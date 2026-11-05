import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { IntegrationEventPublisherPort } from "@modules/messaging/application/ports/outbound/integration-event-publisher.port";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { Inject, Injectable } from "@nestjs/common";
import { SQS_CLIENT } from "@shared/adapters/outbound/sqs/sqs-client.factory";

@Injectable()
export class SqsIntegrationEventPublisherAdapter implements IntegrationEventPublisherPort {
  private readonly eventsQueueUrl: string | undefined;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
  ) {
    this.eventsQueueUrl = process.env.SQS_EVENTS_QUEUE_URL?.trim() || undefined;
  }

  async publish(message: OutboxMessage): Promise<void> {
    if (!this.eventsQueueUrl) {
      return;
    }

    const isFifo = this.eventsQueueUrl.endsWith(".fifo");
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.eventsQueueUrl,
        MessageBody: JSON.stringify(message.payload),
        ...(isFifo
          ? {
              MessageGroupId: message.aggregateId,
              MessageDeduplicationId: message.id,
            }
          : {}),
      }),
    );
  }
}

