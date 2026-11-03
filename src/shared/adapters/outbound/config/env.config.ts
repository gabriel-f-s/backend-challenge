export interface AppEnvironmentConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
  };
  readonly sqs: {
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly endpoint: string;
    readonly wagerTransactionsQueueName: string;
    readonly wagerTransactionsDlqName: string;
    readonly wagerTransactionsQueueUrl: string;
    readonly wagerTransactionsDlqUrl: string;
  };
}

function parsePort(rawValue: string | undefined, fallback: number, variableName: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port value for ${variableName}: "${rawValue}"`);
  }
  return parsed;
}

function parseNodeEnv(rawValue: string | undefined): "development" | "test" | "production" {
  if (rawValue === "production" || rawValue === "test" || rawValue === "development") {
    return rawValue;
  }
  return "development";
}

export function loadEnvironmentConfig(
  rawEnv: Record<string, string | undefined> = process.env,
): AppEnvironmentConfig {
  const sqsEndpoint = rawEnv.SQS_ENDPOINT?.trim() || "http://localhost:4566";
  const queueName = rawEnv.SQS_WAGER_TRANSACTIONS_QUEUE_NAME?.trim() || "wager-transactions.fifo";
  const dlqName = rawEnv.SQS_WAGER_TRANSACTIONS_DLQ_NAME?.trim() || "wager-transactions-dlq.fifo";

  return {
    nodeEnv: parseNodeEnv(rawEnv.NODE_ENV),
    port: parsePort(rawEnv.PORT, 3000, "PORT"),
    database: {
      host: rawEnv.DB_HOST?.trim() || "localhost",
      port: parsePort(rawEnv.DB_PORT, 5432, "DB_PORT"),
      user: rawEnv.DB_USER?.trim() || "jungle",
      password: rawEnv.DB_PASSWORD?.trim() || "jungle_secret",
      name: rawEnv.DB_NAME?.trim() || "wagering_processor",
    },
    sqs: {
      region: rawEnv.AWS_REGION?.trim() || "us-east-1",
      accessKeyId: rawEnv.AWS_ACCESS_KEY_ID?.trim() || "test",
      secretAccessKey: rawEnv.AWS_SECRET_ACCESS_KEY?.trim() || "test",
      endpoint: sqsEndpoint,
      wagerTransactionsQueueName: queueName,
      wagerTransactionsDlqName: dlqName,
      wagerTransactionsQueueUrl:
        rawEnv.SQS_WAGER_TRANSACTIONS_QUEUE_URL?.trim() ||
        `${sqsEndpoint}/000000000000/${queueName}`,
      wagerTransactionsDlqUrl:
        rawEnv.SQS_WAGER_TRANSACTIONS_DLQ_URL?.trim() ||
        `${sqsEndpoint}/000000000000/${dlqName}`,
    },
  };
}

