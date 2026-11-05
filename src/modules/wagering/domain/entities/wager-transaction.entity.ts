import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import {
  DomainValidationError,
  InvalidTransactionStateError,
} from "@shared/domain/errors/domain.error";
import type { FailureCode } from "@shared/domain/errors/failure-code.enum";
import type { Money } from "@shared/domain/value-objects/money.vo";
import { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../enums/wager-transaction-status.enum";

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt?: Date;
}

export interface WagerTransactionState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt: Date;
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly processedAt?: Date;
  readonly observedBalance?: Money;
  readonly attempts?: number;
  readonly nextAttemptAt?: Date;
}

const PENDING_REF_BASE_DELAY_MS = 1000;
const PENDING_REF_MAX_DELAY_MS = 30000;

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _observedBalance?: Money,
    private _attempts = 0,
    private _nextAttemptAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new DomainValidationError(
        "OPENING transaction kind is internal and cannot be submitted externally",
        "FORBIDDEN_OPENING_TRANSACTION_KIND",
      );
    }

    WagerTransaction.assertNonEmpty(props.id, "id");
    WagerTransaction.assertNonEmpty(props.providerId, "providerId");
    WagerTransaction.assertNonEmpty(props.externalTransactionId, "externalTransactionId");
    WagerTransaction.assertNonEmpty(props.idempotencyKey, "idempotencyKey");
    WagerTransaction.assertNonEmpty(props.payloadHash, "payloadHash");
    WagerTransaction.assertNonEmpty(props.walletId, "walletId");
    WagerTransaction.assertNonEmpty(props.playerId, "playerId");
    WagerTransaction.assertNonEmpty(props.roundId, "roundId");
    WagerTransaction.assertNonEmpty(props.gameId, "gameId");

    const trimmedRef = props.referenceExternalTransactionId?.trim() || undefined;
    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !trimmedRef
    ) {
      throw new DomainValidationError(
        `referenceExternalTransactionId is required for ${props.kind} transactions`,
        "MISSING_REFERENCE_EXTERNAL_TRANSACTION_ID",
      );
    }

    if (props.kind !== WagerTransactionKind.Loss && !props.money.isPositive()) {
      throw new DomainValidationError(
        `${props.kind} transaction amount must be strictly positive`,
        "NON_POSITIVE_TRANSACTION_AMOUNT",
      );
    }

    if (props.money.isNegative()) {
      throw new DomainValidationError(
        "Transaction amount cannot be negative",
        "NEGATIVE_TRANSACTION_AMOUNT",
      );
    }

    return new WagerTransaction(
      props.id.trim(),
      props.providerId.trim(),
      props.externalTransactionId.trim(),
      props.idempotencyKey.trim(),
      props.payloadHash.trim(),
      props.walletId.trim(),
      props.playerId.trim(),
      props.roundId.trim(),
      props.gameId.trim(),
      props.kind,
      props.money,
      trimmedRef,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.observedBalance,
      state.attempts ?? 0,
      state.nextAttemptAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get observedBalance(): Money | undefined {
    return this._observedBalance;
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    observedBalance?: Money,
  ): void {
    this.assertNotTerminal("markProcessed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._observedBalance = observedBalance ?? this._observedBalance;
    this._nextAttemptAt = undefined;
  }

  markPendingReference(now?: Date, observedBalance?: Money): void {
    this.assertNotTerminal("markPendingReference");
    this._status = WagerTransactionStatus.PendingReference;
    this._observedBalance = observedBalance ?? this._observedBalance;
    if (now) {
      this._nextAttemptAt = new Date(now.getTime() + PENDING_REF_BASE_DELAY_MS);
    }
  }

  schedulePendingReferenceRetry(now: Date): void {
    this.assertNotTerminal("schedulePendingReferenceRetry");
    this._status = WagerTransactionStatus.PendingReference;
    this._attempts += 1;
    const delayMs = Math.min(
      PENDING_REF_BASE_DELAY_MS * 2 ** (this._attempts - 1),
      PENDING_REF_MAX_DELAY_MS,
    );
    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }

  reject(code: FailureCode, at?: Date, observedBalance?: Money): void {
    this.assertNotTerminal("reject");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at ?? new Date();
    this._observedBalance = observedBalance ?? this._observedBalance;
    this._nextAttemptAt = undefined;
  }

  fail(code: FailureCode, at?: Date): void {
    this.assertNotTerminal("fail");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at ?? new Date();
    this._nextAttemptAt = undefined;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new DomainValidationError(
            "ROLLBACK requires a resolved reference transaction to determine ledger direction",
            "MISSING_ROLLBACK_REFERENCE",
          );
        }
        const referenceDirection = reference.ledgerDirectionFor();
        return referenceDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
      case WagerTransactionKind.Loss:
        throw new DomainValidationError(
          "LOSS transaction does not affect balance or generate a ledger entry",
          "LOSS_HAS_NO_LEDGER_DIRECTION",
        );
    }
  }

  private assertNotTerminal(targetAction: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, targetAction);
    }
  }

  private static assertNonEmpty(value: string, fieldName: string): void {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(
        `WagerTransaction ${fieldName} is required`,
        `INVALID_TRANSACTION_${fieldName.toUpperCase()}`,
      );
    }
  }
}

