import { get } from 'config';

export interface ServerConfig {
    app: {
        id: number;
        client_id: string;
        client_secret: string;
        webhook_secret: string;
        private_key: string;
    }
}

export function loadConfig(): ServerConfig {
    return {
        app: {
            id: get('app.id') || 1, // Default to 1 if not set
            client_id: get('app.client_id') || '<your_client_id>',
            client_secret: get('app.client_secret') || '<your_client_secret>',
            webhook_secret: get('app.webhook_secret') || '<your_webhook_secret>',
            private_key: get('app.private_key') || '<your_private_key>'
        }
    }
}

export function startServer(config: ServerConfig) {
    console.log("Starting server...");
    console.log(`App ID: ${config.app.id}`);
    console.log(`Client ID: ${config.app.client_id}`);
    console.log(`Webhook Secret: ${config.app.webhook_secret}`);
}

