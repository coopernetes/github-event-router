import express from "express";
import { loadConfig, setAppConfig } from "./config.js";
import { router as apiRoutes } from "./routes.js";

export function startServer() {
  const app = express();
  const config = loadConfig();
  setAppConfig(config);

  // Parse JSON for all routes
  app.use(express.json());

  // Simple test route at root
  app.get("/", (req, res) => {
    res.json({ message: "Server is running" });
  });

  // API Routes
  app.use("/api/v1", apiRoutes);

  // Start the server
  const port = config.server.port || 8080;
  app.listen(port, () => {
    console.log(`App ID: ${config.app.id}`);
    console.log(`Webhook Secret: ${config.app.webhook_secret}`);
    console.log(`Server is running on port ${port}`);
  });
}
