import { describe, expect, it } from "bun:test";
import { WalletMapper } from "@modules/wallet/adapters/outbound/persistence/mappers/wallet.mapper";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { WalletBalanceChanged } from "@modules/wallet/domain/events/wallet-balance-changed.event";
import {
  BusinessRuleViolationError,
  CurrencyMismatchError,
  DomainValidationError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("Wallet Aggregate Root", () => {
  const createdAt = new Date("2026-07-29T15:00:00.000Z");

  it("opens a wallet with version 1 and applies debit and credit generating balanced ledger entries", () => {
    const wallet = Wallet.open({
      id: "0192f291-27dd-7d3f-8071-5f8685deef37",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt,
    });

    expect(wallet.version).toBe(1);
    expect(wallet.balance.amount).toBe("100.00");

    const debitTime = new Date("2026-07-29T15:01:00.000Z");
    const debitEntry = wallet.debit({
      entryId: "entry-1",
      transactionId: "tx-1",
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      at: debitTime,
    });

    expect(wallet.balance.amount).toBe("75.00");
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(debitTime);
    expect(debitEntry.direction).toBe(LedgerDirection.Debit);
    expect(debitEntry.balanceBefore.amount).toBe("100.00");
    expect(debitEntry.balanceAfter.amount).toBe("75.00");
    expect(debitEntry.isBalanced()).toBe(true);

    const creditTime = new Date("2026-07-29T15:02:00.000Z");
    const creditEntry = wallet.credit({
      entryId: "entry-2",
      transactionId: "tx-2",
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      at: creditTime,
    });

    expect(wallet.balance.amount).toBe("125.00");
    expect(wallet.version).toBe(3);
    expect(creditEntry.direction).toBe(LedgerDirection.Credit);
    expect(creditEntry.balanceBefore.amount).toBe("75.00");
    expect(creditEntry.balanceAfter.amount).toBe("125.00");
    expect(creditEntry.isBalanced()).toBe(true);

    const event = WalletBalanceChanged.from(wallet, creditEntry, {
      eventId: "evt-1",
      correlationId: "corr-1",
      causationId: "tx-2",
      occurredAt: creditTime,
    });

    expect(event.toJSON()).toEqual({
      eventId: "evt-1",
      eventType: "WalletBalanceChanged",
      aggregateId: wallet.id,
      correlationId: "corr-1",
      causationId: "tx-2",
      occurredAt: creditTime.toISOString(),
      version: 1,
      data: {
        walletId: wallet.id,
        transactionId: "tx-2",
        direction: LedgerDirection.Credit,
        money: { amount: "50.00", currency: "BRL" },
        balanceBefore: { amount: "75.00", currency: "BRL" },
        balanceAfter: { amount: "125.00", currency: "BRL" },
        walletVersion: 3,
      },
    });
  });

  it("rejects debit when balance is insufficient and preserves balance and version", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
      createdAt,
    });

    try {
      wallet.debit({
        entryId: "entry-1",
        transactionId: "tx-bet",
        money: Money.from({ amount: "80.00", currency: "BRL" }),
        at: createdAt,
      });
      throw new Error("Expected BusinessRuleViolationError");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolationError);
      expect((error as BusinessRuleViolationError).failureCode).toBe(
        FailureCode.InsufficientFundsBet,
      );
    }

    try {
      wallet.debit({
        entryId: "entry-2",
        transactionId: "tx-reversal",
        money: Money.from({ amount: "80.00", currency: "BRL" }),
        at: createdAt,
        insufficientFundsFailureCode: FailureCode.InsufficientFundsReversal,
      });
      throw new Error("Expected BusinessRuleViolationError");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolationError);
      expect((error as BusinessRuleViolationError).failureCode).toBe(
        FailureCode.InsufficientFundsReversal,
      );
    }

    expect(wallet.balance.amount).toBe("50.00");
    expect(wallet.version).toBe(1);
  });

  it("rejects currency mismatch and non-positive amounts on debit and credit", () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt,
    });

    expect(() =>
      wallet.debit({
        entryId: "e-1",
        transactionId: "tx-1",
        money: Money.from({ amount: "10.00", currency: "USD" }),
        at: createdAt,
      }),
    ).toThrow(CurrencyMismatchError);

    expect(() =>
      wallet.credit({
        entryId: "e-2",
        transactionId: "tx-2",
        money: Money.from({ amount: "10.00", currency: "USD" }),
        at: createdAt,
      }),
    ).toThrow(CurrencyMismatchError);

    expect(() =>
      wallet.debit({
        entryId: "e-3",
        transactionId: "tx-3",
        money: Money.zero("BRL"),
        at: createdAt,
      }),
    ).toThrow(DomainValidationError);
  });

  it("maps cleanly between domain and persistence via WalletMapper", () => {
    const wallet = Wallet.open({
      id: "0192f291-27dd-7d3f-8071-5f8685deef37",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      createdAt,
    });

    const record = WalletMapper.toPersistence(wallet);
    const rehydrated = WalletMapper.toDomain(record);

    expect(rehydrated.id).toBe(wallet.id);
    expect(rehydrated.playerId).toBe(wallet.playerId);
    expect(rehydrated.balance.equals(wallet.balance)).toBe(true);
    expect(rehydrated.version).toBe(1);
  });
});

