import { describe, expect, it } from "bun:test";
import type { InboxRepositoryPort } from "@modules/messaging/application/ports/outbound/inbox.repository.port";
import type { OutboxRepositoryPort } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import type { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import type { WagerTransactionRepositoryPort } from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { RetryPendingReferenceTransactionsUseCase } from "@modules/wagering/application/use-cases/retry-pending-reference-transactions.use-case";
import type { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import type { WalletRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import type { WalletLedgerRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import type { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

function createPendingRefTestHarness(initialBalance = "100.00") {
  let currentTime = new Date("2026-11-05T17:00:00.000Z");
  const wallet = Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: Money.from({ amount: initialBalance, currency: "BRL" }),
  });

  const wallets = new Map<string, Wallet>([[wallet.id, wallet]]);
  const transactions = new Map<string, WagerTransaction>();
  const ledgerEntries: WalletLedgerEntry[] = [];
  const outboxMessages: OutboxMessage[] = [];
  const inboxMessages = new Map<string, InboxMessage>();
  let idCounter = 0;

  const walletRepo: WalletRepositoryPort = {
    findById: async (id) => wallets.get(id) ?? null,
    findByIdForUpdate: async (id) => wallets.get(id) ?? null,
    findByPlayerAndCurrency: async () => null,
    insert: async (w) => {
      wallets.set(w.id, w);
    },
    save: async (w) => {
      wallets.set(w.id, w);
    },
  };

  const ledgerRepo: WalletLedgerRepositoryPort = {
    insert: async (entry) => {
      ledgerEntries.push(entry);
    },
    insertOpeningTransactionAndLedgerEntry: async () => {},
    findByWalletAndTransactionId: async () => null,
    listByWalletId: async () => ({ items: [], nextCursor: null }),
    findAllByWalletIdOrdered: async () => ledgerEntries,
  };

  const txRepo: WagerTransactionRepositoryPort = {
    findById: async (id) => transactions.get(id) ?? null,
    findByIdempotencyKey: async (key) => {
      for (const tx of transactions.values()) {
        if (tx.idempotencyKey === key) {
          return tx;
        }
      }
      return null;
    },
    findByProviderAndExternalId: async (providerId, externalId) => {
      for (const tx of transactions.values()) {
        if (tx.providerId === providerId && tx.externalTransactionId === externalId) {
          return tx;
        }
      }
      return null;
    },
    findProcessedReversalByReferenceAndKind: async (refId, kind) => {
      for (const tx of transactions.values()) {
        if (
          tx.referenceTransactionId === refId &&
          tx.kind === kind &&
          tx.status === WagerTransactionStatus.Processed
        ) {
          return tx;
        }
      }
      return null;
    },
    claimDuePendingReferenceBatch: async (now, limit) => {
      const due: WagerTransaction[] = [];
      for (const tx of transactions.values()) {
        if (
          tx.status === WagerTransactionStatus.PendingReference &&
          (!tx.nextAttemptAt || tx.nextAttemptAt.getTime() <= now.getTime())
        ) {
          due.push(tx);
          if (due.length >= limit) {
            break;
          }
        }
      }
      return due;
    },
    insert: async (tx) => {
      transactions.set(tx.id, tx);
    },
    save: async (tx) => {
      transactions.set(tx.id, tx);
    },
  };

  const outboxRepo: OutboxRepositoryPort = {
    enqueue: async (msg) => {
      outboxMessages.push(msg);
    },
    enqueueMany: async (msgs) => {
      outboxMessages.push(...msgs);
    },
    claimDueBatch: async () => [],
    save: async () => {},
    countPending: async () => outboxMessages.length,
  };

  const inboxRepo: InboxRepositoryPort = {
    findByConsumerAndMessageId: async (consumer, msgId) =>
      inboxMessages.get(`${consumer}:${msgId}`) ?? null,
    insertIfAbsent: async (msg) => {
      const key = `${msg.consumerName}:${msg.messageId}`;
      const existing = inboxMessages.get(key);
      if (existing) {
        return { inserted: false, message: existing };
      }
      inboxMessages.set(key, msg);
      return { inserted: true, message: msg };
    },
    save: async (msg) => {
      inboxMessages.set(`${msg.consumerName}:${msg.messageId}`, msg);
    },
  };

  const unitOfWork = {
    runInTransaction: async <T>(work: () => Promise<T>) => work(),
  };
  const idGenerator = {
    generate: () => `id-${++idCounter}`,
  };
  const clock = {
    now: () => currentTime,
  };

  const processUseCase = new ProcessWagerTransactionUseCase(
    unitOfWork,
    walletRepo,
    ledgerRepo,
    txRepo,
    outboxRepo,
    inboxRepo,
    idGenerator,
    clock,
  );

  const retryUseCase = new RetryPendingReferenceTransactionsUseCase(
    unitOfWork,
    txRepo,
    walletRepo,
    outboxRepo,
    idGenerator,
    clock,
    processUseCase,
  );

  return {
    processUseCase,
    retryUseCase,
    wallet,
    transactions,
    ledgerEntries,
    outboxMessages,
    advanceTimeMs: (ms: number) => {
      currentTime = new Date(currentTime.getTime() + ms);
    },
  };
}

describe("RetryPendingReferenceTransactionsUseCase", () => {
  it("resolves an out-of-order REFUND once the referenced BET arrives", async () => {
    const { processUseCase, retryUseCase, wallet, ledgerEntries, outboxMessages, advanceTimeMs } =
      createPendingRefTestHarness("100.00");

    const refundOut = await processUseCase.execute({
      idempotencyKey: "provider-a:refund-out-of-order",
      providerId: "provider-a",
      externalTransactionId: "refund-out-of-order",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "30.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-late",
    });

    expect(refundOut.status).toBe(WagerTransactionStatus.PendingReference);
    expect(wallet.balance.amount).toBe("100.00");

    const betOut = await processUseCase.execute({
      idempotencyKey: "provider-a:bet-late",
      providerId: "provider-a",
      externalTransactionId: "bet-late",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    expect(betOut.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.amount).toBe("70.00");

    advanceTimeMs(1500);
    const retryResult = await retryUseCase.execute(10);

    expect(retryResult).toEqual({
      processedCount: 1,
      retriedCount: 0,
      timedOutCount: 0,
      rejectedCount: 0,
    });
    expect(wallet.balance.amount).toBe("100.00");
    expect(ledgerEntries).toHaveLength(2);
    expect(
      outboxMessages.some(
        (m) =>
          m.eventType === "WagerTransactionProcessed" &&
          m.aggregateId === refundOut.transactionId,
      ),
    ).toBe(true);
  });

  it("schedules exponential backoff retries and rejects with REFERENCE_NOT_FOUND_TIMEOUT when maxAttempts is exhausted", async () => {
    const { processUseCase, retryUseCase, transactions, outboxMessages, advanceTimeMs } =
      createPendingRefTestHarness("100.00");

    const refundOut = await processUseCase.execute({
      idempotencyKey: "provider-a:refund-orphan",
      providerId: "provider-a",
      externalTransactionId: "refund-orphan",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "20.00", currency: "BRL" },
      referenceExternalTransactionId: "never-arrives",
    });

    expect(refundOut.status).toBe(WagerTransactionStatus.PendingReference);

    advanceTimeMs(1500);
    const firstRetry = await retryUseCase.execute(10, { maxAttempts: 3, maxTtlMs: 120_000 });
    expect(firstRetry.retriedCount).toBe(1);
    expect(transactions.get(refundOut.transactionId)?.attempts).toBe(1);

    advanceTimeMs(2500);
    const secondRetry = await retryUseCase.execute(10, { maxAttempts: 3, maxTtlMs: 120_000 });
    expect(secondRetry.retriedCount).toBe(1);
    expect(transactions.get(refundOut.transactionId)?.attempts).toBe(2);

    advanceTimeMs(4500);
    const thirdRetry = await retryUseCase.execute(10, { maxAttempts: 3, maxTtlMs: 120_000 });
    expect(thirdRetry).toEqual({
      processedCount: 0,
      retriedCount: 0,
      timedOutCount: 1,
      rejectedCount: 1,
    });

    const rejectedTx = transactions.get(refundOut.transactionId);
    expect(rejectedTx?.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejectedTx?.failureCode).toBe(FailureCode.ReferenceNotFoundTimeout);
    expect(
      outboxMessages.some(
        (m) =>
          m.eventType === "WagerTransactionRejected" &&
          m.aggregateId === refundOut.transactionId,
      ),
    ).toBe(true);
  });
});

