import { type RetryConfig } from "./config.js";
import { type DeliveryResult } from "./transport.js";

export interface RetryContext {
  subscriberId: number;
  eventId: string;
  eventType: string;
  attempt: number;
}

export class RetryHandler {
  private config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  shouldRetry(result: DeliveryResult, context: RetryContext): boolean {
    // Don't retry if we've exceeded max attempts
    if (context.attempt >= this.config.max_attempts) {
      return false;
    }

    // Don't retry successful deliveries
    if (result.success) {
      return false;
    }

    // Check if the status code is retryable
    if (
      result.statusCode &&
      !this.config.retryable_status_codes.includes(result.statusCode)
    ) {
      return false;
    }

    return true;
  }

  calculateDelay(attempt: number): number {
    const { backoff_strategy, initial_delay_ms, max_delay_ms } = this.config;

    let delay: number;

    if (backoff_strategy === "exponential") {
      delay = initial_delay_ms * Math.pow(2, attempt - 1);
    } else {
      // linear backoff
      delay = initial_delay_ms * attempt;
    }

    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    delay += jitter;

    return Math.min(delay, max_delay_ms);
  }

  getNextRetryTime(attempt: number): Date {
    const delay = this.calculateDelay(attempt);
    return new Date(Date.now() + delay);
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: RetryContext,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.max_attempts; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.config.max_attempts) {
          break;
        }

        // Check if we should retry based on the error
        const shouldRetry = this.shouldRetryError(lastError);
        if (!shouldRetry) {
          break;
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt);

        if (onRetry) {
          onRetry(attempt, lastError);
        }

        await this.sleep(delay);
      }
    }

    throw lastError || new Error("Operation failed after retries");
  }

  private shouldRetryError(error: Error): boolean {
    // Retry network errors, timeouts, etc.
    const retryableErrors = [
      "ECONNRESET",
      "ENOTFOUND",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "NETWORK_ERROR",
      "TIMEOUT_ERROR",
    ];

    return retryableErrors.some(
      (errorType) =>
        error.message.includes(errorType) || error.name.includes(errorType)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
