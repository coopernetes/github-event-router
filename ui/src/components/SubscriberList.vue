<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { Subscriber } from "../types/subscriber";
import SubscriberRow from "./SubscriberRow.vue";

const subscribers = ref<Subscriber[]>([]);
const error = ref<string | null>(null);
const isLoading = ref(true);

async function fetchSubscribers() {
  try {
    const response = await fetch("/api/v1/subscribers");
    if (!response.ok) {
      throw new Error("Failed to fetch subscribers");
    }
    const data = await response.json();
    // Add some debug logging
    console.log("Received subscribers:", data);
    subscribers.value = data;
  } catch (e) {
    console.error("Error fetching subscribers:", e);
    error.value = e instanceof Error ? e.message : "An error occurred";
  } finally {
    isLoading.value = false;
  }
}

async function handleSubscriberUpdate(updatedSubscriber: Subscriber) {
  try {
    const response = await fetch(
      `/api/v1/subscribers/${updatedSubscriber.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedSubscriber),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update subscriber");
    }

    // Refresh the list after successful update
    await fetchSubscribers();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Failed to update subscriber";
  }
}

onMounted(fetchSubscribers);
</script>

<template>
  <div class="subscribers-container">
    <h2>Subscribers</h2>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-if="isLoading" class="loading">Loading subscribers...</div>

    <table v-else class="subscribers-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Events</th>
          <th>Transport Type</th>
          <th>Transport Config</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <SubscriberRow
          v-for="subscriber in subscribers"
          :key="subscriber.id"
          :subscriber="subscriber"
          @update="handleSubscriberUpdate"
        />
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.subscribers-container {
  padding: 1rem;
}

.error-message {
  color: #dc3545;
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid #dc3545;
  border-radius: 4px;
  background-color: #f8d7da;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.subscribers-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

.subscribers-table th,
.subscribers-table td {
  padding: 0.75rem;
  border: 1px solid #dee2e6;
  text-align: left;
}

.subscribers-table th {
  background-color: #f8f9fa;
  font-weight: 600;
}

.subscribers-table tr:nth-child(even) {
  background-color: #f8f9fa;
}
</style>
