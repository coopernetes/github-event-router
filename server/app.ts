import express from "express";
import { loadConfig, setAppConfig } from "./config.js";
import { setupWebhooks } from "./github.js";

export function startServer() {
  const config = loadConfig();
  setAppConfig(config);
  const app = express();
  setupWebhooks(app);

  console.log(`App ID: ${config.app.id}`);
  console.log(`Webhook Secret: ${config.app.webhook_secret}`);
  
  app.listen(config.server.port, () => {
    console.log(`Server is listening on port ${config.server.port}`);
  });
}
