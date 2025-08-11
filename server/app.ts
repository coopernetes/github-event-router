import { loadConfig, setAppConfig } from "./config.js";

export function startServer() {
  const config = loadConfig();
  setAppConfig(config);
  console.log("Starting server...");
  console.log(`App ID: ${config.app.id}`);
  console.log(`Client ID: ${config.app.client_id}`);
  console.log(`Webhook Secret: ${config.app.webhook_secret}`);
}
