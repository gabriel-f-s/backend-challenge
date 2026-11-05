import { EntitySchema } from "@mikro-orm/core";

export class InboxMessagePersistenceRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt?: Date | null;
}

export const InboxMessageSchema = new EntitySchema<InboxMessagePersistenceRecord>({
  class: InboxMessagePersistenceRecord,
  tableName: "inbox_messages",
  properties: {
    consumerName: {
      type: "string",
      fieldName: "consumer_name",
      length: 120,
      primary: true,
    },
    messageId: {
      type: "string",
      fieldName: "message_id",
      length: 255,
      primary: true,
    },
    payloadHash: {
      type: "string",
      fieldName: "payload_hash",
      length: 64,
    },
    receivedAt: {
      type: "Date",
      fieldName: "received_at",
      columnType: "timestamptz",
    },
    processedAt: {
      type: "Date",
      fieldName: "processed_at",
      columnType: "timestamptz",
      nullable: true,
    },
  },
});

