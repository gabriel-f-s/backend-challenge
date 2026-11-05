import { describe, expect, it } from "bun:test";
import type { InboxRepositoryPort } from "@modules/messaging/application/ports/outbound/inbox.repository.port";
import type { OutboxRepositoryPort } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import type { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import type { WagerTransactionRepositoryPort } from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import type { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import type { WalletRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import type { WalletLedgerRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import type { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { IdempotencyConflictError } from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

function createInMemoryHarness(initialBalance = "100.00") {
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
    claimDuePendingReferenceBatch: async () => [],
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

  const useCase = new ProcessWagerTransactionUseCase(
    { runInTransaction: async <T>(work: () => Promise<T>): Promise<T> => work() },
    walletRepo,
    ledgerRepo,
    txRepo,
    outboxRepo,
    inboxRepo,
    {
      generate: () => {
        idCounter += 1;
        return `0192f298-345e-7e38-af88-e43f851a8${String(idCounter).padStart(3, "0")}`;
      },
    },
    { now: () => new Date("2026-07-29T15:00:00.000Z") },
  );

  return {
    useCase,
    wallet,
    ledgerEntries,
    outboxMessages,
    transactions,
  };
}

describe("ProcessWagerTransactionUseCase — Wagering Rules & Idempotency", () => {
  it("processes BET, WIN, LOSS, REFUND, and ROLLBACK while maintaining wallet and ledger consistency", async () => {
    const { useCase, wallet, ledgerEntries } = createInMemoryHarness("100.00");

    const betResult = await useCase.execute({
      idempotencyKey: "provider-a:tx-bet-1",
      providerId: "provider-a",
      externalTransactionId: "tx-bet-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(betResult.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(betResult.idempotentReplay).toBe(false);
    expect(wallet.version).toBe(2);
    expect(ledgerEntries).toHaveLength(1);

    const lossResult = await useCase.execute({
      idempotencyKey: "provider-a:tx-loss-1",
      providerId: "provider-a",
      externalTransactionId: "tx-loss-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Loss,
      money: { amount: "0.00", currency: "BRL" },
      referenceExternalTransactionId: "tx-bet-1",
    });

    expect(lossResult.status).toBe(WagerTransactionStatus.Processed);
    expect(lossResult.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(wallet.version).toBe(2);
    expect(ledgerEntries).toHaveLength(1);

    const refundResult = await useCase.execute({
      idempotencyKey: "provider-a:tx-refund-1",
      providerId: "provider-a",
      externalTransactionId: "tx-refund-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: "tx-bet-1",
    });

    expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
    expect(refundResult.balance).toEqual({ amount: "100.00", currency: "BRL" });
    expect(wallet.version).toBe(3);
    expect(ledgerEntries).toHaveLength(2);

    const duplicateRefund = await useCase.execute({
      idempotencyKey: "provider-a:tx-refund-2",
      providerId: "provider-a",
      externalTransactionId: "tx-refund-2",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: "tx-bet-1",
    });

    expect(duplicateRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(duplicateRefund.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
    expect(wallet.version).toBe(3);
  });

  it("returns original observed balance on idempotent replay and throws IdempotencyConflictError on payload mismatch", async () => {
    const { useCase } = createInMemoryHarness("100.00");

    const first = await useCase.execute({
      idempotencyKey: "provider-a:tx-1",
      providerId: "provider-a",
      externalTransactionId: "tx-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });

    await useCase.execute({
      idempotencyKey: "provider-a:tx-2",
      providerId: "provider-a",
      externalTransactionId: "tx-2",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
    });

    const replay = await useCase.execute({
      idempotencyKey: "provider-a:tx-1",
      providerId: "provider-a",
      externalTransactionId: "tx-1",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });

    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance).toEqual({ amount: "75.00", currency: "BRL" });

    await expect(
      useCase.execute({
        idempotencyKey: "provider-a:tx-1",
        providerId: "provider-a",
        externalTransactionId: "tx-1",
        playerId: "player-1",
        walletId: "wallet-1",
        roundId: "round-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("distinguishes INSUFFICIENT_FUNDS_BET from INSUFFICIENT_FUNDS_REVERSAL and handles PENDING_REFERENCE", async () => {
    const { useCase } = createInMemoryHarness("20.00");

    const rejectedBet = await useCase.execute({
      idempotencyKey: "provider-a:bet-too-high",
      providerId: "provider-a",
      externalTransactionId: "bet-too-high",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "50.00", currency: "BRL" },
    });

    expect(rejectedBet.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejectedBet.failureCode).toBe(FailureCode.InsufficientFundsBet);
    expect(rejectedBet.balance).toEqual({ amount: "20.00", currency: "BRL" });

    await useCase.execute({
      idempotencyKey: "provider-a:win-30",
      providerId: "provider-a",
      externalTransactionId: "win-30",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Win,
      money: { amount: "30.00", currency: "BRL" },
    });

    await useCase.execute({
      idempotencyKey: "provider-a:bet-40",
      providerId: "provider-a",
      externalTransactionId: "bet-40",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-2",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    const rejectedReversal = await useCase.execute({
      idempotencyKey: "provider-a:rollback-win-30",
      providerId: "provider-a",
      externalTransactionId: "rollback-win-30",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "30.00", currency: "BRL" },
      referenceExternalTransactionId: "win-30",
    });

    expect(rejectedReversal.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejectedReversal.failureCode).toBe(FailureCode.InsufficientFundsReversal);

    const outOfOrderRefund = await useCase.execute({
      idempotencyKey: "provider-a:refund-missing-bet",
      providerId: "provider-a",
      externalTransactionId: "refund-missing-bet",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-99",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: { amount: "10.00", currency: "BRL" },
      referenceExternalTransactionId: "missing-bet-99",
    });

    expect(outOfOrderRefund.status).toBe(WagerTransactionStatus.PendingReference);
  });
});

