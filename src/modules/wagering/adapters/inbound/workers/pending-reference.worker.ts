import { RetryPendingReferenceTransactionsUseCase } from "@modules/wagering/application/use-cases/retry-pending-reference-transactions.use-case";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

@Injectable()
export class PendingReferenceWorker implements OnModuleDestroy {
  private isProcessing = false;
  private isShuttingDown = false;
  private activePromise: Promise<void> | null = null;

  constructor(
    private readonly retryPendingReferenceTransactionsUseCase: RetryPendingReferenceTransactionsUseCase,
  ) {}

  @Interval(1000)
  async handleTick(): Promise<void> {
    if (
      this.isShuttingDown ||
      this.isProcessing ||
      process.env.PENDING_REFERENCE_WORKER_ENABLED === "false"
    ) {
      return;
    }

    this.isProcessing = true;
    this.activePromise = this.runBatchCycle();

    try {
      await this.activePromise;
    } finally {
      this.activePromise = null;
      this.isProcessing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.activePromise) {
      await this.activePromise;
    }
  }

  private async runBatchCycle(): Promise<void> {
    try {
      await this.retryPendingReferenceTransactionsUseCase.execute(50);
    } catch {
      // Transient infrastructure errors are retried on the next scheduled tick
    }
  }
}

