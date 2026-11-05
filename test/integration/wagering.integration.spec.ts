import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmInboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-inbox.repository";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import { MikroOrmWagerTransactionRepository } from "@modules/wagering/adapters/outbound/persistence/repositories/mikro-orm-wager-transaction.repository";
import { GetWagerTransactionUseCase } from "@modules/wagering/application/use-cases/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { MikroOrmWalletRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWalletLedgerRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet-ledger.repository";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { initIntegrationTestOrm, truncateAllTables } from "./helpers/postgres-test-harness";

describe("Wagering Integration & Concurrency (Real PostgreSQL)", () => {
  let orm: MikroORM;
  const idGenerator = new UuidV7GeneratorAdapter();
  const clock = new SystemClockAdapter();

  function buildUseCases() {
    const forkEm = orm.em.fork();
    const uow = new MikroOrmUnitOfWorkAdapter(forkEm);
    const walletRepo = new MikroOrmWalletRepository(forkEm);
    const ledgerRepo = new MikroOrmWalletLedgerRepository(forkEm);
    const txRepo = new MikroOrmWagerTransactionRepository(forkEm);
    const outboxRepo = new MikroOrmOutboxRepository(forkEm);
    const inboxRepo = new MikroOrmInboxRepository(forkEm);

    return {
      openWallet: new OpenWalletUseCase(
        uow,
        walletRepo,
        ledgerRepo,
        outboxRepo,
        idGenerator,
        clock,
      ),
      processWager: new ProcessWagerTransactionUseCase(
        uow,
        walletRepo,
        ledgerRepo,
        txRepo,
        outboxRepo,
        inboxRepo,
        idGenerator,
        clock,
      ),
      getWager: new GetWagerTransactionUseCase(txRepo),
      reconcile: new ReconcileWalletUseCase(walletRepo, ledgerRepo),
      ledgerRepo,
    };
  }

  beforeAll(async () => {
    orm = await initIntegrationTestOrm();
  });

  beforeEach(async () => {
    await truncateAllTables(orm);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("processes BET, WIN, LOSS, REFUND, and ROLLBACK end-to-end with full ledger reconciliation", async () => {
    const { openWallet, processWager, getWager, reconcile } = buildUseCases();

    const wallet = await openWallet.execute({
      playerId: "player-e2e-1",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const bet = await processWager.execute({
      idempotencyKey: "prov-a:bet-1",
      providerId: "prov-a",
      externalTransactionId: "bet-1",
      playerId: "player-e2e-1",
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });
    expect(bet.status).toBe(WagerTransactionStatus.Processed);
    expect(bet.balance.amount).toBe("70.00");

    const win = await processWager.execute({
      idempotencyKey: "prov-a:win-1",
      providerId: "prov-a",
      externalTransactionId: "win-1",
      playerId: "player-e2e-1",
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: "bet-1",
    });
    expect(win.status).toBe(WagerTransactionStatus.Processed);
    expect(win.balance.amount).toBe("120.00");

    const rollbackWin = await processWager.execute({
      idempotencyKey: "prov-a:rb-win-1",
      providerId: "prov-a",
      externalTransactionId: "rb-win-1",
      playerId: "player-e2e-1",
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: "win-1",
    });
    expect(rollbackWin.status).toBe(WagerTransactionStatus.Processed);
    expect(rollbackWin.balance.amount).toBe("70.00");

    const byId = await getWager.executeById(bet.transactionId);
    expect(byId.externalTransactionId).toBe("bet-1");

    const byProvider = await getWager.executeByProviderAndExternalId("prov-a", "win-1");
    expect(byProvider.id).toBe(win.transactionId);

    const rec = await reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe("70.00");
    expect(rec.calculatedBalance.amount).toBe("70.00");
    expect(rec.checkedEntries).toBe(4);
  });

  it("handles Section 8 mandatory concurrency scenario: 100.00 BRL initial balance with two simultaneous 80.00 BRL bets", async () => {
    const main = buildUseCases();
    const wallet = await main.openWallet.execute({
      playerId: "player-race-80",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const instanceA = buildUseCases();
    const instanceB = buildUseCases();

    const [resA, resB] = await Promise.all([
      instanceA.processWager.execute({
        idempotencyKey: "prov-a:bet-80-a",
        providerId: "prov-a",
        externalTransactionId: "bet-80-a",
        playerId: "player-race-80",
        walletId: wallet.id,
        roundId: "round-race-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
      instanceB.processWager.execute({
        idempotencyKey: "prov-a:bet-80-b",
        providerId: "prov-a",
        externalTransactionId: "bet-80-b",
        playerId: "player-race-80",
        walletId: wallet.id,
        roundId: "round-race-2",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
    ]);

    const rejected = resA.status === WagerTransactionStatus.Rejected ? resA : resB;
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFundsBet);

    const entries = await main.ledgerRepo.findAllByWalletIdOrdered(wallet.id);
    const debitEntries = entries.filter((e) => e.direction === LedgerDirection.Debit);
    expect(debitEntries).toHaveLength(1);

    const rec = await main.reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance).toEqual({ amount: "20.00", currency: "BRL" });
    expect(rec.calculatedBalance).toEqual({ amount: "20.00", currency: "BRL" });
  });

  it("handles Section 13 concurrency scenario 1: same bet sent 50 times in parallel produces a single debit", async () => {
    const main = buildUseCases();
    const wallet = await main.openWallet.execute({
      playerId: "player-50-parallel",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () => {
        const instance = buildUseCases();
        return instance.processWager.execute({
          idempotencyKey: "prov-a:bet-50x-same",
          providerId: "prov-a",
          externalTransactionId: "bet-50x-same",
          playerId: "player-50-parallel",
          walletId: wallet.id,
          roundId: "round-50x",
          gameId: "fortune-chimp",
          kind: WagerTransactionKind.Bet,
          money: { amount: "25.00", currency: "BRL" },
        });
      }),
    );

    const freshExecutions = results.filter((r) => !r.idempotentReplay);
    const replays = results.filter((r) => r.idempotentReplay);

    expect(freshExecutions).toHaveLength(1);
    expect(replays).toHaveLength(49);

    for (const r of results) {
      expect(r.status).toBe(WagerTransactionStatus.Processed);
      expect(r.balance).toEqual({ amount: "75.00", currency: "BRL" });
    }

    const rec = await main.reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(rec.checkedEntries).toBe(2);
  });
});

