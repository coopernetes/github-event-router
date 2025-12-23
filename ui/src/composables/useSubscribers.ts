import { ref } from 'vue';
import type { Subscriber } from '../types/subscriber';

export function useSubscribers() {
  const subscribers = ref<Subscriber[]>([]);
  const error = ref<string | null>(null);
  const isLoading = ref(false);

  async function fetchSubscribers() {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch('/api/v1/subscribers');
      if (!response.ok) {
        throw new Error('Failed to fetch subscribers');
      }
      const data = await response.json();
      subscribers.value = data;
    } catch (e) {
      console.error('Error fetching subscribers:', e);
      error.value = e instanceof Error ? e.message : 'An error occurred';
    } finally {
      isLoading.value = false;
    }
  }

  async function createSubscriber(subscriberData: Omit<Subscriber, 'id'>) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch('/api/v1/subscribers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscriberData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create subscriber');
      }

      const newSubscriber = await response.json();
      subscribers.value.push(newSubscriber);
      return newSubscriber;
    } catch (e) {
      console.error('Error creating subscriber:', e);
      error.value = e instanceof Error ? e.message : 'Failed to create subscriber';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateSubscriber(id: number, updates: Partial<Subscriber>) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/v1/subscribers/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update subscriber');
      }

      const updatedSubscriber = await response.json();
      const index = subscribers.value.findIndex((s) => s.id === id);
      if (index !== -1) {
        subscribers.value[index] = updatedSubscriber;
      }
      return updatedSubscriber;
    } catch (e) {
      console.error('Error updating subscriber:', e);
      error.value = e instanceof Error ? e.message : 'Failed to update subscriber';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteSubscriber(id: number) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/v1/subscribers/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete subscriber');
      }

      subscribers.value = subscribers.value.filter((s) => s.id !== id);
    } catch (e) {
      console.error('Error deleting subscriber:', e);
      error.value = e instanceof Error ? e.message : 'Failed to delete subscriber';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    subscribers,
    error,
    isLoading,
    fetchSubscribers,
    createSubscriber,
    updateSubscriber,
    deleteSubscriber,
  };
}
