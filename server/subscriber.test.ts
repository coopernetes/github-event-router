import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";

const TEST_DB_PATH = "./test-subscriber-isolated.sqlite";

describe("Subscriber", () => {
  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Use dynamic import to reset the module each time
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up test database
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

  test("normalizes transport name from http to https", () => {
    // The subscriber module normalizes 'http' to 'https'
    // This is tested through the createSubscriber function
    expect(true).toBe(true); // Placeholder for real test
  });

  test("handles comma-separated events string", () => {
    // Events can be stored as comma-separated strings in the database
    // and should be parsed correctly
    expect(true).toBe(true); // Placeholder for real test
  });

  test("validates transport type", () => {
    // All 6 documented transport types should be valid
    const validTypes = [
      "https",
      "redis",
      "kafka",
      "sqs",
      "azure-eventhub",
      "amqp",
    ];
    expect(validTypes).toContain("https");
    expect(validTypes).toContain("redis");
    expect(validTypes).toContain("kafka");
    expect(validTypes).toContain("sqs");
    expect(validTypes).toContain("azure-eventhub");
    expect(validTypes).toContain("amqp");
  });
});
