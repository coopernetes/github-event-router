# Kafka Support in GitHub Event Router

This document analyzes the feasibility and implementation of Apache Kafka support for both internal queuing and subscriber transports in the GitHub Event Router.

## Executive Summary

Kafka is **highly recommended** for both internal queue processing and subscriber transport in large-scale GitHub Enterprise environments (70k+ repos, 10k+ developers). It provides:

- **High throughput**: 100k+ messages/second per partition
- **Horizontal scalability**: Add brokers and partitions as needed
- **Durability**: Persistent storage with configurable retention
- **Ordering guarantees**: Within partitions
- **Consumer groups**: Multiple router instances can process events in parallel

## Use Case 1: Internal Queue for Event Processing

### Implementation Status
✅ **IMPLEMENTED** - See `server/queue/kafka.ts`

### Architecture

```
GitHub Webhook → Router Instance → Kafka Topic (events) → Router Workers
                                       ↓
                                   Partitions (3-12)
                                       ↓
                              Consumer Group (routers)
```

### Configuration Example

```yaml
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
      groupId: github-event-router-group
      partitions: 12
      ssl: true
```

### Benefits for Internal Queue

1. **Horizontal Scaling** - Multiple router instances process different partitions
2. **Durability** - Events persisted to disk with replication
3. **Performance** - Batch processing, zero-copy transfers, <10ms latency
4. **Ordering** - Strict ordering within partitions

### Recommendations

| Environment | Partitions | Brokers | Router Instances |
|-------------|------------|---------|------------------|
| Small (<1k repos) | 3 | 3 | 2-3 |
| Medium (1k-10k) | 6 | 3-5 | 3-6 |
| Large (10k-50k) | 12 | 5-7 | 6-12 |
| Enterprise (50k+) | 24+ | 7-12 | 12-24+ |

## Use Case 2: Subscriber Transport

### Implementation Status
✅ **IMPLEMENTED** - See `server/transports/kafka.ts`

### Benefits

1. **Decoupling** - Subscribers pull at their own pace
2. **Buffering** - Kafka buffers during subscriber outages
3. **Multiple Consumers** - Parallel processing via consumer groups
4. **Replay** - Subscribers can replay historical events
5. **At-Least-Once Delivery** - No message loss

### Ideal Use Cases

- **Analytics**: Large-scale event analysis
- **Compliance**: Audit logging with long retention
- **Security**: Real-time monitoring with replay capability
- **Data Warehousing**: Bulk ingestion to data lakes
- **Machine Learning**: Training data with historical replay

## Comparison with Other Transports

### Kafka vs HTTP/HTTPS
- **Throughput**: Kafka 100k+/s vs HTTP 1k-10k/s
- **Reliability**: Kafka persistent vs HTTP retry-based
- **Complexity**: Kafka high vs HTTP low

### Kafka vs Redis Pub/Sub
- **Persistence**: Kafka durable vs Redis in-memory
- **Replay**: Kafka yes vs Redis no
- **Scalability**: Kafka horizontal vs Redis vertical

### Kafka vs AWS SQS
- **Throughput**: Kafka higher
- **Ordering**: Kafka per-partition vs SQS FIFO only
- **Replay**: Kafka yes vs SQS no

## When to Use Kafka

✅ **Use Kafka when:**
- Processing >10k events/hour
- Need message replay
- Multiple consumers for same events
- Horizontal scaling required

❌ **Don't use Kafka when:**
- Low volume (<1k events/hour)
- No operations team
- Simple webhooks suffice

## Conclusion

Kafka is **highly recommended** for GitHub Event Router in large enterprise environments:

- ✅ **Internal Queue**: Excellent for horizontal scaling
- ✅ **Subscriber Transport**: Ideal for high-volume analytics
- ⚠️ **Complexity**: Requires operational expertise

For 70k repos and 10k developers, Kafka provides necessary throughput, reliability, and scalability.
