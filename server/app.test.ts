import { describe, test, expect, vi, beforeEach } from "vitest";
import { startServer } from "./app.js";
import { loadConfig, setAppConfig, getAppConfig } from "./config.js";
import type { Config } from "./config.js";

// Mock the config module
vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
  setAppConfig: vi.fn(),
  getAppConfig: vi.fn(),
}));

describe("startServer", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  test("logs correct server information", async () => {
    const testConfig: Config = {
      app: {
        webhook_secret: "test-webhook",
      },
      server: {
        port: 3000,
      },
      database: undefined,
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

    // Mock loadConfig to return our test config
    vi.mocked(loadConfig).mockReturnValue(testConfig);
    vi.mocked(getAppConfig).mockReturnValue(testConfig);

    await startServer();

    // Wait a bit for server to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(setAppConfig).toHaveBeenCalledWith(testConfig);

    // Check that key messages were logged (order may vary due to async operations)
    const allLogs = vi.mocked(console.log).mock.calls.map((call) => call[0]);
    expect(
      allLogs.some(
        (log) => typeof log === "string" && log.includes("Webhook Secret:"),
      ),
    ).toBe(true);
    expect(
      allLogs.some((log) => log === "Server is running on port 3000"),
    ).toBe(true);
  });
});
