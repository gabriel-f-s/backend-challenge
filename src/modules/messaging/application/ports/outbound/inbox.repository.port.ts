import type { InboxMessage } from "@modules/messaging/domain/entities/inbox-message.entity";

export const INBOX_REPOSITORY_PORT = Symbol("INBOX_REPOSITORY_PORT");

export interface InsertInboxResult {
  readonly inserted: boolean;
  readonly message: InboxMessage;
}

export interface InboxRepositoryPort {
  findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  insertIfAbsent(message: InboxMessage): Promise<InsertInboxResult>;
  save(message: InboxMessage): Promise<void>;
}

