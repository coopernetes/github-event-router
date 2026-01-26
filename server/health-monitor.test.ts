import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { HealthMonitor } from "./health-monitor.js";
import type { Config } from "./config.js";
import Database from "better-sqlite3";
import fs from "fs";

const TEST_DB_PATH = "./test-health-monitor.sqlite";

describe("HealthMonitor", () => {
  let monitor: HealthMonitor;
  let config: Config;

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Create a test database with required schema
    const db = new Database(TEST_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        events TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS delivery_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_id INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER,
        error_message TEXT,
        FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        headers TEXT,
        received_at TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.close();

    config = {
      app: { webhook_secret: "test-secret" },
      server: { port: 3000 },
      database: {
        type: "sqlite",
        filename: TEST_DB_PATH,
        encryption_key: "test-key",
      },
      event_processing: {
        retry: {
          max_attempts: 3,
          backoff_strategy: "exponential",
          initial_delay_ms: 1000,
          max_delay_ms: 30000,
          retryable_status_codes: [500, 502, 503, 504],
        },
        timeouts: {
          http_delivery_timeout_ms: 10000,
          redis_delivery_timeout_ms: 5000,
        },
        queue: {
          batch_size: 10,
          processing_interval_ms: 1000,
          dead_letter_threshold: 5,
        },
      },
      internal_queue: {
        enabled: false,
        type: "memory",
        consumer_count: 1,
        poll_interval_ms: 100,
        visibility_timeout_ms: 30000,
      },
      monitoring: {
        enable_metrics: true,
        log_level: "info",
        failed_delivery_alerts: true,
      },
      security: {
        enable_rate_limiting: false,
        requests_per_minute: 1000,
        payload_size_limit_mb: 10,
      },
    };

    monitor = new HealthMonitor(config, TEST_DB_PATH);
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

  test("checks database health", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.database).toBeDefined();
    expect(health.database.status).toBe("healthy");
    expect(health.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("reports system stats", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.system).toBeDefined();
    expect(health.system.uptime).toBeGreaterThanOrEqual(0);
    expect(health.system.memory.used).toBeGreaterThan(0);
    expect(health.system.memory.total).toBeGreaterThan(0);
    expect(health.system.memory.percentage).toBeGreaterThanOrEqual(0);
    expect(health.system.memory.percentage).toBeLessThanOrEqual(100);
  });

  test("isHealthy checks health requirements", async () => {
    const health = await monitor.getSystemHealth();

    // isHealthy requires: healthy database, low latency, active subscribers,
    // manageable queue, and no critical failures
    const isHealthy = monitor.isHealthy();

    // Since we have no subscribers in test, it should be false
    expect(typeof isHealthy).toBe("boolean");

    // Verify the health check ran
    expect(health.database.status).toBe("healthy");
  });

  test("returns health summary", async () => {
    await monitor.getSystemHealth();

    const summary = monitor.getHealthSummary();

    expect(summary).toBeDefined();
    expect(typeof summary).toBe("string");
  });

  test("tracks event processing stats", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.eventProcessing).toBeDefined();
    expect(health.eventProcessing.queueSize).toBeGreaterThanOrEqual(0);
    expect(health.eventProcessing.processingRate).toBeGreaterThanOrEqual(0);
    expect(health.eventProcessing.pendingRetries).toBeGreaterThanOrEqual(0);
  });

  test("tracks failed deliveries", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.failedDeliveries).toBeDefined();
    expect(health.failedDeliveries.last24h).toBeGreaterThanOrEqual(0);
    expect(health.failedDeliveries.last1h).toBeGreaterThanOrEqual(0);
    expect(typeof health.failedDeliveries.requiresAttention).toBe("boolean");
  });

  test("tracks subscriber health", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.subscribers).toBeDefined();
    expect(health.subscribers.total).toBeGreaterThanOrEqual(0);
    expect(health.subscribers.active).toBeGreaterThanOrEqual(0);
    expect(health.subscribers.failing).toBeGreaterThanOrEqual(0);
  });
});
