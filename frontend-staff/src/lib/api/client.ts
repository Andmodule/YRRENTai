import axios from 'axios';

/** Зависший прокси/API без таймаута оставляет SWR и Mini App на вечной загрузке (белый экран). */
const REQUEST_TIMEOUT_MS = 28_000;

export const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: REQUEST_TIMEOUT_MS,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  // SSR: same-origin URL so Next middleware can proxy to the API (cookies stay on :3013).
  if (typeof window === 'undefined') {
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3013';
    config.baseURL = `${site.replace(/\/$/, '')}/api/v1`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
