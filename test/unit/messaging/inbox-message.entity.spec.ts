import { describe, expect, it } from "bun:test";
import { InboxMessageMapper } from "@modules/messaging/adapters/outbound/persistence/mappers/inbox-message.mapper";
import { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import {
  DomainValidationError,
  InvalidTransactionStateError,
} from "@shared/domain/errors/domain.error";

describe("InboxMessage Entity & Mapper", () => {
  it("receives an unprocessed inbox message and transitions to processed", () => {
    const receivedAt = new Date("2026-07-29T15:00:00.000Z");
    const processedAt = new Date("2026-07-29T15:00:01.000Z");

    const inbox = InboxMessage.receive({
      messageId: "msg-123",
      consumerName: "wager-transaction-consumer",
      payloadHash: "abc123hash",
      receivedAt,
    });

    expect(inbox.isProcessed()).toBe(false);
    expect(inbox.processedAt).toBeUndefined();
    expect(inbox.matchesPayload("abc123hash")).toBe(true);
    expect(inbox.matchesPayload("different-hash")).toBe(false);

    inbox.markProcessed(processedAt);

    expect(inbox.isProcessed()).toBe(true);
    expect(inbox.processedAt).toEqual(processedAt);
    expect(() => inbox.markProcessed(processedAt)).toThrow(InvalidTransactionStateError);
  });

  it("rejects empty messageId, consumerName, or payloadHash on receive", () => {
    const receivedAt = new Date();
    expect(() =>
      InboxMessage.receive({
        messageId: "  ",
        consumerName: "consumer",
        payloadHash: "hash",
        receivedAt,
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      InboxMessage.receive({
        messageId: "msg-1",
        consumerName: "",
        payloadHash: "hash",
        receivedAt,
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      InboxMessage.receive({
        messageId: "msg-1",
        consumerName: "consumer",
        payloadHash: "",
        receivedAt,
      }),
    ).toThrow(DomainValidationError);
  });

  it("maps cleanly between domain and persistence via InboxMessageMapper", () => {
    const original = InboxMessage.receive({
      messageId: "msg-999",
      consumerName: "sqs-consumer",
      payloadHash: "hash-999",
      receivedAt: new Date("2026-07-29T15:00:00.000Z"),
    });
    original.markProcessed(new Date("2026-07-29T15:00:02.000Z"));

    const record = InboxMessageMapper.toPersistence(original);
    const rehydrated = InboxMessageMapper.toDomain(record);

    expect(rehydrated.messageId).toBe("msg-999");
    expect(rehydrated.consumerName).toBe("sqs-consumer");
    expect(rehydrated.payloadHash).toBe("hash-999");
    expect(rehydrated.isProcessed()).toBe(true);
    expect(rehydrated.processedAt?.toISOString()).toBe("2026-07-29T15:00:02.000Z");
  });
});

