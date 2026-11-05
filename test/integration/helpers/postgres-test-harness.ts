import { MikroORM } from "@mikro-orm/postgresql";
import { createMikroOrmOptions } from "@shared/adapters/outbound/persistence/mikro-orm.config";

export async function initIntegrationTestOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init(createMikroOrmOptions());
  await orm.getMigrator().up();
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

