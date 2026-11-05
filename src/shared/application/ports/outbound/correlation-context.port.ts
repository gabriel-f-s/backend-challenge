export const CORRELATION_CONTEXT_PORT = Symbol("CORRELATION_CONTEXT_PORT");

export interface CorrelationContextData {
  correlationId: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
}

export interface CorrelationContextPort {
  get(): CorrelationContextData | undefined;
  run<T>(context: CorrelationContextData, callback: () => T): T;
  merge(partial: Partial<CorrelationContextData>): void;
}

