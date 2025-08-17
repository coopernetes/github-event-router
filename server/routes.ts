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

router.get("/api/v1/readiness", (req, res) => {
  res.json({ ready: "up" });
});

router.get("/api/v1/liveness", (req, res) => {
  res.json({ status: "up" });
});

router.get("/api/v1/subscribers", (req, res) => {
  try {
    const subscribers = getSubscribers();
    res.json(subscribers);
  } catch (error) {
    console.error("Failed to get subscribers:", error);
    res.status(500).json({ error: "Failed to get subscribers" });
  }
});

// Create new subscriber
router.post("/api/v1/subscribers", (req, res) => {
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
router.put("/api/v1/subscribers/:id", (req, res) => {
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
router.delete("/api/v1/subscribers/:id", (req, res) => {
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
