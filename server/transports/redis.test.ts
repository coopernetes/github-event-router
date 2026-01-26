import { describe, test, expect, beforeEach, vi } from "vitest";
import { RedisTransport } from "./redis.js";
import type { Config } from "../config.js";
import type { GitHubEvent } from "./interface.js";

// Create mock client
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
};

// Mock redis
vi.mock("redis", () => ({
  createClient: vi.fn(() => mockClient),
}));

describe("RedisTransport", () => {
  let transport: RedisTransport;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      app: { webhook_secret: "test-secret" },
      server: { port: 3000 },
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

    transport = new RedisTransport(config);
  });

  test("getType returns redis", () => {
    expect(transport.getType()).toBe("redis");
  });

  test("validates valid Redis config", () => {
    const validConfig = {
      url: "redis://localhost:6379",
      password: "optional-password",
    };

    expect(transport.validateConfig(validConfig)).toBe(true);
  });

  test("rejects invalid config", () => {
    expect(transport.validateConfig(null)).toBe(false);
    expect(transport.validateConfig(undefined)).toBe(false);
    expect(transport.validateConfig({})).toBe(false);
    expect(transport.validateConfig({ password: "only-password" })).toBe(false);
  });

  test("successfully delivers event", async () => {
    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: { ref: "refs/heads/main", commits: [] },
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-123",
      },
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
    };

    const result = await transport.deliver(event, transportConfig);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.publish).toHaveBeenCalledWith(
      "github-events:push",
      expect.stringContaining("push"),
    );
  });

  test("uses custom channel when specified", async () => {
    const event: GitHubEvent = {
      id: "event-123",
      type: "pull_request",
      payload: { action: "opened" },
      headers: {},
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
      channel: "custom-channel",
    };

    await transport.deliver(event, transportConfig);

    expect(mockClient.publish).toHaveBeenCalledWith(
      "custom-channel",
      expect.any(String),
    );
  });

  test("reuses client for same URL", async () => {
    const event: GitHubEvent = {
      id: "event-1",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
    };

    // Deliver twice
    await transport.deliver(event, transportConfig);
    await transport.deliver(event, transportConfig);

    // Client connected for both
    expect(mockClient.connect).toHaveBeenCalled();
  });

  test("handles authentication with password", async () => {
    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "secret-password",
    };

    await transport.deliver(event, transportConfig);

    // Client connected with password
    expect(mockClient.connect).toHaveBeenCalled();
  });

  test("handles delivery failure", async () => {
    mockClient.publish = vi
      .fn()
      .mockRejectedValue(new Error("Redis connection failed"));

    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
    };

    const result = await transport.deliver(event, transportConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Redis connection failed");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns failure for no subscribers", async () => {
    mockClient.publish = vi.fn().mockResolvedValue(0);

    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
    };

    const result = await transport.deliver(event, transportConfig);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(204);
  });

  test("serializes event data correctly", async () => {
    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: {
        ref: "refs/heads/main",
        commits: [{ id: "abc123", message: "test commit" }],
      },
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-123",
      },
      receivedAt: new Date("2026-01-23T10:00:00Z"),
    };

    const transportConfig = {
      url: "redis://localhost:6379",
      password: "",
    };

    await transport.deliver(event, transportConfig);

    expect(mockClient.publish).toHaveBeenCalledWith(
      "github-events:push",
      JSON.stringify({
        event: "push",
        payload: event.payload,
        headers: event.headers,
        deliveryId: "event-123",
        timestamp: "2026-01-23T10:00:00.000Z",
      }),
    );
  });

  test("closes all Redis connections", async () => {
    const event: GitHubEvent = {
      id: "event-1",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    // Create multiple clients
    await transport.deliver(event, {
      url: "redis://localhost:6379",
      password: "",
    });
    await transport.deliver(event, {
      url: "redis://localhost:6380",
      password: "",
    });

    await transport.close();

    expect(mockClient.disconnect).toHaveBeenCalledTimes(2);
  });

  test("returns error for invalid config", async () => {
    const event: GitHubEvent = {
      id: "event-123",
      type: "push",
      payload: {},
      headers: {},
      receivedAt: new Date(),
    };

    const invalidConfig = { invalid: "config" };

    const result = await transport.deliver(event, invalidConfig as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid Redis transport configuration");
  });
});
