/**
 * AWS SQS transport for delivering events to subscribers
 */
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  SQSTransportConfig,
  TransportConfig,
} from "./interface.js";

export class SQSTransport implements ITransport {
  private config: Config;
  private clients: Map<string, SQSClient> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "sqs";
  }

  validateConfig(config: unknown): config is SQSTransportConfig {
    if (!config || typeof config !== "object") return false;
    const sqsConfig = config as SQSTransportConfig;
    return (
      typeof sqsConfig.region === "string" &&
      typeof sqsConfig.queueUrl === "string"
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const sqsConfig = transportConfig as SQSTransportConfig;

    if (!this.validateConfig(sqsConfig)) {
      return {
        success: false,
        error: "Invalid SQS transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Get or create SQS client for this region
      let client = this.clients.get(sqsConfig.region);

      if (!client) {
        const clientConfig: {
          region: string;
          credentials?: {
            accessKeyId: string;
            secretAccessKey: string;
          };
        } = {
          region: sqsConfig.region,
        };

        if (sqsConfig.accessKeyId && sqsConfig.secretAccessKey) {
          clientConfig.credentials = {
            accessKeyId: sqsConfig.accessKeyId,
            secretAccessKey: sqsConfig.secretAccessKey,
          };
        }

        client = new SQSClient(clientConfig);
        this.clients.set(sqsConfig.region, client);
      }

      // Prepare message for SQS
      const message = {
        event: event.type,
        payload: event.payload,
        headers: event.headers,
        deliveryId: event.id,
        timestamp: event.receivedAt.toISOString(),
      };

      // Send to SQS queue
      const command = new SendMessageCommand({
        QueueUrl: sqsConfig.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          EventType: {
            DataType: "String",
            StringValue: event.type,
          },
          DeliveryId: {
            DataType: "String",
            StringValue: event.id,
          },
        },
      });

      await client.send(command);

      return {
        success: true,
        statusCode: 200,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "SQS delivery failed",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }
  }

  async close(): Promise<void> {
    // Destroy all SQS clients
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}
