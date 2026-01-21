/**
 * Database migration runner using Knex
 * Runs migrations automatically on application startup
 */
import knex, { type Knex } from "knex";
import config from "config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DatabaseType = "sqlite" | "postgres";

interface DatabaseConfig {
  type: DatabaseType;
  encryption_key: string;
  filename?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

function getDatabaseConfig(): DatabaseConfig {
  return config.get("database");
}

function buildKnexConfig(): Knex.Config {
  const dbConfig = getDatabaseConfig();

  // For runtime, use compiled JS migrations in dist folder
  // When compiled, migrations are at dist/server/migrations/knex (relative to dist/server/server/)
  const migrationsDir = path.join(__dirname, "..", "migrations", "knex");

  const migrationsConfig: Knex.MigratorConfig = {
    directory: migrationsDir,
    extension: "js",
    loadExtensions: [".js"],
  };

  switch (dbConfig.type) {
    case "sqlite":
      return {
        client: "better-sqlite3",
        connection: {
          filename: dbConfig.filename || "./database.sqlite",
        },
        useNullAsDefault: true,
        migrations: migrationsConfig,
      };

    case "postgres":
      return {
        client: "pg",
        connection: {
          host: dbConfig.host || "localhost",
          port: dbConfig.port || 5432,
          user: dbConfig.username || "postgres",
          password: dbConfig.password || "",
          database: dbConfig.database || "postgres",
        },
        migrations: migrationsConfig,
      };

    default:
      throw new Error(
        `Unsupported database type for migrations: ${dbConfig.type}`
      );
  }
}

export async function runMigrations(): Promise<void> {
  const dbConfig = getDatabaseConfig();

  console.log(`Running database migrations for ${dbConfig.type}...`);

  const knexConfig = buildKnexConfig();
  const db = knex(knexConfig);

  try {
    const [batchNo, migrations] = await db.migrate.latest();

    if (migrations.length === 0) {
      console.log("Database is up to date - no migrations to run");
    } else {
      console.log(`Ran ${migrations.length} migration(s) in batch ${batchNo}:`);
      migrations.forEach((migration: string) => {
        console.log(`  - ${path.basename(migration)}`);
      });
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await db.destroy();
  }
}

export async function rollbackMigrations(): Promise<void> {
  const dbConfig = getDatabaseConfig();

  console.log(`Rolling back database migrations for ${dbConfig.type}...`);

  const knexConfig = buildKnexConfig();
  const db = knex(knexConfig);

  try {
    const [batchNo, migrations] = await db.migrate.rollback();

    if (migrations.length === 0) {
      console.log("No migrations to rollback");
    } else {
      console.log(
        `Rolled back ${migrations.length} migration(s) from batch ${batchNo}:`
      );
      migrations.forEach((migration: string) => {
        console.log(`  - ${path.basename(migration)}`);
      });
    }
  } finally {
    await db.destroy();
  }
}

export async function getMigrationStatus(): Promise<void> {
  const knexConfig = buildKnexConfig();
  const db = knex(knexConfig);

  try {
    const [completed, pending] = await db.migrate.list();

    console.log("Migration status:");
    console.log("  Completed:", completed?.length || 0);
    console.log("  Pending:", pending?.length || 0);
  } finally {
    await db.destroy();
  }
}
