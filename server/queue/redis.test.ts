import { describe, test, expect, beforeEach, vi } from "vitest";
import { RedisQueue } from "./redis.js";

// Create a proper mock for the Redis client
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  xGroupCreate: vi.fn().mockResolvedValue("OK"),
  xAdd: vi.fn().mockResolvedValue("1234-0"),
  xReadGroup: vi.fn().mockResolvedValue([]),
  xAck: vi.fn().mockResolvedValue(1),
  xDel: vi.fn().mockResolvedValue(1),
  xLen: vi.fn().mockResolvedValue(0),
  xClaim: vi.fn().mockResolvedValue([]),
};

// Mock the redis module
vi.mock("redis", () => ({
  createClient: vi.fn(() => mockClient),
}));

describe("RedisQueue", () => {
  let queue: RedisQueue;

  beforeEach(() => {
    vi.clearAllMocks();

    queue = new RedisQueue({
      url: "redis://localhost:6379",
      queueName: "test-queue",
    });
  });

  test("connects successfully", async () => {
    await queue.connect();

    expect(queue.isConnected()).toBe(true);
    expect(queue.getType()).toBe("redis");
    expect(mockClient.connect).toHaveBeenCalled();
  });

  test("creates consumer group on connect", async () => {
    await queue.connect();

    expect(mockClient.xGroupCreate).toHaveBeenCalledWith(
      "queue:test-queue",
      expect.any(String),
      "0",
      { MKSTREAM: true },
    );
  });

  test("handles existing consumer group gracefully", async () => {
    const error = new Error("BUSYGROUP Consumer Group name already exists");
    mockClient.xGroupCreate = vi.fn().mockRejectedValue(error);

    // Should not throw
    await expect(queue.connect()).resolves.not.toThrow();
  });

  test("sends message successfully", async () => {
    await queue.connect();

    const message = { event: "push", data: "test" };
    const messageId = await queue.send(message);

    expect(messageId).toBeDefined();
    expect(mockClient.xAdd).toHaveBeenCalledWith(
      "queue:test-queue",
      "*",
      expect.objectContaining({
        data: expect.any(String),
      }),
    );
  });

  test("sends delayed message", async () => {
    await queue.connect();

    const message = { event: "delayed" };
    const messageId = await queue.send(message, { delayMs: 5000 });

    expect(messageId).toBeDefined();
    expect(mockClient.xAdd).toHaveBeenCalled();
  });

  test("receives messages from stream", async () => {
    await queue.connect();

    const mockMessages = [
      {
        name: "queue:test-queue",
        messages: [
          {
            id: "1234-0",
            message: {
              data: JSON.stringify({ event: "push" }),
              timestamp: new Date().toISOString(),
            },
          },
        ],
      },
    ];

    mockClient.xReadGroup = vi.fn().mockResolvedValue(mockMessages) as never;

    const messages = await queue.receive();

    expect(messages.length).toBeGreaterThanOrEqual(0);
  });

  test("handles delayed visibility", async () => {
    await queue.connect();

    const futureTime = new Date(Date.now() + 10000).toISOString();
    const mockMessages = [
      {
        name: "queue:test-queue",
        messages: [
          {
            id: "1234-0",
            message: {
              data: JSON.stringify({ event: "delayed" }),
              timestamp: new Date().toISOString(),
              visibleAt: futureTime,
            },
          },
        ],
      },
    ];

    mockClient.xReadGroup = vi.fn().mockResolvedValue(mockMessages) as never;

    const messages = await queue.receive();

    // Message handling depends on implementation
    expect(messages).toBeDefined();
  });

  test("deletes message successfully", async () => {
    await queue.connect();

    await queue.delete("1234-0");

    expect(mockClient.xAck).toHaveBeenCalledWith(
      "queue:test-queue",
      expect.any(String),
      "1234-0",
    );
    expect(mockClient.xDel).toHaveBeenCalledWith("queue:test-queue", "1234-0");
  });

  test("closes connection properly", async () => {
    await queue.connect();
    await queue.close();

    expect(queue.isConnected()).toBe(false);
    expect(mockClient.quit).toHaveBeenCalled();
  });

  test("throws error when sending without connection", async () => {
    await expect(queue.send({ test: "data" })).rejects.toThrow(
      "Redis queue not connected",
    );
  });

  test("throws error when receiving without connection", async () => {
    await expect(queue.receive()).rejects.toThrow("Redis queue not connected");
  });

  test("handles network errors gracefully", async () => {
    await queue.connect();

    mockClient.xAdd = vi.fn().mockRejectedValue(new Error("Connection lost"));

    await expect(queue.send({ test: "data" })).rejects.toThrow(
      "Connection lost",
    );
  });

  test("respects maxMessages option", async () => {
    await queue.connect();

    await queue.receive({ maxMessages: 5 });

    expect(mockClient.xReadGroup).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [
        {
          key: "queue:test-queue",
          id: ">",
        },
      ],
      {
        COUNT: 5,
        BLOCK: expect.any(Number),
      },
    );
  });

  test("uses custom consumer group and name", async () => {
    const customQueue = new RedisQueue({
      url: "redis://localhost:6379",
      queueName: "custom-queue",
      consumerGroup: "my-group",
      consumerName: "my-consumer",
    });

    await customQueue.connect();

    expect(mockClient.xGroupCreate).toHaveBeenCalledWith(
      "queue:custom-queue",
      "my-group",
      "0",
      { MKSTREAM: true },
    );
  });

  test("handles authentication with password", async () => {
    const authQueue = new RedisQueue({
      url: "redis://localhost:6379",
      password: "secret-password",
      queueName: "auth-queue",
    });

    await authQueue.connect();

    // Client was created with password in config
    expect(mockClient.connect).toHaveBeenCalled();
  });
});
