import { OutboxPublisherWorker } from "@modules/messaging/adapters/inbound/workers/outbox-publisher.worker";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import { SqsIntegrationEventPublisherAdapter } from "@modules/messaging/adapters/outbound/sqs/sqs-integration-event-publisher.adapter";
import { INBOX_REPOSITORY_PORT } from "@modules/messaging/application/ports/outbound/inbox.repository.port";
import { INTEGRATION_EVENT_PUBLISHER_PORT } from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import { OUTBOX_REPOSITORY_PORT } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { PublishPendingOutboxUseCase } from "@modules/messaging/application/use-cases/publish-pending-outbox.use-case";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [
    {
      provide: INBOX_REPOSITORY_PORT,
      useClass: MikroOrmInboxRepository,
    },
    {
      provide: OUTBOX_REPOSITORY_PORT,
      useClass: MikroOrmOutboxRepository,
    },
    {
      provide: INTEGRATION_EVENT_PUBLISHER_PORT,
      useClass: SqsIntegrationEventPublisherAdapter,
    },
    PublishPendingOutboxUseCase,
    OutboxPublisherWorker,
  ],
  exports: [
    INBOX_REPOSITORY_PORT,
    OUTBOX_REPOSITORY_PORT,
    INTEGRATION_EVENT_PUBLISHER_PORT,
    PublishPendingOutboxUseCase,
  ],
})
export class MessagingModule {}
