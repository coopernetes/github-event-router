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

  test("loads configuration correctly", () => {
    const mockGet = (key: string): unknown => {
      switch (key) {
        case "server.port":
          return 8080;
        case "app.webhook_secret":
          return "test-webhook";
        case "database":
          return {
            type: "sqlite",
            filename: ":memory:",
          };
        default:
          return undefined;
      }
    };

    (config.default.get as Mock).mockImplementation(mockGet);

    const loadedConfig = loadConfig();
    expect(loadedConfig).toEqual({
      server: {
        port: 8080,
      },
      app: {
        webhook_secret: "test-webhook",
      },
      database: {
        type: "sqlite",
        filename: ":memory:",
      },
    });
  });
});
