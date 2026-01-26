import { describe, test, expect, vi, beforeEach } from "vitest";
import { RetryHandler } from "./retry.js";
import type { RetryConfig } from "./config.js";
import type { DeliveryResult } from "./transport.js";

describe("RetryHandler", () => {
  let config: RetryConfig;

  beforeEach(() => {
    config = {
      max_attempts: 3,
      backoff_strategy: "exponential",
      initial_delay_ms: 100,
      max_delay_ms: 5000,
      retryable_status_codes: [500, 502, 503, 504, 429],
    };
  });

  describe("shouldRetry", () => {
    test("returns true for retryable status code", () => {
      const handler = new RetryHandler(config);
      const result: DeliveryResult = {
        success: false,
        statusCode: 503,
        error: "Service unavailable",
        timestamp: new Date(),
      };
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      expect(handler.shouldRetry(result, context)).toBe(true);
    });

    test("returns false for non-retryable status code", () => {
      const handler = new RetryHandler(config);
      const result: DeliveryResult = {
        success: false,
        statusCode: 400,
        error: "Bad request",
        durationMs: 100,
        attempt: 1,
      };
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      expect(handler.shouldRetry(result, context)).toBe(false);
    });

    test("returns false when max attempts reached", () => {
      const handler = new RetryHandler(config);
      const result: DeliveryResult = {
        success: false,
        statusCode: 503,
        error: "Service unavailable",
        durationMs: 100,
        attempt: 1,
      };
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 3,
      };

      expect(handler.shouldRetry(result, context)).toBe(false);
    });

    test("returns false for successful delivery", () => {
      const handler = new RetryHandler(config);
      const result: DeliveryResult = {
        success: true,
        statusCode: 200,
        durationMs: 50,
        attempt: 1,
      };
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      expect(handler.shouldRetry(result, context)).toBe(false);
    });
  });

  describe("calculateDelay", () => {
    test("calculates exponential backoff correctly", () => {
      const handler = new RetryHandler(config);

      const delay1 = handler.calculateDelay(1);
      const delay2 = handler.calculateDelay(2);
      const delay3 = handler.calculateDelay(3);

      // First attempt: ~100ms
      expect(delay1).toBeGreaterThanOrEqual(90);
      expect(delay1).toBeLessThanOrEqual(110);

      // Second attempt: ~200ms
      expect(delay2).toBeGreaterThanOrEqual(180);
      expect(delay2).toBeLessThanOrEqual(220);

      // Third attempt: ~400ms
      expect(delay3).toBeGreaterThanOrEqual(360);
      expect(delay3).toBeLessThanOrEqual(440);
    });

    test("respects max delay", () => {
      const handler = new RetryHandler(config);

      const delay = handler.calculateDelay(10); // Very high attempt number

      expect(delay).toBeLessThanOrEqual(config.max_delay_ms);
    });

    test("calculates linear backoff correctly", () => {
      const linearConfig: RetryConfig = {
        ...config,
        backoff_strategy: "linear",
      };
      const handler = new RetryHandler(linearConfig);

      const delay1 = handler.calculateDelay(1);
      const delay2 = handler.calculateDelay(2);
      const delay3 = handler.calculateDelay(3);

      // Linear: attempt * initial_delay
      expect(delay1).toBeGreaterThanOrEqual(90);
      expect(delay1).toBeLessThanOrEqual(110);

      expect(delay2).toBeGreaterThanOrEqual(180);
      expect(delay2).toBeLessThanOrEqual(220);

      expect(delay3).toBeGreaterThanOrEqual(270);
      expect(delay3).toBeLessThanOrEqual(330);
    });
  });

  describe("getNextRetryTime", () => {
    test("returns future date based on calculated delay", () => {
      const handler = new RetryHandler(config);
      const now = Date.now();

      const nextRetryTime = handler.getNextRetryTime(1);

      expect(nextRetryTime.getTime()).toBeGreaterThan(now);
      expect(nextRetryTime.getTime()).toBeLessThan(now + 200); // ~100ms + jitter
    });
  });

  describe("executeWithRetry", () => {
    test("succeeds on first attempt", async () => {
      const handler = new RetryHandler(config);
      const operation = vi.fn().mockResolvedValue("success");
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      const result = await handler.executeWithRetry(operation, context);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("retries on failure and eventually succeeds", async () => {
      const handler = new RetryHandler(config);
      const networkError = new Error("ECONNRESET: Connection reset");
      const operation = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue("success");

      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      const result = await handler.executeWithRetry(operation, context);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test("throws error after max attempts", async () => {
      const handler = new RetryHandler(config);
      const networkError = new Error("ETIMEDOUT: Request timeout");
      const operation = vi.fn().mockRejectedValue(networkError);

      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      await expect(
        handler.executeWithRetry(operation, context),
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(3);
    });

    test("calls onRetry callback", async () => {
      const handler = new RetryHandler(config);
      const networkError = new Error("ECONNREFUSED: Connection refused");
      const operation = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue("success");

      const onRetry = vi.fn();
      const context = {
        subscriberId: 1,
        eventId: "evt-123",
        eventType: "push",
        attempt: 1,
      };

      await handler.executeWithRetry(operation, context, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          message: expect.stringContaining("ECONNREFUSED"),
        }),
      );
    });
  });
});
