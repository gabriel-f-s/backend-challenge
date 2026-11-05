import { EntitySchema } from "@mikro-orm/core";

export class WalletLedgerEntryPersistenceRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  currency!: string;
  amount!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryPersistenceRecord>({
  class: WalletLedgerEntryPersistenceRecord,
  tableName: "wallet_ledger_entries",
  properties: {
    id: {
      type: "uuid",
      primary: true,
    },
    walletId: {
      type: "uuid",
      fieldName: "wallet_id",
    },
    transactionId: {
      type: "uuid",
      fieldName: "transaction_id",
    },
    direction: {
      type: "string",
      length: 16,
    },
    currency: {
      type: "string",
      length: 3,
    },
    amount: {
      type: "string",
      columnType: "numeric(19, 2)",
    },
    balanceBefore: {
      type: "string",
      fieldName: "balance_before",
      columnType: "numeric(19, 2)",
    },
    balanceAfter: {
      type: "string",
      fieldName: "balance_after",
      columnType: "numeric(19, 2)",
    },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      columnType: "timestamptz",
    },
  },
});

