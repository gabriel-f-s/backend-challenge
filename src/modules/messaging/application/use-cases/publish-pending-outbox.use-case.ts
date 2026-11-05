import {
  INTEGRATION_EVENT_PUBLISHER_PORT,
  type IntegrationEventPublisherPort,
} from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import {
  OUTBOX_REPOSITORY_PORT,
  type OutboxRepositoryPort,
} from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK_PORT, type ClockPort } from "@shared/application/ports/outbound/clock.port";
import {
  UNIT_OF_WORK_PORT,
  type UnitOfWorkPort,
} from "@shared/application/ports/outbound/unit-of-work.port";

export interface PublishPendingOutboxResult {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
}

@Injectable()
export class PublishPendingOutboxUseCase {
  constructor(
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(INTEGRATION_EVENT_PUBLISHER_PORT)
    private readonly eventPublisher: IntegrationEventPublisherPort,
    @Inject(CLOCK_PORT)
    private readonly clock: ClockPort,
  ) {}

  async execute(batchSize = 50): Promise<PublishPendingOutboxResult> {
    return this.unitOfWork.runInTransaction(async () => {
      const now = this.clock.now();
      const dueMessages = await this.outboxRepository.claimDueBatch(now, batchSize);

      let published = 0;
      let retried = 0;

      for (const message of dueMessages) {
        try {
          await this.eventPublisher.publish(message);
          message.markPublished(this.clock.now());
          await this.outboxRepository.save(message);
          published += 1;
        } catch {
          message.scheduleRetry(this.clock.now());
          await this.outboxRepository.save(message);
          retried += 1;
        }
      }

      return {
        claimed: dueMessages.length,
        published,
        retried,
      };
    });
  }
}

