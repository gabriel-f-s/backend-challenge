import {
  DomainValidationError,
  InvalidTransactionStateError,
} from "@shared/domain/errors/domain.error";

export interface ReceiveInboxProps {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

export interface InboxMessageState {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
  readonly processedAt?: Date;
}

export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: ReceiveInboxProps): InboxMessage {
    if (!props.messageId || props.messageId.trim() === "") {
      throw new DomainValidationError("InboxMessage messageId is required", "INVALID_INBOX_MESSAGE_ID");
    }
    if (!props.consumerName || props.consumerName.trim() === "") {
      throw new DomainValidationError(
        "InboxMessage consumerName is required",
        "INVALID_INBOX_CONSUMER_NAME",
      );
    }
    if (!props.payloadHash || props.payloadHash.trim() === "") {
      throw new DomainValidationError(
        "InboxMessage payloadHash is required",
        "INVALID_INBOX_PAYLOAD_HASH",
      );
    }

    return new InboxMessage(
      props.messageId.trim(),
      props.consumerName.trim(),
      props.payloadHash.trim(),
      props.receivedAt,
      undefined,
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidTransactionStateError("PROCESSED", "markProcessed");
    }
    this._processedAt = at;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }
}

