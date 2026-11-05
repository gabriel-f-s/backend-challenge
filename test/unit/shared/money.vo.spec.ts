import { describe, expect, it } from "bun:test";
import {
  CurrencyMismatchError,
  DomainValidationError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("Money Value Object", () => {
  it("creates immutable instances from valid decimal strings with scale 2", () => {
    const money = Money.from({ amount: "25.00", currency: "BRL" });
    const zero = Money.zero("BRL");

    expect(money.amount).toBe("25.00");
    expect(money.currency).toBe("BRL");
    expect(money.isPositive()).toBe(true);
    expect(money.isZero()).toBe(false);
    expect(money.isNegative()).toBe(false);
    expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    expect(money.toString()).toBe("25.00 BRL");

    expect(zero.amount).toBe("0.00");
    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
  });

  it("performs exact decimal arithmetic without floating-point drift and preserves immutability", () => {
    const a = Money.from({ amount: "0.10", currency: "BRL" });
    const b = Money.from({ amount: "0.20", currency: "BRL" });
    const sum = a.add(b);

    expect(sum.amount).toBe("0.30");
    expect(a.amount).toBe("0.10");
    expect(b.amount).toBe("0.20");

    const initial = Money.from({ amount: "100.00", currency: "BRL" });
    const bet = Money.from({ amount: "80.00", currency: "BRL" });
    const remaining = initial.subtract(bet);

    expect(remaining.amount).toBe("20.00");
    expect(remaining.isLessThan(initial)).toBe(true);
    expect(remaining.equals(Money.from({ amount: "20.00", currency: "BRL" }))).toBe(true);
  });

  it("supports negate and negative results from subtraction", () => {
    const ten = Money.from({ amount: "10.00", currency: "BRL" });
    const twenty = Money.from({ amount: "20.00", currency: "BRL" });

    const negated = ten.negate();
    expect(negated.amount).toBe("-10.00");
    expect(negated.isNegative()).toBe(true);
    expect(negated.isPositive()).toBe(false);

    const deficit = ten.subtract(twenty);
    expect(deficit.amount).toBe("-10.00");
    expect(deficit.isNegative()).toBe(true);

    const negatedZero = Money.zero("BRL").negate();
    expect(negatedZero.amount).toBe("0.00");
    expect(negatedZero.isZero()).toBe(true);
  });

  it("rejects invalid amount strings (NaN, Infinity, scientific notation, wrong scale, negatives)", () => {
    const invalidAmounts = [
      "",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e2",
      "25.00e0",
      "25",
      "25.5",
      "25.000",
      "10.123",
      "-25.00",
      "-0.01",
      "+25.00",
      " 25.00",
      "25.00 ",
      "00.50",
      "abc",
    ];

    for (const amount of invalidAmounts) {
      expect(() => Money.from({ amount, currency: "BRL" })).toThrow(DomainValidationError);
    }
  });

  it("rejects invalid ISO-4217 currency codes", () => {
    const invalidCurrencies = ["", "brl", "BR", "BRLX", "123", "BR$"];

    for (const currency of invalidCurrencies) {
      expect(() => Money.from({ amount: "10.00", currency })).toThrow(DomainValidationError);
      expect(() => Money.zero(currency)).toThrow(DomainValidationError);
    }
  });

  it("throws CurrencyMismatchError when operating across different currencies", () => {
    const brl = Money.from({ amount: "50.00", currency: "BRL" });
    const usd = Money.from({ amount: "50.00", currency: "USD" });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.equals(usd)).toThrow(CurrencyMismatchError);

    try {
      brl.add(usd);
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect((error as CurrencyMismatchError).failureCode).toBe(FailureCode.CurrencyMismatch);
    }
  });
});

