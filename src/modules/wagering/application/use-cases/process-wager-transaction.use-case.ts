import {
  INBOX_REPOSITORY_PORT,
  type InboxRepositoryPort,
} from "@modules/messaging/application/ports/outbound/inbox.repository.port";
import {
  OUTBOX_REPOSITORY_PORT,
  type OutboxRepositoryPort,
} from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { WagerTransactionPendingReference } from "@modules/wagering/domain/events/wager-transaction-pending-reference.event";
import { WagerTransactionProcessed } from "@modules/wagering/domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "@modules/wagering/domain/events/wager-transaction-rejected.event";
import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import {
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import type { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { WalletBalanceChanged } from "@modules/wallet/domain/events/wallet-balance-changed.event";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { CLOCK_PORT, type ClockPort } from "@shared/application/ports/outbound/clock.port";
import {
  CORRELATION_CONTEXT_PORT,
  type CorrelationContextPort,
} from "@shared/application/ports/outbound/correlation-context.port";
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
import {
  BusinessRuleViolationError,
  DomainValidationError,
  IdempotencyConflictError,
  ResourceNotFoundError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { CanonicalPayloadHash } from "@shared/domain/services/canonical-payload-hash.service";
import { Money, type MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface InboxDeliveryEnvelope {
  readonly consumerName: string;
  readonly messageId: string;
}

export interface ProcessWagerTransactionCommand {
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly correlationId?: string;
  readonly inboxEnvelope?: InboxDeliveryEnvelope;
}

export interface ProcessWagerTransactionOutput {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps;
  readonly idempotentReplay: boolean;
  readonly failureCode?: FailureCode;
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly walletLedgerRepository: WalletLedgerRepositoryPort,
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(INBOX_REPOSITORY_PORT)
    private readonly inboxRepository: InboxRepositoryPort,
    @Inject(ID_GENERATOR_PORT)
    private readonly idGenerator: IdGeneratorPort,
    @Inject(CLOCK_PORT)
    private readonly clock: ClockPort,
    @Optional()
    @Inject(METRICS_PORT)
    private readonly metrics?: MetricsPort,
    @Optional()
    @Inject(STRUCTURED_LOGGER_PORT)
    private readonly logger?: StructuredLoggerPort,
    @Optional()
    @Inject(CORRELATION_CONTEXT_PORT)
    private readonly correlationContext?: CorrelationContextPort,
  ) {}

  async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionOutput> {
    const startedAt = performance.now();
    if (!command.idempotencyKey || command.idempotencyKey.trim() === "") {
      throw new DomainValidationError(
        "Idempotency-Key header is required",
        "MISSING_IDEMPOTENCY_KEY",
      );
    }

    const idempotencyKey = command.idempotencyKey.trim();
    const money = Money.from(command.money);
    const trimmedRef = command.referenceExternalTransactionId?.trim() || undefined;

    const payloadHash = CanonicalPayloadHash.compute({
      providerId: command.providerId.trim(),
      externalTransactionId: command.externalTransactionId.trim(),
      playerId: command.playerId.trim(),
      walletId: command.walletId.trim(),
      roundId: command.roundId.trim(),
      gameId: command.gameId.trim(),
      kind: command.kind,
      money: money.toJSON(),
      ...(trimmedRef ? { referenceExternalTransactionId: trimmedRef } : {}),
    });

    const candidateTransaction = WagerTransaction.create({
      id: this.idGenerator.generate(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey,
      payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money,
      referenceExternalTransactionId: trimmedRef,
      createdAt: this.clock.now(),
    });

    const correlationId =
      command.correlationId ??
      this.correlationContext?.get()?.correlationId ??
      candidateTransaction.id;
    this.correlationContext?.merge({
      correlationId,
      messageId: command.inboxEnvelope?.messageId,
      transactionId: candidateTransaction.id,
      walletId: candidateTransaction.walletId,
      providerId: candidateTransaction.providerId,
    });

    try {
      return await this.unitOfWork.runInTransaction(async () => {
        const now = this.clock.now();
        let inboxMessageToComplete: InboxMessage | undefined;

        if (command.inboxEnvelope) {
          const inboxCandidate = InboxMessage.receive({
            consumerName: command.inboxEnvelope.consumerName,
            messageId: command.inboxEnvelope.messageId,
            payloadHash,
            receivedAt: now,
          });
          const inboxResult = await this.inboxRepository.insertIfAbsent(inboxCandidate);
          if (!inboxResult.inserted && inboxResult.message.isProcessed()) {
            const existingForInbox = await this.findExistingTransaction(
              idempotencyKey,
              candidateTransaction.providerId,
              candidateTransaction.externalTransactionId,
            );
            if (existingForInbox) {
              this.metrics?.incrementDuplicateDetected("sqs_inbox");
              this.logger?.info("wager_transaction_inbox_duplicate_detected", {
                transactionId: existingForInbox.id,
                walletId: existingForInbox.walletId,
                providerId: existingForInbox.providerId,
                messageId: command.inboxEnvelope.messageId,
              });
              return this.buildReplayOutput(existingForInbox, payloadHash);
            }
          }
          if (!inboxResult.message.isProcessed()) {
            inboxMessageToComplete = inboxResult.message;
          }
        }

        const preLockExisting = await this.findExistingTransaction(
          idempotencyKey,
          candidateTransaction.providerId,
          candidateTransaction.externalTransactionId,
        );
        if (preLockExisting) {
          const replay = await this.buildReplayOutput(preLockExisting, payloadHash);
          if (inboxMessageToComplete) {
            inboxMessageToComplete.markProcessed(now);
            await this.inboxRepository.save(inboxMessageToComplete);
          }
          this.metrics?.incrementDuplicateDetected(
            command.inboxEnvelope ? "sqs_inbox" : "http_idempotency",
          );
          this.logger?.info("wager_transaction_idempotent_replay", {
            transactionId: preLockExisting.id,
            walletId: preLockExisting.walletId,
            providerId: preLockExisting.providerId,
          });
          return replay;
        }

        const wallet = await this.walletRepository.findByIdForUpdate(candidateTransaction.walletId);
        if (!wallet) {
          throw new ResourceNotFoundError(
            `Wallet "${candidateTransaction.walletId}" not found`,
            "WALLET_NOT_FOUND",
          );
        }

        const postLockExisting = await this.findExistingTransaction(
          idempotencyKey,
          candidateTransaction.providerId,
          candidateTransaction.externalTransactionId,
        );
        if (postLockExisting) {
          const replay = await this.buildReplayOutput(postLockExisting, payloadHash, wallet);
          if (inboxMessageToComplete) {
            inboxMessageToComplete.markProcessed(now);
            await this.inboxRepository.save(inboxMessageToComplete);
          }
          this.metrics?.incrementDuplicateDetected(
            command.inboxEnvelope ? "sqs_inbox" : "http_idempotency",
          );
          this.logger?.info("wager_transaction_idempotent_replay", {
            transactionId: postLockExisting.id,
            walletId: postLockExisting.walletId,
            providerId: postLockExisting.providerId,
          });
          return replay;
        }

        await this.evaluateAndApplyTransaction(
          candidateTransaction,
          wallet,
          now,
          correlationId,
          true,
        );

        if (inboxMessageToComplete) {
          inboxMessageToComplete.markProcessed(now);
          await this.inboxRepository.save(inboxMessageToComplete);
        }

        const pendingOutboxCount = await this.outboxRepository.countPending();
        this.metrics?.setOutboxLag(pendingOutboxCount);

        return {
          transactionId: candidateTransaction.id,
          status: candidateTransaction.status,
          balance: (candidateTransaction.observedBalance ?? wallet.balance).toJSON(),
          idempotentReplay: false,
          ...(candidateTransaction.failureCode
            ? { failureCode: candidateTransaction.failureCode }
            : {}),
        };
      });
    } finally {
      this.metrics?.observeProcessingLatencyMs(
        "process_wager_transaction",
        performance.now() - startedAt,
      );
    }
  }

  async evaluateAndApplyTransaction(
    transaction: WagerTransaction,
    wallet: Wallet,
    now: Date,
    correlationId: string,
    isNewRecord: boolean,
  ): Promise<void> {
    if (wallet.playerId !== transaction.playerId) {
      await this.persistRejected(
        transaction,
        wallet,
        FailureCode.ReferenceContextMismatch,
        now,
        correlationId,
        isNewRecord,
      );
      return;
    }

    if (wallet.currency !== transaction.money.currency) {
      await this.persistRejected(
        transaction,
        wallet,
        FailureCode.CurrencyMismatch,
        now,
        correlationId,
        isNewRecord,
      );
      return;
    }

    let resolvedReference: WagerTransaction | undefined;

    if (transaction.referenceExternalTransactionId) {
      const ref = await this.wagerTransactionRepository.findByProviderAndExternalId(
        transaction.providerId,
        transaction.referenceExternalTransactionId,
      );

      if (
        !ref ||
        ref.status === WagerTransactionStatus.Pending ||
        ref.status === WagerTransactionStatus.PendingReference
      ) {
        if (isNewRecord) {
          transaction.markPendingReference(now, wallet.balance);
          await this.wagerTransactionRepository.insert(transaction);
          const pendingEvent = WagerTransactionPendingReference.from(transaction, {
            eventId: this.idGenerator.generate(),
            correlationId,
            causationId: transaction.id,
            occurredAt: now,
          });
          await this.outboxRepository.enqueue(OutboxMessage.enqueue(pendingEvent));
          this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
          this.logger?.info("wager_transaction_pending_reference", {
            transactionId: transaction.id,
            walletId: transaction.walletId,
            providerId: transaction.providerId,
            kind: transaction.kind,
          });
        } else {
          transaction.schedulePendingReferenceRetry(now);
          await this.wagerTransactionRepository.save(transaction);
        }
        return;
      }

      const validationFailure = await this.validateReferenceRules(transaction, ref);
      if (validationFailure) {
        await this.persistRejected(
          transaction,
          wallet,
          validationFailure,
          now,
          correlationId,
          isNewRecord,
        );
        return;
      }

      resolvedReference = ref;
    }

    if (!transaction.affectsBalance()) {
      transaction.markProcessed(resolvedReference?.id, now, wallet.balance);
      if (isNewRecord) {
        await this.wagerTransactionRepository.insert(transaction);
      } else {
        await this.wagerTransactionRepository.save(transaction);
      }

      const processedEvent = WagerTransactionProcessed.from(
        transaction,
        wallet.balance.toJSON(),
        {
          eventId: this.idGenerator.generate(),
          correlationId,
          causationId: transaction.id,
          occurredAt: now,
        },
      );
      await this.outboxRepository.enqueue(OutboxMessage.enqueue(processedEvent));
      this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
      this.logger?.info("wager_transaction_processed", {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        kind: transaction.kind,
      });
      return;
    }

    const direction = transaction.ledgerDirectionFor(resolvedReference);
    try {
      const entryId = this.idGenerator.generate();
      const ledgerEntry =
        direction === LedgerDirection.Debit
          ? wallet.debit({
              entryId,
              transactionId: transaction.id,
              money: transaction.money,
              at: now,
              insufficientFundsFailureCode:
                transaction.kind === WagerTransactionKind.Rollback
                  ? FailureCode.InsufficientFundsReversal
                  : FailureCode.InsufficientFundsBet,
            })
          : wallet.credit({
              entryId,
              transactionId: transaction.id,
              money: transaction.money,
              at: now,
            });

      transaction.markProcessed(resolvedReference?.id, now, wallet.balance);

      await this.walletRepository.save(wallet);
      if (isNewRecord) {
        await this.wagerTransactionRepository.insert(transaction);
      } else {
        await this.wagerTransactionRepository.save(transaction);
      }
      await this.walletLedgerRepository.insert(ledgerEntry);

      const balanceChangedEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
        eventId: this.idGenerator.generate(),
        correlationId,
        causationId: transaction.id,
        occurredAt: now,
      });
      const processedEvent = WagerTransactionProcessed.from(
        transaction,
        wallet.balance.toJSON(),
        {
          eventId: this.idGenerator.generate(),
          correlationId,
          causationId: transaction.id,
          occurredAt: now,
        },
      );

      await this.outboxRepository.enqueueMany([
        OutboxMessage.enqueue(balanceChangedEvent),
        OutboxMessage.enqueue(processedEvent),
      ]);

      this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
      this.logger?.info("wager_transaction_processed", {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        kind: transaction.kind,
      });
    } catch (error) {
      if (error instanceof BusinessRuleViolationError) {
        await this.persistRejected(
          transaction,
          wallet,
          error.failureCode,
          now,
          correlationId,
          isNewRecord,
        );
        return;
      }
      throw error;
    }
  }

  private async validateReferenceRules(
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): Promise<FailureCode | null> {
    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.money.currency !== transaction.money.currency ||
      reference.roundId !== transaction.roundId
    ) {
      return FailureCode.ReferenceContextMismatch;
    }

    if (transaction.kind === WagerTransactionKind.Refund) {
      if (reference.kind !== WagerTransactionKind.Bet) {
        return FailureCode.ReferenceInvalidKind;
      }
    } else if (transaction.kind === WagerTransactionKind.Rollback) {
      if (
        reference.kind !== WagerTransactionKind.Bet &&
        reference.kind !== WagerTransactionKind.Win &&
        reference.kind !== WagerTransactionKind.Refund
      ) {
        return FailureCode.ReferenceInvalidKind;
      }
    } else if (
      transaction.kind === WagerTransactionKind.Win ||
      transaction.kind === WagerTransactionKind.Loss
    ) {
      if (reference.kind !== WagerTransactionKind.Bet) {
        return FailureCode.ReferenceInvalidKind;
      }
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceNotProcessed;
    }

    if (
      transaction.kind === WagerTransactionKind.Refund ||
      transaction.kind === WagerTransactionKind.Rollback
    ) {
      if (!transaction.money.equals(reference.money)) {
        return FailureCode.ReferenceAmountMismatch;
      }

      const existingReversal =
        await this.wagerTransactionRepository.findProcessedReversalByReferenceAndKind(
          reference.id,
          transaction.kind,
        );
      if (existingReversal) {
        return FailureCode.ReferenceAlreadyReversed;
      }
    }

    return null;
  }

  private async persistRejected(
    transaction: WagerTransaction,
    wallet: Wallet,
    failureCode: FailureCode,
    now: Date,
    correlationId: string,
    isNewRecord: boolean,
  ): Promise<void> {
    transaction.reject(failureCode, now, wallet.balance);
    if (isNewRecord) {
      await this.wagerTransactionRepository.insert(transaction);
    } else {
      await this.wagerTransactionRepository.save(transaction);
    }

    const rejectedEvent = WagerTransactionRejected.from(transaction, failureCode, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId: transaction.id,
      occurredAt: now,
    });
    await this.outboxRepository.enqueue(OutboxMessage.enqueue(rejectedEvent));

    this.metrics?.incrementTransactionByStatus(transaction.status, transaction.kind);
    this.logger?.warn("wager_transaction_rejected", {
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      kind: transaction.kind,
      failureCode,
    });
  }

  private async findExistingTransaction(
    idempotencyKey: string,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const byIdempotencyKey =
      await this.wagerTransactionRepository.findByIdempotencyKey(idempotencyKey);
    if (byIdempotencyKey) {
      return byIdempotencyKey;
    }
    return this.wagerTransactionRepository.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
  }

  private async buildReplayOutput(
    existing: WagerTransaction,
    incomingPayloadHash: string,
    lockedWallet?: Wallet,
  ): Promise<ProcessWagerTransactionOutput> {
    if (!existing.matchesPayload(incomingPayloadHash)) {
      throw new IdempotencyConflictError(existing.idempotencyKey);
    }

    let observedBalance = existing.observedBalance;
    if (!observedBalance) {
      const wallet =
        lockedWallet ?? (await this.walletRepository.findById(existing.walletId));
      observedBalance = wallet ? wallet.balance : Money.zero(existing.money.currency);
    }

    return {
      transactionId: existing.id,
      status: existing.status,
      balance: observedBalance.toJSON(),
      idempotentReplay: true,
      ...(existing.failureCode ? { failureCode: existing.failureCode } : {}),
    };
  }
}
