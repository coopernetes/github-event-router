import Database, { type Database as DatabaseType } from "better-sqlite3";
import { type Config } from "./config.js";
import { getSubscribers } from "./subscriber.js";

export interface SystemHealth {
  database: {
    status: "healthy" | "unhealthy";
    latencyMs: number;
    errorMessage?: string;
  };
  subscribers: {
    total: number;
    active: number;
    failing: number;
  };
  eventProcessing: {
    queueSize: number;
    processingRate: number;
    pendingRetries: number;
  };
  failedDeliveries: {
    last24h: number;
    last1h: number;
    requiresAttention: boolean;
  };
  system: {
    uptime: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

export class HealthMonitor {
  private db: DatabaseType;
  private config: Config;
  private startTime: Date;
  private lastHealthCheck: SystemHealth | null = null;

  constructor(config: Config, dbPath = "./database.sqlite") {
    this.config = config;
    this.db = new Database(dbPath);
    this.startTime = new Date();
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const health: SystemHealth = {
      database: await this.checkDatabaseHealth(),
      subscribers: await this.checkSubscriberHealth(),
      eventProcessing: await this.getEventProcessingStats(),
      failedDeliveries: await this.getFailedDeliveryStats(),
      system: this.getSystemStats(),
    };

    this.lastHealthCheck = health;
    return health;
  }

  private async checkDatabaseHealth(): Promise<SystemHealth["database"]> {
    const startTime = Date.now();

    try {
      // Simple health check query
      const stmt = this.db.prepare("SELECT 1 as health_check");
      stmt.get();

      const latencyMs = Date.now() - startTime;

      return {
        status: "healthy",
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      return {
        status: "unhealthy",
        latencyMs,
        errorMessage: error instanceof Error ? error.message : "Database error",
      };
    }
  }

  private async checkSubscriberHealth(): Promise<SystemHealth["subscribers"]> {
    try {
      const subscribers = getSubscribers();
      const total = subscribers.length;

      // Count subscribers with valid transport configurations
      const active = subscribers.filter(
        (sub) => sub.transport && sub.transport.config && sub.events.length > 0
      ).length;

      // Get failing subscribers from recent delivery attempts
      const failingStmt = this.db.prepare(`
        SELECT DISTINCT subscriber_id
        FROM delivery_attempts da
        WHERE da.attempted_at > datetime('now', '-1 hour')
        AND da.status_code >= 400
        AND da.next_retry_at IS NULL
      `);

      const failing = (failingStmt.all() as Array<{ subscriber_id: number }>)
        .length;

      return {
        total,
        active,
        failing,
      };
    } catch {
      return {
        total: 0,
        active: 0,
        failing: 0,
      };
    }
  }

  private async getEventProcessingStats(): Promise<
    SystemHealth["eventProcessing"]
  > {
    try {
      // Get queue size (pending events)
      const queueStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM events
        WHERE status IN ('pending', 'processing')
      `);
      const queueResult = queueStmt.get() as { count: number };
      const queueSize = queueResult.count;

      // Get processing rate (events processed in last hour)
      const rateStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM events
        WHERE processed_at > datetime('now', '-1 hour')
        AND status IN ('completed', 'failed')
      `);
      const rateResult = rateStmt.get() as { count: number };
      const processingRate = rateResult.count;

      // Get pending retries
      const retryStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM delivery_attempts
        WHERE next_retry_at IS NOT NULL
        AND next_retry_at > datetime('now')
      `);
      const retryResult = retryStmt.get() as { count: number };
      const pendingRetries = retryResult.count;

      return {
        queueSize,
        processingRate,
        pendingRetries,
      };
    } catch {
      return {
        queueSize: 0,
        processingRate: 0,
        pendingRetries: 0,
      };
    }
  }

  private async getFailedDeliveryStats(): Promise<
    SystemHealth["failedDeliveries"]
  > {
    try {
      // Failed deliveries in last 24 hours
      const last24hStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM delivery_attempts
        WHERE attempted_at > datetime('now', '-24 hours')
        AND status_code >= 400
      `);
      const last24hResult = last24hStmt.get() as { count: number };
      const last24h = last24hResult.count;

      // Failed deliveries in last hour
      const last1hStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM delivery_attempts
        WHERE attempted_at > datetime('now', '-1 hour')
        AND status_code >= 400
      `);
      const last1hResult = last1hStmt.get() as { count: number };
      const last1h = last1hResult.count;

      // Determine if attention is required
      const alertThreshold = this.config.event_processing.queue.batch_size * 5; // 5x batch size
      const requiresAttention = last1h > alertThreshold;

      return {
        last24h,
        last1h,
        requiresAttention,
      };
    } catch {
      return {
        last24h: 0,
        last1h: 0,
        requiresAttention: false,
      };
    }
  }

  private getSystemStats(): SystemHealth["system"] {
    const uptime = Date.now() - this.startTime.getTime();
    const memUsage = process.memoryUsage();

    return {
      uptime,
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
    };
  }

  isHealthy(): boolean {
    if (!this.lastHealthCheck) {
      return false;
    }

    const { database, subscribers, eventProcessing, failedDeliveries } =
      this.lastHealthCheck;

    return (
      database.status === "healthy" &&
      database.latencyMs < 1000 && // Database responds within 1 second
      subscribers.active > 0 && // At least one active subscriber
      eventProcessing.queueSize < 1000 && // Queue not too large
      !failedDeliveries.requiresAttention // No critical delivery failures
    );
  }

  getHealthSummary(): string {
    if (!this.lastHealthCheck) {
      return "Health check not performed";
    }

    const { database, subscribers, eventProcessing, failedDeliveries } =
      this.lastHealthCheck;

    const issues: string[] = [];

    if (database.status !== "healthy") {
      issues.push(`Database: ${database.errorMessage}`);
    }

    if (subscribers.active === 0) {
      issues.push("No active subscribers");
    }

    if (subscribers.failing > 0) {
      issues.push(`${subscribers.failing} failing subscribers`);
    }

    if (eventProcessing.queueSize > 100) {
      issues.push(`Large event queue: ${eventProcessing.queueSize}`);
    }

    if (failedDeliveries.requiresAttention) {
      issues.push(
        `High failure rate: ${failedDeliveries.last1h} failures in last hour`
      );
    }

    if (issues.length === 0) {
      return "System is healthy";
    }

    return `Issues detected: ${issues.join(", ")}`;
  }

  close(): void {
    this.db.close();
  }
}
