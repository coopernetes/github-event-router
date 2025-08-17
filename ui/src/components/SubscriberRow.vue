<script setup lang="ts">
import { ref, computed } from "vue";
import type {
  Subscriber,
  TransportConfig,
  HttpsTransportConfig,
  RedisTransportConfig,
} from "../types/subscriber";

const props = defineProps<{
  subscriber: Subscriber;
}>();

const emit = defineEmits<{
  update: [updatedSubscriber: Subscriber];
}>();

const isEditing = ref(false);
const editedName = ref(props.subscriber.name);
const editedEvents = ref(props.subscriber.events.join(", "));
const editedTransportConfig = ref(
  props.subscriber.transport
    ? JSON.stringify(props.subscriber.transport.config, null, 2)
    : JSON.stringify({}, null, 2)
);

const transportConfigError = ref("");
const eventsError = ref("");

function startEditing() {
  isEditing.value = true;
}

function cancelEditing() {
  isEditing.value = false;
  editedName.value = props.subscriber.name;
  editedEvents.value = props.subscriber.events.join(", ");
  editedTransportConfig.value = props.subscriber.transport
    ? JSON.stringify(props.subscriber.transport.config, null, 2)
    : JSON.stringify({}, null, 2);
  transportConfigError.value = "";
  eventsError.value = "";
}

function validateTransportConfig(config: unknown): {
  isValid: boolean;
  transportType: "https" | "redis" | null;
} {
  if (typeof config !== "object" || !config) {
    return { isValid: false, transportType: null };
  }

  // Check if it's an HTTPS transport config
  const httpsConfig = config as HttpsTransportConfig;
  if (
    typeof httpsConfig.url === "string" &&
    typeof httpsConfig.webhook_secret === "string"
  ) {
    return { isValid: true, transportType: "https" };
  }

  // Check if it's a Redis transport config
  const redisConfig = config as RedisTransportConfig;
  if (
    typeof redisConfig.url === "string" &&
    typeof redisConfig.password === "string"
  ) {
    return { isValid: true, transportType: "redis" };
  }

  return { isValid: false, transportType: null };
}

async function saveChanges() {
  // Validate events
  const eventsList = editedEvents.value
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (eventsList.length === 0) {
    eventsError.value = "At least one event is required";
    return;
  }

  // Validate transport config
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(editedTransportConfig.value);
  } catch (e) {
    transportConfigError.value = "Invalid JSON format";
    return;
  }

  const validation = validateTransportConfig(parsedConfig);
  if (!validation.isValid) {
    transportConfigError.value =
      "Invalid transport configuration format. Must have either (url + webhook_secret) for HTTPS or (url + password) for Redis";
    return;
  }

  const updatedSubscriber: Subscriber = {
    ...props.subscriber,
    name: editedName.value,
    events: eventsList,
    transport: {
      id: props.subscriber.transport?.id || 0,
      name: validation.transportType!,
      config: parsedConfig as TransportConfig,
    },
  };

  emit("update", updatedSubscriber);
  isEditing.value = false;
}

const configDisplay = computed(() => {
  if (!props.subscriber.transport) {
    return "No transport configured";
  }

  const config = props.subscriber.transport.config;
  if (props.subscriber.transport.name === "https") {
    const httpsConfig = config as HttpsTransportConfig;
    return `URL: ${httpsConfig.url}`;
  } else {
    const redisConfig = config as RedisTransportConfig;
    return `URL: ${redisConfig.url}`;
  }
});
</script>

<template>
  <tr>
    <td>
      <template v-if="isEditing">
        <input v-model="editedName" type="text" class="form-input" required />
      </template>
      <template v-else>
        {{ subscriber.name }}
      </template>
    </td>
    <td>
      <template v-if="isEditing">
        <input
          v-model="editedEvents"
          type="text"
          class="form-input"
          placeholder="Comma-separated events"
          :class="{ error: eventsError }"
        />
        <div v-if="eventsError" class="error-text">{{ eventsError }}</div>
      </template>
      <template v-else>
        {{ subscriber.events.join(", ") }}
      </template>
    </td>
    <td>{{ subscriber.transport?.name || "No transport" }}</td>
    <td>
      <template v-if="isEditing">
        <textarea
          v-model="editedTransportConfig"
          class="form-textarea"
          rows="4"
          :class="{ error: transportConfigError }"
        ></textarea>
        <div v-if="transportConfigError" class="error-text">
          {{ transportConfigError }}
        </div>
      </template>
      <template v-else>
        {{ configDisplay }}
      </template>
    </td>
    <td>
      <template v-if="isEditing">
        <button @click="saveChanges" class="btn btn-save">Save</button>
        <button @click="cancelEditing" class="btn btn-cancel">Cancel</button>
      </template>
      <template v-else>
        <button @click="startEditing" class="btn btn-edit">Edit</button>
      </template>
    </td>
  </tr>
</template>

<style scoped>
.form-input,
.form-textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 0.9rem;
}

.form-textarea {
  resize: vertical;
}

.error {
  border-color: #dc3545;
}

.error-text {
  color: #dc3545;
  font-size: 0.8rem;
  margin-top: 0.25rem;
}

.btn {
  padding: 0.375rem 0.75rem;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  margin: 0 0.25rem;
}

.btn-edit {
  background-color: #007bff;
  color: white;
  border: none;
}

.btn-save {
  background-color: #28a745;
  color: white;
  border: none;
}

.btn-cancel {
  background-color: #6c757d;
  color: white;
  border: none;
}

.btn:hover {
  opacity: 0.9;
}
</style>
