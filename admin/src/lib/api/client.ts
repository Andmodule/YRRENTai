import axios from 'axios';

/** Browser: same-origin `/api/v1` → Next proxy → Nest (session cookie on admin port). */
export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window === 'undefined') {
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3010';
    config.baseURL = `${api.replace(/\/$/, '')}/api/v1`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        const seg = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
        const loc = ['ru', 'en', 'pl', 'es', 'de'].includes(seg) ? seg : 'ru';
        window.location.href = `/${loc}/login`;
      }
    }
    return Promise.reject(error);
  },
);
