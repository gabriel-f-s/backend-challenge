import { EntitySchema } from "@mikro-orm/core";

export class WalletPersistenceRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balanceAmount!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletSchema = new EntitySchema<WalletPersistenceRecord>({
  class: WalletPersistenceRecord,
  tableName: "wallets",
  properties: {
    id: {
      type: "uuid",
      primary: true,
    },
    playerId: {
      type: "string",
      fieldName: "player_id",
      length: 120,
    },
    currency: {
      type: "string",
      length: 3,
    },
    balanceAmount: {
      type: "string",
      fieldName: "balance_amount",
      columnType: "numeric(19, 2)",
    },
    version: {
      type: "integer",
      default: 1,
    },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      columnType: "timestamptz",
    },
    updatedAt: {
      type: "Date",
      fieldName: "updated_at",
      columnType: "timestamptz",
    },
  },
});

