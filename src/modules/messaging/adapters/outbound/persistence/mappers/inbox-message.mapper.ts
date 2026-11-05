import { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import { InboxMessagePersistenceRecord } from "../schemas/inbox-message.schema";

export class InboxMessageMapper {
  private constructor() {}

  static toDomain(record: InboxMessagePersistenceRecord): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: record.consumerName,
      messageId: record.messageId,
      payloadHash: record.payloadHash,
      receivedAt: new Date(record.receivedAt),
      processedAt: record.processedAt ? new Date(record.processedAt) : undefined,
    });
  }

  static toPersistence(entity: InboxMessage): InboxMessagePersistenceRecord {
    const record = new InboxMessagePersistenceRecord();
    record.consumerName = entity.consumerName;
    record.messageId = entity.messageId;
    record.payloadHash = entity.payloadHash;
    record.receivedAt = entity.receivedAt;
    record.processedAt = entity.processedAt ?? null;
    return record;
  }
}

