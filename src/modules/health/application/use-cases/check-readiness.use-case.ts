import { GetQueueAttributesCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import { Inject, Injectable } from "@nestjs/common";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { SQS_CLIENT } from "@shared/adapters/outbound/sqs/sqs-client.factory";

export interface ReadinessCheckOutput {
  readonly status: "ok" | "degraded";
  readonly timestamp: string;
  readonly checks: {
    readonly postgres: "up" | "down";
    readonly sqs: "up" | "down";
  };
}

@Injectable()
export class CheckReadinessUseCase {
  private readonly mainQueueUrl: string;

  constructor(
    private readonly entityManager: EntityManager,
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
  ) {
    this.mainQueueUrl = loadEnvironmentConfig().sqs.wagerTransactionsQueueUrl;
  }

  async execute(): Promise<ReadinessCheckOutput> {
    const [postgresUp, sqsUp] = await Promise.all([
      this.checkPostgres(),
      this.checkSqs(),
    ]);

    const allHealthy = postgresUp && sqsUp;

    return {
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        postgres: postgresUp ? "up" : "down",
        sqs: sqsUp ? "up" : "down",
      },
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.entityManager.getConnection().execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  private async checkSqs(): Promise<boolean> {
    try {
      await this.sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.mainQueueUrl,
          AttributeNames: ["QueueArn"],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

