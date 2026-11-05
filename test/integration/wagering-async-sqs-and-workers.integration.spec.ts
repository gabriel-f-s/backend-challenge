import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import {
  WAGER_TRANSACTION_SQS_CONSUMER_NAME,
  WagerTransactionSqsConsumer,
} from "@modules/wagering/adapters/inbound/messaging/wager-transaction-sqs.consumer";
import { MikroOrmWagerTransactionRepository } from "@modules/wagering/adapters/outbound/persistence/repositories/mikro-orm-wager-transaction.repository";
import { GetWagerTransactionUseCase } from "@modules/wagering/application/use-cases/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { RetryPendingReferenceTransactionsUseCase } from "@modules/wagering/application/use-cases/retry-pending-reference-transactions.use-case";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { MikroOrmWalletRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWalletLedgerRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet-ledger.repository";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { createSqsClient } from "@shared/adapters/outbound/sqs/sqs-client.factory";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { initIntegrationTestOrm, truncateAllTables } from "./helpers/postgres-test-harness";

describe("Wagering Async SQS & PendingReferenceWorker Integration (Real PostgreSQL + MiniStack)", () => {
  let orm: MikroORM;
  const env = loadEnvironmentConfig();
  const sqsClient = createSqsClient(env);
  const idGenerator = new UuidV7GeneratorAdapter();
  let currentNow = new Date();

  const adjustableClock = {
    now: () => currentNow,
  };

  function buildComponents() {
    const forkEm = orm.em.fork();
    const uow = new MikroOrmUnitOfWorkAdapter(forkEm);
    const walletRepo = new MikroOrmWalletRepository(forkEm);
    const ledgerRepo = new MikroOrmWalletLedgerRepository(forkEm);
    const txRepo = new MikroOrmWagerTransactionRepository(forkEm);
    const outboxRepo = new MikroOrmOutboxRepository(forkEm);
    const inboxRepo = new MikroOrmInboxRepository(forkEm);

    const openWallet = new OpenWalletUseCase(
      uow,
      walletRepo,
      ledgerRepo,
      outboxRepo,
      idGenerator,
      adjustableClock,
    );
    const processWager = new ProcessWagerTransactionUseCase(
      uow,
      walletRepo,
      ledgerRepo,
      txRepo,
      outboxRepo,
      inboxRepo,
      idGenerator,
      adjustableClock,
    );
    const retryPendingReference = new RetryPendingReferenceTransactionsUseCase(
      uow,
      txRepo,
      walletRepo,
      outboxRepo,
      idGenerator,
      adjustableClock,
      processWager,
    );
    const getWager = new GetWagerTransactionUseCase(txRepo);
    const reconcile = new ReconcileWalletUseCase(walletRepo, ledgerRepo);
    const sqsConsumer = new WagerTransactionSqsConsumer(sqsClient, processWager);

    return {
      openWallet,
      processWager,
      retryPendingReference,
      getWager,
      reconcile,
      sqsConsumer,
      inboxRepo,
      ledgerRepo,
    };
  }

  async function drainQueue(queueUrl: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const received = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 0,
        }),
      );
      if (!received.Messages || received.Messages.length === 0) {
        break;
      }
      for (const msg of received.Messages) {
        if (msg.ReceiptHandle) {
          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        }
      }
    }
  }

  beforeAll(async () => {
    orm = await initIntegrationTestOrm();
  });

  beforeEach(async () => {
    currentNow = new Date();
    await truncateAllTables(orm);
    await drainQueue(env.sqs.wagerTransactionsQueueUrl);
    await drainQueue(env.sqs.wagerTransactionsDlqUrl);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("handles Section 13 Scenario 7: out-of-order REFUND arrives before BET and is resolved by RetryPendingReferenceTransactionsUseCase", async () => {
    const { openWallet, processWager, retryPendingReference, getWager, reconcile } =
      buildComponents();

    const wallet = await openWallet.execute({
      playerId: "player-out-of-order-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const outOfOrderRefund = await processWager.execute({
      idempotencyKey: "provider-a:refund-early-1",
      providerId: "provider-a",
      externalTransactionId: "refund-early-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-ooo-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-late-1",
    });

    expect(outOfOrderRefund.status).toBe(WagerTransactionStatus.PendingReference);
    expect(outOfOrderRefund.balance.amount).toBe("100.00");

    const lateBet = await processWager.execute({
      idempotencyKey: "provider-a:bet-late-1",
      providerId: "provider-a",
      externalTransactionId: "bet-late-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-ooo-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    expect(lateBet.status).toBe(WagerTransactionStatus.Processed);
    expect(lateBet.balance.amount).toBe("60.00");

    currentNow = new Date(currentNow.getTime() + 2000);
    const retrySummary = await retryPendingReference.execute(20);

    expect(retrySummary).toEqual({
      processedCount: 1,
      retriedCount: 0,
      timedOutCount: 0,
      rejectedCount: 0,
    });

    const resolvedRefund = await getWager.executeById(outOfOrderRefund.transactionId);
    expect(resolvedRefund.status).toBe(WagerTransactionStatus.Processed);
    expect(resolvedRefund.referenceTransactionId).toBe(lateBet.transactionId);

    const reconciliation = await reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("100.00");
    expect(reconciliation.calculatedBalance.amount).toBe("100.00");
    expect(reconciliation.checkedEntries).toBe(3);
  });

  it("rejects PENDING_REFERENCE transaction with REFERENCE_NOT_FOUND_TIMEOUT when retry limit is exhausted", async () => {
    const { openWallet, processWager, retryPendingReference, getWager } = buildComponents();

    const wallet = await openWallet.execute({
      playerId: "player-timeout-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const orphanRollback = await processWager.execute({
      idempotencyKey: "provider-a:rollback-orphan-1",
      providerId: "provider-a",
      externalTransactionId: "rollback-orphan-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-timeout-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "20.00", currency: "BRL" },
      referenceExternalTransactionId: "missing-bet-999",
    });

    expect(orphanRollback.status).toBe(WagerTransactionStatus.PendingReference);

    currentNow = new Date(currentNow.getTime() + 2000);
    const firstRetry = await retryPendingReference.execute(10, { maxAttempts: 2, maxTtlMs: 60_000 });
    expect(firstRetry.retriedCount).toBe(1);

    currentNow = new Date(currentNow.getTime() + 5000);
    const secondRetry = await retryPendingReference.execute(10, { maxAttempts: 2, maxTtlMs: 60_000 });
    expect(secondRetry.timedOutCount).toBe(1);

    const view = await getWager.executeById(orphanRollback.transactionId);
    expect(view.status).toBe(WagerTransactionStatus.Rejected);
    expect(view.failureCode).toBe(FailureCode.ReferenceNotFoundTimeout);
  });

  it("consumes from MiniStack SQS FIFO queue, survives post-commit redelivery via Inbox (Scenario 6), and routes poison messages to DLQ", async () => {
    const { openWallet, sqsConsumer, inboxRepo, reconcile } = buildComponents();

    const wallet = await openWallet.execute({
      playerId: "player-sqs-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const messagePayload = {
      messageId: "msg-sqs-001",
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-sqs",
        externalTransactionId: "sqs-bet-001",
        idempotencyKey: "provider-sqs:sqs-bet-001",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-sqs-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "35.00", currency: "BRL" },
      },
    };

    const sqsRunId = idGenerator.generate();

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.wagerTransactionsQueueUrl,
        MessageBody: JSON.stringify(messagePayload),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${sqsRunId}-first`,
      }),
    );

    const firstPoll = await sqsConsumer.pollOnce(10);
    expect(firstPoll.acked).toBe(1);

    const inboxRecord = await inboxRepo.findByConsumerAndMessageId(
      WAGER_TRANSACTION_SQS_CONSUMER_NAME,
      "msg-sqs-001",
    );
    expect(inboxRecord?.isProcessed()).toBe(true);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.wagerTransactionsQueueUrl,
        MessageBody: JSON.stringify(messagePayload),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${sqsRunId}-redelivery`,
      }),
    );

    const secondPoll = await sqsConsumer.pollOnce(10);
    expect(secondPoll.acked).toBe(1);

    const reconciliation = await reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("65.00");
    expect(reconciliation.calculatedBalance.amount).toBe("65.00");
    expect(reconciliation.checkedEntries).toBe(2);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.wagerTransactionsQueueUrl,
        MessageBody: JSON.stringify({
          messageId: "msg-poison-1",
          type: "UnknownEventType",
          data: {},
        }),
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-${sqsRunId}-poison`,
      }),
    );

    const poisonPoll = await sqsConsumer.pollOnce(10);
    expect(poisonPoll.dlq).toBe(1);

    const dlqMessages = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: env.sqs.wagerTransactionsDlqUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    expect(dlqMessages.Messages?.length).toBeGreaterThanOrEqual(1);
    const dlqBody = JSON.parse(dlqMessages.Messages?.[0]?.Body ?? "{}");
    expect(dlqBody.errorCode).toBe("UNSUPPORTED_SQS_MESSAGE_TYPE");
  });
});

