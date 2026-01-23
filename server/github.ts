/**
 * GitHub Webhook Handler
 * 
 * Receives GitHub webhook events and routes them through the event processing pipeline.
 * Supports two modes:
 * 1. Queue-based (recommended): Events are ingested and queued for async processing
 * 2. Direct (legacy): Events are processed synchronously in the request handler
 */
import express, { type Express, type Request, type Response } from "express";
import { getAppConfig } from "./config.js";
import { EventProcessor } from "./event-processor.js";
import { EventIngestionService } from "./event-ingestion.js";
import { EventWorkerService } from "./event-worker.js";
import { WebhookSecurity } from "./webhook-security.js";
import { type GitHubEvent } from "./transport.js";
import { trace } from "@opentelemetry/api";
import { getAppMetrics } from "./telemetry.js";

const tracer = trace.getTracer("github-event-router");

// Services - will be initialized by setupWebhooks
let ingestionService: EventIngestionService | null = null;
let workerService: EventWorkerService | null = null;
let eventProcessor: EventProcessor | null = null;

/**
 * Get the ingestion service (for external access if needed)
 */
export function getIngestionService(): EventIngestionService | null {
  return ingestionService;
}

/**
 * Get the worker service (for external access if needed)
 */
export function getWorkerService(): EventWorkerService | null {
  return workerService;
}

export async function setupWebhooks(app: Express): Promise<void> {
  const config = getAppConfig();
  const webhookSecurity = new WebhookSecurity(config.security);

  // Initialize the ingestion service
  ingestionService = new EventIngestionService(config);
  await ingestionService.initialize();

  // If queue is enabled, start the worker service
  if (ingestionService.isQueueEnabled()) {
    const queue = ingestionService.getQueue();
    if (queue) {
      workerService = new EventWorkerService(config, queue);
      workerService.start();
      console.log("Queue-based event processing enabled");
    }
  } else {
    // Fall back to legacy direct processing
    eventProcessor = new EventProcessor(config);
    eventProcessor.startRetryProcessor();
    console.log("Direct event processing enabled (queue disabled)");
  }

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
          span.setAttribute("processing.mode", ingestionService?.isQueueEnabled() ? "queue" : "direct");

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

          // Process based on mode
          if (ingestionService?.isQueueEnabled()) {
            // Queue-based processing - ingest and return quickly
            const result = await ingestionService.ingestEvent(githubEvent);
            
            const processingDuration = Date.now() - startTime;
            metrics.eventProcessingDuration.record(processingDuration, {
              event_type: eventType,
            });

            span.setAttribute("event.id", result.eventId);
            span.setAttribute("subscribers.matched", result.subscribersMatched);
            span.setAttribute("processing.duration_ms", processingDuration);
            span.end();

            // Return 202 Accepted - event is queued for processing
            return res.status(202).json({
              message: result.subscribersMatched === 0
                ? "No subscribers for this event"
                : "Event accepted for processing",
              eventId: result.eventId,
              subscribers: result.subscribersMatched,
              queued: result.queued,
            });
          } else {
            // Legacy direct processing
            const results = await eventProcessor!.processEvent(githubEvent);

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
            
            return res.status(statusCode).json({
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
          }
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
}

/**
 * Cleanup function for graceful shutdown
 */
export async function cleanupWebhooks(): Promise<void> {
  console.log("Cleaning up webhook services...");
  
  if (workerService) {
    await workerService.stop();
  }
  
  if (ingestionService) {
    await ingestionService.shutdown();
  }
  
  if (eventProcessor) {
    eventProcessor.stopRetryProcessor();
    eventProcessor.close();
  }
  
  console.log("Webhook services cleaned up");
}
