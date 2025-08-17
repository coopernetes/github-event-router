export type TransportName = "https" | "redis";

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
}

export type TransportConfig = HttpsTransportConfig | RedisTransportConfig;

export interface ConfiguredTransport extends Transport {
  config: TransportConfig;
}

export interface Subscriber {
  id: number;
  name: string;
  events: string[];
  transport: ConfiguredTransport;
}
