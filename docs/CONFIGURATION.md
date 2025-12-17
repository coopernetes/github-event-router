# Configuration Examples

This document provides complete configuration examples for different deployment scenarios.

## Development Configuration (Local)

```yaml
# config/development.yaml
server:
  port: 8080

app:
  webhook_secret: dev-webhook-secret

database:
  type: sqlite
  encryption_key: dev-encryption-key-32-characters
  filename: ./database.sqlite

event_processing:
  queue:
    type: memory
    options:
      maxRetries: 3
      visibilityTimeout: 30000
      retentionPeriod: 345600000

  retry:
    max_attempts: 3
    backoff_strategy: exponential
    initial_delay_ms: 1000
    max_delay_ms: 30000
    retryable_status_codes: [500, 502, 503, 504, 408, 429]

  timeouts:
    http_delivery_timeout_ms: 10000
    redis_delivery_timeout_ms: 5000

  queue:
    batch_size: 10
    processing_interval_ms: 1000
    dead_letter_threshold: 5

monitoring:
  enable_metrics: true
  log_level: debug
  failed_delivery_alerts: false

security:
  enable_rate_limiting: false
  requests_per_minute: 1000
  payload_size_limit_mb: 10
```

## Production Configuration with PostgreSQL and Redis

```yaml
# config/production.yaml
server:
  port: 8080

app:
  webhook_secret: ${GITHUB_WEBHOOK_SECRET}

database:
  type: postgres
  encryption_key: ${DATABASE_ENCRYPTION_KEY}
  host: postgres.internal
  port: 5432
  username: github_router
  password: ${DATABASE_PASSWORD}
  database: github_events

event_processing:
  queue:
    type: redis
    redis:
      url: redis://redis.internal:6379
      password: ${REDIS_PASSWORD}
      queueName: github-events
      consumerGroup: github-router-group
    options:
      maxRetries: 5
      visibilityTimeout: 60000
      retentionPeriod: 604800000

  retry:
    max_attempts: 5
    backoff_strategy: exponential
    initial_delay_ms: 2000
    max_delay_ms: 300000
    retryable_status_codes: [500, 502, 503, 504, 408, 429, 0]

  timeouts:
    http_delivery_timeout_ms: 30000
    redis_delivery_timeout_ms: 10000

  queue:
    batch_size: 50
    processing_interval_ms: 500
    dead_letter_threshold: 10

monitoring:
  enable_metrics: true
  log_level: info
  failed_delivery_alerts: true

security:
  enable_rate_limiting: true
  requests_per_minute: 10000
  payload_size_limit_mb: 25
```

## Enterprise Configuration with Kafka and PostgreSQL

```yaml
# config/enterprise.yaml
server:
  port: 8080

app:
  webhook_secret: ${GITHUB_WEBHOOK_SECRET}

database:
  type: postgres
  encryption_key: ${DATABASE_ENCRYPTION_KEY}
  host: postgres-primary.internal
  port: 5432
  username: github_router
  password: ${DATABASE_PASSWORD}
  database: github_events

event_processing:
  queue:
    type: kafka
    kafka:
      brokers:
        - kafka-1.internal:9092
        - kafka-2.internal:9092
        - kafka-3.internal:9092
      topic: github-events
      clientId: github-event-router
      groupId: github-event-router-processors
      partitions: 24
      replicationFactor: 3
      ssl: true
      sasl:
        mechanism: scram-sha-256
        username: github_router
        password: ${KAFKA_PASSWORD}
    options:
      maxRetries: 5
      visibilityTimeout: 120000
      retentionPeriod: 604800000

  retry:
    max_attempts: 5
    backoff_strategy: exponential
    initial_delay_ms: 5000
    max_delay_ms: 600000
    retryable_status_codes: [500, 502, 503, 504, 408, 429, 0]

  timeouts:
    http_delivery_timeout_ms: 60000
    redis_delivery_timeout_ms: 30000

  queue:
    batch_size: 100
    processing_interval_ms: 100
    dead_letter_threshold: 20

monitoring:
  enable_metrics: true
  log_level: info
  failed_delivery_alerts: true

security:
  enable_rate_limiting: true
  requests_per_minute: 100000
  payload_size_limit_mb: 50
```

## AWS Configuration with SQS and RDS

```yaml
# config/aws.yaml
server:
  port: 8080

app:
  webhook_secret: ${GITHUB_WEBHOOK_SECRET}

database:
  type: postgres
  encryption_key: ${DATABASE_ENCRYPTION_KEY}
  host: ${RDS_ENDPOINT}
  port: 5432
  username: ${RDS_USERNAME}
  password: ${RDS_PASSWORD}
  database: github_events

event_processing:
  queue:
    type: sqs
    sqs:
      region: us-east-1
      queueUrl: https://sqs.us-east-1.amazonaws.com/123456789/github-events
      # Optional: If not using IAM role
      # accessKeyId: ${AWS_ACCESS_KEY_ID}
      # secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
    options:
      maxRetries: 5
      visibilityTimeout: 60000
      retentionPeriod: 604800000

  retry:
    max_attempts: 5
    backoff_strategy: exponential
    initial_delay_ms: 2000
    max_delay_ms: 300000
    retryable_status_codes: [500, 502, 503, 504, 408, 429, 0]

  timeouts:
    http_delivery_timeout_ms: 30000
    redis_delivery_timeout_ms: 10000

  queue:
    batch_size: 50
    processing_interval_ms: 500
    dead_letter_threshold: 10

monitoring:
  enable_metrics: true
  log_level: info
  failed_delivery_alerts: true

security:
  enable_rate_limiting: true
  requests_per_minute: 50000
  payload_size_limit_mb: 25
```

