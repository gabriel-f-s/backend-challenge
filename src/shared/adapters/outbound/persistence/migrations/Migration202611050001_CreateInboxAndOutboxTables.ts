import { Migration } from "@mikro-orm/migrations";

export class Migration202611050001_CreateInboxAndOutboxTables extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        consumer_name VARCHAR(120) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_inbox_messages PRIMARY KEY (consumer_name, message_id),
        CONSTRAINT chk_inbox_messages_consumer_not_empty CHECK (length(btrim(consumer_name)) > 0),
        CONSTRAINT chk_inbox_messages_message_id_not_empty CHECK (length(btrim(message_id)) > 0)
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
        id UUID NOT NULL,
        aggregate_id VARCHAR(120) NOT NULL,
        event_type VARCHAR(120) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NULL,
        published_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_outbox_messages PRIMARY KEY (id),
        CONSTRAINT chk_outbox_messages_attempts_non_negative CHECK (attempts >= 0)
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_outbox_messages_pending_due
      ON outbox_messages (next_attempt_at ASC, occurred_at ASC)
      WHERE published_at IS NULL;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_outbox_messages_pending_due;`);
    this.addSql(`DROP TABLE IF EXISTS outbox_messages;`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages;`);
  }
}

