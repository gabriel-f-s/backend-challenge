import { describe, expect, it } from "bun:test";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("ReconcileWalletUseCase", () => {
  const createdAt = new Date("2026-07-29T15:00:00.000Z");

  it("returns consistent: true when stored balance matches ledger sum", async () => {
    const wallet = Wallet.rehydrate({
      id: "wallet-1",
      playerId: "player-1",
      currency: "BRL",
      balance: Money.from({ amount: "975.00", currency: "BRL" }),
      version: 2,
      createdAt,
      updatedAt: createdAt,
    });

    const entries = [
      WalletLedgerEntry.create({
        id: "e-1",
        walletId: "wallet-1",
        transactionId: "tx-open",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "1000.00", currency: "BRL" }),
        balanceBefore: Money.zero("BRL"),
        balanceAfter: Money.from({ amount: "1000.00", currency: "BRL" }),
        createdAt,
      }),
      WalletLedgerEntry.create({
        id: "e-2",
        walletId: "wallet-1",
        transactionId: "tx-bet",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "25.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "1000.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "975.00", currency: "BRL" }),
        createdAt,
      }),
    ];

    const useCase = new ReconcileWalletUseCase(
      {
        findById: async () => wallet,
        findByIdForUpdate: async () => wallet,
        findByPlayerAndCurrency: async () => wallet,
        insert: async () => {},
        save: async () => {},
      },
      {
        insert: async () => {},
        insertOpeningTransactionAndLedgerEntry: async () => {},
        findByWalletAndTransactionId: async () => null,
        listByWalletId: async () => ({ items: [], nextCursor: null }),
        findAllByWalletIdOrdered: async () => entries,
      },
    );

    const result = await useCase.execute("wallet-1");

    expect(result).toEqual({
      walletId: "wallet-1",
      storedBalance: { amount: "975.00", currency: "BRL" },
      calculatedBalance: { amount: "975.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
  });

  it("flags divergence with consistent: false without mutating stored balance", async () => {
    const wallet = Wallet.rehydrate({
      id: "wallet-1",
      playerId: "player-1",
      currency: "BRL",
      balance: Money.from({ amount: "950.00", currency: "BRL" }),
      version: 2,
      createdAt,
      updatedAt: createdAt,
    });

    const entries = [
      WalletLedgerEntry.create({
        id: "e-1",
        walletId: "wallet-1",
        transactionId: "tx-open",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "1000.00", currency: "BRL" }),
        balanceBefore: Money.zero("BRL"),
        balanceAfter: Money.from({ amount: "1000.00", currency: "BRL" }),
        createdAt,
      }),
    ];

    let saveCalled = false;
    const useCase = new ReconcileWalletUseCase(
      {
        findById: async () => wallet,
        findByIdForUpdate: async () => wallet,
        findByPlayerAndCurrency: async () => wallet,
        insert: async () => {},
        save: async () => {
          saveCalled = true;
        },
      },
      {
        insert: async () => {},
        insertOpeningTransactionAndLedgerEntry: async () => {},
        findByWalletAndTransactionId: async () => null,
        listByWalletId: async () => ({ items: [], nextCursor: null }),
        findAllByWalletIdOrdered: async () => entries,
      },
    );

    const result = await useCase.execute("wallet-1");

    expect(result.consistent).toBe(false);
    expect(result.difference).toEqual({ amount: "-50.00", currency: "BRL" });
    expect(saveCalled).toBe(false);
  });
});

