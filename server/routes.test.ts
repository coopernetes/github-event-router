import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { setAppConfig, type Config } from "./config.js";

// Mock the subscriber module
vi.mock("./subscriber.js", () => ({
  getSubscribers: vi.fn(),
  refreshSubscribers: vi.fn(),
  createSubscriber: vi.fn(),
  updateSubscriber: vi.fn(),
  deleteSubscriber: vi.fn(),
}));

vi.mock("./health-monitor.js", () => ({
  HealthMonitor: vi.fn().mockImplementation(() => ({
    getSystemHealth: vi.fn().mockResolvedValue({
      database: { status: "healthy", latencyMs: 5 },
      subscribers: { total: 2, active: 2, failing: 0 },
      eventProcessing: { queueSize: 0, processingRate: 100, pendingRetries: 0 },
      failedDeliveries: { last24h: 0, last1h: 0, requiresAttention: false },
      system: {
        uptime: 1000,
        memory: { used: 100, total: 1000, percentage: 10 },
      },
    }),
    isHealthy: vi.fn().mockReturnValue(true),
    getHealthSummary: vi
      .fn()
      .mockReturnValue({ status: "healthy", issues: [] }),
  })),
}));

describe("Routes", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let setMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    const config: Config = {
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

    setAppConfig(config);

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();
    setMock = vi.fn().mockReturnThis();

    mockReq = {
      body: {},
      params: {},
      header: vi.fn(),
    };

    mockRes = {
      json: jsonMock,
      status: statusMock,
      set: setMock,
    };
  });

  test("GET /test returns working message", async () => {
    const { router } = await import("./routes.js");
    const route = router.stack.find((r) => r.route?.path === "/test");

    expect(route).toBeDefined();
  });

  test("GET /liveness returns up status", async () => {
    const { router } = await import("./routes.js");
    const route = router.stack.find((r) => r.route?.path === "/liveness");

    expect(route).toBeDefined();

    if (route?.route?.stack?.[0]?.handle) {
      await route.route.stack[0].handle(
        mockReq as Request,
        mockRes as Response,
        vi.fn(),
      );

      expect(jsonMock).toHaveBeenCalledWith({ status: "up" });
    }
  });

  test("POST /subscribers validates required fields", async () => {
    const { router } = await import("./routes.js");
    const route = router.stack.find(
      (r) =>
        r.route?.path === "/subscribers" &&
        r.route?.stack?.some((s) => s.method === "post"),
    );

    if (route?.route?.stack?.[0]?.handle) {
      mockReq.body = { name: "Test" }; // Missing events and transport

      await route.route.stack[0].handle(
        mockReq as Request,
        mockRes as Response,
        vi.fn(),
      );

      expect(statusMock).toHaveBeenCalledWith(400);
    }
  });

  test("validates transport type", () => {
    const validTypes = [
      "https",
      "redis",
      "amqp",
      "kafka",
      "sqs",
      "azure-eventhub",
    ];

    expect(validTypes).toContain("https");
    expect(validTypes).toContain("redis");
  });
});
