# Test Webhook Payloads

This directory contains sample webhook payloads for testing the GitHub Event Router.

## Usage

Send a test webhook using the script:

```bash
node scripts/send-test-webhook.js test-payloads/push.json
```

## Available Payloads

- **push.json** - Push event to main branch
- **pull_request.json** - Pull request opened event
- **issues.json** - Issue opened event

## Custom Payloads

You can add your own payload files here. The script will:
1. Auto-detect the event type from the filename (e.g., `push.json` → `push` event)
2. Or you can specify it manually: `node scripts/send-test-webhook.js my-payload.json foobarbaz123 custom_event`

## Testing with Real Payloads

To test with real GitHub payloads:

1. Go to your GitHub webhook settings
2. Click on a recent delivery
3. Copy the payload JSON
4. Save it to a file in this directory
5. Run the test script with that file

Example:
```bash
# Copy real payload from GitHub webhook delivery
echo '{ ... }' > test-payloads/real-push.json

# Send it to your local router
node scripts/send-test-webhook.js test-payloads/real-push.json
```
