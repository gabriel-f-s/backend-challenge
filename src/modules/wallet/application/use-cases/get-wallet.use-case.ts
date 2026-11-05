import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import { Inject, Injectable } from "@nestjs/common";
import { ResourceNotFoundError } from "@shared/domain/errors/domain.error";
import type { MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface GetWalletOutput {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

@Injectable()
export class GetWalletUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
  ) {}

  async execute(walletId: string): Promise<GetWalletOutput> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new ResourceNotFoundError(`Wallet "${walletId}" not found`, "WALLET_NOT_FOUND");
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}

