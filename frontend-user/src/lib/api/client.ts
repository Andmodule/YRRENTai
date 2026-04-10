import axios, { AxiosHeaders } from 'axios';
import { getLocaleFromPathname, isAuthPath, isTmaPath } from '@/lib/auth/locale-from-path';

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
  // Multipart: must not send `application/json` — Nest/multer otherwise receives zero files.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const headers = AxiosHeaders.from(config.headers ?? {});
    headers.set('Content-Type', false);
    config.headers = headers;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (isAuthPath(path) || isTmaPath(path)) {
          return Promise.reject(error);
        }
        const locale = getLocaleFromPathname(path);
        window.location.href = `/${locale}/login`;
      }
    }
    return Promise.reject(error);
  },
);
