import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, setAppConfig } from "./config.js";
import { router as apiRoutes } from "./routes.js";
import { setupWebhooks } from "./github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startServer() {
  const app = express();
  const config = loadConfig();
  setAppConfig(config);

  // Setup GitHub webhook handling BEFORE general JSON parsing
  // This ensures the webhook route gets raw body parsing
  setupWebhooks(app);

  // Parse JSON for all other routes
  app.use(express.json());

  // API Routes
  app.use("/api/v1", apiRoutes);

  // Serve static files from the UI build directory
  // From dist/server/server/ we need to go up 3 levels to reach project root, then ui/dist
  const uiDistPath = path.join(__dirname, "..", "..", "..", "ui", "dist");
  app.use(express.static(uiDistPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/") && !req.path.includes(".")) {
      res.sendFile(path.join(uiDistPath, "index.html"));
    } else {
      next();
    }
  });

  // Start the server
  const port = config.server.port || 8080;
  const server = app.listen(port, () => {
    console.log(`Webhook Secret: ${config.app.webhook_secret.substring(0, 4)}...`);
    console.log(`Server is running on port ${port}`);
  });

  // Graceful shutdown handling
  const gracefulShutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

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
