/**
 * Database factory for creating database instances based on configuration
 */
import type { DatabaseConfig } from "../config.js";
import type {
  IDatabase,
  ISubscriberRepository,
  ITransportRepository,
  IEventRepository,
  IDeliveryAttemptRepository,
} from "./interface.js";

import {
  SQLiteDatabase,
  SQLiteSubscriberRepository,
  SQLiteTransportRepository,
  SQLiteEventRepository,
  SQLiteDeliveryAttemptRepository,
} from "./sqlite.js";

import {
  PostgreSQLDatabase,
  PostgreSQLSubscriberRepository,
  PostgreSQLTransportRepository,
  PostgreSQLEventRepository,
  PostgreSQLDeliveryAttemptRepository,
  type PostgresConfig,
} from "./postgres.js";

import {
  MongoDBDatabase,
  MongoDBSubscriberRepository,
  MongoDBTransportRepository,
  MongoDBEventRepository,
  MongoDBDeliveryAttemptRepository,
  type MongoConfig,
} from "./mongodb.js";

export interface DatabaseRepositories {
  db: IDatabase;
  subscribers: ISubscriberRepository;
  transports: ITransportRepository;
  events: IEventRepository;
  deliveryAttempts: IDeliveryAttemptRepository;
}

export class DatabaseFactory {
  static async create(config: DatabaseConfig): Promise<DatabaseRepositories> {
    let db: IDatabase;

    switch (config.type) {
      case "sqlite": {
        const dbPath = config.filename || "./database.sqlite";
        db = new SQLiteDatabase(dbPath);
        break;
      }

      case "postgres": {
        if (
          !config.host ||
          !config.port ||
          !config.username ||
          !config.password ||
          !config.database
        ) {
          throw new Error(
            "PostgreSQL requires host, port, username, password, and database"
          );
        }

        const pgConfig: PostgresConfig = {
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.database,
        };

        db = new PostgreSQLDatabase(pgConfig);
        break;
      }

      case "mongodb": {
        if (!config.host || !config.database) {
          throw new Error("MongoDB requires host and database");
        }

        // Build MongoDB connection URL
        let url = config.host;
        if (!url.startsWith("mongodb://") && !url.startsWith("mongodb+srv://")) {
          // Construct URL from parts
          const auth =
            config.username && config.password
              ? `${config.username}:${config.password}@`
              : "";
          const port = config.port ? `:${config.port}` : "";
          url = `mongodb://${auth}${config.host}${port}`;
        }

        const mongoConfig: MongoConfig = {
          url,
          database: config.database,
        };

        db = new MongoDBDatabase(mongoConfig);
        break;
      }

      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    // Connect to the database
    await db.connect();

    // Create repository instances based on database type
    const repositories = DatabaseFactory.createRepositories(db);

    return repositories;
  }

  private static createRepositories(db: IDatabase): DatabaseRepositories {
    const dbType = db.getType();

    let subscribers: ISubscriberRepository;
    let transports: ITransportRepository;
    let events: IEventRepository;
    let deliveryAttempts: IDeliveryAttemptRepository;

    switch (dbType) {
      case "sqlite":
        subscribers = new SQLiteSubscriberRepository(db);
        transports = new SQLiteTransportRepository(db);
        events = new SQLiteEventRepository(db);
        deliveryAttempts = new SQLiteDeliveryAttemptRepository(db);
        break;

      case "postgres":
        subscribers = new PostgreSQLSubscriberRepository(db);
        transports = new PostgreSQLTransportRepository(db);
        events = new PostgreSQLEventRepository(db);
        deliveryAttempts = new PostgreSQLDeliveryAttemptRepository(db);
        break;

      case "mongodb":
        subscribers = new MongoDBSubscriberRepository(db);
        transports = new MongoDBTransportRepository(db);
        events = new MongoDBEventRepository(db);
        deliveryAttempts = new MongoDBDeliveryAttemptRepository(db);
        break;

      default:
        throw new Error(`Unknown database type: ${dbType}`);
    }

    return {
      db,
      subscribers,
      transports,
      events,
      deliveryAttempts,
    };
  }
}
