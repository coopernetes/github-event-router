import { startServer } from "./app.js";
import { runMigrations } from "./migrate.js";

async function main() {
  try {
    // Run database migrations before starting the server
    await runMigrations();

    // Start the server
    startServer();
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

main();
