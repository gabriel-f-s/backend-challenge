import { EntitySchema } from "@mikro-orm/core";

export class WagerTransactionPersistenceRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  currency!: string;
  amount!: string;
  referenceExternalTransactionId?: string | null;
  referenceTransactionId?: string | null;
  status!: string;
  failureCode?: string | null;
  observedBalanceAmount?: string | null;
  attempts!: number;
  nextAttemptAt?: Date | null;
  createdAt!: Date;
  processedAt?: Date | null;
}

export const WagerTransactionSchema = new EntitySchema<WagerTransactionPersistenceRecord>({
  class: WagerTransactionPersistenceRecord,
  tableName: "wager_transactions",
  properties: {
    id: {
      type: "uuid",
      primary: true,
    },
    providerId: {
      type: "string",
      fieldName: "provider_id",
      length: 120,
    },
    externalTransactionId: {
      type: "string",
      fieldName: "external_transaction_id",
      length: 255,
    },
    idempotencyKey: {
      type: "string",
      fieldName: "idempotency_key",
      length: 255,
    },
    payloadHash: {
      type: "string",
      fieldName: "payload_hash",
      length: 64,
    },
    walletId: {
      type: "uuid",
      fieldName: "wallet_id",
    },
    playerId: {
      type: "string",
      fieldName: "player_id",
      length: 120,
    },
    roundId: {
      type: "string",
      fieldName: "round_id",
      length: 255,
    },
    gameId: {
      type: "string",
      fieldName: "game_id",
      length: 255,
    },
    kind: {
      type: "string",
      length: 32,
    },
    currency: {
      type: "string",
      length: 3,
    },
    amount: {
      type: "string",
      columnType: "numeric(19, 2)",
    },
    referenceExternalTransactionId: {
      type: "string",
      fieldName: "reference_external_transaction_id",
      length: 255,
      nullable: true,
    },
    referenceTransactionId: {
      type: "uuid",
      fieldName: "reference_transaction_id",
      nullable: true,
    },
    status: {
      type: "string",
      length: 32,
    },
    failureCode: {
      type: "string",
      fieldName: "failure_code",
      length: 120,
      nullable: true,
    },
    observedBalanceAmount: {
      type: "string",
      fieldName: "observed_balance_amount",
      columnType: "numeric(19, 2)",
      nullable: true,
    },
    attempts: {
      type: "integer",
      default: 0,
    },
    nextAttemptAt: {
      type: "Date",
      fieldName: "next_attempt_at",
      columnType: "timestamptz",
      nullable: true,
    },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      columnType: "timestamptz",
    },
    processedAt: {
      type: "Date",
      fieldName: "processed_at",
      columnType: "timestamptz",
      nullable: true,
    },
  },
});

