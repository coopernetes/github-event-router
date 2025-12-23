import express from "express";
import { loadConfig, setAppConfig } from "./config.js";
import { router as apiRoutes } from "./routes.js";
import { setupWebhooks } from "./github.js";
import {
  initializeTelemetry,
  shutdownTelemetry,
  createAppMetrics,
} from "./telemetry.js";
import { getSubscribers } from "./subscriber.js";
import Database from "better-sqlite3";

export function startServer() {
  // Initialize OpenTelemetry first
  initializeTelemetry();

  const app = express();
  const config = loadConfig();
  setAppConfig(config);

  // Initialize database connection for metrics
  const db = new Database(config.database?.filename || "./database.sqlite");
  db.pragma("journal_mode = WAL");

  // Create metrics with callback functions
  createAppMetrics(
    () => {
      // Get queue depth
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM events
        WHERE status IN ('pending', 'processing')
      `);
      const result = stmt.get() as { count: number };
      return result?.count || 0;
    },
    () => {
      // Get retry queue depth
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM delivery_attempts
        WHERE next_retry_at IS NOT NULL
        AND datetime(next_retry_at) > datetime('now')
      `);
      const result = stmt.get() as { count: number };
      return result?.count || 0;
    },
    () => {
      // Get active subscribers
      const subscribers = getSubscribers();
      return subscribers.filter(
        (sub) => sub.transport && sub.transport.config && sub.events.length > 0
      ).length;
    }
  );

  // Setup GitHub webhook handling BEFORE general JSON parsing
  // This ensures the webhook route gets raw body parsing
  setupWebhooks(app);

  // Parse JSON for all other routes
  app.use(express.json());

  // Simple test route at root
  app.get("/", (req, res) => {
    res.json({ message: "Server is running" });
  });

  // API Routes
  app.use("/api/v1", apiRoutes);

  // Start the server
  const port = config.server.port || 8080;
  const server = app.listen(port, () => {
    console.log(`Webhook Secret: ${config.app.webhook_secret.substring(0, 4)}...`);
    console.log(`Server is running on port ${port}`);
  });

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

    // Shutdown telemetry
    try {
      await shutdownTelemetry();
      console.log("Telemetry shutdown complete");
    } catch (error) {
      console.error("Error shutting down telemetry:", error);
    }

    // Close database connection
    try {
      db.close();
      console.log("Database connection closed");
    } catch (error) {
      console.error("Error closing database:", error);
    }

    server.close((err) => {
      if (err) {
        console.error("Error during server close:", err);
        process.exit(1);
      } else {
        console.log("Server closed successfully");
        process.exit(0);
      }
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.log("Force shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  // Handle various shutdown signals
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // nodemon uses this
}
