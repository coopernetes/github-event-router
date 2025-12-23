import express, { type Express, type Request, type Response } from "express";
import { getAppConfig } from "./config.js";
import { EventProcessor } from "./event-processor.js";
import { WebhookSecurity } from "./webhook-security.js";
import { type GitHubEvent } from "./transport.js";
import { trace, context } from "@opentelemetry/api";
import { getAppMetrics } from "./telemetry.js";

const tracer = trace.getTracer("github-event-router");

export function setupWebhooks(app: Express): void {
  const config = getAppConfig();
  const eventProcessor = new EventProcessor(config);
  const webhookSecurity = new WebhookSecurity(config.security);

  // Start the retry processor
  eventProcessor.startRetryProcessor();

  app.post(
    "/webhook/github",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const startTime = Date.now();
      
      // Start a span for webhook processing
      return tracer.startActiveSpan("webhook.github.receive", async (span) => {
        try {
          // Record webhook received metric
          const metrics = getAppMetrics();
          metrics.webhookEventsReceived.add(1);

          // Extract event information early for span attributes
          const eventType = req.header("x-github-event");
          const deliveryId = req.header("x-github-delivery");
          
          span.setAttribute("github.event.type", eventType || "unknown");
          span.setAttribute("github.delivery.id", deliveryId || "unknown");

          // Security validation
          const securityResult = await webhookSecurity.validateRequest(
            req,
            config.app.webhook_secret
          );
          if (!securityResult.valid) {
            span.setAttribute("error", true);
            span.setAttribute("error.message", securityResult.error || "Security validation failed");
            span.end();
            return res.status(securityResult.statusCode || 400).json({
              error: securityResult.error,
            });
          }

          if (!eventType || !deliveryId) {
            span.setAttribute("error", true);
            span.setAttribute("error.message", "Missing required headers");
            span.end();
            return res.status(400).json({ error: "Missing required headers" });
          }

          // Parse payload
          const rawBody = req.body.toString("utf8");
          let payload: Record<string, unknown>;

          try {
            payload = JSON.parse(rawBody);
          } catch {
            span.setAttribute("error", true);
            span.setAttribute("error.message", "Invalid JSON payload");
            span.end();
            return res.status(400).json({ error: "Invalid JSON payload" });
          }

          // Collect headers to forward
          const forwardHeaders: Record<string, string> = {};
          const headersToForward = [
            "x-github-event",
            "x-hub-signature-256",
            "x-github-delivery",
            "content-type",
            "user-agent",
          ];

          headersToForward.forEach((header) => {
            const value = req.header(header);
            if (value) {
              forwardHeaders[header] = value;
            }
          });

          // Create GitHub event object
          const githubEvent: GitHubEvent = {
            id: deliveryId,
            type: eventType,
            payload,
            headers: forwardHeaders,
            receivedAt: new Date(),
          };

          // Process the event
          const results = await eventProcessor.processEvent(githubEvent);

          // Record processing metrics
          const processingDuration = Date.now() - startTime;
          metrics.eventProcessingDuration.record(processingDuration, {
            event_type: eventType,
          });
          metrics.webhookEventsProcessed.add(1, {
            event_type: eventType,
          });

          // Add span attributes for results
          span.setAttribute("subscribers.total", results.length);
          span.setAttribute("subscribers.successful", results.filter((r) => r.success).length);
          span.setAttribute("subscribers.failed", results.filter((r) => !r.success).length);
          span.setAttribute("processing.duration_ms", processingDuration);

          // Return response based on results
          const hasFailures = results.some((r) => !r.success);
          const hasRetries = results.some((r) => r.nextRetryAt);

          let statusCode = 200;
          if (hasFailures && !hasRetries) {
            statusCode = 500; // Complete failure
            span.setAttribute("error", true);
          } else if (hasFailures && hasRetries) {
            statusCode = 202; // Partial failure with retries
          }

          span.end();
          
          res.status(statusCode).json({
            message:
              results.length === 0
                ? "No subscribers for this event"
                : "Event processed",
            subscribers: results.length,
            successful: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            retries: results.filter((r) => r.nextRetryAt).length,
            results:
              config.monitoring.log_level === "debug" ? results : undefined,
          });
        } catch (error) {
          span.setAttribute("error", true);
          span.setAttribute("error.message", error instanceof Error ? error.message : "Unknown error");
          span.end();
          
          console.error("Webhook processing error:", error);
          res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });
    }
  );

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    eventProcessor.stopRetryProcessor();
    eventProcessor.close();
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
