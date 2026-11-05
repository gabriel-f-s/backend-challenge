import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmOutboxRepository } from "@modules/messaging/adapters/outbound/persistence/repositories/mikro-orm-outbox.repository";
import { MikroOrmWalletRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWalletLedgerRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet-ledger.repository";
import { GetWalletUseCase } from "@modules/wallet/application/use-cases/get-wallet.use-case";
import { ListWalletLedgerUseCase } from "@modules/wallet/application/use-cases/list-wallet-ledger.use-case";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { WalletBalanceChanged } from "@modules/wallet/domain/events/wallet-balance-changed.event";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { ConflictError } from "@shared/domain/errors/domain.error";
import { Money } from "@shared/domain/value-objects/money.vo";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import { initIntegrationTestOrm, truncateAllTables } from "./helpers/postgres-test-harness";

describe("Wallet & Ledger Integration (Real PostgreSQL)", () => {
  let orm: MikroORM;
  let unitOfWork: MikroOrmUnitOfWorkAdapter;
  let walletRepository: MikroOrmWalletRepository;
  let ledgerRepository: MikroOrmWalletLedgerRepository;
  let outboxRepository: MikroOrmOutboxRepository;
  let openWalletUseCase: OpenWalletUseCase;
  let getWalletUseCase: GetWalletUseCase;
  let listLedgerUseCase: ListWalletLedgerUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  const idGenerator = new UuidV7GeneratorAdapter();
  const clock = new SystemClockAdapter();

  beforeAll(async () => {
    orm = await initIntegrationTestOrm();
    unitOfWork = new MikroOrmUnitOfWorkAdapter(orm.em);
    walletRepository = new MikroOrmWalletRepository(orm.em);
    ledgerRepository = new MikroOrmWalletLedgerRepository(orm.em);
    outboxRepository = new MikroOrmOutboxRepository(orm.em);

    openWalletUseCase = new OpenWalletUseCase(
      unitOfWork,
      walletRepository,
      ledgerRepository,
      outboxRepository,
      idGenerator,
      clock,
    );
    getWalletUseCase = new GetWalletUseCase(walletRepository);
    listLedgerUseCase = new ListWalletLedgerUseCase(walletRepository, ledgerRepository);
    reconcileWalletUseCase = new ReconcileWalletUseCase(walletRepository, ledgerRepository);
  });

  beforeEach(async () => {
    await truncateAllTables(orm);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("enforces database-level constraints (negative balance check, unique player+currency under concurrency, arithmetic ledger check)", async () => {
    const walletId = idGenerator.generate();
    await expect(
      orm.em.getConnection().execute(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (?, 'player-neg', 'BRL', -10.00, 1, NOW(), NOW())`,
        [walletId],
      ),
    ).rejects.toThrow(/chk_wallets_balance_non_negative/);

    const concurrentAttempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        openWalletUseCase.execute({
          playerId: "player-concurrent-open",
          initialBalance: { amount: "250.00", currency: "BRL" },
        }),
      ),
    );

    const fulfilled = concurrentAttempts.filter((r) => r.status === "fulfilled");
    const rejected = concurrentAttempts.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }

    const createdWalletId = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    const txId = idGenerator.generate();
    await orm.em.getConnection().execute(
      `INSERT INTO wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, currency, amount, status, created_at
       ) VALUES (?, 'prov-1', 'ext-unbalanced', 'idem-unbalanced', 'hash', ?, 'player-concurrent-open', 'r-1', 'g-1', 'BET', 'BRL', 25.00, 'PROCESSED', NOW())`,
      [txId, createdWalletId],
    );

    await expect(
      orm.em.getConnection().execute(
        `INSERT INTO wallet_ledger_entries (
           id, wallet_id, transaction_id, direction, currency, amount, balance_before, balance_after, created_at
         ) VALUES (?, ?, ?, 'DEBIT', 'BRL', 25.00, 250.00, 230.00, NOW())`,
        [idGenerator.generate(), createdWalletId, txId],
      ),
    ).rejects.toThrow(/chk_wallet_ledger_arithmetic_balance/);
  });

  it("blocks UPDATE and DELETE on wallet_ledger_entries via database trigger trg_wallet_ledger_entries_immutable", async () => {
    const opened = await openWalletUseCase.execute({
      playerId: "player-immutable-ledger",
      initialBalance: { amount: "500.00", currency: "BRL" },
    });

    const entries = await ledgerRepository.findAllByWalletIdOrdered(opened.id);
    expect(entries).toHaveLength(1);
    const entryId = entries[0]?.id;

    await expect(
      orm.em
        .getConnection()
        .execute(`UPDATE wallet_ledger_entries SET amount = 999.00 WHERE id = ?`, [entryId]),
    ).rejects.toThrow(/Wallet ledger entries are immutable and cannot be updated or deleted/);

    await expect(
      orm.em
        .getConnection()
        .execute(`DELETE FROM wallet_ledger_entries WHERE id = ?`, [entryId]),
    ).rejects.toThrow(/Wallet ledger entries are immutable and cannot be updated or deleted/);
  });

  it("rolls back wallet, ledger, and outbox atomically if any step in the SQL transaction fails", async () => {
    const playerId = "player-atomic-rollback";

    await expect(
      unitOfWork.runInTransaction(async () => {
        const wallet = Wallet.open({
          id: idGenerator.generate(),
          playerId,
          initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
        });
        await walletRepository.insert(wallet);
        throw new Error("Simulated failure before commit");
      }),
    ).rejects.toThrow("Simulated failure before commit");

    const found = await walletRepository.findByPlayerAndCurrency(playerId, "BRL");
    expect(found).toBeNull();
    expect(await outboxRepository.countPending()).toBe(0);
  });

  it("supports pessimistic locking updates, opaque cursor pagination, and passes final reconciliation invariant", async () => {
    const opened = await openWalletUseCase.execute({
      playerId: "player-full-flow",
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const applyMovement = async (
      kind: "BET" | "WIN",
      amount: string,
      extId: string,
    ): Promise<void> => {
      await unitOfWork.runInTransaction(async () => {
        const wallet = await walletRepository.findByIdForUpdate(opened.id);
        if (!wallet) {
          throw new Error("Wallet not found");
        }
        const now = clock.now();
        const txId = idGenerator.generate();
        const entryId = idGenerator.generate();

        const entry =
          kind === "BET"
            ? wallet.debit({
                entryId,
                transactionId: txId,
                money: Money.from({ amount, currency: "BRL" }),
                at: now,
              })
            : wallet.credit({
                entryId,
                transactionId: txId,
                money: Money.from({ amount, currency: "BRL" }),
                at: now,
              });

        await orm.em.execute(
          `INSERT INTO wager_transactions (
             id, provider_id, external_transaction_id, idempotency_key, payload_hash,
             wallet_id, player_id, round_id, game_id, kind, currency, amount, status, observed_balance_amount, created_at, processed_at
           ) VALUES (?, 'prov-a', ?, ?, 'hash', ?, ?, 'r-1', 'g-1', ?, 'BRL', ?, 'PROCESSED', ?, ?, ?)`,
          [
            txId,
            extId,
            `prov-a:${extId}`,
            wallet.id,
            wallet.playerId,
            kind,
            amount,
            wallet.balance.amount,
            now,
            now,
          ],
        );

        await walletRepository.save(wallet);
        await ledgerRepository.insert(entry);
        await outboxRepository.enqueue(
          OutboxMessage.enqueue(
            WalletBalanceChanged.from(wallet, entry, {
              eventId: idGenerator.generate(),
              correlationId: txId,
              causationId: txId,
              occurredAt: now,
            }),
          ),
        );
      });
    };

    await applyMovement("BET", "30.00", "tx-bet-1");
    await applyMovement("WIN", "55.00", "tx-win-1");

    const walletState = await getWalletUseCase.execute(opened.id);
    expect(walletState.balance).toEqual({ amount: "125.00", currency: "BRL" });
    expect(walletState.version).toBe(3);

    const page1 = await listLedgerUseCase.execute({ walletId: opened.id, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listLedgerUseCase.execute({
      walletId: opened.id,
      cursor: page1.nextCursor ?? undefined,
      limit: 2,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const reconciliation = await reconcileWalletUseCase.execute(opened.id);
    expect(reconciliation).toEqual({
      walletId: opened.id,
      storedBalance: { amount: "125.00", currency: "BRL" },
      calculatedBalance: { amount: "125.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 3,
    });
  });
});

