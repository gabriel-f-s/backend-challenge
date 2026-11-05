import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  type WagerTransactionRepositoryPort,
} from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import type { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import type { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import type { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { Inject, Injectable } from "@nestjs/common";
import { ResourceNotFoundError } from "@shared/domain/errors/domain.error";
import type { FailureCode } from "@shared/domain/errors/failure-code.enum";
import type { MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface WagerTransactionViewOutput {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly status: WagerTransactionStatus;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly observedBalance?: MoneyProps;
  readonly createdAt: string;
  readonly processedAt?: string;
}

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY_PORT)
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
  ) {}

  async executeById(transactionId: string): Promise<WagerTransactionViewOutput> {
    const transaction = await this.wagerTransactionRepository.findById(transactionId);
    if (!transaction) {
      throw new ResourceNotFoundError(
        `WagerTransaction "${transactionId}" not found`,
        "TRANSACTION_NOT_FOUND",
      );
    }
    return this.toOutput(transaction);
  }

  async executeByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionViewOutput> {
    const transaction = await this.wagerTransactionRepository.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!transaction) {
      throw new ResourceNotFoundError(
        `WagerTransaction for provider "${providerId}" and externalTransactionId "${externalTransactionId}" not found`,
        "TRANSACTION_NOT_FOUND",
      );
    }
    return this.toOutput(transaction);
  }

  private toOutput(transaction: WagerTransaction): WagerTransactionViewOutput {
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      status: transaction.status,
      ...(transaction.referenceExternalTransactionId
        ? { referenceExternalTransactionId: transaction.referenceExternalTransactionId }
        : {}),
      ...(transaction.referenceTransactionId
        ? { referenceTransactionId: transaction.referenceTransactionId }
        : {}),
      ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
      ...(transaction.observedBalance
        ? { observedBalance: transaction.observedBalance.toJSON() }
        : {}),
      createdAt: transaction.createdAt.toISOString(),
      ...(transaction.processedAt
        ? { processedAt: transaction.processedAt.toISOString() }
        : {}),
    };
  }
}

