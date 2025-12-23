import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create events table for audit and retry
  await knex.schema.createTable("events", (table) => {
    table.increments("id").primary();
    table.text("github_delivery_id").notNullable().unique();
    table.text("event_type").notNullable();
    table.text("payload_hash").notNullable();
    table.integer("payload_size").notNullable();
    table.timestamp("received_at").defaultTo(knex.fn.now());
    table.timestamp("processed_at");
    table
      .text("status")
      .defaultTo("pending")
      .checkIn(["pending", "processing", "completed", "failed", "dead_letter"]);
  });

  // Create delivery_attempts table for tracking
  await knex.schema.createTable("delivery_attempts", (table) => {
    table.increments("id").primary();
    table
      .integer("event_id")
      .notNullable()
      .references("id")
      .inTable("events")
      .onDelete("CASCADE");
    table
      .integer("subscriber_id")
      .notNullable()
      .references("id")
      .inTable("subscribers")
      .onDelete("CASCADE");
    table.integer("attempt_number").notNullable().defaultTo(1);
    table.integer("status_code");
    table.text("error_message");
    table.timestamp("attempted_at").defaultTo(knex.fn.now());
    table.integer("duration_ms");
    table.timestamp("next_retry_at");
  });

  // Create indexes for performance
  await knex.schema.alterTable("events", (table) => {
    table.index("status", "idx_events_status");
    table.index("received_at", "idx_events_received_at");
    table.index("github_delivery_id", "idx_events_github_delivery_id");
  });

  await knex.schema.alterTable("delivery_attempts", (table) => {
    table.index(
      ["event_id", "subscriber_id"],
      "idx_delivery_attempts_event_subscriber"
    );
    table.index("next_retry_at", "idx_delivery_attempts_next_retry");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("delivery_attempts");
  await knex.schema.dropTableIfExists("events");
}
