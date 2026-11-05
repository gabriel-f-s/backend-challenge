import { describe, expect, it } from "bun:test";
import { WalletLedgerEntryMapper } from "@modules/wallet/adapters/outbound/persistence/mappers/wallet-ledger-entry.mapper";
import { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { DomainValidationError } from "@shared/domain/errors/domain.error";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("WalletLedgerEntry Entity & Mapper", () => {
  const createdAt = new Date("2026-07-29T15:00:00.000Z");

  it("creates balanced CREDIT and DEBIT ledger entries", () => {
    const creditEntry = WalletLedgerEntry.create({
      id: "entry-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceBefore: Money.zero("BRL"),
      balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt,
    });

    expect(creditEntry.isBalanced()).toBe(true);

    const debitEntry = WalletLedgerEntry.create({
      id: "entry-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "75.00", currency: "BRL" }),
      createdAt,
    });

    expect(debitEntry.isBalanced()).toBe(true);

    const record = WalletLedgerEntryMapper.toPersistence(debitEntry);
    const rehydrated = WalletLedgerEntryMapper.toDomain(record);
    expect(rehydrated.id).toBe(debitEntry.id);
    expect(rehydrated.balanceAfter.amount).toBe("75.00");
  });

  it("rejects unbalanced arithmetic or zero money on create", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-bad",
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "25.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }),
        createdAt,
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-zero",
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Credit,
        money: Money.zero("BRL"),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
        createdAt,
      }),
    ).toThrow(DomainValidationError);
  });
});

