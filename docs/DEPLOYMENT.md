# Deployment Guide

## Architecture Options

The application supports two deployment modes:

### 1. Direct Processing Mode (Default)

```
┌────────────────────────────────────────┐
│     Monolithic Instance                │
│  ┌──────────────────────────────────┐  │
│  │  Webhook Receiver                │  │
│  │    ↓                              │  │
│  │  Event Processor (Worker)        │  │
│  │    ↓                              │  │
│  │  Database (SQLite/PostgreSQL)    │  │
│  │    ↓                              │  │
│  │  Subscriber Transports           │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Characteristics:**
- Single process handles webhook ingestion AND event delivery
- Events are processed synchronously upon receipt
- Simple setup, no external queue required
- Good for low-to-medium volume (< 100k events/hour)

### 2. Queue-Based Processing Mode (Recommended for High Volume)

```
┌────────────────────────────────────────┐
│     Application Instance               │
│  ┌──────────────────────────────────┐  │
│  │  Webhook Receiver                │  │
│  │    ↓                              │  │
│  │  Event Ingestion (to queue)      │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  Event Worker (from queue)       │  │
│  │    ↓                              │  │
│  │  Subscriber Transports           │  │
│  └──────────────────────────────────┘  │
└─────────────┬──────────────────────────┘
              │
              ▼
      ┌──────────────┐
      │ Queue Layer  │
      │ (Redis/Kafka)│
      └──────────────┘
```

**Characteristics:**
- Receiver and worker decoupled via internal queue
- Events are queued for async processing
- Better resilience (events persist in queue)
- Horizontal scaling ready (multiple instances share queue)
- Can run in same process OR split into separate deployments

## Deployment Options

### Option 1: Monolithic Horizontal Scaling (Current - Recommended for Most Use Cases)

Deploy multiple instances of the same application behind a load balancer.

#### Architecture
```
                   ┌──────────────┐
    GitHub  ───────►  Load Balancer│
                   └───────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐        ┌─────────┐       ┌─────────┐
   │ Router  │        │ Router  │       │ Router  │
   │    +    │        │    +    │       │    +    │
   │ Worker 1│        │ Worker 2│       │ Worker N│
   └────┬────┘        └────┬────┘       └────┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                   ┌──────────────┐
                   │  PostgreSQL  │
                   │   Database   │
                   └──────────────┘
```

#### Deployment Steps

**1. Using Docker Compose**

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: github_events
      POSTGRES_USER: router
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  router1:
    build: .
    environment:
      NODE_ENV: production
      DATABASE_TYPE: postgres
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_NAME: github_events
      DATABASE_USERNAME: router
      DATABASE_PASSWORD: ${DB_PASSWORD}
    ports:
      - "8081:8080"
    depends_on:
      - postgres

  router2:
    build: .
    environment:
      NODE_ENV: production
      DATABASE_TYPE: postgres
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_NAME: github_events
      DATABASE_USERNAME: router
      DATABASE_PASSWORD: ${DB_PASSWORD}
    ports:
      - "8082:8080"
    depends_on:
      - postgres

  router3:
    build: .
    environment:
      NODE_ENV: production
      DATABASE_TYPE: postgres
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_NAME: github_events
      DATABASE_USERNAME: router
      DATABASE_PASSWORD: ${DB_PASSWORD}
    ports:
      - "8083:8080"
    depends_on:
      - postgres

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - router1
      - router2
      - router3

volumes:
  postgres_data:
```

**2. Nginx Load Balancer Config**

```nginx
# nginx.conf
upstream github_event_router {
    least_conn;  # Use least connections for better distribution
    server router1:8080 max_fails=3 fail_timeout=30s;
    server router2:8080 max_fails=3 fail_timeout=30s;
    server router3:8080 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name your-router.example.com;

    location / {
        proxy_pass http://github_event_router;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Important: Don't buffer webhook payloads
        proxy_request_buffering off;
        proxy_buffering off;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**3. Start the deployment**

```bash
docker-compose up -d
```

#### Kubernetes Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: github-event-router
spec:
  replicas: 3  # Scale as needed
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
        image: your-registry/github-event-router:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_TYPE
          value: "postgres"
        - name: DATABASE_HOST
          valueFrom:
            configMapKeyRef:
              name: github-event-router-config
              key: database_host
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: github-event-router-secrets
              key: database_password
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /api/v1/liveness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/readiness
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: github-event-router
spec:
  selector:
    app: github-event-router
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: github-event-router
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: github-event-router
  minReplicas: 3
  maxReplicas: 12
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

#### Scaling Considerations

**When to scale horizontally:**
- CPU usage > 70% sustained
- Event processing latency increasing
- Queue depth (pending events) growing
- Expected burst in webhook traffic

**How many instances:**
- Small (<10k events/hour): 2-3 instances
- Medium (10k-100k events/hour): 3-6 instances
- Large (100k-500k events/hour): 6-12 instances
- Enterprise (500k+ events/hour): 12-24 instances

### Option 2: Queue-Based Deployment (Recommended for High Volume)

**Available Now**: The queue infrastructure is fully implemented and ready to use.

#### Quick Start

**1. Enable queue in configuration:**
```yaml
# config/production.yaml
internal_queue:
  enabled: true
  type: memory  # Start with in-memory, upgrade to redis/kafka later
  consumer_count: 2
  poll_interval_ms: 100
  visibility_timeout_ms: 30000
