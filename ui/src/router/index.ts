import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from '../views/Dashboard.vue';
import AdminPanel from '../views/AdminPanel.vue';
import AddSubscriber from '../views/AddSubscriber.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'Dashboard',
      component: Dashboard
    },
    {
      path: '/admin',
      name: 'AdminPanel',
      component: AdminPanel
    },
    {
      path: '/add-subscriber',
      name: 'AddSubscriber',
      component: AddSubscriber
    }
  ]
});

export default router;
