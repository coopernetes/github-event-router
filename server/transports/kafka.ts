/**
 * Kafka transport for delivering events to subscribers
 */
import { Kafka, type Producer } from "kafkajs";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  KafkaTransportConfig,
  TransportConfig,
} from "./interface.js";

export class KafkaTransport implements ITransport {
  private config: Config;
  private producers: Map<string, Producer> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "kafka";
  }

  validateConfig(config: unknown): config is KafkaTransportConfig {
    if (!config || typeof config !== "object") return false;
    const kafkaConfig = config as KafkaTransportConfig;
    return (
      Array.isArray(kafkaConfig.brokers) &&
      kafkaConfig.brokers.length > 0 &&
      typeof kafkaConfig.topic === "string"
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const kafkaConfig = transportConfig as KafkaTransportConfig;

    if (!this.validateConfig(kafkaConfig)) {
      return {
        success: false,
        error: "Invalid Kafka transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Get or create Kafka producer for this broker set
      const brokerKey = kafkaConfig.brokers.join(",");
      let producer = this.producers.get(brokerKey);

      if (!producer) {
        const kafkaInitConfig: {
          clientId: string;
          brokers: string[];
          ssl?: boolean;
          sasl?:
            | { mechanism: "plain"; username: string; password: string }
            | { mechanism: "scram-sha-256"; username: string; password: string }
            | { mechanism: "scram-sha-512"; username: string; password: string };
        } = {
          clientId: kafkaConfig.clientId || "github-event-router-subscriber",
          brokers: kafkaConfig.brokers,
        };

        if (kafkaConfig.ssl !== undefined) {
          kafkaInitConfig.ssl = kafkaConfig.ssl;
        }

        if (kafkaConfig.sasl) {
          kafkaInitConfig.sasl = kafkaConfig.sasl as
            | { mechanism: "plain"; username: string; password: string }
            | { mechanism: "scram-sha-256"; username: string; password: string }
            | { mechanism: "scram-sha-512"; username: string; password: string };
        }

        const kafka = new Kafka(kafkaInitConfig);

        producer = kafka.producer();
        await producer.connect();
        this.producers.set(brokerKey, producer);
      }

      // Prepare message for Kafka
      const message = {
        event: event.type,
        payload: event.payload,
        headers: event.headers,
        deliveryId: event.id,
        timestamp: event.receivedAt.toISOString(),
      };

      // Send to Kafka topic
      await producer.send({
        topic: kafkaConfig.topic,
        messages: [
          {
            key: event.id,
            value: JSON.stringify(message),
            headers: {
              "x-github-event": event.type,
              "x-github-delivery": event.id,
            },
          },
        ],
      });

      return {
        success: true,
        statusCode: 200,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Kafka delivery failed",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }
  }

  async close(): Promise<void> {
    // Disconnect all Kafka producers
    for (const producer of this.producers.values()) {
      await producer.disconnect();
    }
    this.producers.clear();
  }
}
