import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options, PostgreSqlDriver } from "@mikro-orm/postgresql";
import { InboxMessageSchema } from "@modules/messaging/adapters/outbound/persistence/schemas/inbox-message.schema";
import { OutboxMessageSchema } from "@modules/messaging/adapters/outbound/persistence/schemas/outbox-message.schema";
import { loadEnvironmentConfig, type AppEnvironmentConfig } from "../config/env.config";
import { Migration202611050001_CreateInboxAndOutboxTables } from "./migrations/Migration202611050001_CreateInboxAndOutboxTables";

export const DEFAULT_MIKRO_ORM_ENTITIES: NonNullable<Options["entities"]> = [
  InboxMessageSchema,
  OutboxMessageSchema,
];

export function createMikroOrmOptions(
  env: AppEnvironmentConfig = loadEnvironmentConfig(),
  entities: Options["entities"] = DEFAULT_MIKRO_ORM_ENTITIES,
): Options {
  return defineConfig({
    driver: PostgreSqlDriver,
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    dbName: env.database.name,
    entities,
    discovery: {
      warnWhenNoEntities: false,
    },
    extensions: [Migrator],
    migrations: {
      migrationsList: [
        {
          name: "Migration202611050001_CreateInboxAndOutboxTables",
          class: Migration202611050001_CreateInboxAndOutboxTables,
        },
      ],
      transactional: true,
      allOrNothing: true,
    },
    allowGlobalContext: true,
  });
}

export default createMikroOrmOptions();
