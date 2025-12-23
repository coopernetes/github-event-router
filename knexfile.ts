import type { Knex } from "knex";
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

  const migrationsConfig: Knex.MigratorConfig = {
    directory: path.join(__dirname, "migrations", "knex"),
    extension: "ts",
    loadExtensions: [".ts", ".js"],
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
          host: dbConfig.host,
          port: dbConfig.port || 5432,
          user: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
        },
        migrations: migrationsConfig,
      };

    default:
      throw new Error(`Unsupported database type for Knex: ${dbConfig.type}`);
  }
}

const knexConfig: Knex.Config = buildKnexConfig();

export default knexConfig;
