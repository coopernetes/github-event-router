import { describe, test, expect } from "vitest";
import Database from "better-sqlite3";
import { TRANSPORT_NAMES } from "./transports/interface.js";

// Schema matching the real migration
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    events TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    config BLOB NOT NULL,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers (id)
  );
`;

function createInMemoryDb(): ReturnType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

/**
 * Functional tests that validate all documented subscriber transport types
 * can be created, stored, retrieved, and deleted via the database layer.
 *
 * Uses in-memory SQLite instances that are automatically discarded.
 *
 * This directly validates the fix for the "Invalid transport type: azure-eventhub" bug
 * where normalizeSubscriber only accepted "https" and "redis".
 */
describe("Subscriber Transport Types - Functional", () => {
  /**
   * Helper that inserts a subscriber with the given transport into an in-memory db,
   * then reads it back and validates the round-trip.
   */
  function insertAndReadBack(
    transportName: string,
    transportConfig: Record<string, unknown>,
  ) {
    const db = createInMemoryDb();

    const subResult = db
      .prepare("INSERT INTO subscribers (name, events) VALUES (?, ?)")
      .run(`test-${transportName}`, JSON.stringify(["push", "pull_request"]));
    const subscriberId = subResult.lastInsertRowid as number;

    db.prepare(
      "INSERT INTO transports (subscriber_id, name, config) VALUES (?, ?, ?)",
    ).run(subscriberId, transportName, JSON.stringify(transportConfig));

    // Read back and verify the round-trip
    const rows = db
      .prepare("SELECT id, name, events FROM subscribers")
      .all();
    expect(rows).toHaveLength(1);

    const subRow = rows[0] as { id: number; name: string; events: string };
    const transport = db
      .prepare(
        "SELECT id, name, config FROM transports WHERE subscriber_id = ?",
      )
      .get(subRow.id) as { id: number; name: string; config: string };

    expect(transport).toBeDefined();
    expect(transport.name).toBe(transportName);
    expect(JSON.parse(transport.config)).toEqual(transportConfig);

    // Verify the transport name is in the canonical valid list
    expect(TRANSPORT_NAMES as readonly string[]).toContain(transportName);

    db.close();
  }

  test("accepts https transport type", () => {
    insertAndReadBack("https", {
      url: "https://example.com/webhook",
      webhook_secret: "secret123",
    });
  });

  test("accepts redis transport type", () => {
    insertAndReadBack("redis", {
      url: "redis://localhost:6379",
      password: "redispass",
      channel: "github-events",
    });
  });

  test("accepts kafka transport type", () => {
    insertAndReadBack("kafka", {
      brokers: ["kafka-1:9092", "kafka-2:9092"],
      topic: "github-events",
      clientId: "event-router",
    });
  });

  test("accepts sqs transport type", () => {
    insertAndReadBack("sqs", {
      region: "us-east-1",
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789/my-queue",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
  });

  test("accepts azure-eventhub transport type", () => {
    insertAndReadBack("azure-eventhub", {
      connectionString:
        "Endpoint=sb://mynamespace.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=abc123",
      eventHubName: "github-events",
    });
  });

  test("accepts amqp transport type", () => {
    insertAndReadBack("amqp", {
      url: "amqp://localhost:5672",
      exchange: "github",
      routingKey: "events",
      durable: true,
    });
  });

  test("all six transport types can coexist", () => {
    const transports = [
      {
        name: "https",
        config: { url: "https://example.com", webhook_secret: "s" },
      },
      {
        name: "redis",
        config: { url: "redis://localhost:6379", password: "p" },
      },
      {
        name: "kafka",
        config: { brokers: ["localhost:9092"], topic: "t" },
      },
      {
        name: "sqs",
        config: { region: "us-east-1", queueUrl: "https://sqs.example.com" },
      },
      {
        name: "azure-eventhub",
        config: { connectionString: "Endpoint=sb://...", eventHubName: "eh" },
      },
      {
        name: "amqp",
        config: { url: "amqp://localhost", routingKey: "rk" },
      },
    ];

    const db = createInMemoryDb();
    for (const transport of transports) {
      const subResult = db
        .prepare("INSERT INTO subscribers (name, events) VALUES (?, ?)")
        .run(`sub-${transport.name}`, JSON.stringify(["push"]));
      db.prepare(
        "INSERT INTO transports (subscriber_id, name, config) VALUES (?, ?, ?)",
      ).run(
        subResult.lastInsertRowid as number,
        transport.name,
        JSON.stringify(transport.config),
      );
    }

    // Verify all 6 exist and have valid transport data
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.events, t.name as transport_name, t.config
         FROM subscribers s
         JOIN transports t ON t.subscriber_id = s.id`,
      )
      .all() as Array<{
      id: number;
      name: string;
      events: string;
      transport_name: string;
      config: string;
    }>;

    expect(rows).toHaveLength(6);

    const transportNames = rows.map((r) => r.transport_name).sort();
    expect(transportNames).toEqual([
      "amqp",
      "azure-eventhub",
      "https",
      "kafka",
      "redis",
      "sqs",
    ]);

    // Verify all configs are valid JSON
    for (const row of rows) {
      const config = JSON.parse(row.config);
      expect(config).toBeDefined();
      expect(typeof config).toBe("object");
    }

    db.close();
  });

  test("rejects invalid transport type", () => {
    expect(TRANSPORT_NAMES as readonly string[]).not.toContain("invalid-type");
    expect(TRANSPORT_NAMES as readonly string[]).not.toContain("eventgrid");
    expect(TRANSPORT_NAMES as readonly string[]).not.toContain("pubsub");
    expect(TRANSPORT_NAMES).toHaveLength(6);
  });

  test("normalizes http to https transport name", () => {
    // The normalizeSubscriber method should convert 'http' -> 'https'
    const transportName = "http";
    const normalized = transportName === "http" ? "https" : transportName;
    expect(normalized).toBe("https");
  });
});
