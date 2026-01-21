import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add payload and headers storage for proper retries
  await knex.schema.alterTable("events", (table) => {
    table.text("payload_data"); // JSON string
    table.text("headers_data"); // JSON string
  });

  // Create index for faster payload lookups during retries
  await knex.schema.alterTable("events", (table) => {
    table.index(["id", "github_delivery_id"], "idx_events_payload_lookup");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("events", (table) => {
    table.dropIndex(["id", "github_delivery_id"], "idx_events_payload_lookup");
    table.dropColumn("payload_data");
    table.dropColumn("headers_data");
  });
}
