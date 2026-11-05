import { EntitySchema } from "@mikro-orm/core";

export class OutboxMessagePersistenceRecord {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  occurredAt!: Date;
  attempts!: number;
  nextAttemptAt?: Date | null;
  publishedAt?: Date | null;
}

export const OutboxMessageSchema = new EntitySchema<OutboxMessagePersistenceRecord>({
  class: OutboxMessagePersistenceRecord,
  tableName: "outbox_messages",
  properties: {
    id: {
      type: "uuid",
      primary: true,
    },
    aggregateId: {
      type: "string",
      fieldName: "aggregate_id",
      length: 120,
    },
    eventType: {
      type: "string",
      fieldName: "event_type",
      length: 120,
    },
    payload: {
      type: "json",
      columnType: "jsonb",
    },
    occurredAt: {
      type: "Date",
      fieldName: "occurred_at",
      columnType: "timestamptz",
    },
    attempts: {
      type: "integer",
      default: 0,
    },
    nextAttemptAt: {
      type: "Date",
      fieldName: "next_attempt_at",
      columnType: "timestamptz",
      nullable: true,
    },
    publishedAt: {
      type: "Date",
      fieldName: "published_at",
      columnType: "timestamptz",
      nullable: true,
    },
  },
});

