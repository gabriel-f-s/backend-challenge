import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { Money } from "@shared/domain/value-objects/money.vo";
import { WalletPersistenceRecord } from "../schemas/wallet.schema";

export class WalletMapper {
  private constructor() {}

  static toDomain(record: WalletPersistenceRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency,
      balance: Money.rehydrate({
        amount: record.balanceAmount,
        currency: record.currency,
      }),
      version: Number(record.version),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    });
  }

  static toPersistence(entity: Wallet): WalletPersistenceRecord {
    const record = new WalletPersistenceRecord();
    record.id = entity.id;
    record.playerId = entity.playerId;
    record.currency = entity.currency;
    record.balanceAmount = entity.balance.amount;
    record.version = entity.version;
    record.createdAt = entity.createdAt;
    record.updatedAt = entity.updatedAt;
    return record;
  }
}

