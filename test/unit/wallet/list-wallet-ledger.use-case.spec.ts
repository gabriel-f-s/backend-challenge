import { describe, expect, it } from "bun:test";
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { ListWalletLedgerUseCase } from "@modules/wallet/application/use-cases/list-wallet-ledger.use-case";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { DomainValidationError, ResourceNotFoundError } from "@shared/domain/errors/domain.error";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("ListWalletLedgerUseCase & Cursor Pagination", () => {
  it("encodes and decodes opaque ledger cursors and rejects malformed cursors", () => {
    const raw = encodeLedgerCursor({
      createdAtIso: "2026-07-29T15:00:00.000Z",
      id: "0192f291-27dd-7d3f-8071-5f8685deef37",
    });

    expect(decodeLedgerCursor(raw)).toEqual({
      createdAtIso: "2026-07-29T15:00:00.000Z",
      id: "0192f291-27dd-7d3f-8071-5f8685deef37",
    });

    expect(() => decodeLedgerCursor("not-valid-base64-json")).toThrow(DomainValidationError);
  });

  it("validates limit bounds and wallet existence", async () => {
    const wallet = Wallet.open({
      id: "wallet-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const useCase = new ListWalletLedgerUseCase(
      {
        findById: async (id) => (id === "wallet-1" ? wallet : null),
        findByIdForUpdate: async () => null,
        findByPlayerAndCurrency: async () => null,
        insert: async () => {},
        save: async () => {},
      },
      {
        insert: async () => {},
        insertOpeningTransactionAndLedgerEntry: async () => {},
        findByWalletAndTransactionId: async () => null,
        listByWalletId: async () => ({ items: [], nextCursor: null }),
        findAllByWalletIdOrdered: async () => [],
      },
    );

    await expect(useCase.execute({ walletId: "wallet-1", limit: 0 })).rejects.toThrow(
      DomainValidationError,
    );
    await expect(useCase.execute({ walletId: "wallet-1", limit: 101 })).rejects.toThrow(
      DomainValidationError,
    );
    await expect(useCase.execute({ walletId: "missing-wallet" })).rejects.toThrow(
      ResourceNotFoundError,
    );
  });
});