```

**2. Deploy as monolithic instances** (receiver + worker in same process):
```bash
docker-compose up -d
```

Both receiver and worker run together, but events flow through the queue for better resilience.

#### Supported Queue Types

**Memory Queue** (Built-in, no dependencies)
```yaml
internal_queue:
  enabled: true
  type: memory
  consumer_count: 2
```
- Good for: Development, single-instance deployments
- Limitations: Queue lost on restart, not shared across instances

**Redis Streams** (Recommended for Production)
```yaml
internal_queue:
  enabled: true
  type: redis
  consumer_count: 3
  redis:
    url: redis://localhost:6379
    password: ""
    stream_name: github-events
    consumer_group: event-workers
```
- Good for: Multi-instance deployments, production
- Benefits: Persistent, shared across instances, battle-tested

**Apache Kafka** (Enterprise Scale)
```yaml
internal_queue:
  enabled: true
  type: kafka
  consumer_count: 5
  kafka:
    brokers:
      - kafka1:9092
      - kafka2:9092
    topic: github-events
    client_id: github-event-router
    group_id: event-workers
```
- Good for: Very high volume (> 1M events/hour), complex topologies
- Benefits: High throughput, partitioning, replay capability

**AWS SQS**
```yaml
internal_queue:
  enabled: true
  type: sqs
  consumer_count: 3
  sqs:
    region: us-east-1
    queue_url: https://sqs.us-east-1.amazonaws.com/123456789/github-events
    access_key_id: ${AWS_ACCESS_KEY_ID}
    secret_access_key: ${AWS_SECRET_ACCESS_KEY}
```
- Good for: AWS deployments, serverless architectures
- Benefits: Fully managed, scales automatically, pay-per-use

**RabbitMQ (AMQP)**
```yaml
internal_queue:
  enabled: true
  type: amqp
  consumer_count: 3
  amqp:
    url: amqp://localhost:5672
    queue_name: github-events
    exchange: github-events
```
- Good for: Complex routing, existing RabbitMQ infrastructure
- Benefits: Rich routing features, management UI

**Azure Event Hub**
```yaml
internal_queue:
  enabled: true
  type: azure-eventhub
  consumer_count: 3
  azure_eventhub:
    connection_string: ${EVENTHUB_CONNECTION_STRING}
    event_hub_name: github-events
    consumer_group: $Default
```
- Good for: Azure deployments
- Benefits: Fully managed, integrates with Azure ecosystem

#### Architecture with Queue
```
                   ┌──────────────┐
    GitHub  ───────►  Load Balancer│
                   └───────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐        ┌─────────┐       ┌─────────┐
   │Instance1│        │Instance2│       │InstanceN│
   │Receiver+│        │Receiver+│       │Receiver+│
   │ Worker  │        │ Worker  │       │ Worker  │
   └────┬────┘        └────┬────┘       └────┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                   ┌──────────────┐
                   │ Queue Layer  │
                   │(Redis/Kafka) │
                   │  (Shared)    │
                   └───────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │ Consumers pull   │   from shared    │
        │    queue         │     queue        │
        └──────────────────┼──────────────────┘
                           ▼
                   ┌──────────────┐
                   │  PostgreSQL  │
                   └──────────────┘
```

#### Benefits of Queue-Based Mode

1. **Resilience**: Events persist in queue if instance crashes
2. **Back-pressure**: Receiver quickly ACKs to GitHub, processing happens async
3. **Horizontal Scaling**: Multiple instances share the same queue workload
4. **Observability**: Queue depth metrics show processing health
5. **Future-Ready**: Easy to split into separate receiver/worker deployments later

## Monitoring & Health Checks

### Health Endpoints

- **Liveness**: `GET /api/v1/liveness`
  - Returns 200 if process is alive
  - Use for k8s liveness probe

- **Readiness**: `GET /api/v1/readiness`
  - Returns 200 if ready to accept traffic
  - Returns 503 if degraded
  - Checks: database connectivity, queue depth, retry queue
  - Use for k8s readiness probe and load balancer health checks

### Prometheus Metrics

Available at `http://localhost:9464/metrics`

