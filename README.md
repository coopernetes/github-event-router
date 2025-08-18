# GitHub Event Router - Scale GitHub Apps in your organization

A GitHub App that acts as a central receiver of GitHub events of any kind and allows downstream Apps to subscribe to events. This helps large organizations scale their use of GitHub Apps and real-time integrations while keeping your GitHub Enterprise environment healthy & scalable.

The need for this project was born out of large-scale GitHub Enterprise Server environments. However, it can be deployed to any large GitHub organization and does not require GitHub Enterprise directly.

## Goals

- Efficiently aggregate GitHub events & distribute across multiple downstream "subscribers"
- Retries on failures
- Error handling that is configurable
- UI & CLI to register new GitHub Apps
- Allow subscribers to use existing tooling such as [Probot](https://probot.github.io/) and reuse webhook secrets for authentication
- Supports subscribers of events over HTTP (TLS), pubsub or queues

## Usage

1. **Install the GitHub Event Router App** in your organization. This is done like any other GitHub App. See [GitHub's documentation for instructions]().
2. **Configure downstream Apps** to subscribe to the events they need.
3. **Set up event forwarding** using the provided configuration file or environment variables.
4. **Monitor logs** to ensure events are being routed as expected.

## Architecture

The GitHub Event Router uses a robust, scalable architecture designed for enterprise environments:

### Core Components

- **Central Receiver:** Receives all GitHub webhook events with security validation and rate limiting
- **Event Processing Engine:** Queues, processes, and tracks all events with configurable retry mechanisms
- **Transport Layer:** Pluggable delivery system supporting HTTPS and Redis pub/sub
- **Health Monitoring:** Comprehensive system health monitoring with metrics and alerting
- **Persistent Storage:** Event audit trail and delivery tracking for reliability and debugging

### Event Flow

```
GitHub Webhook
      ↓
[Security Validation]
      ↓
[Event Storage & Queuing]
      ↓
[Subscriber Matching]
      ↓
[Transport Delivery] → [Retry Logic] → [Dead Letter Queue]
      ↓
[Audit & Monitoring]
```

### Key Features

- **Configurable Retry Logic:** Exponential/linear backoff with customizable retry policies
- **Event Auditing:** Complete audit trail of all events and delivery attempts
- **Health Monitoring:** Real-time system health with comprehensive metrics
- **Security:** Rate limiting, IP whitelisting, payload validation, and signature verification
- **Transport Flexibility:** Support for HTTPS webhooks and Redis pub/sub with pluggable architecture
- **Scalability:** Designed for high-throughput GitHub Enterprise environments

## Development

1. **Clone the repository:**
   ```sh
   git clone https://github.com/your-org/github-event-router.git
   cd github-event-router
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Run locally:**
   ```sh
   npm start
   ```
4. **Run tests:**
   ```sh
   npm test
   ```

## Contributing

Contributions are welcome! Please open issues or pull requests.  
Before submitting a PR, ensure:

- Code is linted and tested.
- Documentation is updated as needed.

## License

This project is licensed under the Apache-2.0 License.
