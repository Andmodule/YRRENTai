import axios from 'axios';
import { getLocaleFromPathname, isAuthPath } from '@/lib/auth/locale-from-path';

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window === 'undefined') {
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3012';
    config.baseURL = `${site.replace(/\/$/, '')}/api/v1`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (isAuthPath(path)) {
          return Promise.reject(error);
        }
        const locale = getLocaleFromPathname(path);
        window.location.href = `/${locale}/login`;
      }
    }
    return Promise.reject(error);
  },
);
