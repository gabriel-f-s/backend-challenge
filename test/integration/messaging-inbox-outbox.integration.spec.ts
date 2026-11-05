import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import type { IntegrationEventPublisherPort } from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import { PublishPendingOutboxUseCase } from "@modules/messaging/application/use-cases/publish-pending-outbox.use-case";
import { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from "@shared/domain/events/integration-event.base";
import { initIntegrationTestOrm, truncateAllTables } from "./helpers/postgres-test-harness";

class IntegrationTestEvent extends IntegrationEvent<{ readonly seq: number }> {
  readonly eventType = "IntegrationTestEvent";
  readonly version = 1;

  static create(props: IntegrationEventProps<{ readonly seq: number }>): IntegrationTestEvent {
    return new IntegrationTestEvent(props);
  }
}

describe("Messaging Inbox & Outbox Integration (Real PostgreSQL)", () => {
  let orm: MikroORM;
  let unitOfWork: MikroOrmUnitOfWorkAdapter;
  let inboxRepository: MikroOrmInboxRepository;
  let outboxRepository: MikroOrmOutboxRepository;
  const idGenerator = new UuidV7GeneratorAdapter();
  const clock = new SystemClockAdapter();

  beforeAll(async () => {
    orm = await initIntegrationTestOrm();
    unitOfWork = new MikroOrmUnitOfWorkAdapter(orm.em);
    inboxRepository = new MikroOrmInboxRepository(orm.em);
    outboxRepository = new MikroOrmOutboxRepository(orm.em);
  });

  beforeEach(async () => {
    await truncateAllTables(orm);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("deduplicates concurrent InboxMessage deliveries via persistent ON CONFLICT DO NOTHING", async () => {
    const now = clock.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        unitOfWork.runInTransaction(async () => {
          const message = InboxMessage.receive({
            consumerName: "wager-sqs-consumer",
            messageId: "sqs-msg-concurrent-1",
            payloadHash: "hash-abc",
            receivedAt: now,
          });
          return inboxRepository.insertIfAbsent(message);
        }),
      ),
    );

    const insertedCount = results.filter((r) => r.inserted).length;
    const duplicateCount = results.filter((r) => !r.inserted).length;

    expect(insertedCount).toBe(1);
    expect(duplicateCount).toBe(9);
  });

  it("coordinates two concurrent Outbox publishers using FOR UPDATE SKIP LOCKED without duplicating publications", async () => {
    const now = clock.now();
    const messages = Array.from({ length: 20 }, (_, idx) =>
      OutboxMessage.enqueue(
        IntegrationTestEvent.create({
          eventId: idGenerator.generate(),
          aggregateId: `agg-${idx}`,
          correlationId: `corr-${idx}`,
          occurredAt: new Date(now.getTime() - 5000 + idx),
          data: { seq: idx },
        }),
      ),
    );

    await unitOfWork.runInTransaction(async () => {
      await outboxRepository.enqueueMany(messages);
    });

    expect(await outboxRepository.countPending()).toBe(20);

    const publishedIds: string[] = [];
    const slowPublisher: IntegrationEventPublisherPort = {
      publish: async (msg) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        publishedIds.push(msg.id);
      },
    };

    const publisherWorkerA = new PublishPendingOutboxUseCase(
      new MikroOrmUnitOfWorkAdapter(orm.em.fork()),
      new MikroOrmOutboxRepository(orm.em.fork()),
      slowPublisher,
      clock,
    );
    const publisherWorkerB = new PublishPendingOutboxUseCase(
      new MikroOrmUnitOfWorkAdapter(orm.em.fork()),
      new MikroOrmOutboxRepository(orm.em.fork()),
      slowPublisher,
      clock,
    );

    const [resA, resB] = await Promise.all([
      publisherWorkerA.execute(12),
      publisherWorkerB.execute(12),
    ]);

    expect(resA.published + resB.published).toBe(20);
    expect(publishedIds).toHaveLength(20);
    expect(new Set(publishedIds).size).toBe(20);
    expect(await outboxRepository.countPending()).toBe(0);
  });
});

