import { describe, test, expect, vi, beforeEach } from "vitest";
import { startServer } from "./app.js";
import { loadConfig, setAppConfig } from "./config.js";
import type { Config } from "./config.js";

// Mock the config module
vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
  setAppConfig: vi.fn(),
}));

describe("startServer", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  test("logs correct server information", () => {
    const testConfig: Config = {
      app: {
        id: 123,
        webhook_secret: "test-webhook",
        private_key: "test-key",
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

    startServer();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(setAppConfig).toHaveBeenCalledWith(testConfig);
    expect(console.log).toHaveBeenCalledWith("App ID: 123");
    expect(console.log).toHaveBeenCalledWith("Webhook Secret: test-webhook");
    expect(console.log).toHaveBeenCalledWith("Server is running on port 3000");
  });
});
