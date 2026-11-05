import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type {
  CorrelationContextData,
  CorrelationContextPort,
} from "@shared/application/ports/outbound/correlation-context.port";

const correlationStorage = new AsyncLocalStorage<CorrelationContextData>();

@Injectable()
export class AsyncLocalCorrelationContextAdapter implements CorrelationContextPort {
  get(): CorrelationContextData | undefined {
    return correlationStorage.getStore();
  }

  run<T>(context: CorrelationContextData, callback: () => T): T {
    const parent = correlationStorage.getStore();
    const merged: CorrelationContextData = {
      ...parent,
      ...context,
    };
    return correlationStorage.run(merged, callback);
  }

  merge(partial: Partial<CorrelationContextData>): void {
    const store = correlationStorage.getStore();
    if (!store) {
      return;
    }
    if (partial.correlationId !== undefined) {
      store.correlationId = partial.correlationId;
    }
    if (partial.messageId !== undefined) {
      store.messageId = partial.messageId;
    }
    if (partial.transactionId !== undefined) {
      store.transactionId = partial.transactionId;
    }
    if (partial.walletId !== undefined) {
      store.walletId = partial.walletId;
    }
    if (partial.providerId !== undefined) {
      store.providerId = partial.providerId;
    }
  }
}

