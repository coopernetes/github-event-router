import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { Meter, Counter, Histogram, ObservableGauge } from "@opentelemetry/api";
import { metrics } from "@opentelemetry/api";

// Prometheus exporter configuration
const prometheusExporter = new PrometheusExporter(
  {
    port: 9464, // Standard Prometheus port
  },
  () => {
    console.log("Prometheus scrape endpoint available at http://localhost:9464/metrics");
  }
);

// OpenTelemetry SDK configuration
let sdk: NodeSDK | null = null;
let meterProvider: MeterProvider | null = null;

export function initializeTelemetry(): void {
  // Create MeterProvider with Prometheus exporter
  // PrometheusExporter works differently - it creates its own HTTP server
  meterProvider = new MeterProvider({
    readers: [prometheusExporter],
  });

  // Set global meter provider
  metrics.setGlobalMeterProvider(meterProvider);

  // Initialize OpenTelemetry SDK with tracing
  sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({
        requestHook: (span, request) => {
          // Add custom attributes to HTTP spans
          span.setAttribute("http.route", (request as { route?: { path: string } }).route?.path || "unknown");
        },
      }),
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();
  console.log("OpenTelemetry SDK initialized with tracing and metrics");
}

export function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

// Metrics interface
export interface AppMetrics {
  webhookEventsReceived: Counter;
  webhookEventsProcessed: Counter;
  eventProcessingDuration: Histogram;
  deliveryAttempts: Counter;
  deliverySuccess: Counter;
  deliveryFailure: Counter;
  queueDepth: ObservableGauge;
  retryQueueDepth: ObservableGauge;
  activeSubscribers: ObservableGauge;
  databaseLatency: Histogram;
  transportDeliveryDuration: Histogram;
}

let appMetrics: AppMetrics | null = null;

export function createAppMetrics(
  getQueueDepth: () => number,
  getRetryQueueDepth: () => number,
  getActiveSubscribers: () => number
): AppMetrics {
  const meter: Meter = metrics.getMeter("github-event-router");

  appMetrics = {
    // Counter: Total webhook events received
    webhookEventsReceived: meter.createCounter("webhook.events.received", {
      description: "Total number of webhook events received from GitHub",
      unit: "1",
    }),

    // Counter: Total webhook events processed
    webhookEventsProcessed: meter.createCounter("webhook.events.processed", {
      description: "Total number of webhook events processed",
      unit: "1",
    }),

    // Histogram: Event processing duration
    eventProcessingDuration: meter.createHistogram(
      "event.processing.duration",
      {
        description: "Duration of event processing in milliseconds",
        unit: "ms",
      }
    ),

    // Counter: Total delivery attempts
    deliveryAttempts: meter.createCounter("delivery.attempts", {
      description: "Total number of delivery attempts to subscribers",
      unit: "1",
    }),

    // Counter: Successful deliveries
    deliverySuccess: meter.createCounter("delivery.success", {
      description: "Total number of successful deliveries",
      unit: "1",
    }),

    // Counter: Failed deliveries
    deliveryFailure: meter.createCounter("delivery.failure", {
      description: "Total number of failed deliveries",
      unit: "1",
    }),

    // Gauge: Current queue depth
    queueDepth: meter.createObservableGauge("queue.depth", {
      description: "Current number of events in the processing queue",
      unit: "1",
    }),

    // Gauge: Current retry queue depth
    retryQueueDepth: meter.createObservableGauge("retry.queue.depth", {
      description: "Current number of events in the retry queue",
      unit: "1",
    }),

    // Gauge: Active subscribers
    activeSubscribers: meter.createObservableGauge("subscribers.active", {
      description: "Current number of active subscribers",
      unit: "1",
    }),

    // Histogram: Database operation latency
    databaseLatency: meter.createHistogram("database.latency", {
      description: "Database operation latency in milliseconds",
      unit: "ms",
    }),

    // Histogram: Transport delivery duration
    transportDeliveryDuration: meter.createHistogram(
      "transport.delivery.duration",
      {
        description: "Duration of transport delivery operations in milliseconds",
        unit: "ms",
      }
    ),
  };

  // Register observable callbacks for gauges
  appMetrics.queueDepth.addCallback((observableResult) => {
    observableResult.observe(getQueueDepth());
  });

  appMetrics.retryQueueDepth.addCallback((observableResult) => {
    observableResult.observe(getRetryQueueDepth());
  });

  appMetrics.activeSubscribers.addCallback((observableResult) => {
    observableResult.observe(getActiveSubscribers());
  });

  return appMetrics;
}

export function getAppMetrics(): AppMetrics {
  if (!appMetrics) {
    throw new Error(
      "App metrics not initialized. Call createAppMetrics() first."
    );
  }
  return appMetrics;
}
