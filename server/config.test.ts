import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { loadConfig } from "./config.js";

// Mock the config module
vi.mock("config", () => {
  return {
    default: {
      get: vi.fn(),
    },
  };
});

// Import the mocked module with correct typing
import type { IConfig } from "config";
const config = (await import("config")) as unknown as { default: IConfig };

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("returns default values when no config is set", () => {
    const loadedConfig = loadConfig();
    expect(loadedConfig).toEqual({
      app: {
        id: 1,
        client_id: "<your_client_id>",
        client_secret: "<your_client_secret>",
        webhook_secret: "<your_webhook_secret>",
        private_key: "<your_private_key>",
      },
      receivers: [],
    });
  });

  test("returns custom values when config is set", () => {
    const mockConfig: { [key: string]: number | string } = {
      "app.id": 123,
      "app.client_id": "test-client",
      "app.client_secret": "test-secret",
      "app.webhook_secret": "test-webhook",
      "app.private_key": "test-key",
    };

    // Use Mock from Vitest instead of jest.Mock
    (config.default.get as Mock).mockImplementation(
      (key: string) => mockConfig[key]
    );

    const loadedConfig = loadConfig();
    expect(loadedConfig).toEqual({
      app: {
        id: 123,
        client_id: "test-client",
        client_secret: "test-secret",
        webhook_secret: "test-webhook",
        private_key: "test-key",
      },
      receivers: [],
    });
  });
});
