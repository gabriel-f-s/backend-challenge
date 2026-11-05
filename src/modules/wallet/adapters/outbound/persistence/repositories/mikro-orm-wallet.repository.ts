import { LockMode, UniqueConstraintViolationException } from "@mikro-orm/core";
import { EntityManager } from "@mikro-orm/postgresql";
import type { WalletRepositoryPort } from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import type { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { Injectable } from "@nestjs/common";
import { resolveActiveEntityManager } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { ConflictError } from "@shared/domain/errors/domain.error";
import { WalletMapper } from "../mappers/wallet.mapper";
import { WalletPersistenceRecord } from "../schemas/wallet.schema";

@Injectable()
export class MikroOrmWalletRepository implements WalletRepositoryPort {
  constructor(private readonly rootEntityManager: EntityManager) {}

  async findById(walletId: string): Promise<Wallet | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(WalletPersistenceRecord, { id: walletId });
    return record ? WalletMapper.toDomain(record) : null;
  }

  async findByIdForUpdate(walletId: string): Promise<Wallet | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(
      WalletPersistenceRecord,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    return record ? WalletMapper.toDomain(record) : null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = await em.findOne(WalletPersistenceRecord, { playerId, currency });
    return record ? WalletMapper.toDomain(record) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    const record = WalletMapper.toPersistence(wallet);
    try {
      await em.insert(WalletPersistenceRecord, record);
    } catch (error) {
      if (
        error instanceof UniqueConstraintViolationException ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "23505")
      ) {
        throw new ConflictError(
          `Wallet already exists for player "${wallet.playerId}" and currency "${wallet.currency}"`,
          "WALLET_ALREADY_EXISTS",
        );
      }
      throw error;
    }
  }

  async save(wallet: Wallet): Promise<void> {
    const em = resolveActiveEntityManager(this.rootEntityManager);
    await em.nativeUpdate(
      WalletPersistenceRecord,
      { id: wallet.id },
      {
        balanceAmount: wallet.balance.amount,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );
  }
}

