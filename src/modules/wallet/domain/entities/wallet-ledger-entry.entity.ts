import { DomainValidationError } from "@shared/domain/errors/domain.error";
import type { Money } from "@shared/domain/value-objects/money.vo";
import { LedgerDirection } from "../enums/ledger-direction.enum";

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}

export type LedgerEntryState = CreateLedgerEntryProps;

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.id || props.id.trim() === "") {
      throw new DomainValidationError("Ledger entry id is required", "INVALID_LEDGER_ENTRY_ID");
    }
    if (!props.walletId || props.walletId.trim() === "") {
      throw new DomainValidationError(
        "Ledger entry walletId is required",
        "INVALID_LEDGER_WALLET_ID",
      );
    }
    if (!props.transactionId || props.transactionId.trim() === "") {
      throw new DomainValidationError(
        "Ledger entry transactionId is required",
        "INVALID_LEDGER_TRANSACTION_ID",
      );
    }
    if (!props.money.isPositive()) {
      throw new DomainValidationError(
        "Ledger entry money amount must be strictly positive",
        "NON_POSITIVE_LEDGER_AMOUNT",
      );
    }
    if (props.balanceBefore.isNegative() || props.balanceAfter.isNegative()) {
      throw new DomainValidationError(
        "Ledger entry balances cannot be negative",
        "NEGATIVE_LEDGER_BALANCE",
      );
    }

    const entry = new WalletLedgerEntry(
      props.id.trim(),
      props.walletId.trim(),
      props.transactionId.trim(),
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new DomainValidationError(
        "Ledger entry arithmetic is unbalanced (balanceBefore ± money !== balanceAfter)",
        "UNBALANCED_LEDGER_ENTRY",
      );
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      return this.balanceBefore.add(this.money).equals(this.balanceAfter);
    }
    return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
  }
}

