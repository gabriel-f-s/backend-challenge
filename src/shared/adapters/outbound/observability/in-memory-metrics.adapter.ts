import { Injectable } from "@nestjs/common";
import type {
  DuplicateSource,
  LatencyHistogramSnapshot,
  MetricsPort,
  MetricsSnapshot,
  RetryTarget,
} from "@shared/application/ports/outbound/metrics.port";

const MAX_LATENCY_SAMPLES_PER_OPERATION = 5000;

function computePercentile(sortedSamples: number[], percentile: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedSamples.length) - 1),
  );
  return Number((sortedSamples[index] ?? 0).toFixed(2));
}

@Injectable()
export class InMemoryMetricsAdapter implements MetricsPort {
  private readonly transactionsByStatus = new Map<string, number>();
  private readonly duplicates: Record<DuplicateSource, number> = {
    http_idempotency: 0,
    sqs_inbox: 0,
  };
  private readonly retries: Record<RetryTarget, number> = {
    sqs_consumer: 0,
    pending_reference: 0,
    outbox: 0,
  };
  private readonly dlqByErrorCode = new Map<string, number>();
  private dlqTotal = 0;
  private lockConflicts = 0;
  private outboxLag = 0;
  private reconciliationDivergences = 0;
  private readonly latencySamples = new Map<string, number[]>();

  incrementTransactionByStatus(status: string, kind?: string): void {
    const currentStatusCount = this.transactionsByStatus.get(status) ?? 0;
    this.transactionsByStatus.set(status, currentStatusCount + 1);

    if (kind) {
      const compositeKey = `${status}:${kind}`;
      const currentCompositeCount = this.transactionsByStatus.get(compositeKey) ?? 0;
      this.transactionsByStatus.set(compositeKey, currentCompositeCount + 1);
    }
  }

  incrementDuplicateDetected(source: DuplicateSource): void {
    this.duplicates[source] += 1;
  }

  incrementRetry(target: RetryTarget): void {
    this.retries[target] += 1;
  }

  incrementDlqMessage(errorCode: string): void {
    this.dlqTotal += 1;
    const key = errorCode || "UNKNOWN";
    this.dlqByErrorCode.set(key, (this.dlqByErrorCode.get(key) ?? 0) + 1);
  }

  incrementLockConflict(): void {
    this.lockConflicts += 1;
  }

  setOutboxLag(pendingCount: number): void {
    this.outboxLag = Math.max(0, pendingCount);
  }

  incrementReconciliationDivergence(): void {
    this.reconciliationDivergences += 1;
  }

  observeProcessingLatencyMs(operation: string, durationMs: number): void {
    const normalized = Math.max(0, durationMs);
    let samples = this.latencySamples.get(operation);
    if (!samples) {
      samples = [];
      this.latencySamples.set(operation, samples);
    }
    if (samples.length >= MAX_LATENCY_SAMPLES_PER_OPERATION) {
      samples.shift();
    }
    samples.push(normalized);
  }

  getSnapshot(): MetricsSnapshot {
    const processingLatencyMs: Record<string, LatencyHistogramSnapshot> = {};

    for (const [operation, samples] of this.latencySamples.entries()) {
      const sorted = [...samples].sort((a, b) => a - b);
      const sumMs = Number(sorted.reduce((acc, val) => acc + val, 0).toFixed(2));
      processingLatencyMs[operation] = {
        count: sorted.length,
        sumMs,
        minMs: Number((sorted[0] ?? 0).toFixed(2)),
        maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
        p50Ms: computePercentile(sorted, 50),
        p95Ms: computePercentile(sorted, 95),
        p99Ms: computePercentile(sorted, 99),
      };
    }

    return {
      transactionsByStatus: Object.fromEntries(this.transactionsByStatus.entries()),
      duplicatesDetected: {
        ...this.duplicates,
        total: this.duplicates.http_idempotency + this.duplicates.sqs_inbox,
      },
      retries: {
        ...this.retries,
        total:
          this.retries.sqs_consumer + this.retries.pending_reference + this.retries.outbox,
      },
      dlqMessages: {
        total: this.dlqTotal,
        byErrorCode: Object.fromEntries(this.dlqByErrorCode.entries()),
      },
      lockConflicts: this.lockConflicts,
      outboxLag: this.outboxLag,
      reconciliationDivergences: this.reconciliationDivergences,
      processingLatencyMs,
    };
  }
}

