export const METRICS_PORT = Symbol("METRICS_PORT");

export type DuplicateSource = "http_idempotency" | "sqs_inbox";
export type RetryTarget = "sqs_consumer" | "pending_reference" | "outbox";

export interface LatencyHistogramSnapshot {
  readonly count: number;
  readonly sumMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface MetricsSnapshot {
  readonly transactionsByStatus: Readonly<Record<string, number>>;
  readonly duplicatesDetected: Readonly<Record<DuplicateSource, number>> & {
    readonly total: number;
  };
  readonly retries: Readonly<Record<RetryTarget, number>> & {
    readonly total: number;
  };
  readonly dlqMessages: {
    readonly total: number;
    readonly byErrorCode: Readonly<Record<string, number>>;
  };
  readonly lockConflicts: number;
  readonly outboxLag: number;
  readonly reconciliationDivergences: number;
  readonly processingLatencyMs: Readonly<Record<string, LatencyHistogramSnapshot>>;
}

export interface MetricsPort {
  incrementTransactionByStatus(status: string, kind?: string): void;
  incrementDuplicateDetected(source: DuplicateSource): void;
  incrementRetry(target: RetryTarget): void;
  incrementDlqMessage(errorCode: string): void;
  incrementLockConflict(): void;
  setOutboxLag(pendingCount: number): void;
  incrementReconciliationDivergence(): void;
  observeProcessingLatencyMs(operation: string, durationMs: number): void;
  getSnapshot(): MetricsSnapshot;
}

