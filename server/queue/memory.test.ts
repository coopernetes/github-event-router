import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { InMemoryQueue } from "./memory.js";

describe("InMemoryQueue", () => {
  let queue: InMemoryQueue;

  beforeEach(async () => {
    queue = new InMemoryQueue({
      maxRetries: 3,
      visibilityTimeout: 5000,
    });
    await queue.connect();
  });

  afterEach(async () => {
    await queue.close();
  });

  test("connects successfully", async () => {
    expect(queue.isConnected()).toBe(true);
    expect(queue.getType()).toBe("memory");
  });

  test("sends message and returns ID", async () => {
    const message = { test: "data", value: 123 };
    const messageId = await queue.send(message);

    expect(messageId).toBeDefined();
    expect(typeof messageId).toBe("string");
  });

  test("receives messages", async () => {
    const message1 = { event: "push", id: 1 };
    const message2 = { event: "pull_request", id: 2 };

    await queue.send(message1);
    await queue.send(message2);

    const messages = await queue.receive({ maxMessages: 2 });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.data).toEqual(message1);
    expect(messages[1]?.data).toEqual(message2);
  });

  test("respects maxMessages limit", async () => {
    await queue.send({ id: 1 });
    await queue.send({ id: 2 });
    await queue.send({ id: 3 });

    const messages = await queue.receive({ maxMessages: 2 });

    expect(messages).toHaveLength(2);
  });

  test("handles visibility timeout", async () => {
    const message = { test: "visibility" };
    await queue.send(message);

    // Receive message
    const messages1 = await queue.receive();
    expect(messages1).toHaveLength(1);

    // Try to receive again immediately - should be empty (message invisible)
    const messages2 = await queue.receive();
    expect(messages2).toHaveLength(0);

    // Delete the message
    if (messages1[0]) {
      await queue.delete(messages1[0].id);
    }
  });

  test("deletes messages", async () => {
    const message = { test: "delete" };
    await queue.send(message);

    const messages = await queue.receive();
    expect(messages).toHaveLength(1);

    if (messages[0]) {
      await queue.delete(messages[0].id);
    }

    // Wait for visibility timeout and check message is gone
    await new Promise((resolve) => setTimeout(resolve, 100));
    const messagesAfterDelete = await queue.receive({ waitTimeMs: 100 });
    expect(messagesAfterDelete).toHaveLength(0);
  });

  test("supports delayed messages", async () => {
    const message = { test: "delayed" };
    await queue.send(message, { delayMs: 100 });

    // Should not be visible immediately
    const messages1 = await queue.receive({ waitTimeMs: 10 });
    expect(messages1).toHaveLength(0);

    // Wait for delay to pass
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should now be visible
    const messages2 = await queue.receive();
    expect(messages2).toHaveLength(1);
    expect(messages2[0]?.data).toEqual(message);
  });

  test("handles dead letter queue configuration", async () => {
    const queueWithDLQ = new InMemoryQueue({
      maxRetries: 2,
      visibilityTimeout: 100,
      deadLetterQueue: {
        enabled: true,
        maxReceiveCount: 2,
      },
    });
    await queueWithDLQ.connect();

    const message = { test: "dlq" };
    await queueWithDLQ.send(message);

    // Verify message was sent
    const messages = await queueWithDLQ.receive();
    expect(messages.length).toBeGreaterThan(0);

    // Clean up
    await queueWithDLQ.close();
  });

  test("cleans up on close", async () => {
    await queue.send({ test: "cleanup" });
    await queue.close();

    expect(queue.isConnected()).toBe(false);
  });

  test("handles empty queue gracefully", async () => {
    const messages = await queue.receive({ waitTimeMs: 10 });
    expect(messages).toHaveLength(0);
  });

  test("processes messages with different data types", async () => {
    const stringMessage = "test string";
    const numberMessage = 42;
    const objectMessage = { nested: { data: "value" } };
    const arrayMessage = [1, 2, 3];

    await queue.send(stringMessage);
    await queue.send(numberMessage);
    await queue.send(objectMessage);
    await queue.send(arrayMessage);

    const messages = await queue.receive({ maxMessages: 4 });

    expect(messages).toHaveLength(4);
    expect(messages[0]?.data).toBe(stringMessage);
    expect(messages[1]?.data).toBe(numberMessage);
    expect(messages[2]?.data).toEqual(objectMessage);
    expect(messages[3]?.data).toEqual(arrayMessage);
  });
});
