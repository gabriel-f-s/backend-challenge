import {
  BusinessRuleViolationError,
  CurrencyMismatchError,
  DomainValidationError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";
import { LedgerDirection } from "../enums/ledger-direction.enum";
import { WalletLedgerEntry } from "./wallet-ledger-entry.entity";

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly createdAt?: Date;
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WalletDebitParams {
  readonly entryId: string;
  readonly transactionId: string;
  readonly money: Money;
  readonly at: Date;
  readonly insufficientFundsFailureCode?: FailureCode;
}

export interface WalletCreditParams {
  readonly entryId: string;
  readonly transactionId: string;
  readonly money: Money;
  readonly at: Date;
}

export interface WalletOpeningLedgerParams {
  readonly entryId: string;
  readonly transactionId: string;
  readonly at: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (!props.id || props.id.trim() === "") {
      throw new DomainValidationError("Wallet id is required", "INVALID_WALLET_ID");
    }
    if (!props.playerId || props.playerId.trim() === "") {
      throw new DomainValidationError("Wallet playerId is required", "INVALID_PLAYER_ID");
    }
    if (props.initialBalance.isNegative()) {
      throw new DomainValidationError(
        "Wallet initialBalance cannot be negative",
        "NEGATIVE_INITIAL_BALANCE",
      );
    }

    const now = props.createdAt ?? new Date();
    return new Wallet(
      props.id.trim(),
      props.playerId.trim(),
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(params: WalletDebitParams): WalletLedgerEntry {
    this.assertSameCurrency(params.money);

    if (!params.money.isPositive()) {
      throw new DomainValidationError(
        "Debit amount must be strictly positive",
        "NON_POSITIVE_DEBIT_AMOUNT",
      );
    }

    if (this._balance.isLessThan(params.money)) {
      const code = params.insufficientFundsFailureCode ?? FailureCode.InsufficientFundsBet;
      throw new BusinessRuleViolationError(
        code,
        `Insufficient wallet balance: available ${this._balance.toString()}, required ${params.money.toString()}`,
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(params.money);

    const ledgerEntry = WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction: LedgerDirection.Debit,
      money: params.money,
      balanceBefore,
      balanceAfter,
      createdAt: params.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = params.at;

    return ledgerEntry;
  }

  credit(params: WalletCreditParams): WalletLedgerEntry {
    this.assertSameCurrency(params.money);

    if (!params.money.isPositive()) {
      throw new DomainValidationError(
        "Credit amount must be strictly positive",
        "NON_POSITIVE_CREDIT_AMOUNT",
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(params.money);

    const ledgerEntry = WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction: LedgerDirection.Credit,
      money: params.money,
      balanceBefore,
      balanceAfter,
      createdAt: params.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = params.at;

    return ledgerEntry;
  }

  createOpeningLedgerEntry(params: WalletOpeningLedgerParams): WalletLedgerEntry {
    if (!this._balance.isPositive()) {
      throw new DomainValidationError(
        "Opening ledger entry requires a positive initial balance",
        "ZERO_OPENING_BALANCE",
      );
    }

    return WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction: LedgerDirection.Credit,
      money: this._balance,
      balanceBefore: Money.zero(this.currency),
      balanceAfter: this._balance,
      createdAt: params.at,
    });
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}

