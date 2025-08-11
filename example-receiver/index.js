const express = require("express");
const { Webhooks, createNodeMiddleware } = require("@octokit/webhooks");
require("dotenv").config({ quiet: true });

const app = express();
const webhooks = new Webhooks({
  secret: process.env.WEBHOOK_SECRET,
});

// Log all events
webhooks.onAny(({ id, name, payload }) => {
  console.log("Received webhook", name, "with id", id);
  console.log("Payload:", JSON.stringify(payload));
  if (Math.random() < 0.2) {
    throw new Error("Random error");
  }
});

app.use(createNodeMiddleware(webhooks));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
});
