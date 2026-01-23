#!/usr/bin/env node

import crypto from "crypto";
import http from "http";
import fs from "fs";
import path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
let payloadFile = args[0];
let webhookSecret = args[1] || "foobarbaz123";
let eventType = args[2];

if (!payloadFile) {
  console.error(
    "Usage: node send-test-webhook.js <payload-file> [webhook-secret] [event-type]",
  );
  console.error("");
  console.error("Arguments:");
  console.error(
    "  payload-file    - Path to JSON file containing the webhook payload",
  );
  console.error("  webhook-secret  - Webhook secret (default: foobarbaz123)");
  console.error(
    "  event-type      - GitHub event type (default: auto-detect from filename or 'push')",
  );
  console.error("");
  console.error("Example:");
  console.error("  node send-test-webhook.js payloads/push.json");
  console.error(
    "  node send-test-webhook.js payloads/pull_request.json mySecret pull_request",
  );
  process.exit(1);
}

// Read and parse payload file
let payload;
try {
  const payloadContent = fs.readFileSync(payloadFile, "utf8");
  payload = JSON.parse(payloadContent);
} catch (error) {
  console.error(`Error reading payload file: ${error.message}`);
  process.exit(1);
}

// Auto-detect event type from filename if not provided
if (!eventType) {
  const filename = path.basename(payloadFile, ".json");
  // Try to extract event name from filename (e.g., "push.json", "pull_request-opened.json")
  const match = filename.match(/^([a-z_]+)/);
  eventType = match ? match[1] : "push";
}

// Prepare payload string
const payloadString = JSON.stringify(payload);

// Generate signature
const signature = crypto
  .createHmac("sha256", webhookSecret)
  .update(payloadString)
  .digest("hex");

// Prepare headers
const headers = {
  "x-github-event": eventType,
  "x-hub-signature-256": `sha256=${signature}`,
  "x-github-delivery": crypto.randomUUID(),
  "content-type": "application/json",
  "user-agent": "GitHub-Hookshot/test",
  "content-length": Buffer.byteLength(payloadString),
};

console.log("=== Sending Test Webhook ===");
console.log(`Event Type: ${eventType}`);
console.log(`Payload File: ${payloadFile}`);
console.log(`Payload Size: ${Buffer.byteLength(payloadString)} bytes`);
console.log("");

// Send request
const options = {
  hostname: "localhost",
  port: 8080,
  path: "/webhook/github",
  method: "POST",
  headers,
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    console.log("=== Response ===");
    console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
    if (data) {
      try {
        console.log("Body:", JSON.stringify(JSON.parse(data), null, 2));
      } catch {
        console.log("Body:", data);
      }
    }
    console.log("");
    console.log(res.statusCode === 200 ? "✅ Success!" : "❌ Failed");
  });
});

req.on("error", (e) => {
  console.error(`❌ Error: ${e.message}`);
  process.exit(1);
});

req.write(payloadString);
req.end();
