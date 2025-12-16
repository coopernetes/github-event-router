/**
 * Azure Event Hub transport for delivering events to subscribers
 */
import { EventHubProducerClient } from "@azure/event-hubs";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  AzureEventHubTransportConfig,
  TransportConfig,
} from "./interface.js";

export class AzureEventHubTransport implements ITransport {
  private config: Config;
  private clients: Map<string, EventHubProducerClient> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "azure-eventhub";
  }

  validateConfig(config: unknown): config is AzureEventHubTransportConfig {
    if (!config || typeof config !== "object") return false;
    const azureConfig = config as AzureEventHubTransportConfig;
    return (
      typeof azureConfig.connectionString === "string" &&
      typeof azureConfig.eventHubName === "string"
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const azureConfig = transportConfig as AzureEventHubTransportConfig;

    if (!this.validateConfig(azureConfig)) {
      return {
        success: false,
        error: "Invalid Azure Event Hub transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Get or create Event Hub client
      const clientKey = `${azureConfig.connectionString}:${azureConfig.eventHubName}`;
      let client = this.clients.get(clientKey);

      if (!client) {
        client = new EventHubProducerClient(
          azureConfig.connectionString,
          azureConfig.eventHubName
        );
        this.clients.set(clientKey, client);
      }

      // Prepare message for Event Hub
      const message = {
        event: event.type,
        payload: event.payload,
        headers: event.headers,
        deliveryId: event.id,
        timestamp: event.receivedAt.toISOString(),
      };

      // Send to Event Hub
      const batch = await client.createBatch();
      batch.tryAdd({
        body: message,
        properties: {
          eventType: event.type,
          deliveryId: event.id,
        },
      });

      await client.sendBatch(batch);

      return {
        success: true,
        statusCode: 200,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Azure Event Hub delivery failed",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }
  }

  async close(): Promise<void> {
    // Close all Event Hub clients
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
