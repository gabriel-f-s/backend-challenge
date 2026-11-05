import { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransactionRepositoryPort } from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import type { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import type { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { Injectable } from "@nestjs/common";
import { resolveActiveEntityManager } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { WagerTransactionMapper } from "../mappers/wager-transaction.mapper";
import { WagerTransactionPersistenceRecord } from "../schemas/wager-transaction.schema";

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepositoryPort {
  constructor(private readonly rootEntityManager: EntityManager) {}

  async findById(transactionId: string): Promise<WagerTransaction | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(
      WagerTransactionPersistenceRecord,
      { id: transactionId },
      { refresh: true },
    );
    return record ? WagerTransactionMapper.toDomain(record) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(
      WagerTransactionPersistenceRecord,
      { idempotencyKey },
      { refresh: true },
    );
    return record ? WagerTransactionMapper.toDomain(record) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(
      WagerTransactionPersistenceRecord,
      { providerId, externalTransactionId },
      { refresh: true },
    );
    return record ? WagerTransactionMapper.toDomain(record) : null;
  }

  async findProcessedReversalByReferenceAndKind(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(
      WagerTransactionPersistenceRecord,
      {
        referenceTransactionId,
        kind,
        status: WagerTransactionStatus.Processed,
      },
      { refresh: true },
    );
    return record ? WagerTransactionMapper.toDomain(record) : null;
  }

  async claimDuePendingReferenceBatch(now: Date, limit: number): Promise<WagerTransaction[]> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const rows = await em.execute<WagerTransactionPersistenceRecord[]>(
      `SELECT
         id,
         provider_id AS "providerId",
         external_transaction_id AS "externalTransactionId",
         idempotency_key AS "idempotencyKey",
         payload_hash AS "payloadHash",
         wallet_id AS "walletId",
         player_id AS "playerId",
         round_id AS "roundId",
         game_id AS "gameId",
         kind,
         currency,
         amount,
         reference_external_transaction_id AS "referenceExternalTransactionId",
         reference_transaction_id AS "referenceTransactionId",
         status,
         failure_code AS "failureCode",
         observed_balance_amount AS "observedBalanceAmount",
         attempts,
         next_attempt_at AS "nextAttemptAt",
         created_at AS "createdAt",
         processed_at AS "processedAt"
       FROM wager_transactions
       WHERE status = 'PENDING_REFERENCE'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return rows.map((row) => WagerTransactionMapper.toDomain(row));
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = WagerTransactionMapper.toPersistence(transaction);
    await em.insert(WagerTransactionPersistenceRecord, record);
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    await em.nativeUpdate(
      WagerTransactionPersistenceRecord,
      { id: transaction.id },
      {
        status: transaction.status,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        failureCode: transaction.failureCode ?? null,
        observedBalanceAmount: transaction.observedBalance?.amount ?? null,
        attempts: transaction.attempts,
        nextAttemptAt: transaction.nextAttemptAt ?? null,
        processedAt: transaction.processedAt ?? null,
      },
    );
  }
}

