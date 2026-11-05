import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";

export const OUTBOX_REPOSITORY_PORT = Symbol("OUTBOX_REPOSITORY_PORT");

export interface OutboxRepositoryPort {
  enqueue(message: OutboxMessage): Promise<void>;
  enqueueMany(messages: readonly OutboxMessage[]): Promise<void>;
  claimDueBatch(now: Date, limit: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
  countPending(): Promise<number>;
}

