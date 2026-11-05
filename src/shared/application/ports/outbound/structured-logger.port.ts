export const STRUCTURED_LOGGER_PORT = Symbol("STRUCTURED_LOGGER_PORT");

export interface StructuredLoggerPort {
  info(event: string, metadata?: Record<string, unknown>): void;
  warn(event: string, metadata?: Record<string, unknown>): void;
  error(event: string, metadata?: Record<string, unknown>): void;
}

