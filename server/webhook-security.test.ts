import { describe, test, expect, beforeEach } from "vitest";
import { WebhookSecurity } from "./webhook-security.js";
import type { SecurityConfig } from "./config.js";
import crypto from "crypto";
import type { Request } from "express";

describe("WebhookSecurity", () => {
  let securityConfig: SecurityConfig;
  let webhookSecret: string;

  beforeEach(() => {
    webhookSecret = "test-webhook-secret";
    securityConfig = {
      enable_rate_limiting: true,
      requests_per_minute: 60,
      payload_size_limit_mb: 10,
    };
  });

  function createMockRequest(
    body: unknown,
    signature?: string,
    contentLength?: string,
    ip?: string,
  ): Request {
    const req: Partial<Request> = {
      body,
      header: ((name: string) => {
        if (name === "x-hub-signature-256") return signature;
        if (name === "content-length") return contentLength;
        return undefined;
      }) as Request["header"],
      ip: ip || "127.0.0.1",
      socket: {
        remoteAddress: ip || "127.0.0.1",
      } as unknown as Request["socket"],
    };
    return req as Request;
  }

  function generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return `sha256=${hmac.digest("hex")}`;
  }

  describe("validateRequest", () => {
    test("validates request with correct signature", async () => {
      const security = new WebhookSecurity(securityConfig);
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);
      const req = createMockRequest({ test: "data" }, signature, "16");

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("rejects request with missing signature", async () => {
      const security = new WebhookSecurity(securityConfig);
      const req = createMockRequest({ test: "data" }, undefined, "16");

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing signature");
      expect(result.statusCode).toBe(401);
    });

    test("rejects request with invalid signature", async () => {
      const security = new WebhookSecurity(securityConfig);
      const req = createMockRequest({ test: "data" }, "sha256=invalid", "16");

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
      expect(result.statusCode).toBe(401);
    });

    test("rejects request with payload too large", async () => {
      const security = new WebhookSecurity(securityConfig);
      const largeSize = (11 * 1024 * 1024).toString(); // 11MB
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);
      const req = createMockRequest({ test: "data" }, signature, largeSize);

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Payload too large");
      expect(result.statusCode).toBe(413);
    });

    test("validates Buffer body correctly", async () => {
      const security = new WebhookSecurity(securityConfig);
      const payload = '{"test":"data"}';
      const signature = generateSignature(payload, webhookSecret);
      const req = createMockRequest(Buffer.from(payload), signature, "16");

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(true);
    });

    test("enforces IP whitelist when configured", async () => {
      const security = new WebhookSecurity(securityConfig, ["192.168.1.1"]);
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);
      const req = createMockRequest(
        { test: "data" },
        signature,
        "16",
        "10.0.0.1",
      );

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("IP not whitelisted");
      expect(result.statusCode).toBe(403);
    });

    test("allows whitelisted IP", async () => {
      const security = new WebhookSecurity(securityConfig, ["192.168.1.1"]);
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);
      const req = createMockRequest(
        { test: "data" },
        signature,
        "16",
        "192.168.1.1",
      );

      const result = await security.validateRequest(req, webhookSecret);

      expect(result.valid).toBe(true);
    });
  });

  describe("rate limiting", () => {
    test("blocks request when rate limit exceeded", async () => {
      const limitedConfig: SecurityConfig = {
        enable_rate_limiting: true,
        requests_per_minute: 2,
        payload_size_limit_mb: 10,
      };
      const security = new WebhookSecurity(limitedConfig);
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);

      // Make 3 requests (limit is 2)
      const req1 = createMockRequest({ test: "data" }, signature, "16");
      const req2 = createMockRequest({ test: "data" }, signature, "16");
      const req3 = createMockRequest({ test: "data" }, signature, "16");

      const result1 = await security.validateRequest(req1, webhookSecret);
      const result2 = await security.validateRequest(req2, webhookSecret);
      const result3 = await security.validateRequest(req3, webhookSecret);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
      expect(result3.valid).toBe(false);
      expect(result3.error).toBe("Rate limit exceeded");
      expect(result3.statusCode).toBe(429);
    });

    test("allows requests when rate limiting disabled", async () => {
      const noLimitConfig: SecurityConfig = {
        enable_rate_limiting: false,
        requests_per_minute: 1,
        payload_size_limit_mb: 10,
      };
      const security = new WebhookSecurity(noLimitConfig);
      const payload = JSON.stringify({ test: "data" });
      const signature = generateSignature(payload, webhookSecret);

      // Make multiple requests
      const req1 = createMockRequest({ test: "data" }, signature, "16");
      const req2 = createMockRequest({ test: "data" }, signature, "16");

      const result1 = await security.validateRequest(req1, webhookSecret);
      const result2 = await security.validateRequest(req2, webhookSecret);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe("getRateLimitInfo", () => {
    test("returns rate limit information", () => {
      const security = new WebhookSecurity(securityConfig);
      const req = createMockRequest({ test: "data" });

      const info = security.getRateLimitInfo(req);

      expect(info).toBeDefined();
      expect(info.remaining).toBeGreaterThanOrEqual(0);
      expect(info.resetTime).toBeInstanceOf(Date);
      expect(typeof info.blocked).toBe("boolean");
    });
  });
});
