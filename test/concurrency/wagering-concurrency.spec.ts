import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import type { IntegrationEventPublisherPort } from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import { PublishPendingOutboxUseCase } from "@modules/messaging/application/use-cases/publish-pending-outbox.use-case";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
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
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { createMikroOrmOptions } from "@shared/adapters/outbound/persistence/mikro-orm.config";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { createSqsClient } from "@shared/adapters/outbound/sqs/sqs-client.factory";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { initIntegrationTestOrm, truncateAllTables } from "../integration/helpers/postgres-test-harness";

interface AppNodeInstance {
  readonly orm: MikroORM;
  createScope(customPublisher?: IntegrationEventPublisherPort): {
    readonly openWallet: OpenWalletUseCase;
    readonly processWager: ProcessWagerTransactionUseCase;
    readonly retryPendingReference: RetryPendingReferenceTransactionsUseCase;
    readonly publishOutbox: PublishPendingOutboxUseCase;
    readonly getWager: GetWagerTransactionUseCase;
    readonly reconcile: ReconcileWalletUseCase;
    readonly sqsConsumer: WagerTransactionSqsConsumer;
    readonly ledgerRepo: MikroOrmWalletLedgerRepository;
    readonly outboxRepo: MikroOrmOutboxRepository;
    readonly inboxRepo: MikroOrmInboxRepository;
  };
  close(): Promise<void>;
}

