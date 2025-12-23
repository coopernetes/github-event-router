export type TransportName = "https" | "redis" | "kafka" | "sqs" | "azure-eventhub" | "amqp";

export interface Transport {
  id: number;
  name: TransportName;
}

export interface HttpsTransportConfig {
  url: string;
  webhook_secret: string;
}

export interface RedisTransportConfig {
  url: string;
  password: string;
  channel?: string;
}

export interface KafkaTransportConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  ssl?: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
}

export interface SQSTransportConfig {
  region: string;
  queueUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface AzureEventHubTransportConfig {
  connectionString: string;
  eventHubName: string;
}

export interface AMQPTransportConfig {
  url: string;
  exchange?: string;
  routingKey: string;
  durable?: boolean;
}

export type TransportConfig = 
  | HttpsTransportConfig 
  | RedisTransportConfig 
  | KafkaTransportConfig 
  | SQSTransportConfig 
  | AzureEventHubTransportConfig 
  | AMQPTransportConfig;

export interface ConfiguredTransport extends Transport {
  config: TransportConfig;
}

export interface Subscriber {
  id: number;
  name: string;
  events: string[];
  transport: ConfiguredTransport;
}
