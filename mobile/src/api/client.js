import axios from 'axios';
import { Platform } from 'react-native';
import {
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  getDeviceId,
  getLastAuthenticatedUserId,
} from '../utils/storage';

const getApiHost = () => {
  if (Platform.OS === 'android') {
    return '10.0.2.2';
  }
  return 'localhost';
};

const getApiBaseUrl = () => {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return process.env.EXPO_PUBLIC_API_URL || 'https://api.marketplace.eg/api';
  }
  return `http://${getApiHost()}:5209/api`;
};

export const BASE_URL = getApiBaseUrl();

let onUnauthorizedCallback = null;

export const setOnUnauthorized = (callback) => {
  onUnauthorizedCallback = callback;
};

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Single-Flight Refresh Coordinator ──────────────────────
let isRefreshing = false;
let refreshPromise = null;

export const performSingleFlightRefresh = async () => {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const lastUserId = await getLastAuthenticatedUserId();
      const refreshToken = lastUserId ? await getRefreshToken(lastUserId) : null;
      const deviceId = await getDeviceId();

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      // Use a clean axios instance to bypass interceptor recursion
      const refreshResponse = await axios.post(
        `${BASE_URL}/auth/refresh`,
        {
          refreshToken,
          deviceId,
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const newAccessToken = refreshResponse.data?.accessToken || refreshResponse.data?.token;
      const newRefreshToken = refreshResponse.data?.refreshToken;

      if (!newAccessToken) {
        throw new Error('No access token in refresh response');
      }

      // CRITICAL: Save rotated token in storage BEFORE resolving the promise
      await setToken(newAccessToken);
      if (newRefreshToken && lastUserId) {
        await setRefreshToken(lastUserId, newRefreshToken);
      }

      return newAccessToken;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// ─── Request Interceptor: Attach Access Token ───────────────
client.interceptors.request.use(
  async (config) => {
    if (typeof __DEV__ === 'undefined' || __DEV__) {
      // Zero-PII safe logging: method and url only, never payload or tokens
      console.log('[API REQUEST]', config.method?.toUpperCase(), `${config.baseURL || ''}${config.url}`);
    }

    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: Silent Token Refresh on 401 ──────
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (!error.response || error.response.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    const url = originalRequest.url || '';

    // If 401 was on refresh or login endpoint, immediately wipe credentials & log out
    if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
      const lastUserId = await getLastAuthenticatedUserId();
      await removeToken();
      if (lastUserId) {
        await removeRefreshToken(lastUserId);
      }
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
      return Promise.reject(error);
    }

    // A second failure on a retried request logs the user out
    if (originalRequest._retry) {
      const lastUserId = await getLastAuthenticatedUserId();
      await removeToken();
      if (lastUserId) {
        await removeRefreshToken(lastUserId);
      }
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
      return Promise.reject(error);
    }

    // First 401 failure: mark retry and wait for single-flight refresh
    originalRequest._retry = true;

    try {
      const newAccessToken = await performSingleFlightRefresh();

      // Retry original request with the new access token
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(originalRequest);
    } catch (refreshError) {
      // Refresh failed (e.g. revoked token reuse detection or token expired)
      const lastUserId = await getLastAuthenticatedUserId();
      await removeToken();
      if (lastUserId) {
        await removeRefreshToken(lastUserId);
      }
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
      return Promise.reject(refreshError);
    }
  }
);

export default client;
