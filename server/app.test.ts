import { describe, test, expect, vi, beforeEach } from 'vitest';
import { loadConfig, startServer, type ServerConfig } from './app.js';
import { get } from 'config';

// server/app.test.ts

// Mock the config module
vi.mock('config', () => ({
    get: vi.fn()
}));


describe('loadConfig', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    test('returns default values when no config is set', () => {
        const config = loadConfig();
        expect(config).toEqual({
            app: {
                id: 1,
                client_id: '<your_client_id>',
                client_secret: '<your_client_secret>',
                webhook_secret: '<your_webhook_secret>',
                private_key: '<your_private_key>'
            }
        });
    });

    test('returns custom values when config is set', () => {
        const mockConfig: { [key: string]: number | string } = {
            'app.id': 123,
            'app.client_id': 'test-client',
            'app.client_secret': 'test-secret',
            'app.webhook_secret': 'test-webhook',
            'app.private_key': 'test-key'
        };

        (get as any).mockImplementation((key: string) => mockConfig[key]);

        const config = loadConfig();
        expect(config).toEqual({
            app: {
                id: 123,
                client_id: 'test-client',
                client_secret: 'test-secret',
                webhook_secret: 'test-webhook',
                private_key: 'test-key'
            }
        });
    });
});

describe('startServer', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    test('logs correct server information', () => {
        const testConfig: ServerConfig = {
            app: {
                id: 123,
                client_id: 'test-client',
                client_secret: 'test-secret',
                webhook_secret: 'test-webhook',
                private_key: 'test-key'
            }
        };

        startServer(testConfig);

        expect(console.log).toHaveBeenCalledWith('Starting server...');
        expect(console.log).toHaveBeenCalledWith('App ID: 123');
        expect(console.log).toHaveBeenCalledWith('Client ID: test-client');
        expect(console.log).toHaveBeenCalledWith('Webhook Secret: test-webhook');
        expect(console.log).toHaveBeenCalledTimes(4);
    });
});