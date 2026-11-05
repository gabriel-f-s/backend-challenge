import { EntityManager } from "@mikro-orm/postgresql";
import {
  encodeLedgerCursor,
  type ListWalletLedgerQuery,
  type PaginatedWalletLedgerResult,
  type RecordOpeningLedgerParams,
  type WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import type { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { Injectable } from "@nestjs/common";
import { resolveActiveEntityManager } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { WalletLedgerEntryMapper } from "../mappers/wallet-ledger-entry.mapper";
import { WalletLedgerEntryPersistenceRecord } from "../schemas/wallet-ledger-entry.schema";

@Injectable()
export class MikroOrmWalletLedgerRepository implements WalletLedgerRepositoryPort {
  constructor(private readonly rootEntityManager: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = WalletLedgerEntryMapper.toPersistence(entry);
    await em.insert(WalletLedgerEntryPersistenceRecord, record);
  }

  async insertOpeningTransactionAndLedgerEntry(params: RecordOpeningLedgerParams): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const { entry, playerId, payloadHash } = params;

    await em.execute(
      `INSERT INTO wager_transactions (
         id,
         provider_id,
         external_transaction_id,
         idempotency_key,
         payload_hash,
         wallet_id,
         player_id,
         round_id,
         game_id,
         kind,
         currency,
         amount,
         status,
         observed_balance_amount,
         created_at,
         processed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.transactionId,
        "internal",
        `opening:${entry.walletId}`,
        `internal:opening:${entry.walletId}`,
        payloadHash,
        entry.walletId,
        playerId,
        `opening:${entry.walletId}`,
        "wallet-opening",
        "OPENING",
        entry.money.currency,
        entry.money.amount,
        "PROCESSED",
        entry.balanceAfter.amount,
        entry.createdAt,
        entry.createdAt,
      ],
    );

    const record = WalletLedgerEntryMapper.toPersistence(entry);
    await em.insert(WalletLedgerEntryPersistenceRecord, record);
  }

  async findByWalletAndTransactionId(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(WalletLedgerEntryPersistenceRecord, {
      walletId,
      transactionId,
    });
    return record ? WalletLedgerEntryMapper.toDomain(record) : null;
  }

  async listByWalletId(query: ListWalletLedgerQuery): Promise<PaginatedWalletLedgerResult> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const fetchLimit = query.limit + 1;

    const rows = query.cursor
      ? await em.execute<WalletLedgerEntryPersistenceRecord[]>(
          `SELECT
             id,
             wallet_id AS "walletId",
             transaction_id AS "transactionId",
             direction,
             currency,
             amount,
             balance_before AS "balanceBefore",
             balance_after AS "balanceAfter",
             created_at AS "createdAt"
           FROM wallet_ledger_entries
           WHERE wallet_id = ?
             AND (created_at, id) > (?::timestamptz, ?::uuid)
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
          [query.walletId, query.cursor.createdAtIso, query.cursor.id, fetchLimit],
        )
      : await em.execute<WalletLedgerEntryPersistenceRecord[]>(
          `SELECT
             id,
             wallet_id AS "walletId",
             transaction_id AS "transactionId",
             direction,
             currency,
             amount,
             balance_before AS "balanceBefore",
             balance_after AS "balanceAfter",
             created_at AS "createdAt"
           FROM wallet_ledger_entries
           WHERE wallet_id = ?
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
          [query.walletId, fetchLimit],
        );

    const hasNextPage = rows.length > query.limit;
    const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
    const items = pageRows.map((row) => WalletLedgerEntryMapper.toDomain(row));
    const lastItem = items[items.length - 1];

    const nextCursor =
      hasNextPage && lastItem
        ? encodeLedgerCursor({
            createdAtIso: lastItem.createdAt.toISOString(),
            id: lastItem.id,
          })
        : null;

    return {
      items,
      nextCursor,
    };
  }

  async findAllByWalletIdOrdered(walletId: string): Promise<WalletLedgerEntry[]> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const rows = await em.execute<WalletLedgerEntryPersistenceRecord[]>(
      `SELECT
         id,
         wallet_id AS "walletId",
         transaction_id AS "transactionId",
         direction,
         currency,
         amount,
         balance_before AS "balanceBefore",
         balance_after AS "balanceAfter",
         created_at AS "createdAt"
       FROM wallet_ledger_entries
       WHERE wallet_id = ?
       ORDER BY created_at ASC, id ASC`,
      [walletId],
    );

    return rows.map((row) => WalletLedgerEntryMapper.toDomain(row));
  }
}

