<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useSubscribers } from '../composables/useSubscribers';
import SubscriberCard from '../components/SubscriberCard.vue';

const { subscribers, error, isLoading, fetchSubscribers } = useSubscribers();

onMounted(() => {
  fetchSubscribers();
});

const subscriberCount = computed(() => subscribers.value.length);

const transportStats = computed(() => {
  const stats: Record<string, number> = {};
  subscribers.value.forEach((sub) => {
    const type = sub.transport?.name || 'unknown';
    stats[type] = (stats[type] || 0) + 1;
  });
  return stats;
});
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h1>My Dashboard</h1>
      <p class="text-secondary">Manage your event subscribers</p>
    </div>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon stat-icon-primary">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ subscriberCount }}</div>
          <div class="stat-label">Total Subscribers</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-success">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ subscriberCount }}</div>
          <div class="stat-label">Active</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon stat-icon-info">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ Object.keys(transportStats).length }}</div>
          <div class="stat-label">Transport Types</div>
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
      <p>Loading your subscribers...</p>
    </div>

    <!-- Subscribers Grid -->
    <div v-else-if="subscribers.length > 0" class="subscribers-section">
      <h2>Your Subscribers</h2>
      <div class="subscribers-grid">
        <SubscriberCard
          v-for="subscriber in subscribers"
          :key="subscriber.id"
          :subscriber="subscriber"
          @refresh="fetchSubscribers"
        />
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
      </svg>
      <h3>No subscribers yet</h3>
      <p>Get started by adding your first subscriber</p>
      <RouterLink to="/add-subscriber" class="btn-primary" style="margin-top: 1rem;">
        Add Your First Subscriber
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1400px;
}

.dashboard-header {
  margin-bottom: var(--spacing-2xl);
}

.text-secondary {
  color: var(--text-secondary);
  font-size: 1rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-2xl);
}

.stat-card {
  background-color: var(--bg-primary);
  border-radius: 0.5rem;
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  transition: all 0.2s;
}

.stat-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon svg {
  width: 24px;
  height: 24px;
}

.stat-icon-primary {
  background-color: var(--primary-light);
  color: var(--primary-color);
}

.stat-icon-success {
  background-color: #d1fae5;
  color: var(--success-color);
}

.stat-icon-info {
  background-color: #cffafe;
  color: var(--info-color);
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: var(--spacing-xs);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.loading-container {
  text-align: center;
  padding: var(--spacing-2xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
}

.subscribers-section h2 {
  margin-bottom: var(--spacing-lg);
}

.subscribers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: var(--spacing-lg);
}

.empty-state {
  text-align: center;
  padding: var(--spacing-2xl);
  background-color: var(--bg-primary);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
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
</style>
