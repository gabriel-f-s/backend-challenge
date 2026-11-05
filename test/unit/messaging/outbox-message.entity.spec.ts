import { describe, expect, it } from "bun:test";
import { OutboxMessageMapper } from "@modules/messaging/adapters/outbound/persistence/mappers/outbox-message.mapper";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { InvalidTransactionStateError } from "@shared/domain/errors/domain.error";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "@shared/domain/events/integration-event.base";

class DummyDomainEvent extends IntegrationEvent<{ readonly status: string }> {
  readonly eventType = "DummyDomainEvent";
  readonly version = 1;

  static create(props: IntegrationEventProps<{ readonly status: string }>): DummyDomainEvent {
    return new DummyDomainEvent(props);
  }
}

describe("OutboxMessage Entity & Mapper", () => {
  it("enqueues an IntegrationEvent as pending and due immediately", () => {
    const occurredAt = new Date("2026-07-29T15:00:00.000Z");
    const event = DummyDomainEvent.create({
      eventId: "0192f298-345e-7e38-af88-e43f851a819d",
      aggregateId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      correlationId: "corr-1",
      occurredAt,
      data: { status: "PROCESSED" },
    });

    const outbox = OutboxMessage.enqueue(event);

    expect(outbox.id).toBe(event.eventId);
    expect(outbox.aggregateId).toBe(event.aggregateId);
    expect(outbox.eventType).toBe("DummyDomainEvent");
    expect(outbox.attempts).toBe(0);
    expect(outbox.isPending()).toBe(true);
    expect(outbox.isDue(occurredAt)).toBe(true);
    expect(outbox.payload.eventType).toBe("DummyDomainEvent");
  });

  it("applies exponential backoff on scheduleRetry and transitions to published", () => {
    const occurredAt = new Date("2026-07-29T15:00:00.000Z");
    const event = DummyDomainEvent.create({
      eventId: "0192f298-345e-7e38-af88-e43f851a819d",
      aggregateId: "agg-1",
      correlationId: "corr-1",
      occurredAt,
      data: { status: "PROCESSED" },
    });

    const outbox = OutboxMessage.enqueue(event);

    outbox.scheduleRetry(occurredAt);
    expect(outbox.attempts).toBe(1);
    expect(outbox.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 1000);
    expect(outbox.isDue(occurredAt)).toBe(false);
    expect(outbox.isDue(new Date(occurredAt.getTime() + 1000))).toBe(true);

    outbox.scheduleRetry(occurredAt);
    expect(outbox.attempts).toBe(2);
    expect(outbox.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 2000);

    outbox.scheduleRetry(occurredAt);
    expect(outbox.attempts).toBe(3);
    expect(outbox.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 4000);

    const publishedAt = new Date("2026-07-29T15:00:05.000Z");
    outbox.markPublished(publishedAt);

    expect(outbox.isPending()).toBe(false);
    expect(outbox.isDue(publishedAt)).toBe(false);
    expect(outbox.publishedAt).toEqual(publishedAt);
    expect(outbox.nextAttemptAt).toBeUndefined();

    expect(() => outbox.markPublished(publishedAt)).toThrow(InvalidTransactionStateError);
    expect(() => outbox.scheduleRetry(publishedAt)).toThrow(InvalidTransactionStateError);
  });

  it("maps cleanly between domain and persistence via OutboxMessageMapper", () => {
    const occurredAt = new Date("2026-07-29T15:00:00.000Z");
    const event = DummyDomainEvent.create({
      eventId: "0192f298-345e-7e38-af88-e43f851a819d",
      aggregateId: "agg-1",
      correlationId: "corr-1",
      occurredAt,
      data: { status: "PROCESSED" },
    });

    const outbox = OutboxMessage.enqueue(event);
    const record = OutboxMessageMapper.toPersistence(outbox);
    const rehydrated = OutboxMessageMapper.toDomain(record);

    expect(rehydrated.id).toBe(outbox.id);
    expect(rehydrated.eventType).toBe("DummyDomainEvent");
    expect(rehydrated.isPending()).toBe(true);
    expect(rehydrated.payload).toEqual(outbox.payload);
  });
});