## Azure Configuration with Event Hub and Cosmos DB

```yaml
# config/azure.yaml
server:
  port: 8080

app:
  webhook_secret: ${GITHUB_WEBHOOK_SECRET}

database:
  type: mongodb
  encryption_key: ${DATABASE_ENCRYPTION_KEY}
  host: ${COSMOS_DB_ENDPOINT}
  database: github_events
  # Cosmos DB connection string includes auth
  username: ${COSMOS_DB_USERNAME}
  password: ${COSMOS_DB_PASSWORD}

event_processing:
  queue:
    type: azure-eventhub
    azureEventHub:
      connectionString: ${EVENT_HUB_CONNECTION_STRING}
      eventHubName: github-events
      consumerGroup: $Default
    options:
      maxRetries: 5
      visibilityTimeout: 60000
      retentionPeriod: 604800000

  retry:
    max_attempts: 5
    backoff_strategy: exponential
    initial_delay_ms: 2000
    max_delay_ms: 300000
    retryable_status_codes: [500, 502, 503, 504, 408, 429, 0]

  timeouts:
    http_delivery_timeout_ms: 30000
    redis_delivery_timeout_ms: 10000

  queue:
    batch_size: 50
    processing_interval_ms: 500
    dead_letter_threshold: 10

monitoring:
  enable_metrics: true
  log_level: info
  failed_delivery_alerts: true

security:
  enable_rate_limiting: true
  requests_per_minute: 50000
  payload_size_limit_mb: 25
```

## Subscriber Configuration Examples

### HTTPS Subscriber

```json
{
  "name": "legacy-webhook-subscriber",
  "events": ["push", "pull_request", "issues"],
  "transport": {
    "name": "https",
    "config": {
      "url": "https://app.internal/webhooks/github",
      "webhook_secret": "subscriber-secret-key"
    }
  }
}
```

### Redis Pub/Sub Subscriber

```json
{
  "name": "realtime-notifications",
  "events": ["issues", "pull_request_review"],
  "transport": {
    "name": "redis",
    "config": {
      "url": "redis://redis.internal:6379",
      "password": "redis-password",
      "channel": "github-notifications"
    }
  }
}
```

### Kafka Subscriber

```json
{
  "name": "analytics-pipeline",
  "events": ["*"],
  "transport": {
    "name": "kafka",
    "config": {
      "brokers": ["kafka-1.internal:9092", "kafka-2.internal:9092"],
      "topic": "github-events-analytics",
      "clientId": "analytics-consumer",
      "ssl": true,
      "sasl": {
        "mechanism": "scram-sha-256",
        "username": "analytics",
        "password": "analytics-password"
      }
    }
  }
}
```

### AWS SQS Subscriber

```json
{
  "name": "compliance-auditor",
  "events": ["repository", "organization", "team"],
  "transport": {
    "name": "sqs",
    "config": {
      "region": "us-east-1",
      "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789/compliance-events",
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    }
  }
}
```

### Azure Event Hub Subscriber

```json
{
  "name": "security-monitoring",
  "events": ["repository", "member", "organization"],
  "transport": {
    "name": "azure-eventhub",
    "config": {
      "connectionString": "Endpoint=sb://namespace.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=...",
      "eventHubName": "security-events"
    }
  }
}
```

### AMQP Subscriber (RabbitMQ)

```json
{
  "name": "workflow-orchestrator",
  "events": ["workflow_run", "workflow_job"],
  "transport": {
    "name": "amqp",
    "config": {
      "url": "amqp://user:password@rabbitmq.internal:5672",
      "exchange": "github-events",
      "routingKey": "workflows",
      "durable": true
    }
  }
}
```

## Environment Variables

### Common Variables
```bash
# GitHub Webhook Configuration
export GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Database
export DATABASE_ENCRYPTION_KEY=your-32-character-encryption-key
export DATABASE_PASSWORD=your-database-password

# Queue
export REDIS_PASSWORD=your-redis-password
export KAFKA_PASSWORD=your-kafka-password

# AWS (if using SQS)
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Azure (if using Event Hub/Cosmos DB)
export EVENT_HUB_CONNECTION_STRING=Endpoint=sb://...
export COSMOS_DB_ENDPOINT=https://....documents.azure.com:443/
export COSMOS_DB_USERNAME=your-cosmos-username
export COSMOS_DB_PASSWORD=your-cosmos-password
```

## Docker Compose Example

```yaml
version: '3.8'

services:
  router:
    image: github-event-router:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - GITHUB_APP_ID=${GITHUB_APP_ID}
      - GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - DATABASE_PASSWORD=${DATABASE_PASSWORD}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    depends_on:
      - postgres
      - redis
    volumes:
      - ./config:/app/config
    restart: unless-stopped

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=github_events
      - POSTGRES_USER=github_router
      - POSTGRES_PASSWORD=${DATABASE_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./migrations/postgres:/docker-entrypoint-initdb.d
    restart: unless-stopped

  redis:
    image: redis:7
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:
```

## Kubernetes Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: github-event-router
spec:
  replicas: 6
  selector:
    matchLabels:
      app: github-event-router
  template:
    metadata:
      labels:
        app: github-event-router
    spec:
      containers:
      - name: router
        image: github-event-router:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: GITHUB_WEBHOOK_SECRET
          valueFrom:
            secretKeyRef:
              name: github-secrets
              key: webhook-secret
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: database-secrets
              key: password
        - name: KAFKA_PASSWORD
          valueFrom:
            secretKeyRef:
              name: kafka-secrets
              key: password
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        volumeMounts:
        - name: config
          mountPath: /app/config
      volumes:
      - name: config
        configMap:
          name: router-config
```
