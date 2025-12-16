/**
 * Queue factory for creating queue instances based on configuration
 */
import type { IQueue, QueueOptions } from "./interface.js";
import { InMemoryQueue } from "./memory.js";
import { RedisQueue, type RedisQueueConfig } from "./redis.js";
import { SQSQueue, type SQSQueueConfig } from "./sqs.js";
import {
  AzureEventHubQueue,
  type AzureEventHubConfig,
} from "./azure-eventhub.js";
import { AMQPQueue, type AMQPQueueConfig } from "./amqp.js";
import { KafkaQueue, type KafkaQueueConfig } from "./kafka.js";

export type QueueType =
  | "memory"
  | "redis"
  | "sqs"
  | "azure-eventhub"
  | "amqp"
  | "kafka";

export interface QueueConfig {
  type: QueueType;
  options?: QueueOptions;

  // Memory queue (no additional config needed)

  // Redis config
  redis?: RedisQueueConfig;

  // AWS SQS config
  sqs?: SQSQueueConfig;

  // Azure Event Hub config
  azureEventHub?: AzureEventHubConfig;

  // AMQP (RabbitMQ) config
  amqp?: AMQPQueueConfig;

  // Kafka config
  kafka?: KafkaQueueConfig;
}

export class QueueFactory {
  static async create(config: QueueConfig): Promise<IQueue> {
    let queue: IQueue;

    switch (config.type) {
      case "memory": {
        queue = new InMemoryQueue(config.options);
        break;
      }

      case "redis": {
        if (!config.redis) {
          throw new Error("Redis configuration is required for redis queue type");
        }
        queue = new RedisQueue(config.redis, config.options);
        break;
      }

      case "sqs": {
        if (!config.sqs) {
          throw new Error("SQS configuration is required for sqs queue type");
        }
        queue = new SQSQueue(config.sqs, config.options);
        break;
      }

      case "azure-eventhub": {
        if (!config.azureEventHub) {
          throw new Error(
            "Azure Event Hub configuration is required for azure-eventhub queue type"
          );
        }
        queue = new AzureEventHubQueue(config.azureEventHub, config.options);
        break;
      }

      case "amqp": {
        if (!config.amqp) {
          throw new Error("AMQP configuration is required for amqp queue type");
        }
        queue = new AMQPQueue(config.amqp, config.options);
        break;
      }

      case "kafka": {
        if (!config.kafka) {
          throw new Error("Kafka configuration is required for kafka queue type");
        }
        queue = new KafkaQueue(config.kafka, config.options);
        break;
      }

      default: {
        const exhaustiveCheck: never = config.type;
        throw new Error(`Unknown queue type: ${exhaustiveCheck}`);
      }
    }

    // Connect to the queue
    await queue.connect();

    return queue;
  }

  static getSupportedTypes(): QueueType[] {
    return ["memory", "redis", "sqs", "azure-eventhub", "amqp", "kafka"];
  }
}
