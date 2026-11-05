import { SQSClient } from "@aws-sdk/client-sqs";
import { loadEnvironmentConfig, type AppEnvironmentConfig } from "../config/env.config";

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

