import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { type AppEnvironmentConfig, loadEnvironmentConfig } from "../config/env.config";

export const SQS_CLIENT = Symbol("SQS_CLIENT");

export function createSqsClient(env: AppEnvironmentConfig = loadEnvironmentConfig()): SQSClient {
  return new SQSClient({
    region: env.sqs.region,
    endpoint: env.sqs.endpoint,
    credentials: {
      accessKeyId: env.sqs.accessKeyId,
      secretAccessKey: env.sqs.secretAccessKey,
    },
  });
}

export async function ensureSqsQueuesProvisioned(
  sqsClient: SQSClient = createSqsClient(),
  env: AppEnvironmentConfig = loadEnvironmentConfig(),
): Promise<void> {
  const dlqResponse = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: env.sqs.wagerTransactionsDlqName,
      Attributes: {
        FifoQueue: "true",
        ContentBasedDeduplication: "false",
      },
    }),
  );

  const dlqUrl = dlqResponse.QueueUrl ?? env.sqs.wagerTransactionsDlqUrl;
  const dlqAttributes = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ["QueueArn"],
    }),
  );

  const dlqArn = dlqAttributes.Attributes?.QueueArn;

  await sqsClient.send(
    new CreateQueueCommand({
      QueueName: env.sqs.wagerTransactionsQueueName,
      Attributes: {
        FifoQueue: "true",
        ContentBasedDeduplication: "false",
        VisibilityTimeout: "30",
        ...(dlqArn
          ? {
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: dlqArn,
                maxReceiveCount: "5",
              }),
            }
          : {}),
      },
    }),
  );
}
