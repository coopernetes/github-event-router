# Docker Compose Setups

This directory contains Docker Compose configurations for testing the GitHub Event Router with different resilience levels.

## Available Setups

### 1. Development Setup (Least Resilient)
**File:** `docker-compose.dev.yml`

**Components:**
- GitHub Event Router (receiver + processor in one container)
- Example webhook receiver (subscriber)
- SQLite database (file-based)
- In-memory queue

**Use Case:** Local development, testing, debugging

**Start:**
```bash
docker-compose -f docker-compose.dev.yml up --build
```

**Access:**
- Router: http://localhost:8080
- Example Receiver: http://localhost:3000
- Health Check: http://localhost:8080/api/v1/liveness
- Readiness: http://localhost:8080/api/v1/readiness

### 2. Production Setup (Most Resilient)
**File:** `docker-compose.prod.yml`

**Components:**
- GitHub Event Router (separate receiver and worker containers)
- PostgreSQL database (persistent, ACID-compliant)
- Apache Kafka (distributed message queue)
- Zookeeper (Kafka coordination)
- Redis (caching, optional transport)
- Example webhook receiver (subscriber)
- Kafka UI (monitoring interface)

**Use Case:** Production-like testing, performance testing, enterprise deployment simulation

**Start:**
```bash
docker-compose -f docker-compose.prod.yml up --build
```

**Access:**
- Router: http://localhost:8080
- Example Receiver: http://localhost:3000
- Kafka UI: http://localhost:8090
- Health Check: http://localhost:8080/api/v1/liveness
- PostgreSQL: localhost:5432 (user: github_router, db: github_events)
- Kafka: localhost:9093

## Quick Start

### Development Setup

1. **Start the services:**
   ```bash
   docker-compose -f docker-compose.dev.yml up --build
   ```

2. **Register a subscriber** (in another terminal):
   ```bash
   curl -X POST http://localhost:8080/api/v1/subscribers \
     -H "Content-Type: application/json" \
     -d '{
       "name": "example-receiver",
       "events": ["push", "pull_request", "issues"],
       "transport": {
         "name": "https",
         "config": {
           "url": "http://example-receiver:3000",
           "webhook_secret": "dev-webhook-secret-123"
         }
       }
     }'
   ```

3. **Send a test webhook:**
   ```bash
   curl -X POST http://localhost:8080/webhook/github \
     -H "Content-Type: application/json" \
     -H "X-GitHub-Event: push" \
     -H "X-GitHub-Delivery: test-delivery-$(date +%s)" \
     -H "X-Hub-Signature-256: sha256=$(echo -n '{}' | openssl dgst -sha256 -hmac 'dev-webhook-secret-123' | cut -d' ' -f2)" \
     -d '{
       "ref": "refs/heads/main",
       "repository": {
         "name": "test-repo",
         "full_name": "test-org/test-repo"
       }
     }'
   ```

4. **Check logs:**
   ```bash
   # Router logs
   docker logs github-event-router-dev -f
   
   # Subscriber logs
   docker logs example-receiver-dev -f
   ```

5. **Stop services:**
   ```bash
   docker-compose -f docker-compose.dev.yml down
   ```

### Production Setup

1. **Start the services:**
   ```bash
   docker-compose -f docker-compose.prod.yml up --build -d
   ```

2. **Wait for services to be healthy:**
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

3. **Register a subscriber:**
   ```bash
   curl -X POST http://localhost:8080/api/v1/subscribers \
     -H "Content-Type: application/json" \
     -d '{
       "name": "example-receiver",
       "events": ["push", "pull_request", "issues"],
       "transport": {
         "name": "https",
         "config": {
           "url": "http://example-receiver:3000",
           "webhook_secret": "prod-webhook-secret-456"
         }
       }
     }'
   ```

4. **Send a test webhook:**
   ```bash
   curl -X POST http://localhost:8080/webhook/github \
     -H "Content-Type: application/json" \
     -H "X-GitHub-Event: push" \
     -H "X-GitHub-Delivery: test-delivery-$(date +%s)" \
     -H "X-Hub-Signature-256: sha256=$(echo -n '{}' | openssl dgst -sha256 -hmac 'prod-webhook-secret-456' | cut -d' ' -f2)" \
     -d '{
       "ref": "refs/heads/main",
       "repository": {
         "name": "test-repo",
         "full_name": "test-org/test-repo"
       }
     }'
   ```

5. **Monitor with Kafka UI:**
   Open http://localhost:8090 in your browser to see:
   - Topics and messages
   - Consumer groups
   - Message throughput

