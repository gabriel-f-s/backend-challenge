import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";

export const INTEGRATION_EVENT_PUBLISHER_PORT = Symbol("INTEGRATION_EVENT_PUBLISHER_PORT");

export interface IntegrationEventPublisherPort {
  publish(message: OutboxMessage): Promise<void>;
}

