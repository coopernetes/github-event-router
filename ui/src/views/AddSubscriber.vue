<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSubscribers } from '../composables/useSubscribers';
import type { TransportName } from '../types/subscriber';

const router = useRouter();
const { createSubscriber, error: subscriberError } = useSubscribers();

// Wizard state
const currentStep = ref(1);
const totalSteps = 4;

// Form data
const name = ref('');
const selectedEvents = ref<string[]>([]);
const transportType = ref<TransportName>('https');
const transportConfig = ref<Record<string, any>>({});

// Form errors
const errors = ref<Record<string, string>>({});
const isSubmitting = ref(false);

// Available GitHub events
const availableEvents = [
  'push',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'issues',
  'create',
  'delete',
  'release',
  'status',
  'check_run',
  'check_suite',
  'deployment',
  'deployment_status',
  'fork',
  'watch',
  'star',
  'member',
  'public',
  'organization',
  'repository',
  'team',
  'team_add',
];

// Transport types with descriptions
const transportTypes = [
  {
    value: 'https' as TransportName,
    label: 'HTTPS Webhook',
    icon: '🌐',
    description: 'Send events to an HTTPS endpoint',
  },
  {
    value: 'redis' as TransportName,
    label: 'Redis Pub/Sub',
    icon: '📮',
    description: 'Publish events to a Redis channel',
  },
  {
    value: 'kafka' as TransportName,
    label: 'Apache Kafka',
    icon: '📡',
    description: 'Send events to a Kafka topic',
  },
  {
    value: 'sqs' as TransportName,
    label: 'AWS SQS',
    icon: '☁️',
    description: 'Send events to an AWS SQS queue',
  },
  {
    value: 'azure-eventhub' as TransportName,
    label: 'Azure Event Hub',
    icon: '☁️',
    description: 'Send events to Azure Event Hub',
  },
  {
    value: 'amqp' as TransportName,
    label: 'AMQP (RabbitMQ)',
    icon: '📨',
    description: 'Send events via AMQP protocol',
  },
];

// Get transport config fields based on selected type
const transportConfigFields = computed(() => {
  switch (transportType.value) {
    case 'https':
      return [
        { name: 'url', label: 'Webhook URL', type: 'text', placeholder: 'https://example.com/webhook', required: true },
        { name: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'Your webhook secret', required: true },
      ];
    case 'redis':
      return [
        { name: 'url', label: 'Redis URL', type: 'text', placeholder: 'redis://localhost:6379', required: true },
        { name: 'password', label: 'Password', type: 'password', placeholder: 'Redis password', required: true },
        { name: 'channel', label: 'Channel (optional)', type: 'text', placeholder: 'github-events', required: false },
      ];
    case 'kafka':
      return [
        { name: 'brokers', label: 'Brokers (comma-separated)', type: 'text', placeholder: 'kafka1:9092,kafka2:9092', required: true },
        { name: 'topic', label: 'Topic', type: 'text', placeholder: 'github-events', required: true },
        { name: 'clientId', label: 'Client ID (optional)', type: 'text', placeholder: 'my-client', required: false },
      ];
    case 'sqs':
      return [
        { name: 'region', label: 'AWS Region', type: 'text', placeholder: 'us-east-1', required: true },
        { name: 'queueUrl', label: 'Queue URL', type: 'text', placeholder: 'https://sqs.us-east-1.amazonaws.com/...', required: true },
        { name: 'accessKeyId', label: 'Access Key ID (optional)', type: 'text', placeholder: 'AKIA...', required: false },
        { name: 'secretAccessKey', label: 'Secret Access Key (optional)', type: 'password', placeholder: 'Your secret key', required: false },
      ];
    case 'azure-eventhub':
      return [
        { name: 'connectionString', label: 'Connection String', type: 'text', placeholder: 'Endpoint=sb://...', required: true },
        { name: 'eventHubName', label: 'Event Hub Name', type: 'text', placeholder: 'my-event-hub', required: true },
      ];
    case 'amqp':
      return [
        { name: 'url', label: 'AMQP URL', type: 'text', placeholder: 'amqp://localhost:5672', required: true },
        { name: 'routingKey', label: 'Routing Key', type: 'text', placeholder: 'github.events', required: true },
        { name: 'exchange', label: 'Exchange (optional)', type: 'text', placeholder: 'github', required: false },
      ];
    default:
      return [];
  }
});

function toggleEvent(event: string) {
  const index = selectedEvents.value.indexOf(event);
  if (index > -1) {
    selectedEvents.value.splice(index, 1);
  } else {
    selectedEvents.value.push(event);
  }
}

function selectAllEvents() {
  selectedEvents.value = [...availableEvents];
}

function clearAllEvents() {
  selectedEvents.value = [];
}

