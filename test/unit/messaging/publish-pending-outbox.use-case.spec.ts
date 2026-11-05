import { describe, expect, it } from "bun:test";
import type { IntegrationEventPublisherPort } from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import type { OutboxRepositoryPort } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { PublishPendingOutboxUseCase } from "@modules/messaging/application/use-cases/publish-pending-outbox.use-case";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import type { ClockPort } from "@shared/application/ports/outbound/clock.port";
import type { UnitOfWorkPort } from "@shared/application/ports/outbound/unit-of-work.port";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "@shared/domain/events/integration-event.base";

class TestOutboxEvent extends IntegrationEvent<{ readonly value: number }> {
  readonly eventType = "TestOutboxEvent";
  readonly version = 1;

  static create(props: IntegrationEventProps<{ readonly value: number }>): TestOutboxEvent {
    return new TestOutboxEvent(props);
  }
}

describe("PublishPendingOutboxUseCase", () => {
  const fixedNow = new Date("2026-07-29T15:00:00.000Z");
  const clock: ClockPort = {
    now: () => fixedNow,
  };
  const unitOfWork: UnitOfWorkPort = {
    runInTransaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
  };

  it("publishes due messages and marks them as published", async () => {
    const msg1 = OutboxMessage.enqueue(
      TestOutboxEvent.create({
        eventId: "0192f298-345e-7e38-af88-e43f851a8191",
        aggregateId: "agg-1",
        correlationId: "corr-1",
        occurredAt: fixedNow,
        data: { value: 1 },
      }),
    );
    const msg2 = OutboxMessage.enqueue(
      TestOutboxEvent.create({
        eventId: "0192f298-345e-7e38-af88-e43f851a8192",
        aggregateId: "agg-2",
        correlationId: "corr-2",
        occurredAt: fixedNow,
        data: { value: 2 },
      }),
    );

    const savedMessages: OutboxMessage[] = [];
    const publishedIds: string[] = [];

    const outboxRepository: OutboxRepositoryPort = {
      enqueue: async () => {},
      enqueueMany: async () => {},
      claimDueBatch: async () => [msg1, msg2],
      save: async (message) => {
        savedMessages.push(message);
      },
      countPending: async () => 0,
    };

    const publisher: IntegrationEventPublisherPort = {
      publish: async (message) => {
        if (message.id === msg2.id) {
          throw new Error("Simulated SQS timeout");
        }
        publishedIds.push(message.id);
      },
    };

    const useCase = new PublishPendingOutboxUseCase(
      unitOfWork,
      outboxRepository,
      publisher,
      clock,
    );

    const result = await useCase.execute(10);

    expect(result).toEqual({
      claimed: 2,
      published: 1,
      retried: 1,
    });
    expect(publishedIds).toEqual([msg1.id]);
    expect(savedMessages).toHaveLength(2);
    expect(msg1.isPending()).toBe(false);
    expect(msg1.publishedAt).toEqual(fixedNow);
    expect(msg2.isPending()).toBe(true);
    expect(msg2.attempts).toBe(1);
    expect(msg2.nextAttemptAt?.getTime()).toBe(fixedNow.getTime() + 1000);
  });
});

