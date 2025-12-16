# Architecture Overview

## High-Level Design

The GitHub Event Router is designed for horizontal scalability in enterprise environments. The architecture consists of several decoupled layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Enterprise                         │
│                         (70k+ repos)                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Webhooks
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Router Instances (Load Balanced)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Router 1   │  │   Router 2   │  │   Router N   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Internal Queue Layer                         │
│         (Kafka / Redis / SQS / Azure Event Hub / AMQP)          │
│                   - Event buffering                              │
│                   - Horizontal scaling                           │
│                   - Fault tolerance                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Worker 1    │  │  Worker 2    │  │  Worker N    │
│  (Processor) │  │  (Processor) │  │  (Processor) │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Database Layer                               │
│            (SQLite / PostgreSQL / MongoDB)                       │
│                   - Subscriber configuration                     │
│                   - Event tracking                               │
│                   - Delivery audit                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   Subscriber A   │  │   Subscriber B   │  │   Subscriber C   │
│   (HTTPS)        │  │   (Kafka)        │  │   (SQS)          │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Layer Descriptions

### 1. Router Instances (Receiver Layer)
- **Purpose**: Receive GitHub webhooks, validate, and enqueue
- **Scalability**: Horizontal (add more instances behind load balancer)
- **State**: Stateless (configuration from database)
- **HA**: Active-active, any instance can process any webhook

### 2. Internal Queue Layer
- **Purpose**: Decouple receiving from processing, enable horizontal scaling
- **Options**: Memory (dev), Redis, Kafka, AWS SQS, Azure Event Hub, AMQP
- **Features**:
  - Message persistence (except memory)
  - At-least-once delivery
  - Retry handling
  - Dead letter queues
- **Recommended**: Kafka for enterprise scale

### 3. Worker/Processor Layer
- **Purpose**: Process events from queue and deliver to subscribers
- **Scalability**: Horizontal (consumer groups)
- **State**: Stateless (pull config from database)
- **HA**: Active-active with consumer group coordination

### 4. Database Layer
- **Purpose**: Store subscriber config, event audit, delivery tracking
- **Options**: SQLite (dev), PostgreSQL, MongoDB
- **Features**:
  - Subscriber management
  - Event tracking
  - Delivery audit trail
  - Retry scheduling
- **Recommended**: PostgreSQL for enterprise scale

### 5. Subscriber Transport Layer
- **Purpose**: Deliver events to subscribers
- **Options**: HTTPS, Redis Pub/Sub, Kafka, AWS SQS, Azure Event Hub, AMQP
- **Features**:
  - Multiple transport protocols
  - Per-subscriber configuration
  - Retry with backoff
  - Signature verification (HTTPS)

## Scalability Characteristics

### Vertical Limits (Single Instance)
- **Throughput**: ~5,000 events/second
- **Memory**: ~2GB per instance
- **CPU**: 2-4 cores recommended

### Horizontal Scaling
- **Router Instances**: Linear scaling up to load balancer limits
- **Queue Partitions**: Linear scaling (Kafka/AMQP)
- **Worker Instances**: Linear scaling with queue partitions
- **Database**: Single writer, multiple readers (PostgreSQL)

### Enterprise Scale (70k repos, 10k developers)
Recommended configuration:
- **Router Instances**: 6-12 instances
- **Queue**: Kafka with 12-24 partitions
- **Workers**: 12-24 instances
- **Database**: PostgreSQL with read replicas
- **Expected Throughput**: 50k-100k events/hour sustained
- **Peak Throughput**: 200k+ events/hour

## Data Flow

### Ingestion Path
1. GitHub sends webhook to load balancer
2. Router instance receives webhook
3. Validates signature and payload
4. Stores event metadata in database
5. Publishes to internal queue
6. Returns 200 OK to GitHub

### Processing Path
1. Worker pulls event from queue
2. Queries database for matching subscribers
3. For each subscriber:
   - Retrieves transport configuration
   - Delivers event via transport
   - Records delivery attempt
   - Schedules retry if needed
4. Acknowledges message from queue

### Retry Path
1. Periodic job scans for pending retries
2. For each retry:
   - Pulls event and subscriber config
   - Attempts delivery
   - Updates retry schedule or marks failed

## Fault Tolerance

### Component Failures
- **Router instance down**: Load balancer routes to healthy instances
- **Queue down**: Routers buffer and retry (temp), workers wait
- **Worker down**: Other workers pick up its partitions
- **Database down**: System pauses until recovery (read replicas help)
- **Subscriber down**: Retries with exponential backoff, DLQ after max

### Data Durability
- **Events**: Persisted to database and queue
- **Delivery tracking**: Recorded in database
- **Configuration**: Stored in database with backups

### Recovery
- **Automatic**: Queue consumer rebalancing, database failover
- **Manual**: DLQ replay, event replay from audit log

## Security Considerations

### Inbound
- Webhook signature validation (GitHub → Router)
- TLS termination at load balancer
- IP allowlisting (optional)
- Rate limiting per source

### Internal
- Queue authentication (SASL, IAM, etc.)
- Database authentication and encryption
- Encrypted storage of sensitive config (webhook secrets)

### Outbound
- Signature generation for subscribers (HTTPS)
- TLS for all HTTP transports
- Authentication for queue/message transports

## Monitoring and Observability

### Metrics
- Events received per second
- Queue depth and lag
- Delivery success/failure rates
- Retry counts
- Worker processing time
- Database query performance

### Logs
- Event reception with delivery ID
- Delivery attempts with results
- Errors and exceptions
- Retry schedules

### Alerts
- Queue depth threshold
- Failed delivery rate threshold
- Worker lag threshold
- Database connection issues
- Disk space warnings

## Technology Choices

### Why Kafka for Internal Queue?
- Highest throughput (100k+ msg/sec)
- Best durability with replication
- Excellent scaling (add partitions)
- Consumer groups for parallel processing
- Event replay capability
- Battle-tested at scale

### Why PostgreSQL for Database?
- ACID compliance
- Rich query capabilities
- Excellent performance
- Read replicas for scaling
- Wide ecosystem support
- Proven at enterprise scale

### Why Support Multiple Transports?
- **HTTPS**: Universal compatibility, easy debugging
- **Kafka**: High throughput analytics pipelines
- **SQS**: AWS-native integrations
- **Azure Event Hub**: Azure-native integrations
- **AMQP**: Enterprise message bus integrations
- **Redis**: Low-latency notifications

## Future Enhancements

1. **Event Filtering**: Allow subscribers to filter events beyond just type
2. **Event Transformation**: Transform payloads before delivery
3. **Batching**: Batch multiple events in single delivery
4. **Compression**: Compress large payloads
5. **Multi-Region**: Deploy across regions for geo-distribution
6. **Schema Registry**: Version control for event schemas
7. **Rate Limiting**: Per-subscriber rate limits
8. **Priority Queues**: Different priorities for different event types
