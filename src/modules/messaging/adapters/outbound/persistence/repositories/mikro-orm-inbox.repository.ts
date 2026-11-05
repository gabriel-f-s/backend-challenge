import { LockMode } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import type {
  InboxRepositoryPort,
  InsertInboxResult,
} from "@modules/messaging/application/ports/outbound/inbox.repository.port";
import type { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";
import { Injectable } from "@nestjs/common";
import { resolveActiveEntityManager } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { InboxMessageMapper } from "../mappers/inbox-message.mapper";
import { InboxMessagePersistenceRecord } from "../schemas/inbox-message.schema";

@Injectable()
export class MikroOrmInboxRepository implements InboxRepositoryPort {
  constructor(private readonly rootEntityManager: EntityManager) {}

  async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(InboxMessagePersistenceRecord, {
      consumerName,
      messageId,
    });
    return record ? InboxMessageMapper.toDomain(record) : null;
  }

  async insertIfAbsent(message: InboxMessage): Promise<InsertInboxResult> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const insertedRows = await em.execute<InboxMessagePersistenceRecord[]>(
      `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at, processed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (consumer_name, message_id) DO NOTHING
       RETURNING
         consumer_name AS "consumerName",
         message_id AS "messageId",
         payload_hash AS "payloadHash",
         received_at AS "receivedAt",
         processed_at AS "processedAt"`,
      [
        message.consumerName,
        message.messageId,
        message.payloadHash,
        message.receivedAt,
        message.processedAt ?? null,
      ],
    );

    const insertedRow = insertedRows[0];
    if (insertedRow) {
      return {
        inserted: true,
        message: InboxMessageMapper.toDomain(insertedRow),
      };
    }

    const existingRecord = await em.findOneOrFail(
      InboxMessagePersistenceRecord,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    return {
      inserted: false,
      message: InboxMessageMapper.toDomain(existingRecord),
    };
  }

  async save(message: InboxMessage): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    await em.nativeUpdate(
      InboxMessagePersistenceRecord,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
      },
      {
        payloadHash: message.payloadHash,
        receivedAt: message.receivedAt,
        processedAt: message.processedAt ?? null,
      },
    );
  }
}
