// MongoDB initialization script
// Run this with: mongosh <connection-string> < 001_initialize.js

// Create collections with validation
db.createCollection("subscribers", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "name", "events"],
      properties: {
        id: {
          bsonType: "int",
          description: "Unique subscriber ID"
        },
        name: {
          bsonType: "string",
          description: "Subscriber name"
        },
        events: {
          bsonType: "string",
          description: "JSON array of event types"
        }
      }
    }
  }
});

db.createCollection("transports", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "subscriber_id", "name", "config"],
      properties: {
        id: {
          bsonType: "int",
          description: "Unique transport ID"
        },
        subscriber_id: {
          bsonType: "int",
          description: "Reference to subscriber"
        },
        name: {
          bsonType: "string",
          description: "Transport type (https, redis, etc.)"
        },
        config: {
          bsonType: "string",
          description: "JSON configuration for transport"
        }
      }
    }
  }
});

db.createCollection("events", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "github_delivery_id", "event_type", "payload_hash", "payload_size", "received_at", "status"],
      properties: {
        id: {
          bsonType: "int",
          description: "Unique event ID"
        },
        github_delivery_id: {
          bsonType: "string",
          description: "GitHub delivery ID"
        },
        event_type: {
          bsonType: "string",
          description: "Type of GitHub event"
        },
        payload_hash: {
          bsonType: "string",
          description: "SHA256 hash of payload"
        },
        payload_size: {
          bsonType: "int",
          description: "Size of payload in bytes"
        },
        payload_data: {
          bsonType: ["string", "null"],
          description: "Event payload data"
        },
        headers_data: {
          bsonType: ["string", "null"],
          description: "Encrypted headers"
        },
        received_at: {
          bsonType: "string",
          description: "ISO timestamp when event was received"
        },
        processed_at: {
          bsonType: ["string", "null"],
          description: "ISO timestamp when event was processed"
        },
        status: {
          enum: ["pending", "processing", "completed", "failed", "dead_letter"],
          description: "Event processing status"
        }
      }
    }
  }
});

db.createCollection("delivery_attempts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "event_id", "subscriber_id", "attempt_number", "attempted_at"],
      properties: {
        id: {
          bsonType: "int",
          description: "Unique attempt ID"
        },
        event_id: {
          bsonType: "int",
          description: "Reference to event"
        },
        subscriber_id: {
          bsonType: "int",
          description: "Reference to subscriber"
        },
        attempt_number: {
          bsonType: "int",
          description: "Attempt number"
        },
        status_code: {
          bsonType: ["int", "null"],
          description: "HTTP status code or error code"
        },
        error_message: {
          bsonType: ["string", "null"],
          description: "Error message if delivery failed"
        },
        attempted_at: {
          bsonType: "string",
          description: "ISO timestamp of attempt"
        },
        duration_ms: {
          bsonType: ["int", "null"],
          description: "Duration of delivery attempt in milliseconds"
        },
        next_retry_at: {
          bsonType: ["string", "null"],
          description: "ISO timestamp for next retry"
        }
      }
    }
  }
});

// Create indexes
db.subscribers.createIndex({ id: 1 }, { unique: true });
db.transports.createIndex({ subscriber_id: 1 });
db.transports.createIndex({ id: 1 }, { unique: true });
db.events.createIndex({ github_delivery_id: 1 }, { unique: true });
db.events.createIndex({ status: 1 });
db.events.createIndex({ received_at: -1 });
db.events.createIndex({ id: 1 }, { unique: true });
db.delivery_attempts.createIndex({ event_id: 1, subscriber_id: 1 });
db.delivery_attempts.createIndex({ next_retry_at: 1 }, { sparse: true });
db.delivery_attempts.createIndex({ id: 1 }, { unique: true });

// Create counter collection for auto-increment IDs
db.createCollection("counters");
db.counters.insertMany([
  { _id: "subscribers", seq: 0 },
  { _id: "transports", seq: 0 },
  { _id: "events", seq: 0 },
  { _id: "delivery_attempts", seq: 0 }
]);

print("MongoDB collections and indexes created successfully");
