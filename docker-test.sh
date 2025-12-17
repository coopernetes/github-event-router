#!/bin/bash
# Helper script for Docker Compose testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    print_info "Docker is running"
}

# Function to start development setup
start_dev() {
    print_info "Starting development setup (SQLite + In-Memory Queue)..."
    
    mkdir -p data
    
    docker-compose -f docker-compose.dev.yml up --build -d
    
    print_info "Waiting for services to be healthy..."
    sleep 10
    
    if docker ps | grep -q "github-event-router-dev"; then
        print_info "✓ Development setup is running!"
        echo ""
        print_info "Access points:"
        echo "  - Router:            http://localhost:8080"
        echo "  - Example Receiver:  http://localhost:3000"
        echo "  - Health Check:      http://localhost:8080/api/v1/liveness"
        echo ""
        print_info "View logs with:"
        echo "  docker logs github-event-router-dev -f"
        echo ""
        print_info "Register a subscriber:"
        echo '  curl -X POST http://localhost:8080/api/v1/subscribers \'
        echo '    -H "Content-Type: application/json" \'
        echo '    -d '"'"'{"name":"example","events":["push"],"transport":{"name":"https","config":{"url":"http://example-receiver:3000","webhook_secret":"dev-webhook-secret-123"}}}'"'"
    else
        print_error "Failed to start development setup"
        exit 1
    fi
}

# Function to start production setup
start_prod() {
    print_info "Starting production setup (PostgreSQL + Kafka + Redis)..."
    
    docker-compose -f docker-compose.prod.yml up --build -d
    
    print_info "Waiting for services to be healthy (this may take up to 2 minutes)..."
    
    # Wait for PostgreSQL
    print_info "Waiting for PostgreSQL..."
    for i in {1..30}; do
        if docker exec github-router-postgres pg_isready -U github_router -d github_events > /dev/null 2>&1; then
            print_info "✓ PostgreSQL is ready"
            break
        fi
        sleep 2
    done
    
    # Wait for Kafka
    print_info "Waiting for Kafka..."
    for i in {1..30}; do
        if docker exec github-router-kafka kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null 2>&1; then
            print_info "✓ Kafka is ready"
            break
        fi
        sleep 2
    done
    
    # Wait for router
    print_info "Waiting for router..."
    for i in {1..20}; do
        if curl -s http://localhost:8080/api/v1/liveness > /dev/null 2>&1; then
            print_info "✓ Router is ready"
            break
        fi
        sleep 2
    done
    
    print_info "✓ Production setup is running!"
    echo ""
    print_info "Access points:"
    echo "  - Router:            http://localhost:8080"
    echo "  - Example Receiver:  http://localhost:3000"
    echo "  - Kafka UI:          http://localhost:8090"
    echo "  - PostgreSQL:        localhost:5432 (user: github_router, db: github_events)"
    echo ""
    print_info "View logs with:"
    echo "  docker logs github-event-router-receiver -f"
    echo "  docker logs github-event-router-worker -f"
    echo ""
    print_info "Register a subscriber:"
    echo '  curl -X POST http://localhost:8080/api/v1/subscribers \'
    echo '    -H "Content-Type: application/json" \'
    echo '    -d '"'"'{"name":"example","events":["push"],"transport":{"name":"https","config":{"url":"http://example-receiver:3000","webhook_secret":"prod-webhook-secret-456"}}}'"'"
}

# Function to stop services
stop() {
    local compose_file=$1
    print_info "Stopping services..."
    docker-compose -f "$compose_file" down
    print_info "✓ Services stopped"
}

# Function to clean up (stop and remove volumes)
clean() {
    local compose_file=$1
    print_info "Cleaning up services and volumes..."
    docker-compose -f "$compose_file" down -v
    print_info "✓ Cleanup complete"
}

# Function to show logs
logs() {
    local compose_file=$1
    local service=$2
    
    if [ -z "$service" ]; then
        docker-compose -f "$compose_file" logs -f
    else
        docker-compose -f "$compose_file" logs -f "$service"
    fi
}

# Function to show status
status() {
    print_info "Development setup:"
    docker-compose -f docker-compose.dev.yml ps
    echo ""
    print_info "Production setup:"
    docker-compose -f docker-compose.prod.yml ps
}

# Function to send test webhook
test_webhook() {
    local env=$1
    local secret="dev-webhook-secret-123"
    local port="8080"
    
    if [ "$env" = "prod" ]; then
        secret="prod-webhook-secret-456"
    fi
    
    print_info "Sending test webhook to $env environment..."
    
    local payload='{"ref":"refs/heads/main","repository":{"name":"test-repo","full_name":"test-org/test-repo"},"pusher":{"name":"testuser"}}'
    local delivery_id="test-delivery-$(date +%s)"
    
    curl -X POST "http://localhost:$port/webhook/github" \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: push" \
        -H "X-GitHub-Delivery: $delivery_id" \
        -H "X-Hub-Signature-256: sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$secret" | cut -d' ' -f2)" \
        -d "$payload"
    
    echo ""
    print_info "Check logs to see if event was processed"
}

# Main script
case "$1" in
    start-dev)
        check_docker
        start_dev
        ;;
    start-prod)
        check_docker
        start_prod
        ;;
    stop-dev)
        stop docker-compose.dev.yml
        ;;
    stop-prod)
        stop docker-compose.prod.yml
        ;;
    clean-dev)
        clean docker-compose.dev.yml
        ;;
    clean-prod)
        clean docker-compose.prod.yml
        ;;
    logs-dev)
        logs docker-compose.dev.yml "$2"
        ;;
    logs-prod)
        logs docker-compose.prod.yml "$2"
        ;;
    status)
        status
        ;;
    test-dev)
        test_webhook dev
        ;;
    test-prod)
        test_webhook prod
        ;;
    *)
        echo "GitHub Event Router - Docker Helper Script"
        echo ""
        echo "Usage: $0 {command}"
        echo ""
        echo "Commands:"
        echo "  start-dev      Start development setup (SQLite + In-Memory)"
        echo "  start-prod     Start production setup (PostgreSQL + Kafka)"
        echo "  stop-dev       Stop development setup"
        echo "  stop-prod      Stop production setup"
        echo "  clean-dev      Stop and remove development volumes"
        echo "  clean-prod     Stop and remove production volumes"
        echo "  logs-dev       View development logs (optional: specify service)"
        echo "  logs-prod      View production logs (optional: specify service)"
        echo "  status         Show status of all services"
        echo "  test-dev       Send test webhook to development"
        echo "  test-prod      Send test webhook to production"
        echo ""
        echo "Examples:"
        echo "  $0 start-dev"
        echo "  $0 logs-prod router"
        echo "  $0 test-dev"
        echo "  $0 clean-prod"
        exit 1
        ;;
esac