describe("Mandatory Real Concurrency Suite — Section 13 (PostgreSQL + MiniStack SQS)", () => {
  let primaryOrm: MikroORM;
  const env = loadEnvironmentConfig();
  const sqsClient = createSqsClient(env);
  const idGenerator = new UuidV7GeneratorAdapter();
  let currentNow = new Date();

  const adjustableClock = {
    now: () => currentNow,
  };

  async function spawnIndependentNodeInstance(): Promise<AppNodeInstance> {
    const nodeOrm = await MikroORM.init(createMikroOrmOptions(env));
    return buildNodeWrapper(nodeOrm);
  }

  function buildNodeWrapper(nodeOrm: MikroORM): AppNodeInstance {
    return {
      orm: nodeOrm,
      createScope(customPublisher?: IntegrationEventPublisherPort) {
        const forkEm = nodeOrm.em.fork();
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
        const publisher: IntegrationEventPublisherPort = customPublisher ?? {
          publish: async () => {},
        };
        const publishOutbox = new PublishPendingOutboxUseCase(
          uow,
          outboxRepo,
          publisher,
          adjustableClock,
        );
        const getWager = new GetWagerTransactionUseCase(txRepo);
        const reconcile = new ReconcileWalletUseCase(walletRepo, ledgerRepo);
        const sqsConsumer = new WagerTransactionSqsConsumer(sqsClient, processWager);

        return {
          openWallet,
          processWager,
          retryPendingReference,
          publishOutbox,
          getWager,
          reconcile,
          sqsConsumer,
          ledgerRepo,
          outboxRepo,
          inboxRepo,
        };
      },
      async close() {
        await nodeOrm.close(true);
      },
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
    primaryOrm = await initIntegrationTestOrm();
  });

  beforeEach(async () => {
    currentNow = new Date();
    await truncateAllTables(primaryOrm);
    await drainQueue(env.sqs.wagerTransactionsQueueUrl);
    await drainQueue(env.sqs.wagerTransactionsDlqUrl);
  });

  afterAll(async () => {
    await primaryOrm.close(true);
  });

  it("Scenario 1: same bet sent 50 times in parallel -> produces a single debit and 49 idempotent replays", async () => {
    const primaryNode = buildNodeWrapper(primaryOrm);
    const setupScope = primaryNode.createScope();

    const wallet = await setupScope.openWallet.execute({
      playerId: "player-conc-1",
      initialBalance: { amount: "200.00", currency: "BRL" },
    });

    const parallelResponses = await Promise.all(
      Array.from({ length: 50 }, () =>
        primaryNode.createScope().processWager.execute({
          idempotencyKey: "provider-c1:bet-50x",
          providerId: "provider-c1",
          externalTransactionId: "bet-50x",
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "round-c1",
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Bet,
          money: { amount: "45.00", currency: "BRL" },
        }),
      ),
    );

    const freshExecutions = parallelResponses.filter((r) => !r.idempotentReplay);
    const replays = parallelResponses.filter((r) => r.idempotentReplay);

    expect(freshExecutions).toHaveLength(1);
    expect(replays).toHaveLength(49);

    for (const response of parallelResponses) {
      expect(response.status).toBe(WagerTransactionStatus.Processed);
      expect(response.balance).toEqual({ amount: "155.00", currency: "BRL" });
    }

    const reconciliation = await setupScope.reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("155.00");
    expect(reconciliation.calculatedBalance.amount).toBe("155.00");
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it("Scenario 2: concurrent operations competing for the same wallet balance (100.00 BRL vs two 80.00 BRL bets)", async () => {
    const primaryNode = buildNodeWrapper(primaryOrm);
    const setupScope = primaryNode.createScope();

    const wallet = await setupScope.openWallet.execute({
      playerId: "player-conc-2",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const [betA, betB] = await Promise.all([
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c2:bet-a",
        providerId: "provider-c2",
        externalTransactionId: "bet-a",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c2:bet-b",
        providerId: "provider-c2",
        externalTransactionId: "bet-b",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
    ]);

    const outcomes = [betA, betB];
    const processed = outcomes.filter((o) => o.status === WagerTransactionStatus.Processed);
    const rejected = outcomes.filter((o) => o.status === WagerTransactionStatus.Rejected);

    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.failureCode).toBe(FailureCode.InsufficientFundsBet);

    const allEntries = await setupScope.ledgerRepo.findAllByWalletIdOrdered(wallet.id);
    const debitEntries = allEntries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debitEntries).toHaveLength(1);

    const reconciliation = await setupScope.reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("20.00");
    expect(reconciliation.calculatedBalance.amount).toBe("20.00");
  });

  it("Scenario 3: distinct wallets processed in parallel without mutual blocking", async () => {
    const primaryNode = buildNodeWrapper(primaryOrm);
    const setupScope = primaryNode.createScope();

    const wallets = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        setupScope.openWallet.execute({
          playerId: `player-conc-3-${idx}`,
          initialBalance: { amount: "100.00", currency: "BRL" },
        }),
      ),
    );

    await Promise.all(
      wallets.flatMap((wallet, idx) => [
        primaryNode.createScope().processWager.execute({
          idempotencyKey: `provider-c3:bet-${idx}`,
          providerId: "provider-c3",
          externalTransactionId: `bet-${idx}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: `round-c3-${idx}`,
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Bet,
          money: { amount: "30.00", currency: "BRL" },
        }),
        primaryNode.createScope().processWager.execute({
          idempotencyKey: `provider-c3:win-${idx}`,
          providerId: "provider-c3",
          externalTransactionId: `win-${idx}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: `round-c3-${idx}`,
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Win,
          money: { amount: "15.00", currency: "BRL" },
        }),
      ]),
    );

    for (const wallet of wallets) {
      const reconciliation = await setupScope.reconcile.execute(wallet.id);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.amount).toBe("85.00");
      expect(reconciliation.calculatedBalance.amount).toBe("85.00");
    }
  });

  it("Scenario 4: >= 3 simultaneous application instances competing on the same hot wallet", async () => {
    const [node1, node2, node3] = await Promise.all([
      spawnIndependentNodeInstance(),
      spawnIndependentNodeInstance(),
      spawnIndependentNodeInstance(),
    ]);

    try {
      const wallet = await node1.createScope().openWallet.execute({
        playerId: "player-conc-4-hot",
        initialBalance: { amount: "150.00", currency: "BRL" },
      });

      const nodes = [node1, node2, node3];
      const results = await Promise.all(
        Array.from({ length: 9 }, (_, idx) => {
          const targetNode = nodes[idx % nodes.length] ?? node1;
          return targetNode.createScope().processWager.execute({
            idempotencyKey: `provider-c4:bet-${idx}`,
            providerId: "provider-c4",
            externalTransactionId: `bet-${idx}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: `round-c4-${idx}`,
            gameId: "fortune-chimp",
            kind: WagerTransactionKind.Bet,
            money: { amount: "30.00", currency: "BRL" },
          });
        }),
      );

      const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
      const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

      expect(processed).toHaveLength(5);
      expect(rejected).toHaveLength(4);

      const reconciliation = await node2.createScope().reconcile.execute(wallet.id);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.amount).toBe("0.00");
      expect(reconciliation.calculatedBalance.amount).toBe("0.00");
      expect(reconciliation.checkedEntries).toBe(6);
    } finally {
      await Promise.all([node1.close(), node2.close(), node3.close()]);
    }
  });

  it("Scenario 5: worker killed after SQL commit and before SQS ack -> redelivery is deduplicated safely via Inbox", async () => {
    const primaryNode = buildNodeWrapper(primaryOrm);
    const scope1 = primaryNode.createScope();

    const wallet = await scope1.openWallet.execute({
      playerId: "player-conc-5",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const sqsMessageBody = JSON.stringify({
      messageId: "msg-crash-before-ack-1",
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-c5",
        externalTransactionId: "tx-c5-1",
        idempotencyKey: "provider-c5:tx-c5-1",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c5",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
      },
    });

    await scope1.processWager.execute({
      idempotencyKey: "provider-c5:tx-c5-1",
      providerId: "provider-c5",
      externalTransactionId: "tx-c5-1",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-c5",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
      inboxEnvelope: {
        consumerName: WAGER_TRANSACTION_SQS_CONSUMER_NAME,
        messageId: "msg-crash-before-ack-1",
      },
    });

    const runId = idGenerator.generate();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.wagerTransactionsQueueUrl,
        MessageBody: sqsMessageBody,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: `dedup-c5-${runId}`,
      }),
    );

    const scope2 = primaryNode.createScope();
    const pollSummary = await scope2.sqsConsumer.pollOnce(10);
    expect(pollSummary.acked).toBe(1);

    const reconciliation = await scope2.reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("60.00");
    expect(reconciliation.calculatedBalance.amount).toBe("60.00");
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it("Scenario 6: two concurrent publishers over the same Outbox using FOR UPDATE SKIP LOCKED", async () => {
    const [nodeA, nodeB] = await Promise.all([
      spawnIndependentNodeInstance(),
      spawnIndependentNodeInstance(),
    ]);

    try {
      const setupScope = nodeA.createScope();
      const wallet = await setupScope.openWallet.execute({
        playerId: "player-conc-6",
        initialBalance: { amount: "500.00", currency: "BRL" },
      });

      for (let i = 0; i < 10; i++) {
        await nodeA.createScope().processWager.execute({
          idempotencyKey: `provider-c6:bet-${i}`,
          providerId: "provider-c6",
          externalTransactionId: `bet-${i}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: `round-c6-${i}`,
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Bet,
          money: { amount: "10.00", currency: "BRL" },
        });
      }

      const publishedEventIds: string[] = [];
      const trackingPublisher: IntegrationEventPublisherPort = {
        publish: async (msg: OutboxMessage) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          publishedEventIds.push(msg.id);
        },
      };

      const [resA, resB] = await Promise.all([
        nodeA.createScope(trackingPublisher).publishOutbox.execute(15),
        nodeB.createScope(trackingPublisher).publishOutbox.execute(15),
      ]);

      expect(resA.published + resB.published).toBe(21);
      expect(new Set(publishedEventIds).size).toBe(21);
      expect(await setupScope.outboxRepo.countPending()).toBe(0);

      const reconciliation = await setupScope.reconcile.execute(wallet.id);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.amount).toBe("400.00");
    } finally {
      await Promise.all([nodeA.close(), nodeB.close()]);
    }
  });

  it("Scenario 7: ROLLBACK and REFUND delivered before their referenced transactions", async () => {
    const primaryNode = buildNodeWrapper(primaryOrm);
    const scope = primaryNode.createScope();

    const wallet = await scope.openWallet.execute({
      playerId: "player-conc-7",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const [earlyRefund, earlyRollback] = await Promise.all([
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c7:early-refund",
        providerId: "provider-c7",
        externalTransactionId: "early-refund",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c7-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Refund,
        money: { amount: "30.00", currency: "BRL" },
        referenceExternalTransactionId: "bet-for-refund",
      }),
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c7:early-rollback",
        providerId: "provider-c7",
        externalTransactionId: "early-rollback",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c7-2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Rollback,
        money: { amount: "50.00", currency: "BRL" },
        referenceExternalTransactionId: "win-for-rollback",
      }),
    ]);

    expect(earlyRefund.status).toBe(WagerTransactionStatus.PendingReference);
    expect(earlyRollback.status).toBe(WagerTransactionStatus.PendingReference);

    await Promise.all([
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c7:bet-for-refund",
        providerId: "provider-c7",
        externalTransactionId: "bet-for-refund",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c7-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      }),
      primaryNode.createScope().processWager.execute({
        idempotencyKey: "provider-c7:win-for-rollback",
        providerId: "provider-c7",
        externalTransactionId: "win-for-rollback",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c7-2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Win,
        money: { amount: "50.00", currency: "BRL" },
      }),
    ]);

    currentNow = new Date(currentNow.getTime() + 2000);
    const retryResult = await scope.retryPendingReference.execute(10);
    expect(retryResult.processedCount).toBe(2);

    const reconciliation = await scope.reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe("100.00");
    expect(reconciliation.calculatedBalance.amount).toBe("100.00");
    expect(reconciliation.checkedEntries).toBe(5);
  });

  it("Scenario 8: service restart proving final consistency across persisted state, pending references, and outbox", async () => {
    const firstGenerationNode = await spawnIndependentNodeInstance();
    let walletId = "";

    try {
      const scopeGen1 = firstGenerationNode.createScope();
      const wallet = await scopeGen1.openWallet.execute({
        playerId: "player-conc-8-restart",
        initialBalance: { amount: "250.00", currency: "BRL" },
      });
      walletId = wallet.id;

      await Promise.all([
        firstGenerationNode.createScope().processWager.execute({
          idempotencyKey: "provider-c8:bet-1",
          providerId: "provider-c8",
          externalTransactionId: "bet-1",
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "round-c8-1",
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Bet,
          money: { amount: "70.00", currency: "BRL" },
        }),
        firstGenerationNode.createScope().processWager.execute({
          idempotencyKey: "provider-c8:refund-ooo",
          providerId: "provider-c8",
          externalTransactionId: "refund-ooo",
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "round-c8-2",
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Refund,
          money: { amount: "40.00", currency: "BRL" },
          referenceExternalTransactionId: "bet-2",
        }),
      ]);

      await firstGenerationNode.createScope().processWager.execute({
        idempotencyKey: "provider-c8:bet-2",
        providerId: "provider-c8",
        externalTransactionId: "bet-2",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-c8-2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
      });
    } finally {
      await firstGenerationNode.close();
    }

    const restartedNode = await spawnIndependentNodeInstance();
    try {
      const scopeGen2 = restartedNode.createScope();
      currentNow = new Date(currentNow.getTime() + 2500);

      const pendingRefSummary = await scopeGen2.retryPendingReference.execute(10);
      expect(pendingRefSummary.processedCount).toBe(1);

      const outboxSummary = await scopeGen2.publishOutbox.execute(50);
      expect(outboxSummary.published).toBeGreaterThanOrEqual(7);
      expect(await scopeGen2.outboxRepo.countPending()).toBe(0);

      const reconciliation = await scopeGen2.reconcile.execute(walletId);
      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance.amount).toBe("180.00");
      expect(reconciliation.calculatedBalance.amount).toBe("180.00");
      expect(reconciliation.difference.amount).toBe("0.00");
      expect(reconciliation.checkedEntries).toBe(4);
    } finally {
      await restartedNode.close();
    }
  });
});
