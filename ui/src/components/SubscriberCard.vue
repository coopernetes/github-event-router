<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Subscriber } from '../types/subscriber';
import { useSubscribers } from '../composables/useSubscribers';

const props = defineProps<{
  subscriber: Subscriber;
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const { deleteSubscriber } = useSubscribers();
const showDeleteConfirm = ref(false);
const isDeleting = ref(false);

const transportIcon = computed(() => {
  const transport = props.subscriber.transport?.name;
  switch (transport) {
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
});

const eventList = computed(() => {
  return props.subscriber.events.slice(0, 3);
});

const moreEvents = computed(() => {
  const remaining = props.subscriber.events.length - 3;
  return remaining > 0 ? remaining : 0;
});

async function handleDelete() {
  if (!showDeleteConfirm.value) {
    showDeleteConfirm.value = true;
    return;
  }

  isDeleting.value = true;
  try {
    await deleteSubscriber(props.subscriber.id);
    emit('refresh');
  } catch (error) {
    console.error('Failed to delete subscriber:', error);
  } finally {
    isDeleting.value = false;
    showDeleteConfirm.value = false;
  }
}

function cancelDelete() {
  showDeleteConfirm.value = false;
}
</script>

<template>
  <div class="subscriber-card">
    <div class="card-header">
      <div class="header-top">
        <h3 class="subscriber-name">{{ subscriber.name }}</h3>
        <span class="transport-badge">
          <span class="transport-icon">{{ transportIcon }}</span>
          {{ subscriber.transport?.name || 'No transport' }}
        </span>
      </div>
    </div>

    <div class="card-body">
      <div class="info-section">
        <div class="info-label">Events</div>
        <div class="event-tags">
          <span
            v-for="event in eventList"
            :key="event"
            class="badge badge-primary"
          >
            {{ event }}
          </span>
          <span v-if="moreEvents > 0" class="badge badge-secondary">
            +{{ moreEvents }} more
          </span>
        </div>
      </div>

      <div v-if="subscriber.transport" class="info-section">
        <div class="info-label">Transport Configuration</div>
        <div class="config-preview">
          <template v-if="subscriber.transport.name === 'https'">
            <div class="config-item">
              <span class="config-key">URL:</span>
              <span class="config-value">{{ (subscriber.transport.config as any).url }}</span>
            </div>
          </template>
          <template v-else-if="subscriber.transport.name === 'redis'">
            <div class="config-item">
              <span class="config-key">URL:</span>
              <span class="config-value">{{ (subscriber.transport.config as any).url }}</span>
            </div>
          </template>
          <template v-else-if="subscriber.transport.name === 'kafka'">
            <div class="config-item">
              <span class="config-key">Brokers:</span>
              <span class="config-value">{{ (subscriber.transport.config as any).brokers?.join(', ') }}</span>
            </div>
            <div class="config-item">
              <span class="config-key">Topic:</span>
              <span class="config-value">{{ (subscriber.transport.config as any).topic }}</span>
            </div>
          </template>
          <template v-else>
            <div class="config-item">
              <span class="config-value">{{ subscriber.transport.name }} transport</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <RouterLink 
        :to="`/admin`" 
        class="btn-secondary btn-sm"
      >
        View Details
      </RouterLink>
      
      <div v-if="showDeleteConfirm" class="delete-confirm">
        <span class="confirm-text">Delete?</span>
        <button 
          @click="handleDelete" 
          class="btn-danger btn-sm"
          :disabled="isDeleting"
        >
          {{ isDeleting ? 'Deleting...' : 'Yes' }}
        </button>
        <button 
          @click="cancelDelete" 
          class="btn-secondary btn-sm"
          :disabled="isDeleting"
        >
          No
        </button>
      </div>
      <button 
        v-else
        @click="handleDelete" 
        class="btn-danger btn-sm"
      >
        Delete
      </button>
    </div>
  </div>
</template>

<style scoped>
.subscriber-card {
  background-color: var(--bg-primary);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  overflow: hidden;
  transition: all 0.2s;
}

.subscriber-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.card-header {
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--border-light);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
}

.subscriber-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  flex: 1;
  word-break: break-word;
}

.transport-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  background-color: var(--bg-tertiary);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.transport-icon {
  font-size: 1rem;
}

.card-body {
  padding: var(--spacing-lg);
}

.info-section {
  margin-bottom: var(--spacing-lg);
}

.info-section:last-child {
  margin-bottom: 0;
}

.info-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-sm);
}

.event-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.badge-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
}

.config-preview {
  background-color: var(--bg-secondary);
  border-radius: 0.375rem;
  padding: var(--spacing-md);
  font-size: 0.875rem;
}

.config-item {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}

.config-item:last-child {
  margin-bottom: 0;
}

.config-key {
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 80px;
}

.config-value {
  color: var(--text-primary);
  word-break: break-all;
  flex: 1;
}

.card-footer {
  padding: var(--spacing-lg);
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm);
}

.delete-confirm {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.confirm-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
