import { describe, test, expect, vi, beforeEach } from "vitest";
import { startServer } from "./app.js";
import { loadConfig, setAppConfig } from "./config.js";
import type { Config } from "./config.js";

// Mock the config module
vi.mock("./config.js", () => ({
  loadConfig: vi.fn(),
  setAppConfig: vi.fn(),
}));

describe("startServer", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  test("logs correct server information", () => {
    const testConfig: Config = {
      app: {
        id: 123,
        webhook_secret: "test-webhook",
        private_key: "test-key",
      },
      subscribers: [
        {
          id: 1,
          name: 'foo',
          events: [],
          transport: {
            id: 1,
            name: 'https',
            config: {
              webhook_secret: "receiver-webhook",
              url: "http://localhost/webhook",
            },
          },
        },
      ],
      server: {
        port: 3000,
      },
      database: undefined,
    };

    // Mock loadConfig to return our test config
    vi.mocked(loadConfig).mockReturnValue(testConfig);

    startServer();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(setAppConfig).toHaveBeenCalledWith(testConfig);
    expect(console.log).toHaveBeenCalledWith("Starting server...");
    expect(console.log).toHaveBeenCalledWith("App ID: 123");
    expect(console.log).toHaveBeenCalledWith("Client ID: test-client");
    expect(console.log).toHaveBeenCalledWith("Webhook Secret: test-webhook");
    expect(console.log).toHaveBeenCalledTimes(4);
  });
});