Key metrics to monitor:
- `github_webhooks_received_total` - Total webhooks received
- `event_delivery_attempts_total` - Delivery attempts by subscriber/transport
- `event_delivery_success_total` - Successful deliveries
- `event_delivery_failures_total` - Failed deliveries
- `queue_depth` - Pending events in database
- `retry_queue_depth` - Events awaiting retry
- `transport_delivery_duration_ms` - Delivery latency by transport

### Recommended Alerts

```yaml
# Example Prometheus alerts
groups:
- name: github_event_router
  rules:
  - alert: HighQueueDepth
    expr: queue_depth > 1000
    for: 5m
    annotations:
      summary: "Event queue depth is high"
      
  - alert: HighInternalQueueDepth
    expr: events_queued > 10000
    for: 5m
    annotations:
      summary: "Internal queue has many pending events"
      description: "Consider scaling workers or investigating slow subscribers"
      
  - alert: HighDeliveryFailureRate
    expr: rate(event_delivery_failures_total[5m]) / rate(event_delivery_attempts_total[5m]) > 0.1
    for: 5m
    annotations:
      summary: "Delivery failure rate > 10%"
      
  - alert: SlowDeliveries
    expr: histogram_quantile(0.95, transport_delivery_duration_ms) > 5000
    for: 5m
    annotations:
      summary: "95th percentile delivery time > 5s"
```

## Configuration

### Environment Variables

```bash
# Server
SERVER_PORT=8080

# Database
DATABASE_TYPE=postgres  # or sqlite
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=github_events
DATABASE_USERNAME=router
DATABASE_PASSWORD=secret
DATABASE_ENCRYPTION_KEY=your-encryption-key-here

# GitHub
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Internal Queue (Optional - for queue-based processing)
INTERNAL_QUEUE_ENABLED=true
INTERNAL_QUEUE_TYPE=redis  # memory, redis, kafka, amqp, sqs, azure-eventhub
INTERNAL_QUEUE_CONSUMER_COUNT=3

# Redis Queue Config (if using redis)
REDIS_URL=redis://localhost:6379
REDIS_STREAM_NAME=github-events
REDIS_CONSUMER_GROUP=event-workers

# Monitoring
ENABLE_METRICS=true
LOG_LEVEL=info

# Security
ENABLE_RATE_LIMITING=true
REQUESTS_PER_MINUTE=1000
PAYLOAD_SIZE_LIMIT_MB=10
```

### Configuration File

See `config/default.yaml` for full configuration options and `docs/CONFIGURATION.md` for detailed examples.

## Database Considerations

### PostgreSQL (Production Recommended)

**Advantages:**
- Supports multiple instances reading/writing
- Better for high-volume workloads
- ACID transactions
- Can use connection pooling

**Setup:**
```sql
CREATE DATABASE github_events;
CREATE USER router WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE github_events TO router;
```

### SQLite (Development/Small Deployments)

**Advantages:**
- No separate database server needed
- Simple setup
- Good for < 10k events/hour

**Limitations:**
- Single writer (WAL mode helps but limits scale)
- File-based (ensure proper file permissions)
- Not recommended for > 3 instances

## Performance Tuning

### Database

**PostgreSQL:**
```sql
-- Recommended indexes (created by migrations)
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_delivery_attempts_retry ON delivery_attempts(next_retry_at) 
  WHERE next_retry_at IS NOT NULL;
```

**Connection Pooling:**
```yaml
database:
  pool:
    min: 2
    max: 10
```

### Retry Processing

```yaml
event_processing:
  queue:
    processing_interval_ms: 1000  # How often to check for retries
    batch_size: 10                # Retries processed per batch
```

### Rate Limiting

```yaml
security:
  enable_rate_limiting: true
  requests_per_minute: 1000  # Adjust based on expected load
```

## Troubleshooting

### High Queue Depth

**Symptoms:** `queue_depth` metric growing, slow event processing

**Solutions:**
1. Add more instances to process events faster
2. Check subscriber endpoints - are they slow or timing out?
3. Review retry queue - are retries piling up?
4. Increase `processing_interval_ms` for faster retry processing

### Delivery Failures

**Symptoms:** High `event_delivery_failures_total`

**Solutions:**
1. Check subscriber endpoint health
2. Review delivery attempt logs in database
3. Verify webhook secrets match
4. Check network connectivity to subscribers

### Memory Issues

**Symptoms:** OOM errors, high memory usage

**Solutions:**
1. Reduce `batch_size` for retry processing
2. Check for payload size - large events use more memory
3. Ensure proper database connection cleanup
4. Add memory limits in container/k8s config
