import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options, PostgreSqlDriver } from "@mikro-orm/postgresql";
import { loadEnvironmentConfig, type AppEnvironmentConfig } from "../config/env.config";

export function createMikroOrmOptions(
  env: AppEnvironmentConfig = loadEnvironmentConfig(),
  entities: Options["entities"] = [],
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
      path: "./dist/shared/adapters/outbound/persistence/migrations",
      pathTs: "./src/shared/adapters/outbound/persistence/migrations",
      transactional: true,
      allOrNothing: true,
    },
    allowGlobalContext: true,
  });
}

export default createMikroOrmOptions();