function validateStep(step: number): boolean {
  errors.value = {};

  if (step === 1) {
    if (!name.value.trim()) {
      errors.value.name = 'Subscriber name is required';
      return false;
    }
  }

  if (step === 2) {
    if (selectedEvents.value.length === 0) {
      errors.value.events = 'Please select at least one event';
      return false;
    }
  }

  if (step === 4) {
    // Validate transport configuration
    for (const field of transportConfigFields.value) {
      if (field.required && !transportConfig.value[field.name]) {
        errors.value[field.name] = `${field.label} is required`;
      }
    }
    return Object.keys(errors.value).length === 0;
  }

  return true;
}

function nextStep() {
  if (validateStep(currentStep.value)) {
    if (currentStep.value < totalSteps) {
      currentStep.value++;
      // Reset transport config when changing transport type
      if (currentStep.value === 4) {
        transportConfig.value = {};
      }
    }
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

async function submitForm() {
  if (!validateStep(currentStep.value)) {
    return;
  }

  isSubmitting.value = true;
  try {
    // Process transport config based on type
    let processedConfig: any = { ...transportConfig.value };

    // Special handling for Kafka brokers
    if (transportType.value === 'kafka' && typeof processedConfig.brokers === 'string') {
      processedConfig.brokers = processedConfig.brokers.split(',').map((b: string) => b.trim());
    }

    await createSubscriber({
      name: name.value,
      events: selectedEvents.value,
      transport: {
        id: 0,
        name: transportType.value,
        config: processedConfig,
      },
    });

    // Success! Navigate to dashboard
    router.push('/');
  } catch (error) {
    console.error('Failed to create subscriber:', error);
    errors.value.submit = subscriberError.value || 'Failed to create subscriber';
  } finally {
    isSubmitting.value = false;
  }
}

const progressPercentage = computed(() => {
  return (currentStep.value / totalSteps) * 100;
});
</script>

<template>
  <div class="add-subscriber">
    <div class="wizard-container">
      <div class="wizard-header">
        <h1>Add New Subscriber</h1>
        <p class="text-secondary">Configure a new event subscriber</p>
      </div>

      <!-- Progress Bar -->
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercentage + '%' }"></div>
      </div>
      <div class="step-indicators">
        <div
          v-for="step in totalSteps"
          :key="step"
          class="step-indicator"
          :class="{ active: currentStep >= step, current: currentStep === step }"
        >
          <div class="step-number">{{ step }}</div>
          <div class="step-label">
            <template v-if="step === 1">Basic Info</template>
            <template v-else-if="step === 2">Events</template>
            <template v-else-if="step === 3">Transport</template>
            <template v-else>Configuration</template>
          </div>
        </div>
      </div>

      <!-- Step Content -->
      <div class="wizard-content card">
        <!-- Step 1: Basic Info -->
        <div v-if="currentStep === 1" class="wizard-step">
          <h2>Basic Information</h2>
          <p class="step-description">Enter a name for your subscriber</p>

          <div class="form-group">
            <label class="form-label">Subscriber Name *</label>
            <input
              v-model="name"
              type="text"
              placeholder="e.g., my-webhook-service"
              :class="{ 'error': errors.name }"
            />
            <span v-if="errors.name" class="form-error">{{ errors.name }}</span>
            <span v-else class="form-help">A unique identifier for this subscriber</span>
          </div>
        </div>

        <!-- Step 2: Events -->
        <div v-if="currentStep === 2" class="wizard-step">
          <div class="step-header">
            <div>
              <h2>Select Events</h2>
              <p class="step-description">Choose which GitHub events to subscribe to</p>
            </div>
            <div class="event-actions">
              <button @click="selectAllEvents" class="btn-secondary btn-sm">Select All</button>
              <button @click="clearAllEvents" class="btn-secondary btn-sm">Clear All</button>
            </div>
          </div>

          <div v-if="errors.events" class="alert alert-error">
            {{ errors.events }}
          </div>

          <div class="event-grid">
            <label
              v-for="event in availableEvents"
              :key="event"
              class="event-checkbox"
              :class="{ selected: selectedEvents.includes(event) }"
            >
              <input
                type="checkbox"
                :checked="selectedEvents.includes(event)"
                @change="toggleEvent(event)"
              />
              <span class="event-name">{{ event }}</span>
            </label>
          </div>

          <div class="selected-count">
            {{ selectedEvents.length }} event(s) selected
          </div>
        </div>

        <!-- Step 3: Transport Type -->
        <div v-if="currentStep === 3" class="wizard-step">
          <h2>Select Transport Type</h2>
          <p class="step-description">Choose how you want to receive events</p>

          <div class="transport-grid">
            <label
              v-for="transport in transportTypes"
              :key="transport.value"
              class="transport-card"
              :class="{ selected: transportType === transport.value }"
            >
              <input
                type="radio"
                :value="transport.value"
                v-model="transportType"
              />
              <div class="transport-icon">{{ transport.icon }}</div>
              <div class="transport-label">{{ transport.label }}</div>
              <div class="transport-description">{{ transport.description }}</div>
            </label>
          </div>
        </div>

        <!-- Step 4: Transport Configuration -->
        <div v-if="currentStep === 4" class="wizard-step">
          <h2>Configure Transport</h2>
          <p class="step-description">Provide connection details for {{ transportType }}</p>

          <div v-if="errors.submit" class="alert alert-error">
            {{ errors.submit }}
          </div>

          <div class="form-group" v-for="field in transportConfigFields" :key="field.name">
            <label class="form-label">
              {{ field.label }}
              <span v-if="field.required" class="required-mark">*</span>
            </label>
            <input
              v-model="transportConfig[field.name]"
              :type="field.type"
              :placeholder="field.placeholder"
              :class="{ 'error': errors[field.name] }"
            />
            <span v-if="errors[field.name]" class="form-error">{{ errors[field.name] }}</span>
          </div>

          <!-- Review Section -->
          <div class="review-section">
            <h3>Review Your Configuration</h3>
            <div class="review-item">
              <span class="review-label">Name:</span>
              <span class="review-value">{{ name }}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Events:</span>
              <span class="review-value">{{ selectedEvents.length }} selected</span>
            </div>
            <div class="review-item">
              <span class="review-label">Transport:</span>
              <span class="review-value">{{ transportType }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="wizard-footer">
        <button
          v-if="currentStep > 1"
          @click="prevStep"
          class="btn-secondary"
          :disabled="isSubmitting"
        >
          <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
          </svg>
          Previous
        </button>
        <RouterLink
          v-else
          to="/"
          class="btn-secondary"
        >
          Cancel
        </RouterLink>

        <button
          v-if="currentStep < totalSteps"
          @click="nextStep"
          class="btn-primary"
        >
          Next
          <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </button>
        <button
          v-else
          @click="submitForm"
          class="btn-success"
          :disabled="isSubmitting"
        >
          <span v-if="isSubmitting">Creating...</span>
          <span v-else>Create Subscriber</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.add-subscriber {
  max-width: 900px;
  margin: 0 auto;
}

.wizard-container {
  background-color: var(--bg-primary);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.wizard-header {
  padding: var(--spacing-2xl);
  border-bottom: 1px solid var(--border-light);
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--bg-primary) 100%);
}

.wizard-header h1 {
  margin-bottom: var(--spacing-sm);
}

.text-secondary {
  color: var(--text-secondary);
}

.progress-bar {
  height: 4px;
  background-color: var(--border-light);
  position: relative;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--primary-color);
  transition: width 0.3s ease;
}

