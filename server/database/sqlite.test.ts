import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { SQLiteDatabase } from "./sqlite.js";
import fs from "fs";

const TEST_DB_PATH = "./test-sqlite-db.sqlite";

describe("SQLiteDatabase", () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    db = new SQLiteDatabase(TEST_DB_PATH);
    await db.connect();

    // Create test table using direct database access
    const Database = (await import("better-sqlite3")).default;
    const directDb = new Database(TEST_DB_PATH);
    directDb.exec(`
      CREATE TABLE test_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
    directDb.close();
  });

  afterEach(async () => {
    await db.close();

    // Clean up test database files
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }
  });

  test("connects to database", async () => {
    expect(db.isConnected()).toBe(true);
    expect(db.getType()).toBe("sqlite");
  });

  test("inserts data", async () => {
    const result = await db.insert("test_table", {
      name: "test",
      value: 42,
    });

    expect(result.insertId).toBeGreaterThan(0);
    expect(result.affectedRows).toBe(1);
  });

  test("queries data", async () => {
    await db.insert("test_table", { name: "test1", value: 1 });
    await db.insert("test_table", { name: "test2", value: 2 });

    const result = await db.query<{ id: number; name: string; value: number }>(
      "SELECT * FROM test_table",
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]?.name).toBe("test1");
    expect(result.rows[1]?.name).toBe("test2");
  });

  test("queries with parameters", async () => {
    await db.insert("test_table", { name: "test1", value: 1 });
    await db.insert("test_table", { name: "test2", value: 2 });

    const result = await db.query<{ id: number; name: string; value: number }>(
      "SELECT * FROM test_table WHERE name = ?",
      ["test2"],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe("test2");
  });

  test("updates data", async () => {
    const insertResult = await db.insert("test_table", {
      name: "test",
      value: 1,
    });

    const updateResult = await db.update(
      "test_table",
      { value: 99 },
      { id: insertResult.insertId },
    );

    expect(updateResult.affectedRows).toBe(1);

    const queryResult = await db.query<{
      id: number;
      name: string;
      value: number;
    }>("SELECT * FROM test_table WHERE id = ?", [insertResult.insertId]);

    expect(queryResult.rows[0]?.value).toBe(99);
  });

  test("deletes data", async () => {
    const insertResult = await db.insert("test_table", {
      name: "test",
      value: 1,
    });

    const deleteResult = await db.delete("test_table", {
      id: insertResult.insertId,
    });

    expect(deleteResult.affectedRows).toBe(1);

    const queryResult = await db.query("SELECT * FROM test_table");
    expect(queryResult.rows).toHaveLength(0);
  });

  test("finds records with conditions", async () => {
    await db.insert("test_table", { name: "alice", value: 1 });
    await db.insert("test_table", { name: "bob", value: 2 });
    await db.insert("test_table", { name: "charlie", value: 3 });

    const results = await db.find<{ id: number; name: string; value: number }>(
      "test_table",
      { name: "bob" },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("bob");
  });

  test("finds records with ordering and limit", async () => {
    await db.insert("test_table", { name: "item3", value: 3 });
    await db.insert("test_table", { name: "item1", value: 1 });
    await db.insert("test_table", { name: "item2", value: 2 });

    const results = await db.find<{ id: number; name: string; value: number }>(
      "test_table",
      undefined,
      { orderBy: "value ASC", limit: 2 },
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.value).toBe(1);
    expect(results[1]?.value).toBe(2);
  });

  test("throws error when querying without connection", async () => {
    const disconnectedDb = new SQLiteDatabase(":memory:");

    await expect(disconnectedDb.query("SELECT 1")).rejects.toThrow(
      "Database not connected",
    );
  });

  test("closes connection properly", async () => {
    expect(db.isConnected()).toBe(true);

    await db.close();

    expect(db.isConnected()).toBe(false);
  });
});
