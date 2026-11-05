import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  CORRELATION_CONTEXT_PORT,
  type CorrelationContextPort,
} from "@shared/application/ports/outbound/correlation-context.port";
import type { StructuredLoggerPort } from "@shared/application/ports/outbound/structured-logger.port";

const PROHIBITED_LOG_KEYS = new Set([
  "money",
  "amount",
  "balance",
  "balancebefore",
  "balanceafter",
  "initialbalance",
  "storedbalance",
  "calculatedbalance",
  "difference",
  "observedbalance",
  "observedbalanceamount",
  "authorization",
  "password",
  "secret",
  "token",
  "payload",
  "body",
]);

export type LogOutputWriter = (jsonLine: string) => void;

function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (PROHIBITED_LOG_KEYS.has(key.toLowerCase())) {
      continue;
    }

    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "object" && item !== null && !(item instanceof Date)
          ? sanitizeMetadata(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === "object" && value !== null && !(value instanceof Date)) {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

@Injectable()
export class JsonStructuredLoggerAdapter implements StructuredLoggerPort {
  private readonly writer: LogOutputWriter;

  constructor(
    @Optional()
    @Inject(CORRELATION_CONTEXT_PORT)
    private readonly correlationContext?: CorrelationContextPort,
    @Optional()
    writer?: LogOutputWriter,
  ) {
    this.writer =
      writer ??
      ((jsonLine: string) => {
        if (process.env.LOG_SILENT === "true") {
          return;
        }
        process.stdout.write(`${jsonLine}\n`);
      });
  }

  info(event: string, metadata?: Record<string, unknown>): void {
    this.writeEntry("info", event, metadata);
  }

  warn(event: string, metadata?: Record<string, unknown>): void {
    this.writeEntry("warn", event, metadata);
  }

  error(event: string, metadata?: Record<string, unknown>): void {
    this.writeEntry("error", event, metadata);
  }

  private writeEntry(
    level: "info" | "warn" | "error",
    event: string,
    metadata?: Record<string, unknown>,
  ): void {
    const activeContext = this.correlationContext?.get();
    const cleanedMetadata = metadata ? sanitizeMetadata(metadata) : {};

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(activeContext?.correlationId ? { correlationId: activeContext.correlationId } : {}),
      ...(activeContext?.messageId ? { messageId: activeContext.messageId } : {}),
      ...(activeContext?.transactionId ? { transactionId: activeContext.transactionId } : {}),
      ...(activeContext?.walletId ? { walletId: activeContext.walletId } : {}),
      ...(activeContext?.providerId ? { providerId: activeContext.providerId } : {}),
      ...cleanedMetadata,
    };

    this.writer(JSON.stringify(entry));
  }
}

