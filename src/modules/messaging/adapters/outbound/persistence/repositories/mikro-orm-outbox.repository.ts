import { EntityManager } from "@mikro-orm/postgresql";
import type { OutboxRepositoryPort } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { Injectable } from "@nestjs/common";
import { resolveActiveEntityManager } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { OutboxMessageMapper } from "../mappers/outbox-message.mapper";
import { OutboxMessagePersistenceRecord } from "../schemas/outbox-message.schema";

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly rootEntityManager: EntityManager) {}

  async enqueue(message: OutboxMessage): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = OutboxMessageMapper.toPersistence(message);
    await em.insert(OutboxMessagePersistenceRecord, record);
  }

  async enqueueMany(messages: readonly OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const records = messages.map((message) => OutboxMessageMapper.toPersistence(message));
    await em.insertMany(OutboxMessagePersistenceRecord, records);
  }

  async claimDueBatch(now: Date, limit: number): Promise<OutboxMessage[]> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const rows = await em.execute<OutboxMessagePersistenceRecord[]>(
      `SELECT
         id,
         aggregate_id AS "aggregateId",
         event_type AS "eventType",
         payload,
         occurred_at AS "occurredAt",
         attempts,
         next_attempt_at AS "nextAttemptAt",
         published_at AS "publishedAt"
       FROM outbox_messages
       WHERE published_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY occurred_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return rows.map((row) => OutboxMessageMapper.toDomain(row));
  }

  async save(message: OutboxMessage): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    await em.nativeUpdate(
      OutboxMessagePersistenceRecord,
      { id: message.id },
      {
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt ?? null,
        publishedAt: message.publishedAt ?? null,
      },
    );
  }

  async countPending(): Promise<number> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    return em.count(OutboxMessagePersistenceRecord, {
      publishedAt: null,
    });
  }
}

