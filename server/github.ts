import express, { type Express, type Request, type Response } from "express";
import { getAppConfig } from "./config.js";
import { getSubscribers, type HttpsTransportConfig } from "./subscriber.js";
import axios from "axios";
import crypto from "crypto";

const GITHUB_WEBHOOK_HEADERS = [
  "x-github-event",
  "x-hub-signature-256",
  "x-github-delivery",
  "content-type",
  "user-agent",
];

function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// Update the generateSubscriberHeaders function
function generateSubscriberHeaders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any, // Change parameter type to accept parsed JSON
  originalHeaders: Record<string, string>,
  subscriberSecret: string
): Record<string, string> {
  // Ensure consistent string representation
  const payloadString = JSON.stringify(payload);

  // Create new signature with subscriber's secret
  const hmac = crypto.createHmac("sha256", subscriberSecret);
  const signature = "sha256=" + hmac.update(payloadString).digest("hex");

  return {
    ...originalHeaders,
    "x-hub-signature-256": signature,
    "x-github-event-router": "true",
    // Ensure content-length is correct for the actual payload
    "content-length": Buffer.from(payloadString).length.toString(),
  };
}

export function setupWebhooks(app: Express): void {
  const config = getAppConfig();

  app.post(
    "/webhook/github",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const signature = req.header("x-hub-signature-256");
      const event = req.header("x-github-event");
      const delivery = req.header("x-github-delivery");

      // Verify required headers
      if (!signature || !event || !delivery) {
        return res.status(400).json({ error: "Missing required headers" });
      }

      // Verify signature
      const rawBody = req.body.toString("utf8");
      if (!verifySignature(rawBody, signature, config.app.webhook_secret)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Collect headers to forward
      const forwardHeaders: Record<string, string> = {};
      GITHUB_WEBHOOK_HEADERS.forEach((header) => {
        const value = req.header(header);
        if (value) {
          forwardHeaders[header] = value;
        }
      });

      // Parse body only after verification
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        console.error("Failed to parse JSON payload:", err);
        return res.status(400).json({ error: "Invalid JSON payload" });
      }

      const subscriberPromises = [];
      // Forward to subscribers asynchronously
      const subscribers = getSubscribers();
      for (const subscriber of subscribers) {
        if (subscriber.events.includes(event)) {
          subscriberPromises.push(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (async (): Promise<{ data: any; status: number }> => {
              const transportConfig = subscriber.transport
                ?.config as HttpsTransportConfig;
              try {
                const payloadToSend = JSON.stringify(payload);
                const subscriberHeaders = generateSubscriberHeaders(
                  payload,
                  forwardHeaders,
                  transportConfig.webhook_secret
                );

                const response = await axios.post(
                  transportConfig.url,
                  payloadToSend,
                  {
                    headers: subscriberHeaders,
                    // Ensure axios doesn't modify the payload
                    transformRequest: [(data) => data],
                    timeout: 5000,
                  }
                );
                return Promise.resolve({
                  data: response.data,
                  status: response.status,
                });
              } catch (error) {
                if (axios.isAxiosError(error) && error.response) {
                  console.error(
                    `Failed to notify subscriber ${transportConfig.url}: ${error.response?.statusText}`,
                    error.response?.data || error.message
                  );
                  return {
                    data: error.response.data,
                    status: error.response.status,
                  };
                }
                // re-throw any non-axios errors so that it is captured by the Promise
                throw error;
              }
            })()
          );
        }
      }
      const subscriberResults = await Promise.allSettled(subscriberPromises);
      let parentStatus = 200;
      let error: Error | null = null;
      const responses = [];
      for (const result of subscriberResults) {
        if (result.status === "rejected") {
          parentStatus = 500;
          error = result.reason;
        }
        if (result.status === "fulfilled") {
          responses.push(result.value);
          if (result.value.status >= 400) {
            parentStatus = Math.max(parentStatus, result.value.status);
          }
        }
      }
      if (error) {
        res.status(500).json({
          error: "Failed to notify subscribers",
        });
      }
      res.status(parentStatus).json({
        responses,
      });
    }
  );

  app.use((req, res, next) => {
    // GitHub webhook middleware - signature verification could go here
    next();
  });
}
