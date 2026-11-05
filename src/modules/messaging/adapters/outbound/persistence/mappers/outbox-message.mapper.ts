import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { OutboxMessagePersistenceRecord } from "../schemas/outbox-message.schema";

export class OutboxMessageMapper {
  private constructor() {}

  static toDomain(record: OutboxMessagePersistenceRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload:
        typeof record.payload === "string"
          ? (JSON.parse(record.payload) as Record<string, unknown>)
          : record.payload,
      occurredAt: new Date(record.occurredAt),
      attempts: Number(record.attempts),
      nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : undefined,
      publishedAt: record.publishedAt ? new Date(record.publishedAt) : undefined,
    });
  }

  static toPersistence(entity: OutboxMessage): OutboxMessagePersistenceRecord {
    const record = new OutboxMessagePersistenceRecord();
    record.id = entity.id;
    record.aggregateId = entity.aggregateId;
    record.eventType = entity.eventType;
    record.payload = { ...entity.payload };
    record.occurredAt = entity.occurredAt;
    record.attempts = entity.attempts;
    record.nextAttemptAt = entity.nextAttemptAt ?? null;
    record.publishedAt = entity.publishedAt ?? null;
    return record;
  }
}

