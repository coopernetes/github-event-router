import { describe, test, expect, beforeEach, vi } from "vitest";
import { HttpsTransport } from "./https.js";
import type { Config } from "../config.js";
import type { GitHubEvent } from "./interface.js";
import axios from "axios";

vi.mock("axios");

describe("HttpsTransport", () => {
  let transport: HttpsTransport;
  let config: Config;

  beforeEach(() => {
    config = {
      app: {
        webhook_secret: "test-secret",
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

    transport = new HttpsTransport(config);
    vi.clearAllMocks();
  });

  test("getType returns https", () => {
    expect(transport.getType()).toBe("https");
  });

  describe("validateConfig", () => {
    test("validates valid HTTPS config", () => {
      const validConfig = {
        url: "https://example.com/webhook",
        webhook_secret: "test-secret",
      };

      expect(transport.validateConfig(validConfig)).toBe(true);
    });

    test("accepts localhost HTTP URLs", () => {
      const localhostConfig = {
        url: "http://localhost:3000/webhook",
        webhook_secret: "test-secret",
      };

      expect(transport.validateConfig(localhostConfig)).toBe(true);
    });

    test("accepts 127.0.0.1 HTTP URLs", () => {
      const localhostConfig = {
        url: "http://127.0.0.1:3000/webhook",
        webhook_secret: "test-secret",
      };

      expect(transport.validateConfig(localhostConfig)).toBe(true);
    });

    test("rejects plain HTTP URLs for non-localhost", () => {
      const insecureConfig = {
        url: "http://example.com/webhook",
        webhook_secret: "test-secret",
      };

      expect(transport.validateConfig(insecureConfig)).toBe(false);
    });

    test("rejects config without URL", () => {
      const invalidConfig = {
        webhook_secret: "test-secret",
      };

      expect(transport.validateConfig(invalidConfig)).toBe(false);
    });

    test("rejects config without webhook_secret", () => {
      const invalidConfig = {
        url: "https://example.com/webhook",
      };

      expect(transport.validateConfig(invalidConfig)).toBe(false);
    });

    test("rejects non-object config", () => {
      expect(transport.validateConfig(null)).toBe(false);
      expect(transport.validateConfig(undefined)).toBe(false);
      expect(transport.validateConfig("string")).toBe(false);
      expect(transport.validateConfig(123)).toBe(false);
    });
  });

  describe("deliver", () => {
    test("successfully delivers event", async () => {
      const mockPost = vi.mocked(axios.post);
      mockPost.mockResolvedValue({
        status: 200,
        statusText: "OK",
        data: {},
        headers: {},
        config: { headers: {} },
      } as never);

      const event: GitHubEvent = {
        id: "event-123",
        type: "push",
        payload: { ref: "refs/heads/main" },
        headers: {
          "x-github-event": "push",
          "x-github-delivery": "delivery-123",
        },
        receivedAt: new Date(),
      };

      const transportConfig = {
        url: "https://example.com/webhook",
        webhook_secret: "test-secret",
      };

      const result = await transport.deliver(event, transportConfig);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockPost).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-hub-signature-256": expect.stringContaining("sha256="),
            "x-github-event-router": "true",
            "content-type": "application/json",
          }),
          timeout: config.event_processing.timeouts.http_delivery_timeout_ms,
        }),
      );
    });

    test("handles delivery failure", async () => {
      const mockPost = vi.mocked(axios.post);
      const axiosError = new Error("Network error");
      (axiosError as unknown as Record<string, unknown>).isAxiosError = true;
      (axiosError as unknown as Record<string, unknown>).response = {
        status: 503,
        statusText: "Service Unavailable",
      };

      mockPost.mockRejectedValue(axiosError);
      vi.spyOn(axios, "isAxiosError").mockReturnValue(true);

      const event: GitHubEvent = {
        id: "event-123",
        type: "push",
        payload: { ref: "refs/heads/main" },
        headers: {
          "x-github-event": "push",
        },
        receivedAt: new Date(),
      };

      const transportConfig = {
        url: "https://example.com/webhook",
        webhook_secret: "test-secret",
      };

      const result = await transport.deliver(event, transportConfig);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(503);
      expect(result.error).toBe("Service Unavailable");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("handles non-axios errors", async () => {
      const mockPost = vi.mocked(axios.post);
      mockPost.mockRejectedValue(new Error("Unknown error"));
      vi.spyOn(axios, "isAxiosError").mockReturnValue(false);

      const event: GitHubEvent = {
        id: "event-123",
        type: "push",
        payload: { ref: "refs/heads/main" },
        headers: {},
        receivedAt: new Date(),
      };

      const transportConfig = {
        url: "https://example.com/webhook",
        webhook_secret: "test-secret",
      };

      const result = await transport.deliver(event, transportConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown error");
    });

    test("includes proper signature in headers", async () => {
      const mockPost = vi.mocked(axios.post);
      mockPost.mockResolvedValue({
        status: 200,
        data: {},
      } as never);

      const event: GitHubEvent = {
        id: "event-123",
        type: "push",
        payload: { test: "data" },
        headers: {},
        receivedAt: new Date(),
      };

      const transportConfig = {
        url: "https://example.com/webhook",
        webhook_secret: "my-secret",
      };

      await transport.deliver(event, transportConfig);

      const callArgs = mockPost.mock.calls[0];
      const headers = callArgs?.[2]?.headers;

      expect(headers).toBeDefined();
      expect(headers?.["x-hub-signature-256"]).toMatch(/^sha256=/);
      expect(headers?.["x-github-event-router"]).toBe("true");
      expect(headers?.["content-type"]).toBe("application/json");
    });
  });
});
