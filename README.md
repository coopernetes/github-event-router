# GitHub Event Router - Scale GitHub Apps in your organization

A GitHub App that acts as a central receiver of GitHub events of any kind and allows downstream Apps to subscribe to events. This helps large organizations scale their use of GitHub Apps and real-time integrations while keeping your GitHub Enterprise environment healthy & scalable.

The need for this project was born out of large-scale GitHub Enterprise Server environments. However, it can be deployed to any large GitHub organization and does not require GitHub Enterprise directly.

## Usage

1. **Install the GitHub Event Router App** in your organization. This is done like any other GitHub App. See [GitHub's documentation for instructions]().
2. **Configure downstream Apps** to subscribe to the events they need.
3. **Set up event forwarding** using the provided configuration file or environment variables.
4. **Monitor logs** to ensure events are being routed as expected.

## Architecture

- **Central Receiver:** The app receives all GitHub webhook events for your organization.
- **Event Filtering:** Events are filtered and routed based on downstream app subscriptions.
- **Downstream Delivery:** Events are forwarded to registered endpoints via HTTP POST.
- **Scalability:** Designed to handle high event throughput and multiple downstream consumers.

```
GitHub
   |
   v
[Event Router App]
   |         \
   v          v
[App A]    [App B]
```

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
