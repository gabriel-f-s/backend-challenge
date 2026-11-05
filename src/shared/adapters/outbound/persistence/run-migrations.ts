import { MikroORM } from "@mikro-orm/postgresql";
import { createMikroOrmOptions } from "./mikro-orm.config";

async function run(): Promise<void> {
  const direction = process.argv[2] ?? "up";
  const orm = await MikroORM.init(createMikroOrmOptions());

  try {
    const migrator = orm.getMigrator();
    if (direction === "down") {
      await migrator.down();
    } else {
      await migrator.up();
    }
  } finally {
    await orm.close(true);
  }
}

void run();

