import type { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import type { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";

export const WAGER_TRANSACTION_REPOSITORY_PORT = Symbol("WAGER_TRANSACTION_REPOSITORY_PORT");

export interface WagerTransactionRepositoryPort {
  findById(transactionId: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findProcessedReversalByReferenceAndKind(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null>;
  claimDuePendingReferenceBatch(now: Date, limit: number): Promise<WagerTransaction[]>;
  insert(transaction: WagerTransaction): Promise<void>;
  save(transaction: WagerTransaction): Promise<void>;
}

