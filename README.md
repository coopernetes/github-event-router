# GitHub Event Router - Scale GitHub Apps in your organization

A highly scalable GitHub App that acts as a central receiver of GitHub events and distributes them to multiple downstream subscribers. Built for enterprise environments with 70,000+ repositories and 10,000+ developers.

## Goals

- **Horizontally Scalable**: Add router instances and workers as needed
- **Multiple Database Support**: SQLite, PostgreSQL, MongoDB
- **Multiple Queue Systems**: Memory, Redis, Kafka, AWS SQS, Azure Event Hub, AMQP
- **Multiple Transport Protocols**: HTTPS, Redis Pub/Sub, Kafka, SQS, Event Hub, AMQP
- **Enterprise-Grade**: Retries, error handling, audit trail, monitoring
- **Easy Integration**: Compatible with existing tools like [Probot](https://probot.github.io/)
- **Secure**: Webhook signature validation, encryption, rate limiting

## Architecture

The GitHub Event Router uses a robust, decoupled architecture designed for enterprise scalability:

### Core Components

```
GitHub → Router Instances → Internal Queue → Workers → Database
                                  ↓
                            Subscribers (via Transport Layer)
```

- **Router Instances (Receiver):** Stateless HTTP servers that receive webhooks, validate, and enqueue events
- **Internal Queue:** Message queue for decoupling and horizontal scaling (Kafka, Redis, SQS, etc.)
- **Workers (Processors):** Process events from queue and deliver to subscribers
- **Database:** Store subscriber configuration, event audit, and delivery tracking (PostgreSQL, MongoDB, SQLite)
- **Transport Layer:** Pluggable delivery system supporting multiple protocols

### Supported Technologies

#### Databases
- **SQLite**: Development and small deployments
- **PostgreSQL**: Production and enterprise (recommended)
- **MongoDB**: Document-based storage option

#### Internal Queues
- **Memory**: Development only
- **Redis Streams**: Production, low latency
- **Apache Kafka**: Enterprise, highest throughput (recommended)
- **AWS SQS**: AWS-native deployments
- **Azure Event Hub**: Azure-native deployments
- **AMQP (RabbitMQ)**: Enterprise message bus integrations

#### Subscriber Transports
- **HTTPS**: Universal webhooks with signature validation
- **Redis Pub/Sub**: Real-time notifications
- **Apache Kafka**: High-throughput analytics pipelines
- **AWS SQS**: AWS-native integrations
- **Azure Event Hub**: Azure-native integrations
- **AMQP (RabbitMQ)**: Enterprise message bus

### Scalability

| Environment | Events/Hour | Router Instances | Queue Partitions | Workers |
|-------------|-------------|------------------|------------------|---------|
| Small | <10k | 1-2 | 3 | 2-3 |
| Medium | 10k-100k | 3-6 | 6-12 | 6-12 |
| Large | 100k-500k | 6-12 | 12-24 | 12-24 |
| Enterprise | 500k+ | 12-24+ | 24+ | 24+ |

See [Architecture Documentation](docs/ARCHITECTURE.md) for detailed design.

## Quick Start

### Development (Local)

1. **Install dependencies:**
   ```sh
   npm install
   ```

2. **Configure app:**
   ```sh
   cp config/default.yaml config/local.yaml
   # Edit local.yaml with your GitHub App credentials
   ```

3. **Initialize database:**
   ```sh
   npm run db:reset
   ```

4. **Build and run:**
   ```sh
   npm run build
   npm start
   ```

### Production

See [Configuration Examples](docs/CONFIGURATION.md) for production setups with:
- PostgreSQL/MongoDB
- Kafka/Redis/SQS
- Docker Compose
- Kubernetes

## Configuration

### Basic Configuration (config/local.yaml)

```yaml
server:
  port: 8080

app:
  id: YOUR_GITHUB_APP_ID
  private_key: YOUR_PRIVATE_KEY
  webhook_secret: YOUR_WEBHOOK_SECRET

database:
  type: sqlite  # or postgres, mongodb
  encryption_key: YOUR_ENCRYPTION_KEY
  filename: ./database.sqlite

event_processing:
  queue:
    type: memory  # or redis, kafka, sqs, azure-eventhub, amqp
    
  retry:
    max_attempts: 5
    backoff_strategy: exponential
    initial_delay_ms: 2000
    max_delay_ms: 300000
```

See [Configuration Documentation](docs/CONFIGURATION.md) for complete examples.

## Subscriber Management

### Add Subscriber (API)

```bash
curl -X POST http://localhost:8080/api/v1/subscribers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-subscriber",
    "events": ["push", "pull_request"],
    "transport": {
      "name": "https",
      "config": {
        "url": "https://myapp.com/webhook",
        "webhook_secret": "my-secret"
      }
    }
  }'
```

### Supported Transport Types

#### HTTPS (Webhooks)
```json
{
  "name": "https",
  "config": {
    "url": "https://myapp.com/webhook",
    "webhook_secret": "secret"
  }
}
```

#### Kafka
```json
{
  "name": "kafka",
  "config": {
    "brokers": ["kafka:9092"],
    "topic": "github-events",
    "ssl": true,
    "sasl": {
      "mechanism": "scram-sha-256",
      "username": "user",
      "password": "pass"
    }
  }
}
```

See [Configuration Documentation](docs/CONFIGURATION.md) for all transport types.

## Key Features

### Horizontal Scaling
- Add router instances behind load balancer
- Scale workers independently with consumer groups
- Partition queues for parallel processing

### Reliability
- At-least-once delivery guarantee
- Configurable retry with exponential backoff
- Dead letter queue for failed deliveries
- Complete audit trail in database

### Security
- GitHub webhook signature validation
- Encrypted storage of sensitive configuration
- Rate limiting and payload size limits
- TLS for all external communications

### Monitoring
- Event tracking and delivery metrics
- Failed delivery alerts
- Queue depth and lag monitoring
- Configurable log levels

## Kafka Support

Kafka is highly recommended for enterprise deployments. Benefits:

- **High Throughput**: 100k+ messages/second per partition
- **Durability**: Persistent storage with replication
- **Scalability**: Linear scaling by adding partitions
- **Replay**: Can replay historical events
- **Ordering**: Maintains order within partitions

See [Kafka Feasibility Analysis](docs/KAFKA_FEASIBILITY.md) for detailed recommendations.

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Kafka Feasibility Analysis](docs/KAFKA_FEASIBILITY.md)

## Development

### Build
```sh
npm run build         # Build server and UI
npm run build:server  # Build server only
```

### Test
```sh
npm test              # Run tests
npm run test:ci       # Run tests with coverage
```

### Lint
```sh
npm run lint          # Check code style
npm run format:check  # Check formatting
npm run format:write  # Fix formatting
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run linting and tests
5. Submit a pull request

## License

Apache-2.0 License - see LICENSE file for details.
