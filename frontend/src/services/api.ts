import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('reachinbox_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  googleLogin: (credential: string) => api.post('/auth/google', { credential }),
  getMe: () => api.get('/auth/me'),
  getSlackConnectUrl: () => api.get('/auth/slack/connect'),
  disconnectSlack: () => api.post('/auth/slack/disconnect'),
};

export const emailApi = {
  schedule: (payload: {
    recipients: string[];
    subject: string;
    body: string;
    startTime: string;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
    senderId?: string;
  }) => api.post('/emails/schedule', payload),
  getScheduled: () => api.get('/emails/scheduled'),
  getSent: () => api.get('/emails/sent'),
  search: (q: string, status?: string) =>
    api.get('/emails/search', { params: { q, ...(status ? { status } : {}) } }),
  addSender: () => api.post('/emails/senders'),
};