6. **Check logs:**
   ```bash
   # Receiver logs
   docker logs github-event-router-receiver -f
   
   # Worker logs
   docker logs github-event-router-worker -f
   
   # Subscriber logs
   docker logs example-receiver-prod -f
   ```

7. **Connect to PostgreSQL:**
   ```bash
   docker exec -it github-router-postgres psql -U github_router -d github_events
   ```
   
   Useful queries:
   ```sql
   -- List all subscribers
   SELECT * FROM subscribers;
   
   -- List recent events
   SELECT id, event_type, status, received_at FROM events ORDER BY received_at DESC LIMIT 10;
   
   -- List delivery attempts
   SELECT da.*, s.name as subscriber_name 
   FROM delivery_attempts da 
   JOIN subscribers s ON da.subscriber_id = s.id 
   ORDER BY da.attempted_at DESC LIMIT 10;
   ```

8. **Stop services:**
   ```bash
   docker-compose -f docker-compose.prod.yml down
   ```

   To remove volumes (reset data):
   ```bash
   docker-compose -f docker-compose.prod.yml down -v
   ```

## Architecture Comparison

### Development Setup Flow
```
GitHub → Router (8080) → In-Memory Queue → Router → Example Receiver (3000)
                ↓
            SQLite DB
```

### Production Setup Flow
```
GitHub → Router (8080) → Kafka → Worker(s) → Example Receiver (3000)
                ↓                    ↓
            PostgreSQL          PostgreSQL
```

## Troubleshooting

### Development Setup

**Issue:** Router can't start
```bash
# Check logs
docker logs github-event-router-dev

# Check if port 8080 is already in use
lsof -i :8080
```

**Issue:** Subscriber not receiving events
```bash
# Verify subscriber is registered
curl http://localhost:8080/api/v1/subscribers

# Check router logs for delivery attempts
docker logs github-event-router-dev | grep -i delivery
```

### Production Setup

**Issue:** Kafka not starting
```bash
# Check Kafka logs
docker logs github-router-kafka

# Verify Zookeeper is healthy
docker exec github-router-zookeeper zookeeper-shell localhost:2181 ls /brokers/ids
```

**Issue:** Worker can't connect to Kafka
```bash
# Check worker logs
docker logs github-event-router-worker

# Verify Kafka topics
docker exec github-router-kafka kafka-topics --list --bootstrap-server localhost:9092
```

**Issue:** PostgreSQL connection error
```bash
# Check PostgreSQL logs
docker logs github-router-postgres

# Test connection
docker exec github-router-postgres pg_isready -U github_router -d github_events
```

**Issue:** Reset everything
```bash
# Stop and remove all containers, networks, and volumes
docker-compose -f docker-compose.prod.yml down -v

# Remove images
docker-compose -f docker-compose.prod.yml down --rmi all -v
```

## Configuration

Both setups use configuration files in the `config/` directory:
- `config/docker-dev.yaml` - Development configuration
- `config/docker-prod.yaml` - Production configuration

You can modify these files to:
- Change log levels
- Adjust retry policies
- Configure rate limiting
- Modify queue settings

## Performance Testing

With the production setup, you can test scalability:

1. **Scale workers:**
   ```bash
   docker-compose -f docker-compose.prod.yml up --scale router-worker=4 -d
   ```

2. **Send bulk events:**
   ```bash
   for i in {1..100}; do
     curl -X POST http://localhost:8080/webhook/github \
       -H "Content-Type: application/json" \
       -H "X-GitHub-Event: push" \
       -H "X-GitHub-Delivery: test-$i" \
       -H "X-Hub-Signature-256: sha256=$(echo -n '{}' | openssl dgst -sha256 -hmac 'prod-webhook-secret-456' | cut -d' ' -f2)" \
       -d "{\"test\": $i}" &
   done
   wait
   ```

3. **Monitor throughput:**
   - Check Kafka UI: http://localhost:8090
   - Check PostgreSQL event counts
   - Monitor container resources: `docker stats`

## Next Steps

1. Configure with real GitHub App credentials
2. Set up ngrok or similar for webhook delivery from GitHub
3. Add more subscribers with different transports (Kafka, SQS, etc.)
4. Monitor metrics and tune performance
5. Deploy to production environment

## Notes

- **Development setup** stores data in `./data/` directory (SQLite database)
- **Production setup** uses named Docker volumes for persistence
- Both setups include health checks for reliable startup
- Example receiver simulates 20% random failures to test retry logic
- All secrets in these configs are for demonstration only - use proper secret management in production
