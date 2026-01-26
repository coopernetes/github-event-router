import { describe, test, expect, beforeEach } from "vitest";
import { encryptData, decryptData } from "./encryption.js";
import { setAppConfig } from "./config.js";
import type { Config } from "./config.js";

describe("Encryption", () => {
  beforeEach(() => {
    const testConfig: Config = {
      app: {
        webhook_secret: "test-webhook-secret",
      },
      server: {
        port: 3000,
      },
      database: {
        type: "sqlite",
        filename: ":memory:",
        encryption_key: "test-encryption-key-at-least-32-chars-long",
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

    setAppConfig(testConfig);
  });

  test("encrypts and decrypts data correctly", () => {
    const originalData = "sensitive-token-12345";

    const encrypted = encryptData(originalData);

    expect(encrypted).toBeDefined();
    expect(encrypted.encrypted).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.salt).toBeTruthy();

    const decrypted = decryptData(encrypted);

    expect(decrypted).toBe(originalData);
  });

  test("produces different ciphertext for same input", () => {
    const originalData = "sensitive-data";

    const encrypted1 = encryptData(originalData);
    const encrypted2 = encryptData(originalData);

    // Different salt and IV should produce different ciphertext
    expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.salt).not.toBe(encrypted2.salt);

    // But both should decrypt to the same value
    expect(decryptData(encrypted1)).toBe(originalData);
    expect(decryptData(encrypted2)).toBe(originalData);
  });

  test("handles JSON data", () => {
    const originalData = JSON.stringify({ token: "abc123", secret: "xyz789" });

    const encrypted = encryptData(originalData);
    const decrypted = decryptData(encrypted);

    expect(decrypted).toBe(originalData);
    expect(JSON.parse(decrypted)).toEqual({
      token: "abc123",
      secret: "xyz789",
    });
  });

  test("throws error when encryption key is missing", () => {
    const configWithoutKey: Config = {
      app: {
        webhook_secret: "test-webhook-secret",
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

    setAppConfig(configWithoutKey);

    expect(() => encryptData("test")).toThrow(
      "Encryption key is required for encryption",
    );
  });

  test("throws error when decrypting with wrong key", () => {
    const originalData = "sensitive-data";
    const encrypted = encryptData(originalData);

    // Change the encryption key
    const differentConfig: Config = {
      app: {
        webhook_secret: "test-webhook-secret",
      },
      server: {
        port: 3000,
      },
      database: {
        type: "sqlite",
        filename: ":memory:",
        encryption_key: "different-encryption-key-32-chars-long!",
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

    setAppConfig(differentConfig);

    expect(() => decryptData(encrypted)).toThrow("Failed to decrypt data");
  });

  test("handles empty string", () => {
    const originalData = "";

    const encrypted = encryptData(originalData);
    const decrypted = decryptData(encrypted);

    expect(decrypted).toBe(originalData);
  });

  test("handles Unicode characters", () => {
    const originalData =
      "🔒 Sensitive data with émojis and spëcial chars 日本語";

    const encrypted = encryptData(originalData);
    const decrypted = decryptData(encrypted);

    expect(decrypted).toBe(originalData);
  });
});
