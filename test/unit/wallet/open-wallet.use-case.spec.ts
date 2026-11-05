import { describe, expect, it } from "bun:test";
import type { OutboxRepositoryPort } from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import type { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import type { WalletRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import type {
  RecordOpeningLedgerParams,
  WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import type { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import type { ClockPort } from "@shared/application/ports/outbound/clock.port";
import type { IdGeneratorPort } from "@shared/application/ports/outbound/id-generator.port";
import type { UnitOfWorkPort } from "@shared/application/ports/outbound/unit-of-work.port";
import { ConflictError } from "@shared/domain/errors/domain.error";

describe("OpenWalletUseCase", () => {
  const fixedNow = new Date("2026-07-29T15:00:00.000Z");
  const clock: ClockPort = { now: () => fixedNow };
  const unitOfWork: UnitOfWorkPort = {
    runInTransaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
  };

  it("opens a wallet with positive initial balance, recording OPENING ledger entry and Outbox event", async () => {
    const wallets = new Map<string, Wallet>();
    const openingRecords: RecordOpeningLedgerParams[] = [];
    const outboxMessages: OutboxMessage[] = [];
    let counter = 0;

    const idGenerator: IdGeneratorPort = {
      generate: () => {
        counter += 1;
        return `0192f291-27dd-7d3f-8071-5f8685deef3${counter}`;
      },
    };

    const walletRepo: WalletRepositoryPort = {
      findById: async (id) => wallets.get(id) ?? null,
      findByIdForUpdate: async (id) => wallets.get(id) ?? null,
      findByPlayerAndCurrency: async (playerId, currency) => {
        for (const wallet of wallets.values()) {
          if (wallet.playerId === playerId && wallet.currency === currency) {
            return wallet;
          }
        }
        return null;
      },
      insert: async (wallet) => {
        wallets.set(wallet.id, wallet);
      },
      save: async (wallet) => {
        wallets.set(wallet.id, wallet);
      },
    };

    const ledgerRepo: WalletLedgerRepositoryPort = {
      insert: async () => {},
      insertOpeningTransactionAndLedgerEntry: async (params) => {
        openingRecords.push(params);
      },
      findByWalletAndTransactionId: async () => null,
      listByWalletId: async () => ({ items: [], nextCursor: null }),
      findAllByWalletIdOrdered: async () => [],
    };

    const outboxRepo: OutboxRepositoryPort = {
      enqueue: async (msg) => {
        outboxMessages.push(msg);
      },
      enqueueMany: async () => {},
      claimDueBatch: async () => [],
      save: async () => {},
      countPending: async () => 0,
    };

    const useCase = new OpenWalletUseCase(
      unitOfWork,
      walletRepo,
      ledgerRepo,
      outboxRepo,
      idGenerator,
      clock,
    );

    const output = await useCase.execute({
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    expect(output).toEqual({
      id: "0192f291-27dd-7d3f-8071-5f8685deef31",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });
    expect(openingRecords).toHaveLength(1);
    expect(openingRecords[0]?.entry.direction).toBe(LedgerDirection.Credit);
    expect(openingRecords[0]?.entry.balanceBefore.amount).toBe("0.00");
    expect(openingRecords[0]?.entry.balanceAfter.amount).toBe("1000.00");
    expect(outboxMessages).toHaveLength(1);
    expect(outboxMessages[0]?.eventType).toBe("WalletBalanceChanged");

    await expect(
      useCase.execute({
        playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
        initialBalance: { amount: "500.00", currency: "BRL" },
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("opens a wallet with 0.00 initial balance without creating ledger entry or outbox event", async () => {
    const openingRecords: RecordOpeningLedgerParams[] = [];
    const outboxMessages: OutboxMessage[] = [];

    const useCase = new OpenWalletUseCase(
      unitOfWork,
      {
        findById: async () => null,
        findByIdForUpdate: async () => null,
        findByPlayerAndCurrency: async () => null,
        insert: async () => {},
        save: async () => {},
      },
      {
        insert: async () => {},
        insertOpeningTransactionAndLedgerEntry: async (params) => {
          openingRecords.push(params);
        },
        findByWalletAndTransactionId: async () => null,
        listByWalletId: async () => ({ items: [], nextCursor: null }),
        findAllByWalletIdOrdered: async () => [],
      },
      {
        enqueue: async (msg) => {
          outboxMessages.push(msg);
        },
        enqueueMany: async () => {},
        claimDueBatch: async () => [],
        save: async () => {},
        countPending: async () => 0,
      },
      { generate: () => "0192f291-27dd-7d3f-8071-5f8685deef31" },
      clock,
    );

    const output = await useCase.execute({
      playerId: "player-zero",
      initialBalance: { amount: "0.00", currency: "BRL" },
    });

    expect(output.balance).toEqual({ amount: "0.00", currency: "BRL" });
    expect(output.version).toBe(1);
    expect(openingRecords).toHaveLength(0);
    expect(outboxMessages).toHaveLength(0);
  });
});

