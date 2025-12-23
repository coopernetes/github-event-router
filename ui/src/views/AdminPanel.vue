<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useSubscribers } from '../composables/useSubscribers';

const { subscribers, error, isLoading, fetchSubscribers, deleteSubscriber } = useSubscribers();
const searchQuery = ref('');
const filterTransport = ref<string>('all');
const showDeleteConfirm = ref<number | null>(null);

onMounted(() => {
  fetchSubscribers();
});

const filteredSubscribers = computed(() => {
  let result = subscribers.value;

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (sub) =>
        sub.name.toLowerCase().includes(query) ||
        sub.events.some((event) => event.toLowerCase().includes(query))
    );
  }

  // Filter by transport type
  if (filterTransport.value !== 'all') {
    result = result.filter((sub) => sub.transport?.name === filterTransport.value);
  }

  return result;
});

const transportTypes = computed(() => {
  const types = new Set<string>();
  subscribers.value.forEach((sub) => {
    if (sub.transport?.name) {
      types.add(sub.transport.name);
    }
  });
  return Array.from(types).sort();
});

async function handleDelete(id: number) {
  if (showDeleteConfirm.value !== id) {
    showDeleteConfirm.value = id;
    return;
  }

  try {
    await deleteSubscriber(id);
    showDeleteConfirm.value = null;
  } catch (error) {
    console.error('Failed to delete subscriber:', error);
  }
}

function cancelDelete() {
  showDeleteConfirm.value = null;
}

function getTransportIcon(transportName: string | undefined): string {
  switch (transportName) {
    case 'https':
      return '🌐';
    case 'redis':
      return '📮';
    case 'kafka':
      return '📡';
    case 'sqs':
      return '☁️';
    case 'azure-eventhub':
      return '☁️';
    case 'amqp':
      return '📨';
    default:
      return '❓';
  }
}
</script>

<template>
  <div class="admin-panel">
    <div class="page-header">
      <div>
        <h1>Admin Panel</h1>
        <p class="text-secondary">Manage all registered subscribers</p>
      </div>
      <RouterLink to="/add-subscriber" class="btn-primary">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
        </svg>
        Add New Subscriber
      </RouterLink>
    </div>

    <!-- Filters -->
    <div class="filters-section card">
      <div class="filters-grid">
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">Search</label>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by name or event..."
            class="search-input"
          />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">Filter by Transport</label>
          <select v-model="filterTransport">
            <option value="all">All Transports</option>
            <option v-for="type in transportTypes" :key="type" :value="type">
              {{ getTransportIcon(type) }} {{ type }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="alert alert-error">
      {{ error }}
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading subscribers...</p>
    </div>

    <!-- Subscribers Table -->
    <div v-else-if="filteredSubscribers.length > 0" class="card">
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Transport</th>
              <th>Events</th>
              <th>Configuration</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="subscriber in filteredSubscribers" :key="subscriber.id">
              <td>
                <span class="id-badge">#{{ subscriber.id }}</span>
              </td>
              <td>
                <div class="subscriber-name-cell">
                  {{ subscriber.name }}
                </div>
              </td>
              <td>
                <span class="transport-badge">
                  <span class="transport-icon">{{ getTransportIcon(subscriber.transport?.name) }}</span>
                  {{ subscriber.transport?.name || 'None' }}
                </span>
              </td>
              <td>
                <div class="events-cell">
                  <span
                    v-for="(event, index) in subscriber.events.slice(0, 2)"
                    :key="index"
                    class="badge badge-primary"
                  >
                    {{ event }}
                  </span>
                  <span
                    v-if="subscriber.events.length > 2"
                    class="badge badge-secondary"
                  >
                    +{{ subscriber.events.length - 2 }}
                  </span>
                </div>
              </td>
              <td>
                <div class="config-cell">
                  <template v-if="subscriber.transport?.name === 'https'">
                    {{ (subscriber.transport.config as any).url }}
                  </template>
                  <template v-else-if="subscriber.transport?.name === 'redis'">
                    {{ (subscriber.transport.config as any).url }}
                  </template>
                  <template v-else-if="subscriber.transport?.name === 'kafka'">
                    {{ (subscriber.transport.config as any).topic }}
                  </template>
                  <template v-else>
                    -
                  </template>
                </div>
              </td>
              <td class="text-right">
                <div class="action-buttons">
                  <template v-if="showDeleteConfirm === subscriber.id">
                    <span class="confirm-text">Delete?</span>
                    <button
                      @click="handleDelete(subscriber.id)"
                      class="btn-danger btn-sm"
                    >
                      Yes
                    </button>
                    <button
                      @click="cancelDelete"
                      class="btn-secondary btn-sm"
                    >
                      No
                    </button>
                  </template>
                  <template v-else>
                    <button
                      @click="handleDelete(subscriber.id)"
                      class="btn-danger btn-sm"
                    >
                      Delete
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state card">
      <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
      </svg>
      <h3>No subscribers found</h3>
      <p v-if="searchQuery || filterTransport !== 'all'">
        Try adjusting your filters
      </p>
      <p v-else>Get started by adding your first subscriber</p>
    </div>
  </div>
</template>

<style scoped>
.admin-panel {
  max-width: 1400px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-2xl);
  gap: var(--spacing-lg);
}

.page-header .icon {
  width: 20px;
  height: 20px;
}

.text-secondary {
  color: var(--text-secondary);
  font-size: 1rem;
}

.filters-section {
  margin-bottom: var(--spacing-lg);
}

.filters-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--spacing-lg);
}

.search-input {
  width: 100%;
}

.loading-container {
  text-align: center;
  padding: var(--spacing-2xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
}

.table-container {
  overflow-x: auto;
}

.id-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  background-color: var(--bg-tertiary);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.subscriber-name-cell {
  font-weight: 500;
  color: var(--text-primary);
}

.transport-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
  background-color: var(--bg-tertiary);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.transport-icon {
  font-size: 0.875rem;
}

.events-cell {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.badge-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
}

.config-cell {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--spacing-sm);
}

.confirm-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.empty-state {
  text-align: center;
  padding: var(--spacing-2xl);
}

.empty-icon {
  width: 64px;
  height: 64px;
  color: var(--text-tertiary);
  margin: 0 auto var(--spacing-lg);
}

.empty-state h3 {
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
}

.empty-state p {
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .filters-grid {
    grid-template-columns: 1fr;
  }
}
</style>
