import type { Wallet } from "@modules/wallet/domain/entities/wallet.entity";

export const WALLET_REPOSITORY_PORT = Symbol("WALLET_REPOSITORY_PORT");

export interface WalletRepositoryPort {
  findById(walletId: string): Promise<Wallet | null>;
  findByIdForUpdate(walletId: string): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  insert(wallet: Wallet): Promise<void>;
  save(wallet: Wallet): Promise<void>;
}

