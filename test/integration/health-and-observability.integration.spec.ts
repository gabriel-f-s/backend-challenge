import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { MikroORM } from "@mikro-orm/postgresql";
import { HealthController } from "@modules/health/adapters/inbound/http/health.controller";
import { CheckReadinessUseCase } from "@modules/health/application/use-cases/check-readiness.use-case";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import { MikroOrmWagerTransactionRepository } from "@modules/wagering/adapters/outbound/persistence/repositories/mikro-orm-wager-transaction.repository";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { MikroOrmWalletRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWalletLedgerRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet-ledger.repository";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { HttpStatus } from "@nestjs/common";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { AsyncLocalCorrelationContextAdapter } from "@shared/adapters/outbound/observability/async-local-correlation-context.adapter";
import { InMemoryMetricsAdapter } from "@shared/adapters/outbound/observability/in-memory-metrics.adapter";
import { JsonStructuredLoggerAdapter } from "@shared/adapters/outbound/observability/json-structured-logger.adapter";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { createSqsClient } from "@shared/adapters/outbound/sqs/sqs-client.factory";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import type { Response } from "express";
import { initIntegrationTestOrm, truncateAllTables } from "./helpers/postgres-test-harness";

describe("Health & Observability Integration (Real PostgreSQL + MiniStack SQS)", () => {
  let orm: MikroORM;
  const sqsClient = createSqsClient(loadEnvironmentConfig());
  const idGenerator = new UuidV7GeneratorAdapter();
  const clock = new SystemClockAdapter();

  beforeAll(async () => {
    orm = await initIntegrationTestOrm();
  });

  beforeEach(async () => {
    await truncateAllTables(orm);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("verifies /health/live and /health/ready against real PostgreSQL and MiniStack SQS and records metrics/structured logs without financial leaks", async () => {
    const forkEm = orm.em.fork();
    const uow = new MikroOrmUnitOfWorkAdapter(forkEm);
    const walletRepo = new MikroOrmWalletRepository(forkEm);
    const ledgerRepo = new MikroOrmWalletLedgerRepository(forkEm);
    const txRepo = new MikroOrmWagerTransactionRepository(forkEm);
    const outboxRepo = new MikroOrmOutboxRepository(forkEm);
    const inboxRepo = new MikroOrmInboxRepository(forkEm);

    const correlationContext = new AsyncLocalCorrelationContextAdapter();
    const metrics = new InMemoryMetricsAdapter();
    const capturedLogs: Record<string, unknown>[] = [];
    const logger = new JsonStructuredLoggerAdapter(correlationContext, (line) => {
      capturedLogs.push(JSON.parse(line) as Record<string, unknown>);
    });

    const readinessUseCase = new CheckReadinessUseCase(forkEm, sqsClient);
    const healthController = new HealthController(readinessUseCase, metrics);

    let httpStatus = 0;
    const responseStub = {
      status: (code: number) => {
        httpStatus = code;
      },
    } as unknown as Response;

    const readiness = await healthController.checkReadiness(responseStub);
    expect(httpStatus).toBe(HttpStatus.OK);
    expect(readiness.status).toBe("ok");
    expect(readiness.checks).toEqual({
      postgres: "up",
      sqs: "up",
    });

    const openWallet = new OpenWalletUseCase(
      uow,
      walletRepo,
      ledgerRepo,
      outboxRepo,
      idGenerator,
      clock,
    );
    const processWager = new ProcessWagerTransactionUseCase(
      uow,
      walletRepo,
      ledgerRepo,
      txRepo,
      outboxRepo,
      inboxRepo,
      idGenerator,
      clock,
      metrics,
      logger,
      correlationContext,
    );
    const reconcile = new ReconcileWalletUseCase(walletRepo, ledgerRepo, metrics, logger);

    const wallet = await openWallet.execute({
      playerId: "player-obs-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await correlationContext.run({ correlationId: "corr-obs-1" }, async () => {
      await processWager.execute({
        idempotencyKey: "provider-obs:bet-1",
        providerId: "provider-obs",
        externalTransactionId: "bet-1",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-obs-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
      });

      await processWager.execute({
        idempotencyKey: "provider-obs:bet-1",
        providerId: "provider-obs",
        externalTransactionId: "bet-1",
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-obs-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "40.00", currency: "BRL" },
      });
    });

    const snapshot = healthController.getMetrics();
    expect(snapshot.transactionsByStatus.PROCESSED).toBe(1);
    expect(snapshot.duplicatesDetected.http_idempotency).toBe(1);
    expect(snapshot.outboxLag).toBeGreaterThanOrEqual(3);
    expect(snapshot.processingLatencyMs.process_wager_transaction?.count).toBe(2);

    expect(capturedLogs.length).toBeGreaterThanOrEqual(2);
    for (const log of capturedLogs) {
      expect(log.correlationId).toBe("corr-obs-1");
      expect(log.walletId).toBe(wallet.id);
      expect(log.providerId).toBe("provider-obs");
      expect(log.money).toBeUndefined();
      expect(log.amount).toBeUndefined();
      expect(log.balance).toBeUndefined();
    }

    const reconciliation = await reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
  });
});

