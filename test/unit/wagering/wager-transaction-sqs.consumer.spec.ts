import { describe, expect, it } from "bun:test";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import {
  WAGER_TRANSACTION_SQS_CONSUMER_NAME,
  WagerTransactionSqsConsumer,
} from "@modules/wagering/adapters/inbound/messaging/wager-transaction-sqs.consumer";
import type { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import {
  IdempotencyConflictError,
  TransientInfrastructureError,
} from "@shared/domain/errors/domain.error";

function buildValidSqsMessageBody(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    messageId: "msg-001",
    type: "WagerTransactionRequested",
    occurredAt: "2026-11-05T17:00:00.000Z",
    data: {
      providerId: "provider-a",
      externalTransactionId: "tx-001",
      idempotencyKey: "provider-a:tx-001",
      playerId: "player-1",
      walletId: "wallet-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    },
    ...overrides,
  });
}

describe("WagerTransactionSqsConsumer", () => {
  it("delegates valid message with Inbox envelope to ProcessWagerTransactionUseCase and acks after commit", async () => {
    const sentCommands: unknown[] = [];
    const sqsClient = {
      send: async (cmd: unknown) => {
        sentCommands.push(cmd);
        return {};
      },
    } as unknown as SQSClient;

    let capturedCommand: unknown;
    const processUseCase = {
      execute: async (cmd: unknown) => {
        capturedCommand = cmd;
        return {
          transactionId: "internal-tx-1",
          status: WagerTransactionStatus.Processed,
          balance: { amount: "75.00", currency: "BRL" },
          idempotentReplay: false,
        };
      },
    } as unknown as ProcessWagerTransactionUseCase;

    const consumer = new WagerTransactionSqsConsumer(sqsClient, processUseCase);
    const outcome = await consumer.handleMessage({
      MessageId: "sqs-msg-1",
      ReceiptHandle: "receipt-1",
      Body: buildValidSqsMessageBody(),
      Attributes: { ApproximateReceiveCount: "1", MessageGroupId: "wallet-1" },
    });

    expect(outcome).toBe("acked");
    expect(capturedCommand).toMatchObject({
      idempotencyKey: "provider-a:tx-001",
      inboxEnvelope: {
        consumerName: WAGER_TRANSACTION_SQS_CONSUMER_NAME,
        messageId: "msg-001",
      },
    });
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]).toBeInstanceOf(DeleteMessageCommand);
  });

  it("applies exponential visibility backoff without acking on transient errors below maxReceiveCount", async () => {
    const sentCommands: unknown[] = [];
    const sqsClient = {
      send: async (cmd: unknown) => {
        sentCommands.push(cmd);
        return {};
      },
    } as unknown as SQSClient;

    const processUseCase = {
      execute: async () => {
        throw new TransientInfrastructureError("Database connection temporarily lost");
      },
    } as unknown as ProcessWagerTransactionUseCase;

    const consumer = new WagerTransactionSqsConsumer(sqsClient, processUseCase);
    const outcome = await consumer.handleMessage({
      MessageId: "sqs-msg-2",
      ReceiptHandle: "receipt-2",
      Body: buildValidSqsMessageBody(),
      Attributes: { ApproximateReceiveCount: "2", MessageGroupId: "wallet-1" },
    });

    expect(outcome).toBe("retried");
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]).toBeInstanceOf(ChangeMessageVisibilityCommand);
    const visibilityCmd = sentCommands[0] as ChangeMessageVisibilityCommand;
    expect(visibilityCmd.input.VisibilityTimeout).toBe(4);
  });

  it("routes message to DLQ and deletes from main queue on permanent error or exhausted retries", async () => {
    const sentCommands: unknown[] = [];
    const sqsClient = {
      send: async (cmd: unknown) => {
        sentCommands.push(cmd);
        return {};
      },
    } as unknown as SQSClient;

    const processUseCase = {
      execute: async () => {
        throw new IdempotencyConflictError("provider-a:tx-001");
      },
    } as unknown as ProcessWagerTransactionUseCase;

    const consumer = new WagerTransactionSqsConsumer(sqsClient, processUseCase);

    const conflictOutcome = await consumer.handleMessage({
      MessageId: "sqs-msg-3",
      ReceiptHandle: "receipt-3",
      Body: buildValidSqsMessageBody(),
      Attributes: { ApproximateReceiveCount: "1", MessageGroupId: "wallet-1" },
    });

    expect(conflictOutcome).toBe("dlq");
    expect(sentCommands).toHaveLength(2);
    expect(sentCommands[0]).toBeInstanceOf(SendMessageCommand);
    expect(sentCommands[1]).toBeInstanceOf(DeleteMessageCommand);

    sentCommands.length = 0;
    const malformedOutcome = await consumer.handleMessage({
      MessageId: "sqs-msg-4",
      ReceiptHandle: "receipt-4",
      Body: "{not-json",
      Attributes: { ApproximateReceiveCount: "1", MessageGroupId: "wallet-1" },
    });

    expect(malformedOutcome).toBe("dlq");
    expect(sentCommands).toHaveLength(2);
    expect(sentCommands[0]).toBeInstanceOf(SendMessageCommand);
    expect(sentCommands[1]).toBeInstanceOf(DeleteMessageCommand);
  });

  it("releases visibility (VisibilityTimeout: 0) when shutting down via SIGTERM / onModuleDestroy", async () => {
    const sentCommands: unknown[] = [];
    const sqsClient = {
      send: async (cmd: unknown) => {
        sentCommands.push(cmd);
        return {};
      },
    } as unknown as SQSClient;

    const processUseCase = {
      execute: async () => ({
        transactionId: "tx-1",
        status: WagerTransactionStatus.Processed,
        balance: { amount: "75.00", currency: "BRL" },
        idempotentReplay: false,
      }),
    } as unknown as ProcessWagerTransactionUseCase;

    const consumer = new WagerTransactionSqsConsumer(sqsClient, processUseCase);
    await consumer.onModuleDestroy();

    const outcome = await consumer.handleMessage({
      MessageId: "sqs-msg-5",
      ReceiptHandle: "receipt-5",
      Body: buildValidSqsMessageBody(),
    });

    expect(outcome).toBe("released");
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]).toBeInstanceOf(ChangeMessageVisibilityCommand);
    expect((sentCommands[0] as ChangeMessageVisibilityCommand).input.VisibilityTimeout).toBe(0);
  });
});

