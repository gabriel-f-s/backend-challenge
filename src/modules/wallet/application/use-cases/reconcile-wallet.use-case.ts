import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import {
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ResourceNotFoundError } from "@shared/domain/errors/domain.error";
import { Money, type MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface ReconcileWalletOutput {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly walletLedgerRepository: WalletLedgerRepositoryPort,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletOutput> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new ResourceNotFoundError(`Wallet "${walletId}" not found`, "WALLET_NOT_FOUND");
    }

    const entries = await this.walletLedgerRepository.findAllByWalletIdOrdered(walletId);

    let calculatedBalance = Money.zero(wallet.currency);
    for (const entry of entries) {
      if (entry.direction === LedgerDirection.Credit) {
        calculatedBalance = calculatedBalance.add(entry.money);
      } else {
        calculatedBalance = calculatedBalance.subtract(entry.money);
      }
    }

    const difference = wallet.balance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger.error(
        JSON.stringify({
          event: "wallet_reconciliation_divergence_detected",
          walletId: wallet.id,
          playerId: wallet.playerId,
          currency: wallet.currency,
          checkedEntries: entries.length,
        }),
      );
    }

    return {
      walletId: wallet.id,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: entries.length,
    };
  }
}

