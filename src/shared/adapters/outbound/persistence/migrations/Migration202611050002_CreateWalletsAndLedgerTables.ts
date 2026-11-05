import { Migration } from "@mikro-orm/migrations";

export class Migration202611050002_CreateWalletsAndLedgerTables extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID NOT NULL,
        player_id VARCHAR(120) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_amount NUMERIC(19, 2) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT pk_wallets PRIMARY KEY (id),
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency),
        CONSTRAINT chk_wallets_balance_non_negative CHECK (balance_amount >= 0),
        CONSTRAINT chk_wallets_version_positive CHECK (version >= 1),
        CONSTRAINT chk_wallets_currency_iso CHECK (currency ~ '^[A-Z]{3}$')
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS wager_transactions (
        id UUID NOT NULL,
        provider_id VARCHAR(120) NOT NULL,
        external_transaction_id VARCHAR(255) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id UUID NOT NULL,
        player_id VARCHAR(120) NOT NULL,
        round_id VARCHAR(255) NOT NULL,
        game_id VARCHAR(255) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        amount NUMERIC(19, 2) NOT NULL,
        reference_external_transaction_id VARCHAR(255) NULL,
        reference_transaction_id UUID NULL,
        status VARCHAR(32) NOT NULL,
        failure_code VARCHAR(120) NULL,
        observed_balance_amount NUMERIC(19, 2) NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_wager_transactions PRIMARY KEY (id),
        CONSTRAINT fk_wager_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_wager_transactions_reference FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions(id) ON DELETE RESTRICT,
        CONSTRAINT uq_wager_transactions_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wager_transactions_provider_ext_id UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT chk_wager_transactions_kind CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT chk_wager_transactions_status CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT chk_wager_transactions_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT chk_wager_transactions_attempts_non_negative CHECK (attempts >= 0),
        CONSTRAINT chk_wager_transactions_reference_required CHECK (
          (kind IN ('REFUND', 'ROLLBACK') AND reference_external_transaction_id IS NOT NULL)
          OR (kind NOT IN ('REFUND', 'ROLLBACK'))
        )
      );
    `);

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_wager_tx_processed_reversal
      ON wager_transactions (reference_transaction_id, kind)
      WHERE status = 'PROCESSED'
        AND kind IN ('REFUND', 'ROLLBACK')
        AND reference_transaction_id IS NOT NULL;
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_wager_transactions_pending_ref_due
      ON wager_transactions (next_attempt_at ASC, created_at ASC)
      WHERE status = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_wager_transactions_wallet_id
      ON wager_transactions (wallet_id, created_at ASC);
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
        id UUID NOT NULL,
        wallet_id UUID NOT NULL,
        transaction_id UUID NOT NULL,
        direction VARCHAR(16) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        amount NUMERIC(19, 2) NOT NULL,
        balance_before NUMERIC(19, 2) NOT NULL,
        balance_after NUMERIC(19, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT pk_wallet_ledger_entries PRIMARY KEY (id),
        CONSTRAINT fk_wallet_ledger_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_wallet_ledger_transaction FOREIGN KEY (transaction_id) REFERENCES wager_transactions(id) ON DELETE RESTRICT,
        CONSTRAINT uq_wallet_ledger_wallet_transaction UNIQUE (wallet_id, transaction_id),
        CONSTRAINT chk_wallet_ledger_direction CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT chk_wallet_ledger_amount_positive CHECK (amount > 0),
        CONSTRAINT chk_wallet_ledger_balances_non_negative CHECK (balance_before >= 0 AND balance_after >= 0),
        CONSTRAINT chk_wallet_ledger_arithmetic_balance CHECK (
          (direction = 'CREDIT' AND balance_before + amount = balance_after)
          OR (direction = 'DEBIT' AND balance_before - amount = balance_after)
        )
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_wallet_cursor
      ON wallet_ledger_entries (wallet_id, created_at ASC, id ASC);
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Wallet ledger entries are immutable and cannot be updated or deleted';
      END;
      $$ LANGUAGE plpgsql;
    `);

    this.addSql(`
      DROP TRIGGER IF EXISTS trg_wallet_ledger_entries_immutable ON wallet_ledger_entries;
      CREATE TRIGGER trg_wallet_ledger_entries_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION prevent_wallet_ledger_mutation();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TRIGGER IF EXISTS trg_wallet_ledger_entries_immutable ON wallet_ledger_entries;`);
    this.addSql(`DROP FUNCTION IF EXISTS prevent_wallet_ledger_mutation();`);
    this.addSql(`DROP INDEX IF EXISTS idx_wallet_ledger_entries_wallet_cursor;`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries;`);
    this.addSql(`DROP INDEX IF EXISTS idx_wager_transactions_wallet_id;`);
    this.addSql(`DROP INDEX IF EXISTS idx_wager_transactions_pending_ref_due;`);
    this.addSql(`DROP INDEX IF EXISTS idx_uq_wager_tx_processed_reversal;`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions;`);
    this.addSql(`DROP TABLE IF EXISTS wallets;`);
  }
}

