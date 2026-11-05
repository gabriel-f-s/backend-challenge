import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import {
  decodeLedgerCursor,
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import type { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import { Inject, Injectable } from "@nestjs/common";
import {
  DomainValidationError,
  ResourceNotFoundError,
} from "@shared/domain/errors/domain.error";
import type { MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface ListWalletLedgerInput {
  readonly walletId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface WalletLedgerItemOutput {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly createdAt: string;
}

export interface ListWalletLedgerOutput {
  readonly items: readonly WalletLedgerItemOutput[];
  readonly nextCursor: string | null;
}

@Injectable()
export class ListWalletLedgerUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly walletLedgerRepository: WalletLedgerRepositoryPort,
  ) {}

  async execute(input: ListWalletLedgerInput): Promise<ListWalletLedgerOutput> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainValidationError(
        "Ledger pagination limit must be an integer between 1 and 100",
        "INVALID_LEDGER_LIMIT",
      );
    }

    const decodedCursor =
      input.cursor && input.cursor.trim() !== "" ? decodeLedgerCursor(input.cursor) : undefined;

    const wallet = await this.walletRepository.findById(input.walletId);
    if (!wallet) {
      throw new ResourceNotFoundError(`Wallet "${input.walletId}" not found`, "WALLET_NOT_FOUND");
    }

    const page = await this.walletLedgerRepository.listByWalletId({
      walletId: input.walletId,
      cursor: decodedCursor,
      limit,
    });

    return {
      items: page.items.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}

