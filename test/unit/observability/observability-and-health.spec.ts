import { describe, expect, it } from "bun:test";
import type { SQSClient } from "@aws-sdk/client-sqs";
import type { EntityManager } from "@mikro-orm/postgresql";
import { HealthController } from "@modules/health/adapters/inbound/http/health.controller";
import { CheckReadinessUseCase } from "@modules/health/application/use-cases/check-readiness.use-case";
import { HttpStatus } from "@nestjs/common";
import { AsyncLocalCorrelationContextAdapter } from "@shared/adapters/outbound/observability/async-local-correlation-context.adapter";
import { InMemoryMetricsAdapter } from "@shared/adapters/outbound/observability/in-memory-metrics.adapter";
import { JsonStructuredLoggerAdapter } from "@shared/adapters/outbound/observability/json-structured-logger.adapter";
import type { Response } from "express";

describe("Observability & Health Checks (Unit)", () => {
  it("propagates correlationId, messageId, transactionId, walletId, and providerId via AsyncLocalStorage and strips raw financial fields in JsonStructuredLogger", async () => {
    const correlationContext = new AsyncLocalCorrelationContextAdapter();
    const lines: string[] = [];
    const logger = new JsonStructuredLoggerAdapter(correlationContext, (line) => {
      lines.push(line);
    });

    await correlationContext.run(
      {
        correlationId: "corr-100",
        messageId: "msg-200",
        walletId: "wallet-300",
        providerId: "provider-400",
      },
      async () => {
        await Promise.resolve();
        correlationContext.merge({ transactionId: "tx-500" });

        logger.info("wager_transaction_processed", {
          kind: "BET",
          money: { amount: "50.00", currency: "BRL" },
          amount: "50.00",
          balance: { amount: "150.00", currency: "BRL" },
          authorization: "Bearer secret-jwt",
          nested: {
            balanceAfter: "150.00",
            roundId: "round-1",
          },
        });
      },
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("wager_transaction_processed");
    expect(parsed.correlationId).toBe("corr-100");
    expect(parsed.messageId).toBe("msg-200");
    expect(parsed.transactionId).toBe("tx-500");
    expect(parsed.walletId).toBe("wallet-300");
    expect(parsed.providerId).toBe("provider-400");
    expect(parsed.kind).toBe("BET");
    expect(parsed.money).toBeUndefined();
    expect(parsed.amount).toBeUndefined();
    expect(parsed.balance).toBeUndefined();
    expect(parsed.authorization).toBeUndefined();
    expect(parsed.nested).toEqual({ roundId: "round-1" });
  });

  it("collects all mandatory metrics (status counters, duplicates, retries, DLQ, lock conflicts, outbox lag, reconciliation divergences, latency percentiles)", () => {
    const metrics = new InMemoryMetricsAdapter();

    metrics.incrementTransactionByStatus("PROCESSED", "BET");
    metrics.incrementTransactionByStatus("PROCESSED", "WIN");
    metrics.incrementTransactionByStatus("REJECTED", "BET");
    metrics.incrementDuplicateDetected("http_idempotency");
    metrics.incrementDuplicateDetected("sqs_inbox");
    metrics.incrementRetry("sqs_consumer");
    metrics.incrementRetry("pending_reference");
    metrics.incrementRetry("outbox");
    metrics.incrementDlqMessage("UNSUPPORTED_SQS_MESSAGE_TYPE");
    metrics.incrementLockConflict();
    metrics.setOutboxLag(7);
    metrics.incrementReconciliationDivergence();

    metrics.observeProcessingLatencyMs("process_wager_transaction", 5);
    metrics.observeProcessingLatencyMs("process_wager_transaction", 12);
    metrics.observeProcessingLatencyMs("process_wager_transaction", 40);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.transactionsByStatus).toEqual({
      PROCESSED: 2,
      "PROCESSED:BET": 1,
      "PROCESSED:WIN": 1,
      REJECTED: 1,
      "REJECTED:BET": 1,
    });
    expect(snapshot.duplicatesDetected).toEqual({
      http_idempotency: 1,
      sqs_inbox: 1,
      total: 2,
    });
    expect(snapshot.retries).toEqual({
      sqs_consumer: 1,
      pending_reference: 1,
      outbox: 1,
      total: 3,
    });
    expect(snapshot.dlqMessages).toEqual({
      total: 1,
      byErrorCode: {
        UNSUPPORTED_SQS_MESSAGE_TYPE: 1,
      },
    });
    expect(snapshot.lockConflicts).toBe(1);
    expect(snapshot.outboxLag).toBe(7);
    expect(snapshot.reconciliationDivergences).toBe(1);
    expect(snapshot.processingLatencyMs.process_wager_transaction).toEqual({
      count: 3,
      sumMs: 57,
      minMs: 5,
      maxMs: 40,
      p50Ms: 12,
      p95Ms: 40,
      p99Ms: 40,
    });
  });

  it("returns 200 on /health/live and /health/ready when healthy, and 503 when PostgreSQL or SQS is down", async () => {
    const metrics = new InMemoryMetricsAdapter();

    const healthyEm = {
      getConnection: () => ({
        execute: async () => [{ "?column?": 1 }],
      }),
    } as unknown as EntityManager;

    const healthySqs = {
      send: async () => ({ Attributes: { QueueArn: "arn:aws:sqs:us-east-1:000000000000:q" } }),
    } as unknown as SQSClient;

    const healthyController = new HealthController(
      new CheckReadinessUseCase(healthyEm, healthySqs),
      metrics,
    );

    const liveResult = healthyController.checkLiveness();
    expect(liveResult.status).toBe("ok");

    let statusCode = 0;
    const responseStub = {
      status: (code: number) => {
        statusCode = code;
      },
    } as unknown as Response;

    const readyResult = await healthyController.checkReadiness(responseStub);
    expect(statusCode).toBe(HttpStatus.OK);
    expect(readyResult.status).toBe("ok");
    expect(readyResult.checks).toEqual({ postgres: "up", sqs: "up" });

    const failingSqs = {
      send: async () => {
        throw new Error("SQS unreachable");
      },
    } as unknown as SQSClient;

    const degradedController = new HealthController(
      new CheckReadinessUseCase(healthyEm, failingSqs),
      metrics,
    );

    const degradedResult = await degradedController.checkReadiness(responseStub);
    expect(statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(degradedResult.status).toBe("degraded");
    expect(degradedResult.checks).toEqual({ postgres: "up", sqs: "down" });
  });
});

