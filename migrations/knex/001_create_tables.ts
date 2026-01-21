import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create subscribers table
  await knex.schema.createTable("subscribers", (table) => {
    table.increments("id").primary();
    table.text("name").notNullable();
    table.text("events").notNullable();
  });

  // Create transports table
  await knex.schema.createTable("transports", (table) => {
    table.increments("id").primary();
    table
      .integer("subscriber_id")
      .notNullable()
      .references("id")
      .inTable("subscribers")
      .onDelete("CASCADE");
    table.text("name").notNullable();
    table.binary("config").notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("transports");
  await knex.schema.dropTableIfExists("subscribers");
}
