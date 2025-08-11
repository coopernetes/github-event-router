import crypto from "crypto";
import http from "http";

const webhookSecret = process.argv[2];
if (!webhookSecret) {
  console.error("Please provide a webhook secret as an argument");
  console.error("Usage: node generate-webhook-headers.js <webhook_secret>");
  process.exit(1);
}

// Sample push event payload
const payload = JSON.stringify(
  {
    ref: "refs/heads/main",
    before: "6113728f27ae82c7b1a177c8d03f9e96e0adf246",
    after: "76454c8417b754e33dd4e4a55baa38a1bee68068",
    repository: {
      id: 123456,
      name: "github-event-router",
      full_name: "owner/github-event-router",
      private: false,
      owner: {
        name: "owner",
        email: "owner@example.com",
      },
    },
    pusher: {
      name: "owner",
      email: "owner@example.com",
    },
    commits: [
      {
        id: "76454c8417b754e33dd4e4a55baa38a1bee68068",
        message: "Test commit",
        timestamp: new Date().toISOString(),
        author: {
          name: "Test Author",
          email: "author@example.com",
        },
      },
    ],
  },
  null,
  2
);

// Generate headers
const signature = crypto
  .createHmac("sha256", webhookSecret)
  .update(payload)
  .digest("hex");

const headers = {
  "x-github-event": "push",
  "x-hub-signature-256": `sha256=${signature}`,
  "x-github-delivery": crypto.randomUUID(),
  "content-type": "application/json",
  "user-agent": "GitHub-Hookshot/test",
  "content-length": Buffer.byteLength(payload),
};

console.log("=== Sending Webhook ===");
console.log("Headers:", headers);
console.log("Payload:", payload);

const options = {
  hostname: "localhost",
  port: 8080,
  path: "/webhook",
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
    console.log(`Status: ${res.statusCode}`);
    console.log("Headers:", res.headers);
    console.log("Body:", data);
  });
});

req.on("error", (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(payload);
req.end();
