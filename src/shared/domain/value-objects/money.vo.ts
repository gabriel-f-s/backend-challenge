import Decimal from "decimal.js";
import { CurrencyMismatchError, DomainValidationError } from "../errors/domain.error";

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

const STRICT_DECIMAL_AMOUNT_PATTERN = /^(0|[1-9]\d*)\.\d{2}$/;
const ISO_4217_CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (props === null || typeof props !== "object") {
      throw new DomainValidationError("Money props must be an object", "INVALID_MONEY_PROPS");
    }

    Money.validateCurrency(props.currency);
    Money.validateAmountString(props.amount);

    const decimalValue = new Decimal(props.amount);
    return new Money(decimalValue, props.currency);
  }

  static zero(currency: string): Money {
    Money.validateCurrency(currency);
    return new Money(new Decimal("0.00"), currency);
  }

  static rehydrate(props: MoneyProps): Money {
    return new Money(new Decimal(props.amount), props.currency);
  }

  get amount(): string {
    return this.value.toFixed(2);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    if (this.value.isZero()) {
      return new Money(new Decimal("0.00"), this.currency);
    }
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static validateCurrency(currency: string): void {
    if (typeof currency !== "string" || !ISO_4217_CURRENCY_PATTERN.test(currency)) {
      throw new DomainValidationError(
        `Invalid ISO-4217 currency code: "${String(currency)}"`,
        "INVALID_CURRENCY",
      );
    }
  }

  private static validateAmountString(amount: string): void {
    if (typeof amount !== "string" || amount.length === 0) {
      throw new DomainValidationError("Money amount must be a non-empty string", "INVALID_MONEY_AMOUNT");
    }

    if (amount.startsWith("-")) {
      throw new DomainValidationError(
        `Money amount cannot be negative in input contracts: "${amount}"`,
        "NEGATIVE_MONEY_AMOUNT",
      );
    }

    if (!STRICT_DECIMAL_AMOUNT_PATTERN.test(amount)) {
      throw new DomainValidationError(
        `Money amount must be a decimal string with exact scale of 2: "${amount}"`,
        "INVALID_MONEY_AMOUNT_FORMAT",
      );
    }
  }
}

