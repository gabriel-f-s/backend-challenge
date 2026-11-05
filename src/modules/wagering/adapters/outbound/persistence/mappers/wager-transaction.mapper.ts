import { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import type { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import type { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";
import { WagerTransactionPersistenceRecord } from "../schemas/wager-transaction.schema";

export class WagerTransactionMapper {
  private constructor() {}

  static toDomain(record: WagerTransactionPersistenceRecord): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.rehydrate({
        amount: record.amount,
        currency: record.currency,
      }),
      referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
      createdAt: new Date(record.createdAt),
      status: record.status as WagerTransactionStatus,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      failureCode: (record.failureCode as FailureCode | null | undefined) ?? undefined,
      processedAt: record.processedAt ? new Date(record.processedAt) : undefined,
      observedBalance: record.observedBalanceAmount
        ? Money.rehydrate({
            amount: record.observedBalanceAmount,
            currency: record.currency,
          })
        : undefined,
      attempts: Number(record.attempts ?? 0),
      nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : undefined,
    });
  }

  static toPersistence(entity: WagerTransaction): WagerTransactionPersistenceRecord {
    const record = new WagerTransactionPersistenceRecord();
    record.id = entity.id;
    record.providerId = entity.providerId;
    record.externalTransactionId = entity.externalTransactionId;
    record.idempotencyKey = entity.idempotencyKey;
    record.payloadHash = entity.payloadHash;
    record.walletId = entity.walletId;
    record.playerId = entity.playerId;
    record.roundId = entity.roundId;
    record.gameId = entity.gameId;
    record.kind = entity.kind;
    record.currency = entity.money.currency;
    record.amount = entity.money.amount;
    record.referenceExternalTransactionId = entity.referenceExternalTransactionId ?? null;
    record.referenceTransactionId = entity.referenceTransactionId ?? null;
    record.status = entity.status;
    record.failureCode = entity.failureCode ?? null;
    record.observedBalanceAmount = entity.observedBalance?.amount ?? null;
    record.attempts = entity.attempts;
    record.nextAttemptAt = entity.nextAttemptAt ?? null;
    record.createdAt = entity.createdAt;
    record.processedAt = entity.processedAt ?? null;
    return record;
  }
}

