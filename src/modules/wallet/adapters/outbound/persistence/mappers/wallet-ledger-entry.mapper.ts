import { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import type { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { Money } from "@shared/domain/value-objects/money.vo";
import { WalletLedgerEntryPersistenceRecord } from "../schemas/wallet-ledger-entry.schema";

export class WalletLedgerEntryMapper {
  private constructor() {}

  static toDomain(record: WalletLedgerEntryPersistenceRecord): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction as LedgerDirection,
      money: Money.rehydrate({
        amount: record.amount,
        currency: record.currency,
      }),
      balanceBefore: Money.rehydrate({
        amount: record.balanceBefore,
        currency: record.currency,
      }),
      balanceAfter: Money.rehydrate({
        amount: record.balanceAfter,
        currency: record.currency,
      }),
      createdAt: new Date(record.createdAt),
    });
  }

  static toPersistence(entity: WalletLedgerEntry): WalletLedgerEntryPersistenceRecord {
    const record = new WalletLedgerEntryPersistenceRecord();
    record.id = entity.id;
    record.walletId = entity.walletId;
    record.transactionId = entity.transactionId;
    record.direction = entity.direction;
    record.currency = entity.money.currency;
    record.amount = entity.money.amount;
    record.balanceBefore = entity.balanceBefore.amount;
    record.balanceAfter = entity.balanceAfter.amount;
    record.createdAt = entity.createdAt;
    return record;
  }
}

