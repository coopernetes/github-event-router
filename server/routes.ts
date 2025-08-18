import { Router } from "express";
import {
  getSubscribers,
  refreshSubscribers,
  createSubscriber,
  updateSubscriber,
  deleteSubscriber,
  type TransportName,
  type HttpsTransportConfig,
  type RedisTransportConfig,
} from "./subscriber.js";
import { HealthMonitor } from "./health-monitor.js";
import { getAppConfig } from "./config.js";

// Health monitor will be initialized lazily
let healthMonitor: HealthMonitor | null = null;

function getHealthMonitor(): HealthMonitor {
  if (!healthMonitor) {
    const config = getAppConfig();
    healthMonitor = new HealthMonitor(config);
  }
  return healthMonitor;
}

// Type guards for validation
type UnknownConfig = {
  [key: string]: unknown;
  url?: unknown;
  webhook_secret?: unknown;
  password?: unknown;
};

// Input validation utilities
function isValidTransportName(name: string): name is TransportName {
  return ["https", "redis"].includes(name);
}

function isValidTransportConfig(
  name: TransportName,
  config: unknown
): config is HttpsTransportConfig | RedisTransportConfig {
  if (!config || typeof config !== "object") return false;

  const unknownConfig = config as UnknownConfig;
  if (name === "https") {
    return (
      typeof unknownConfig.url === "string" &&
      typeof unknownConfig.webhook_secret === "string" &&
      Object.keys(unknownConfig).length === 2
    );
  } else if (name === "redis") {
    return (
      typeof unknownConfig.url === "string" &&
      typeof unknownConfig.password === "string" &&
      Object.keys(unknownConfig).length === 2
    );
  }
  return false;
}

function isValidEvents(events: unknown): events is string[] {
  return (
    Array.isArray(events) &&
    events.every((event) => typeof event === "string") &&
    events.length > 0
  );
}

export const router = Router();

// Test route
router.get("/test", (req, res) => {
  res.json({ message: "Router is working" });
});

router.get("/readiness", async (req, res) => {
  try {
    const monitor = getHealthMonitor();
    const health = await monitor.getSystemHealth();
    const isHealthy = monitor.isHealthy();

    res.status(isHealthy ? 200 : 503).json({
      ready: isHealthy ? "up" : "degraded",
      health,
      summary: monitor.getHealthSummary(),
    });
  } catch (error) {
    res.status(503).json({
      ready: "down",
      error: error instanceof Error ? error.message : "Health check failed",
    });
  }
});

router.get("/liveness", (req, res) => {
  res.json({ status: "up" });
});

router.get("/subscribers", (req, res) => {
  try {
    // Add no-cache headers to prevent stale data issues during development
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const subscribers = getSubscribers();
    res.json(subscribers);
  } catch (error) {
    console.error("Failed to get subscribers:", error);
    res.status(500).json({ error: "Failed to get subscribers" });
  }
});

// Create new subscriber
router.post("/subscribers", (req, res) => {
  try {
    const { name, events, transport } = req.body;

    // Validate required fields
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Invalid or missing name" });
    }

    if (!isValidEvents(events)) {
      return res.status(400).json({ error: "Invalid or missing events array" });
    }

    if (!transport || typeof transport !== "object") {
      return res
        .status(400)
        .json({ error: "Invalid or missing transport configuration" });
    }

    if (!isValidTransportName(transport.name)) {
      return res.status(400).json({ error: "Invalid transport type" });
    }

    if (!isValidTransportConfig(transport.name, transport.config)) {
      return res.status(400).json({ error: "Invalid transport configuration" });
    }

    const subscriber = createSubscriber(name, events, transport);
    res.status(201).json(subscriber);
  } catch (error) {
    console.error("Failed to create subscriber:", error);
    res.status(500).json({ error: "Failed to create subscriber" });
  }
});

// Update existing subscriber
router.put("/subscribers/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid subscriber ID" });
    }

    const updates = req.body;
    if (typeof updates !== "object" || updates === null) {
      return res.status(400).json({ error: "Invalid update payload" });
    }

    // Validate fields if they exist
    if ("name" in updates && typeof updates.name !== "string") {
      return res.status(400).json({ error: "Invalid name" });
    }

    if ("events" in updates && !isValidEvents(updates.events)) {
      return res.status(400).json({ error: "Invalid events array" });
    }

    if ("transport" in updates) {
      if (!isValidTransportName(updates.transport.name)) {
        return res.status(400).json({ error: "Invalid transport type" });
      }
      if (
        !isValidTransportConfig(
          updates.transport.name,
          updates.transport.config
        )
      ) {
        return res
          .status(400)
          .json({ error: "Invalid transport configuration" });
      }
    }

    const subscriber = updateSubscriber(id, updates);
    res.json(subscriber);
  } catch (error) {
    console.error("Failed to update subscriber:", error);
    res.status(500).json({ error: "Failed to update subscriber" });
  }
});

// Delete subscriber
router.delete("/subscribers/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid subscriber ID" });
    }

    deleteSubscriber(id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete subscriber:", error);
    res.status(500).json({ error: "Failed to delete subscriber" });
  }
});

router.post("/api/v1/refresh", (req, res) => {
  try {
    refreshSubscribers();
    res.status(200).send();
  } catch (error) {
    console.error("Failed to refresh subscribers:", error);
    res.status(500).json({
      error: "Failed to refresh subscribers",
    });
  }
});
