import {
  DomainValidationError,
  InvalidTransactionStateError,
} from "@shared/domain/errors/domain.error";
import type { IntegrationEvent } from "@shared/domain/events/integration-event.base";

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly publishedAt?: Date;
}

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000;

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    if (!event.eventId || event.eventId.trim() === "") {
      throw new DomainValidationError("OutboxMessage eventId is required", "INVALID_OUTBOX_EVENT_ID");
    }
    if (!event.aggregateId || event.aggregateId.trim() === "") {
      throw new DomainValidationError(
        "OutboxMessage aggregateId is required",
        "INVALID_OUTBOX_AGGREGATE_ID",
      );
    }
    if (!event.eventType || event.eventType.trim() === "") {
      throw new DomainValidationError(
        "OutboxMessage eventType is required",
        "INVALID_OUTBOX_EVENT_TYPE",
      );
    }

    const serializedEnvelope = Object.freeze({ ...event.toJSON() }) as Readonly<
      Record<string, unknown>
    >;

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      serializedEnvelope,
      event.occurredAt,
      0,
      event.occurredAt,
      undefined,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      Object.freeze({ ...state.payload }),
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    if (this._nextAttemptAt === undefined) {
      return true;
    }
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new InvalidTransactionStateError("PUBLISHED", "markPublished");
    }
    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new InvalidTransactionStateError("PUBLISHED", "scheduleRetry");
    }
    this._attempts += 1;
    const backoffDelayMs = Math.min(
      BASE_RETRY_DELAY_MS * 2 ** (this._attempts - 1),
      MAX_RETRY_DELAY_MS,
    );
    this._nextAttemptAt = new Date(now.getTime() + backoffDelayMs);
  }
}

