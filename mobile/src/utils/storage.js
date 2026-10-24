import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const ACCESS_TOKEN_KEY = 'jwt_token';
const REFRESH_TOKEN_PREFIX = 'refresh_token_';
const DEVICE_ID_KEY = 'app_device_id';
const LAST_USER_ID_KEY = 'last_auth_user_id';
const BIOMETRICS_ENABLED_PREFIX = 'biometrics_enabled_';
const BIOMETRICS_OFFERED_PREFIX = 'biometrics_offered_';
const FRESH_INSTALL_FLAG_KEY = 'app_installed_initialized';

// ─── Access Token (SecureStore) ─────────────────────────────
export const setToken = async (token) => {
  try {
    if (!token) {
      await removeToken();
      return;
    }
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
  } catch (error) {
    console.error('Error saving access token to SecureStore', error);
  }
};

export const getToken = async () => {
  try {
    return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch (error) {
    console.error('Error reading access token from SecureStore', error);
    return null;
  }
};

export const removeToken = async () => {
  try {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  } catch (error) {
    console.error('Error deleting access token from SecureStore', error);
  }
};

// ─── Device ID (Persistent GUID) ────────────────────────────
export const getDeviceId = async () => {
  try {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      if (Crypto.randomUUID) {
        deviceId = Crypto.randomUUID();
      } else {
        deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch (error) {
    console.error('Error resolving device ID', error);
    return 'default-mobile-device';
  }
};

// ─── Refresh Token (Key per User ID in SecureStore) ──────────
const getRefreshTokenKey = (userId) => `${REFRESH_TOKEN_PREFIX}${userId}`;

export const setRefreshToken = async (userId, refreshToken) => {
  if (!userId || !refreshToken) return;
  try {
    await SecureStore.setItemAsync(getRefreshTokenKey(userId), refreshToken);
  } catch (error) {
    console.error('Error saving refresh token to SecureStore', error);
  }
};

export const getRefreshToken = async (userId) => {
  if (!userId) return null;
  try {
    return await SecureStore.getItemAsync(getRefreshTokenKey(userId));
  } catch (error) {
    console.error('Error reading refresh token from SecureStore', error);
    return null;
  }
};

export const removeRefreshToken = async (userId) => {
  if (!userId) return;
  try {
    await SecureStore.deleteItemAsync(getRefreshTokenKey(userId));
  } catch (error) {
    console.error('Error removing refresh token from SecureStore', error);
  }
};

// ─── Last Authenticated User ID ─────────────────────────────
export const getLastAuthenticatedUserId = async () => {
  try {
    return await AsyncStorage.getItem(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
};

export const setLastAuthenticatedUserId = async (userId) => {
  try {
    if (userId) {
      await AsyncStorage.setItem(LAST_USER_ID_KEY, String(userId));
    } else {
      await AsyncStorage.removeItem(LAST_USER_ID_KEY);
    }
  } catch (error) {
    console.error('Error persisting last user ID', error);
  }
};

export const removeLastAuthenticatedUserId = async () => {
  try {
    await AsyncStorage.removeItem(LAST_USER_ID_KEY);
  } catch {
    // ignore
  }
};

// ─── Biometric Preferences (AsyncStorage) ────────────────────
export const isBiometricsEnabled = async (userId) => {
  if (!userId) return false;
  try {
    const val = await AsyncStorage.getItem(`${BIOMETRICS_ENABLED_PREFIX}${userId}`);
    return val === 'true';
  } catch {
    return false;
  }
};

export const setBiometricsEnabled = async (userId, enabled) => {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(`${BIOMETRICS_ENABLED_PREFIX}${userId}`, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('Error updating biometrics preference', error);
  }
};

export const hasOfferedBiometrics = async (userId) => {
  if (!userId) return false;
  try {
    const val = await AsyncStorage.getItem(`${BIOMETRICS_OFFERED_PREFIX}${userId}`);
    return val === 'true';
  } catch {
    return false;
  }
};

export const setOfferedBiometrics = async (userId) => {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(`${BIOMETRICS_OFFERED_PREFIX}${userId}`, 'true');
  } catch {
    // ignore
  }
};

// ─── Fresh Install Wipe Handling ────────────────────────────
/**
 * iOS Keychain data can survive app uninstalls.
 * On first launch after a fresh install, wipe any orphaned SecureStore keys.
 */
export const checkAndHandleFreshInstall = async () => {
  try {
    const isInitialized = await AsyncStorage.getItem(FRESH_INSTALL_FLAG_KEY);
    if (!isInitialized) {
      console.log('[Storage] Fresh install detected. Purging leftover SecureStore credentials...');
      await removeToken();
      const lastUser = await getLastAuthenticatedUserId();
      if (lastUser) {
        await removeRefreshToken(lastUser);
      }
      await AsyncStorage.setItem(FRESH_INSTALL_FLAG_KEY, 'true');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error during fresh install check', error);
    return false;
  }
};
