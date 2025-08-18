import { type Request } from "express";
import { type SecurityConfig } from "./config.js";
import crypto from "crypto";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: Date;
  blocked: boolean;
}

export class WebhookSecurity {
  private rateLimiter: Map<string, { count: number; resetTime: Date }> =
    new Map();
  private ipWhitelist: Set<string> = new Set();
  private config: SecurityConfig;

  constructor(config: SecurityConfig, ipWhitelist: string[] = []) {
    this.config = config;
    this.ipWhitelist = new Set(ipWhitelist);
  }

  async validateRequest(
    req: Request,
    secret: string
  ): Promise<ValidationResult> {
    // IP whitelist check (if configured)
    if (this.ipWhitelist.size > 0) {
      const clientIP = this.getClientIP(req);
      if (!this.ipWhitelist.has(clientIP)) {
        return {
          valid: false,
          error: "IP not whitelisted",
          statusCode: 403,
        };
      }
    }

    // Rate limiting
    if (this.config.enable_rate_limiting) {
      const rateLimitResult = this.checkRateLimit(req);
      if (rateLimitResult.blocked) {
        return {
          valid: false,
          error: "Rate limit exceeded",
          statusCode: 429,
        };
      }
    }

    // Payload size check
    const contentLength = parseInt(req.header("content-length") || "0");
    const maxSize = this.config.payload_size_limit_mb * 1024 * 1024;
    if (contentLength > maxSize) {
      return {
        valid: false,
        error: "Payload too large",
        statusCode: 413,
      };
    }

    // Signature validation
    const signature = req.header("x-hub-signature-256");
    if (!signature) {
      return {
        valid: false,
        error: "Missing signature",
        statusCode: 401,
      };
    }

    const rawBody =
      req.body instanceof Buffer
        ? req.body.toString("utf8")
        : JSON.stringify(req.body);
    if (!this.verifySignature(rawBody, signature, secret)) {
      return {
        valid: false,
        error: "Invalid signature",
        statusCode: 401,
      };
    }

    // Note: GitHub delivery IDs are UUIDs, not timestamps, so we skip timestamp validation
    // In a real implementation, you might want to store delivery IDs to prevent replay attacks

    return { valid: true };
  }

  private verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    try {
      const hmac = crypto.createHmac("sha256", secret);
      const digest = "sha256=" + hmac.update(payload).digest("hex");
      return crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(signature)
      );
    } catch {
      return false;
    }
  }

  private getClientIP(req: Request): string {
    // Check various headers for the real IP
    const forwarded = req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || "unknown";
    }

    const realIP = req.header("x-real-ip");
    if (realIP) {
      return realIP;
    }

    return req.ip || req.socket.remoteAddress || "unknown";
  }

  private checkRateLimit(req: Request): RateLimitInfo {
    const clientIP = this.getClientIP(req);
    const now = new Date();

    const existing = this.rateLimiter.get(clientIP);

    if (!existing || existing.resetTime <= now) {
      // Start new window
      const resetTime = new Date(now.getTime() + 60000);
      this.rateLimiter.set(clientIP, { count: 1, resetTime });

      return {
        remaining: this.config.requests_per_minute - 1,
        resetTime,
        blocked: false,
      };
    }

    // Increment existing count
    existing.count++;
    const remaining = Math.max(
      0,
      this.config.requests_per_minute - existing.count
    );
    const blocked = existing.count > this.config.requests_per_minute;

    return {
      remaining,
      resetTime: existing.resetTime,
      blocked,
    };
  }

  // Cleanup old rate limit entries
  cleanup(): void {
    const now = new Date();
    for (const [ip, data] of this.rateLimiter.entries()) {
      if (data.resetTime <= now) {
        this.rateLimiter.delete(ip);
      }
    }
  }

  // Get rate limit info for an IP
  getRateLimitInfo(req: Request): RateLimitInfo {
    return this.checkRateLimit(req);
  }

  // Add IPs to whitelist
  addToWhitelist(ips: string[]): void {
    for (const ip of ips) {
      this.ipWhitelist.add(ip);
    }
  }

  // Remove IPs from whitelist
  removeFromWhitelist(ips: string[]): void {
    for (const ip of ips) {
      this.ipWhitelist.delete(ip);
    }
  }
}
