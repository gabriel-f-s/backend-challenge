import {
  OUTBOX_REPOSITORY_PORT,
  type OutboxRepositoryPort,
} from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { WagerTransactionRejected } from "@modules/wagering/domain/events/wager-transaction-rejected.event";
import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { CLOCK_PORT, type ClockPort } from "@shared/application/ports/outbound/clock.port";
import {
  ID_GENERATOR_PORT,
  type IdGeneratorPort,
} from "@shared/application/ports/outbound/id-generator.port";
import { METRICS_PORT, type MetricsPort } from "@shared/application/ports/outbound/metrics.port";
import {
  STRUCTURED_LOGGER_PORT,
  type StructuredLoggerPort,
} from "@shared/application/ports/outbound/structured-logger.port";
import {
  UNIT_OF_WORK_PORT,
  type UnitOfWorkPort,
} from "@shared/application/ports/outbound/unit-of-work.port";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { ProcessWagerTransactionUseCase } from "./process-wager-transaction.use-case";

export interface RetryPendingReferenceOptions {
  readonly maxAttempts?: number;
  readonly maxTtlMs?: number;
}

export interface RetryPendingReferenceOutput {
  readonly processedCount: number;
  readonly retriedCount: number;
  readonly timedOutCount: number;
  readonly rejectedCount: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_TTL_MS = 60_000;

@Injectable()
export class RetryPendingReferenceTransactionsUseCase {
  constructor(
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(ID_GENERATOR_PORT)
    private readonly idGenerator: IdGeneratorPort,
    @Inject(CLOCK_PORT)
    private readonly clock: ClockPort,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    @Optional()
    @Inject(METRICS_PORT)
    private readonly metrics?: MetricsPort,
    @Optional()
    @Inject(STRUCTURED_LOGGER_PORT)
    private readonly logger?: StructuredLoggerPort,
  ) {}

  async execute(
    batchSize = 50,
    options?: RetryPendingReferenceOptions,
  ): Promise<RetryPendingReferenceOutput> {
    const maxAttempts =
      options?.maxAttempts ??
      (Number.parseInt(process.env.PENDING_REFERENCE_MAX_ATTEMPTS ?? "", 10) ||
        DEFAULT_MAX_ATTEMPTS);
    const maxTtlMs =
      options?.maxTtlMs ??
      (Number.parseInt(process.env.PENDING_REFERENCE_MAX_TTL_MS ?? "", 10) || DEFAULT_MAX_TTL_MS);

    return this.unitOfWork.runInTransaction(async () => {
      const now = this.clock.now();
      const dueTransactions = await this.wagerTransactionRepository.claimDuePendingReferenceBatch(
        now,
        batchSize,
      );

      if (dueTransactions.length === 0) {
        return {
          processedCount: 0,
          retriedCount: 0,
          timedOutCount: 0,
          rejectedCount: 0,
        };
      }

      const sortedTransactions = [...dueTransactions].sort((left, right) => {
        const walletOrder = left.walletId.localeCompare(right.walletId);
        if (walletOrder !== 0) {
          return walletOrder;
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });

      let processedCount = 0;
      let retriedCount = 0;
      let timedOutCount = 0;
      let rejectedCount = 0;

      for (const transaction of sortedTransactions) {
        const wallet = await this.walletRepository.findByIdForUpdate(transaction.walletId);
        if (!wallet) {
          transaction.reject(FailureCode.ReferenceContextMismatch, now);
          await this.wagerTransactionRepository.save(transaction);
          const rejectedEvent = WagerTransactionRejected.from(
            transaction,
            FailureCode.ReferenceContextMismatch,
            {
              eventId: this.idGenerator.generate(),
              correlationId: transaction.id,
              causationId: transaction.id,
              occurredAt: now,
            },
          );
          await this.outboxRepository.enqueue(OutboxMessage.enqueue(rejectedEvent));
          this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
          rejectedCount += 1;
          continue;
        }

        const reference = transaction.referenceExternalTransactionId
          ? await this.wagerTransactionRepository.findByProviderAndExternalId(
              transaction.providerId,
              transaction.referenceExternalTransactionId,
            )
          : null;

        const isReferenceStillMissing =
          !reference ||
          reference.status === WagerTransactionStatus.Pending ||
          reference.status === WagerTransactionStatus.PendingReference;

        if (!isReferenceStillMissing) {
          await this.processWagerTransactionUseCase.evaluateAndApplyTransaction(
            transaction,
            wallet,
            now,
            transaction.id,
            false,
          );

          if (transaction.status === WagerTransactionStatus.Processed) {
            processedCount += 1;
          } else if (transaction.status === WagerTransactionStatus.Rejected) {
            rejectedCount += 1;
          } else {
            retriedCount += 1;
          }
          continue;
        }

        const nextAttemptCount = transaction.attempts + 1;
        const elapsedMs = now.getTime() - transaction.createdAt.getTime();
        const isExpired = nextAttemptCount >= maxAttempts || elapsedMs >= maxTtlMs;

        if (isExpired) {
          transaction.reject(FailureCode.ReferenceNotFoundTimeout, now, wallet.balance);
          await this.wagerTransactionRepository.save(transaction);

          const rejectedEvent = WagerTransactionRejected.from(
            transaction,
            FailureCode.ReferenceNotFoundTimeout,
            {
              eventId: this.idGenerator.generate(),
              correlationId: transaction.id,
              causationId: transaction.id,
              occurredAt: now,
            },
          );
          await this.outboxRepository.enqueue(OutboxMessage.enqueue(rejectedEvent));
          this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
          this.logger?.warn("wager_transaction_pending_reference_timed_out", {
            transactionId: transaction.id,
            walletId: transaction.walletId,
            providerId: transaction.providerId,
            attempts: nextAttemptCount,
          });
          timedOutCount += 1;
          rejectedCount += 1;
        } else {
          transaction.schedulePendingReferenceRetry(now);
          await this.wagerTransactionRepository.save(transaction);
          this.metrics?.incrementRetry("pending_reference");
          retriedCount += 1;
        }
      }

      return {
        processedCount,
        retriedCount,
        timedOutCount,
        rejectedCount,
      };
    });
  }
}
