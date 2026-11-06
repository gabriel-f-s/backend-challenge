import { MikroORM } from "@mikro-orm/postgresql";
import { createMikroOrmOptions } from "@shared/adapters/outbound/persistence/mikro-orm.config";
import { ensureSqsQueuesProvisioned } from "@shared/adapters/outbound/sqs/sqs-client.factory";

export async function initIntegrationTestOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init(createMikroOrmOptions());
  await orm.getMigrator().up();
  try {
    await ensureSqsQueuesProvisioned();
  } catch {
    // Tests that only target PostgreSQL continue even if SQS is not required
  }
  return orm;
}

export async function truncateAllTables(orm: MikroORM): Promise<void> {
  await orm.em
    .getConnection()
    .execute(
      `TRUNCATE TABLE
         wallet_ledger_entries,
         wager_transactions,
         wallets,
         inbox_messages,
         outbox_messages
       RESTART IDENTITY CASCADE`,
    );
}
