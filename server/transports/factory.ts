/**
 * Transport factory for creating transport instances
 */
import type { Config } from "../config.js";
import type { ITransport, TransportName } from "./interface.js";
import { HttpsTransport } from "./https.js";
import { RedisTransport } from "./redis.js";
import { KafkaTransport } from "./kafka.js";
import { SQSTransport } from "./sqs.js";
import { AzureEventHubTransport } from "./azure-eventhub.js";
import { AMQPTransport } from "./amqp.js";

export class TransportFactory {
  private static transports: Map<string, new (config: Config) => ITransport> =
    new Map();

  static {
    this.transports.set("https", HttpsTransport);
    this.transports.set("redis", RedisTransport);
    this.transports.set("kafka", KafkaTransport);
    this.transports.set("sqs", SQSTransport);
    this.transports.set("azure-eventhub", AzureEventHubTransport);
    this.transports.set("amqp", AMQPTransport);
  }

  static create(type: string, config: Config): ITransport {
    const TransportClass = this.transports.get(type);
    if (!TransportClass) {
      throw new Error(`Unknown transport type: ${type}`);
    }
    return new TransportClass(config);
  }

  static getSupportedTypes(): TransportName[] {
    return Array.from(this.transports.keys()) as TransportName[];
  }
}
