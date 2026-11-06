import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import type { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { Inject, Injectable, type OnModuleDestroy, Optional } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { SQS_CLIENT } from "@shared/adapters/outbound/sqs/sqs-client.factory";
import {
  CORRELATION_CONTEXT_PORT,
  type CorrelationContextPort,
} from "@shared/application/ports/outbound/correlation-context.port";
import { METRICS_PORT, type MetricsPort } from "@shared/application/ports/outbound/metrics.port";
import {
  STRUCTURED_LOGGER_PORT,
  type StructuredLoggerPort,
} from "@shared/application/ports/outbound/structured-logger.port";
import {
  BusinessRuleViolationError,
  DomainValidationError,
  IdempotencyConflictError,
  InvalidTransactionStateError,
  ResourceNotFoundError,
} from "@shared/domain/errors/domain.error";
import type { MoneyProps } from "@shared/domain/value-objects/money.vo";

export const WAGER_TRANSACTION_SQS_CONSUMER_NAME = "wager-transactions-sqs-consumer";

export interface WagerTransactionRequestedPayload {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
}

export interface WagerTransactionRequestedEnvelope {
  readonly messageId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly data: WagerTransactionRequestedPayload;
}

export type SqsMessageOutcome = "acked" | "retried" | "dlq" | "released";

export interface SqsPollSummary {
  readonly acked: number;
  readonly retried: number;
  readonly dlq: number;
  readonly released: number;
}

const DEFAULT_MAX_RECEIVE_COUNT = 5;
const DEFAULT_BASE_BACKOFF_SECONDS = 2;
const DEFAULT_MAX_BACKOFF_SECONDS = 60;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;

@Injectable()
export class WagerTransactionSqsConsumer implements OnModuleDestroy {
  private readonly mainQueueUrl: string;
  private readonly dlqUrl: string;
  private readonly maxReceiveCount: number;
  private readonly baseBackoffSeconds: number;
  private readonly maxBackoffSeconds: number;
  private readonly drainTimeoutMs: number;

  private isPolling = false;
  private isShuttingDown = false;
  private readonly activePromises = new Set<Promise<void>>();
  private readonly inFlightReceipts = new Map<string, string>();

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    @Optional()
    @Inject(METRICS_PORT)
    private readonly metrics?: MetricsPort,
    @Optional()
    @Inject(STRUCTURED_LOGGER_PORT)
    private readonly logger?: StructuredLoggerPort,
    @Optional()
    @Inject(CORRELATION_CONTEXT_PORT)
    private readonly correlationContext?: CorrelationContextPort,
  ) {
    const config = loadEnvironmentConfig();
    this.mainQueueUrl = config.sqs.wagerTransactionsQueueUrl;
    this.dlqUrl = config.sqs.wagerTransactionsDlqUrl;
    this.maxReceiveCount =
      Number.parseInt(process.env.SQS_MAX_RECEIVE_COUNT ?? "", 10) || DEFAULT_MAX_RECEIVE_COUNT;
    this.baseBackoffSeconds =
      Number.parseInt(process.env.SQS_BASE_BACKOFF_SECONDS ?? "", 10) ||
      DEFAULT_BASE_BACKOFF_SECONDS;
    this.maxBackoffSeconds =
      Number.parseInt(process.env.SQS_MAX_BACKOFF_SECONDS ?? "", 10) || DEFAULT_MAX_BACKOFF_SECONDS;
    this.drainTimeoutMs =
      Number.parseInt(process.env.SQS_DRAIN_TIMEOUT_MS ?? "", 10) || DEFAULT_DRAIN_TIMEOUT_MS;
  }

  @Interval(500)
  async handleScheduledPoll(): Promise<void> {
    if (
      this.isShuttingDown ||
      this.isPolling ||
      process.env.SQS_CONSUMER_ENABLED === "false" ||
      process.env.NODE_ENV === "test"
    ) {
      return;
    }

    this.isPolling = true;
    try {
      await this.pollOnce(10);
    } catch {
      // Transient SQS polling failures are retried on the next scheduled tick
    } finally {
      this.isPolling = false;
    }
  }

  async pollOnce(maxNumberOfMessages = 10): Promise<SqsPollSummary> {
    if (this.isShuttingDown) {
      return { acked: 0, retried: 0, dlq: 0, released: 0 };
    }

    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.mainQueueUrl,
        MaxNumberOfMessages: maxNumberOfMessages,
        WaitTimeSeconds: 0,
        MessageSystemAttributeNames: ["All"],
      }),
    );

    const messages = response.Messages ?? [];
    let acked = 0;
    let retried = 0;
    let dlq = 0;
    let released = 0;

    for (const message of messages) {
      const outcome = await this.handleMessage(message);
      if (outcome === "acked") {
        acked += 1;
      } else if (outcome === "retried") {
        retried += 1;
      } else if (outcome === "dlq") {
        dlq += 1;
      } else if (outcome === "released") {
        released += 1;
      }
    }

    return { acked, retried, dlq, released };
  }

  async handleMessage(message: Message): Promise<SqsMessageOutcome> {
    const receiptHandle = message.ReceiptHandle;
    if (!receiptHandle) {
      return "released";
    }

    if (this.isShuttingDown) {
      await this.releaseVisibility(receiptHandle);
      return "released";
    }

    const trackingKey = message.MessageId ?? receiptHandle;
    this.inFlightReceipts.set(trackingKey, receiptHandle);
    const startedAt = performance.now();

    let outcome: SqsMessageOutcome = "acked";
    const processingPromise = (async () => {
      try {
        const envelope = this.parseAndValidateEnvelope(message);
        const correlationId = envelope.correlationId ?? envelope.messageId;

        const executeWork = async () => {
          await this.processWagerTransactionUseCase.execute({
            idempotencyKey: envelope.data.idempotencyKey,
            providerId: envelope.data.providerId,
            externalTransactionId: envelope.data.externalTransactionId,
            playerId: envelope.data.playerId,
            walletId: envelope.data.walletId,
            roundId: envelope.data.roundId,
            gameId: envelope.data.gameId,
            kind: envelope.data.kind,
            money: envelope.data.money,
            referenceExternalTransactionId: envelope.data.referenceExternalTransactionId,
            correlationId,
            inboxEnvelope: {
              consumerName: WAGER_TRANSACTION_SQS_CONSUMER_NAME,
              messageId: envelope.messageId,
            },
          });
        };

        if (this.correlationContext) {
          await this.correlationContext.run(
            {
              correlationId,
              messageId: envelope.messageId,
              walletId: envelope.data.walletId,
              providerId: envelope.data.providerId,
            },
            executeWork,
          );
        } else {
          await executeWork();
        }

        await this.ackMessage(receiptHandle);
        outcome = "acked";
      } catch (error) {
        outcome = await this.handleProcessingError(message, receiptHandle, error);
      } finally {
        this.inFlightReceipts.delete(trackingKey);
        this.metrics?.observeProcessingLatencyMs("sqs_message", performance.now() - startedAt);
      }
    })();

    this.activePromises.add(processingPromise);
    try {
      await processingPromise;
    } finally {
      this.activePromises.delete(processingPromise);
    }

    return outcome;
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.activePromises.size > 0) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const drainTimeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), this.drainTimeoutMs);
      });

      const raceResult = await Promise.race([
        Promise.allSettled([...this.activePromises]).then(() => "drained" as const),
        drainTimeoutPromise,
      ]);

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (raceResult === "timeout" && this.inFlightReceipts.size > 0) {
        await this.releaseAllInFlightMessages();
      }
    }
  }

  async releaseAllInFlightMessages(): Promise<number> {
    const receipts = [...this.inFlightReceipts.values()];
    this.inFlightReceipts.clear();

    for (const receiptHandle of receipts) {
      await this.releaseVisibility(receiptHandle);
    }

    return receipts.length;
  }

  private parseAndValidateEnvelope(message: Message): WagerTransactionRequestedEnvelope {
    if (!message.Body || message.Body.trim() === "") {
      throw new DomainValidationError("SQS message body is empty", "EMPTY_SQS_MESSAGE_BODY");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.Body);
    } catch {
      throw new DomainValidationError(
        "SQS message body is not valid JSON",
        "MALFORMED_SQS_MESSAGE_JSON",
      );
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new DomainValidationError(
        "SQS message envelope must be a JSON object",
        "INVALID_SQS_MESSAGE_ENVELOPE",
      );
    }

    const record = parsed as Record<string, unknown>;
    const messageId =
      typeof record.messageId === "string" && record.messageId.trim() !== ""
        ? record.messageId.trim()
        : message.MessageId?.trim();

    if (!messageId) {
      throw new DomainValidationError(
        "SQS messageId is required",
        "MISSING_SQS_MESSAGE_ID",
      );
    }

    if (record.type !== "WagerTransactionRequested") {
      throw new DomainValidationError(
        `Unsupported SQS message type: "${String(record.type)}"`,
        "UNSUPPORTED_SQS_MESSAGE_TYPE",
      );
    }

    if (typeof record.data !== "object" || record.data === null) {
      throw new DomainValidationError(
        "SQS message data object is required",
        "MISSING_SQS_MESSAGE_DATA",
      );
    }

    return {
      messageId,
      type: record.type,
      occurredAt:
        typeof record.occurredAt === "string" ? record.occurredAt : new Date().toISOString(),
      correlationId: typeof record.correlationId === "string" ? record.correlationId : undefined,
      data: record.data as WagerTransactionRequestedPayload,
    };
  }

  private async handleProcessingError(
    message: Message,
    receiptHandle: string,
    error: unknown,
  ): Promise<SqsMessageOutcome> {
    if (error instanceof BusinessRuleViolationError) {
      await this.ackMessage(receiptHandle);
      return "acked";
    }

    const isPermanentDomainError =
      error instanceof DomainValidationError ||
      error instanceof IdempotencyConflictError ||
      error instanceof ResourceNotFoundError ||
      error instanceof InvalidTransactionStateError;

    const receiveCount =
      Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? "1", 10) || 1;

    if (isPermanentDomainError || receiveCount >= this.maxReceiveCount) {
      await this.moveToDlq(message, error, receiveCount);
      await this.ackMessage(receiptHandle);
      return "dlq";
    }

    const backoffSeconds = Math.min(
      this.baseBackoffSeconds * 2 ** (receiveCount - 1),
      this.maxBackoffSeconds,
    );

    const correlationId =
      this.correlationContext?.get()?.correlationId ?? message.MessageId ?? "sqs-unknown";

    this.metrics?.incrementRetry("sqs_consumer");
    this.logger?.warn("sqs_message_transient_retry_scheduled", {
      correlationId,
      messageId: message.MessageId,
      receiveCount,
      backoffSeconds,
    });

    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.mainQueueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: backoffSeconds,
      }),
    );

    return "retried";
  }

  private async ackMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.mainQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async releaseVisibility(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.mainQueueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0,
      }),
    );
  }

  private async moveToDlq(
    message: Message,
    error: unknown,
    receiveCount: number,
  ): Promise<void> {
    const errorCode =
      typeof error === "object" && error !== null && "errorCode" in error
        ? String((error as { errorCode: unknown }).errorCode)
        : "MAX_RETRIES_EXCEEDED";
    const errorMessage = error instanceof Error ? error.message : String(error);

    const correlationId =
      this.correlationContext?.get()?.correlationId ?? message.MessageId ?? "sqs-unknown";

    this.metrics?.incrementDlqMessage(errorCode);
    this.logger?.error("sqs_message_moved_to_dlq", {
      correlationId,
      messageId: message.MessageId,
      receiveCount,
      errorCode,
    });

    const dlqEnvelope = {
      originalMessageId: message.MessageId ?? "unknown",
      originalBody: message.Body ?? "",
      receiveCount,
      errorCode,
      errorMessage,
      failedAt: new Date().toISOString(),
    };

    const isFifo = this.dlqUrl.endsWith(".fifo");
    const deduplicationId = `${message.MessageId ?? "msg"}-${receiveCount}-${Date.now()}`;
    const groupId = message.Attributes?.MessageGroupId || "dlq-default-group";

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: JSON.stringify(dlqEnvelope),
        ...(isFifo
          ? {
              MessageGroupId: groupId,
              MessageDeduplicationId: deduplicationId,
            }
          : {}),
      }),
    );
  }
}
