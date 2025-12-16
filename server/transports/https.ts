/**
 * HTTPS transport for delivering events to subscribers via webhooks
 */
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  HttpsTransportConfig,
  TransportConfig,
} from "./interface.js";

export class HttpsTransport implements ITransport {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "https";
  }

  validateConfig(config: unknown): config is HttpsTransportConfig {
    if (!config || typeof config !== "object") return false;
    const httpConfig = config as HttpsTransportConfig;
    return (
      typeof httpConfig.url === "string" &&
      typeof httpConfig.webhook_secret === "string" &&
      httpConfig.url.startsWith("https://")
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const httpsConfig = transportConfig as HttpsTransportConfig;

    if (!this.validateConfig(httpsConfig)) {
      return {
        success: false,
        error: "Invalid HTTPS transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Prepare payload
      const payloadString = JSON.stringify(event.payload);

      // Generate signature for subscriber
      const signature = this.generateSignature(
        payloadString,
        httpsConfig.webhook_secret
      );

      // Prepare headers
      const headers = {
        ...event.headers,
        "x-hub-signature-256": signature,
        "x-github-event-router": "true",
        "content-type": "application/json",
        "content-length": Buffer.from(payloadString).length.toString(),
      };

      // Make HTTP request
      const response = await axios.post(httpsConfig.url, payloadString, {
        headers,
        timeout: this.config.event_processing.timeouts.http_delivery_timeout_ms,
        transformRequest: [(data) => data], // Prevent axios from modifying payload
      });

      return {
        success: true,
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        return {
          success: false,
          statusCode: axiosError.response?.status ?? 0,
          error: axiosError.response?.statusText || axiosError.message,
          durationMs,
          attempt: 1,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs,
        attempt: 1,
      };
    }
  }

  private generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    return "sha256=" + hmac.update(payload).digest("hex");
  }
}