.step-indicators {
  display: flex;
  justify-content: space-around;
  padding: var(--spacing-xl) var(--spacing-lg);
  background-color: var(--bg-secondary);
}

.step-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--text-tertiary);
  background-color: var(--bg-primary);
  transition: all 0.3s;
}

.step-indicator.active .step-number {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
  color: var(--primary-color);
}

.step-indicator.current .step-number {
  background-color: var(--primary-color);
  color: white;
}

.step-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.step-indicator.active .step-label {
  color: var(--text-primary);
}

.wizard-content {
  padding: var(--spacing-2xl);
  min-height: 400px;
}

.wizard-step h2 {
  margin-bottom: var(--spacing-sm);
}

.step-description {
  color: var(--text-secondary);
  margin-bottom: var(--spacing-xl);
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-xl);
}

.event-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

.event-checkbox {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 2px solid var(--border-color);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.event-checkbox:hover {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
}

.event-checkbox.selected {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
}

.event-checkbox input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.event-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.selected-count {
  text-align: center;
  padding: var(--spacing-md);
  background-color: var(--bg-secondary);
  border-radius: 0.375rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.transport-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--spacing-lg);
}

.transport-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--spacing-xl);
  border: 2px solid var(--border-color);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.transport-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.transport-card.selected {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
  box-shadow: var(--shadow-md);
}

.transport-card input[type="radio"] {
  position: absolute;
  top: var(--spacing-md);
  right: var(--spacing-md);
  width: auto;
  margin: 0;
}

.transport-icon {
  font-size: 3rem;
  margin-bottom: var(--spacing-md);
}

.transport-label {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-xs);
}

.transport-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.review-section {
  margin-top: var(--spacing-xl);
  padding: var(--spacing-lg);
  background-color: var(--bg-secondary);
  border-radius: 0.375rem;
}

.review-section h3 {
  font-size: 1rem;
  margin-bottom: var(--spacing-md);
}

.review-item {
  display: flex;
  justify-content: space-between;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--border-light);
}

.review-item:last-child {
  border-bottom: none;
}

.review-label {
  font-weight: 500;
  color: var(--text-secondary);
}

.review-value {
  color: var(--text-primary);
}

.required-mark {
  color: var(--danger-color);
}

.wizard-footer {
  display: flex;
  justify-content: space-between;
  padding: var(--spacing-xl) var(--spacing-2xl);
  border-top: 1px solid var(--border-light);
  background-color: var(--bg-secondary);
}

.icon {
  width: 20px;
  height: 20px;
}

.error {
  border-color: var(--danger-color) !important;
}
</style>
