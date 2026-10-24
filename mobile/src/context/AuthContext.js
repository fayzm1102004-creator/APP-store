import React, { createContext, useState, useEffect, useRef } from 'react';
import { AppState, Alert } from 'react-native';
import { jwtDecode } from 'jwt-decode';
import {
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  getDeviceId,
  getLastAuthenticatedUserId,
  setLastAuthenticatedUserId,
  removeLastAuthenticatedUserId,
  isBiometricsEnabled,
  setBiometricsEnabled,
  hasOfferedBiometrics,
  setOfferedBiometrics,
  checkAndHandleFreshInstall,
} from '../utils/storage';
import {
  login as loginApi,
  register as registerApi,
  verify as verifyApi,
  googleAuth as googleAuthApi,
  refresh as refreshApi,
  logout as logoutApi,
  logoutAll as logoutAllApi,
} from '../api/authApi';
import { setOnUnauthorized } from '../api/client';
import { syncPushToken } from '../utils/notifications';
import {
  checkBiometricSupport,
  promptBiometricAuth,
  DEFAULT_LOCK_TIMEOUT_MS,
} from '../utils/biometrics';
import i18n from '../locales/i18n';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [userRole, setUserRole] = useState(null); // 'Buyer' or 'Seller'
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const backgroundTimestampRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // The role claim key in .NET
  const ROLE_CLAIM = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';

  // ─── Biometrics Prompt Offer ────────────────────────────────
  const offerBiometricsIfSupported = async (uid) => {
    try {
      const alreadyOffered = await hasOfferedBiometrics(uid);
      if (alreadyOffered) return;

      const support = await checkBiometricSupport();
      if (!support.available) return;

      await setOfferedBiometrics(uid);

      Alert.alert(
        i18n.t('biometrics.enablePromptTitle', 'تفعيل الدخول بالبصمة؟'),
        i18n.t(
          'biometrics.enablePromptMessage',
          'هل ترغب في تفعيل تسجيل الدخول ببصمة الإصبع أو الوجه للوصول السريع والآمن إلى حسابك؟'
        ),
        [
          {
            text: i18n.t('biometrics.laterButton', 'لاحقاً'),
            style: 'cancel',
          },
          {
            text: i18n.t('biometrics.enableButton', 'تفعيل'),
            onPress: async () => {
              const authRes = await promptBiometricAuth({
                promptMessage: i18n.t('biometrics.authenticateToEnable', 'تأكيد البصمة لتفعيل الميزة'),
                fallbackLabel: i18n.t('biometrics.usePasscode', 'استخدم رمز الهاتف'),
              });
              if (authRes.success) {
                await setBiometricsEnabled(uid, true);
                Alert.alert(
                  i18n.t('common.success', 'تم بنجاح'),
                  i18n.t('biometrics.enabledSuccess', 'تم تفعيل الدخول بالبصمة بنجاح')
                );
              }
            },
          },
        ]
      );
    } catch (err) {
      console.error('Error offering biometrics', err);
    }
  };

  // ─── Load User / Token On Startup ───────────────────────────
  const loadUserFromToken = async () => {
    try {
      // 1. Check fresh install wipe (Requirement 5)
      await checkAndHandleFreshInstall();

      const lastUserId = await getLastAuthenticatedUserId();
      let token = await getToken();

      // Requirement B.2: When biometrics are enabled and refresh token exists,
      // NEVER call /auth/refresh before a successful unlock on cold start (lock first, refresh after).
      if (lastUserId) {
        const bioEnabled = await isBiometricsEnabled(lastUserId);
        const hasRt = await getRefreshToken(lastUserId);

        if (bioEnabled && hasRt) {
          if (token) {
            try {
              const decoded = jwtDecode(token);
              const role = decoded[ROLE_CLAIM] || decoded.role;
              const id = decoded.sub || decoded.nameid || decoded.id;
              const name = decoded.name || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];
              const email = decoded.email || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
              setUserRole(role);
              setUserId(String(id || lastUserId));
              setUserName(name || null);
              setUserEmail(email || null);
            } catch {
              setUserId(lastUserId);
            }
          } else {
            setUserId(lastUserId);
          }

          setIsLocked(true);
          return;
        }
      }

      // If biometrics are NOT enabled: regular cold start flow
      if (token) {
        try {
          const decoded = jwtDecode(token);
          if (decoded.exp && decoded.exp * 1000 <= Date.now()) {
            token = null; // Token expired, will try refresh below
          }
        } catch {
          token = null;
        }
      }

      if (!token && lastUserId) {
        const refreshToken = await getRefreshToken(lastUserId);
        if (refreshToken) {
          const deviceId = await getDeviceId();
          try {
            const refreshRes = await refreshApi({ refreshToken, deviceId });
            const newAccessToken = refreshRes.data?.accessToken || refreshRes.data?.token;
            const newRefreshToken = refreshRes.data?.refreshToken;
            if (newAccessToken) {
              await setToken(newAccessToken);
              if (newRefreshToken) {
                await setRefreshToken(lastUserId, newRefreshToken);
              }
              token = newAccessToken;
            }
          } catch {
            await removeToken();
            await removeRefreshToken(lastUserId);
            token = null;
          }
        }
      }

      if (token) {
        const decoded = jwtDecode(token);
        const role = decoded[ROLE_CLAIM] || decoded.role;
        const id = decoded.sub || decoded.nameid || decoded.id;
        const name = decoded.name || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];
        const email = decoded.email || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
        const uidStr = id ? String(id) : null;

        setUserRole(role);
        setUserId(uidStr);
        setUserName(name || null);
        setUserEmail(email || null);
        if (uidStr) {
          await setLastAuthenticatedUserId(uidStr);
        }

        setIsLocked(false);
        syncPushToken();
      } else {
        setUserRole(null);
        setUserId(null);
        setUserName(null);
        setUserEmail(null);
        setIsLocked(false);
      }
    } catch {
      setUserRole(null);
      setUserId(null);
      setUserName(null);
      setUserEmail(null);
      setIsLocked(false);
      await removeToken();
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Background / Resume Timeout Listener ───────────────────
  useEffect(() => {
    let isMounted = true;
    setOnUnauthorized(() => {
      if (isMounted) {
        setUserRole(null);
        setUserId(null);
        setUserName(null);
        setUserEmail(null);
        setIsLocked(false);
      }
    });

    const init = async () => {
      try {
        await loadUserFromToken();
      } catch (err) {
        if (__DEV__) {
          console.warn('[AuthContext] init error', err);
        }
      }
    };
    init();

    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (
        appStateRef.current.match(/active/) &&
        nextAppState.match(/inactive|background/)
      ) {
        backgroundTimestampRef.current = Date.now();
      } else if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        if (backgroundTimestampRef.current) {
          const elapsed = Date.now() - backgroundTimestampRef.current;
          backgroundTimestampRef.current = null;

          if (elapsed >= DEFAULT_LOCK_TIMEOUT_MS) {
            const currentUserId = userId || (await getLastAuthenticatedUserId());
            if (currentUserId) {
              const bioEnabled = await isBiometricsEnabled(currentUserId);
              const rt = await getRefreshToken(currentUserId);
              if (bioEnabled && rt) {
                setIsLocked(true);
              }
            }
          }
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [userId]);

  // ─── Unlock Handlers ────────────────────────────────────────
  const unlockWithBiometrics = async () => {
    try {
      const currentUserId = userId || (await getLastAuthenticatedUserId());
      if (!currentUserId) {
        setIsLocked(false);
        return;
      }

      const refreshToken = await getRefreshToken(currentUserId);
      const deviceId = await getDeviceId();

      if (!refreshToken) {
        // No refresh token, force password login
        await unlockWithPassword();
        return;
      }

      const res = await refreshApi({ refreshToken, deviceId });
      const newAccessToken = res.data?.accessToken || res.data?.token;
      const newRefreshToken = res.data?.refreshToken;

      if (newAccessToken) {
        await setToken(newAccessToken);
        if (newRefreshToken) {
          await setRefreshToken(currentUserId, newRefreshToken);
        }

        try {
          const decoded = jwtDecode(newAccessToken);
          const role = decoded[ROLE_CLAIM] || decoded.role;
          const id = decoded.sub || decoded.nameid || decoded.id;
          const name = decoded.name || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];
          const email = decoded.email || decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
          if (role) setUserRole(role);
          if (id) setUserId(String(id));
          if (name) setUserName(name);
          if (email) setUserEmail(email);
        } catch {
          // Keep existing user state if decode fails
        }

        setIsLocked(false);
      } else {
        throw new Error('Refresh failed on unlock');
      }
    } catch (err) {
      console.error('Error during biometric unlock refresh', err);
      Alert.alert(
        i18n.t('biometrics.unlockTitle', 'فتح التطبيق'),
        i18n.t('biometrics.refreshFailed', 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً بكلمة المرور.')
      );
      await unlockWithPassword();
    }
  };

  const unlockWithPassword = async () => {
    const currentUserId = userId || (await getLastAuthenticatedUserId());
    if (currentUserId) {
      try {
        const refreshToken = await getRefreshToken(currentUserId);
        if (refreshToken) {
          // Requirement B.4: Revoke refresh token on server (best effort)
          await logoutApi({ refreshToken });
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[unlockWithPassword] best-effort server revoke error', err?.message);
        }
      }
      await removeRefreshToken(currentUserId);
    }
    await removeToken();
    await removeLastAuthenticatedUserId();
    setUserRole(null);
    setUserId(null);
    setUserName(null);
    setUserEmail(null);
    setIsLocked(false);
  };

  // ─── Login Flow ─────────────────────────────────────────────
  const login = async (identifier, password) => {
    const deviceId = await getDeviceId();
    const response = await loginApi({ identifier, password, deviceId });
    const { token, accessToken, refreshToken } = response.data;
    const effectiveToken = accessToken || token;

    if (effectiveToken) {
      await setToken(effectiveToken);
      const decoded = jwtDecode(effectiveToken);
      const uid = String(decoded.sub || decoded.nameid || decoded.id || response.data?.userId);

      if (refreshToken && uid) {
        await setRefreshToken(uid, refreshToken);
        await setLastAuthenticatedUserId(uid);
      }

      await loadUserFromToken();

      // Offer biometrics once if supported
      if (uid) {
        offerBiometricsIfSupported(uid);
      }
    }
    return response.data;
  };

  // ─── Verify Flow ────────────────────────────────────────────
  const verify = async (target, code) => {
    const deviceId = await getDeviceId();
    const response = await verifyApi({ target, code, deviceId });
    const { token, accessToken, refreshToken } = response.data;
    const effectiveToken = accessToken || token;

    if (effectiveToken) {
      await setToken(effectiveToken);
      const decoded = jwtDecode(effectiveToken);
      const uid = String(decoded.sub || decoded.nameid || decoded.id || response.data?.userId);

      if (refreshToken && uid) {
        await setRefreshToken(uid, refreshToken);
        await setLastAuthenticatedUserId(uid);
      }

      await loadUserFromToken();

      if (uid) {
        offerBiometricsIfSupported(uid);
      }
    }
    return response.data;
  };

  // ─── Register Flow ──────────────────────────────────────────
  const register = async ({
    name,
    email,
    phone,
    password,
    role,
    acceptedTermsAndPrivacy = true,
    marketingConsent = false,
  }) => {
    const deviceId = await getDeviceId();
    const response = await registerApi({
      name,
      email: email || null,
      phone: phone || null,
      password,
      role,
      acceptedTermsAndPrivacy,
      marketingConsent,
      policyVersion: '1.0',
      deviceId,
    });
    return response.data;
  };

  // ─── Google Auth Flow ───────────────────────────────────────
  const loginWithGoogle = async (idToken, role = 'Buyer', acceptedTermsAndPrivacy = true, marketingConsent = false) => {
    const deviceId = await getDeviceId();
    const response = await googleAuthApi({
      idToken,
      role,
      acceptedTermsAndPrivacy,
      marketingConsent,
      policyVersion: '1.0',
      deviceId,
    });
    const { token, accessToken, refreshToken } = response.data;
    const effectiveToken = accessToken || token;

    if (effectiveToken) {
      await setToken(effectiveToken);
      const decoded = jwtDecode(effectiveToken);
      const uid = String(decoded.sub || decoded.nameid || decoded.id || response.data?.userId);

      if (refreshToken && uid) {
        await setRefreshToken(uid, refreshToken);
        await setLastAuthenticatedUserId(uid);
      }

      await loadUserFromToken();

      if (uid) {
        offerBiometricsIfSupported(uid);
      }
    }
    return response.data;
  };

  // ─── Logout Flows ───────────────────────────────────────────
  const logout = async () => {
    try {
      if (userId) {
        const rt = await getRefreshToken(userId);
        if (rt) {
          logoutApi({ refreshToken: rt }).catch(() => {});
        }
        await removeRefreshToken(userId);
      }
      await removeToken();
      await removeLastAuthenticatedUserId();
    } finally {
      setUserRole(null);
      setUserId(null);
      setUserName(null);
      setUserEmail(null);
      setIsLocked(false);
    }
  };

  const logoutAll = async () => {
    try {
      await logoutAllApi().catch(() => {});
      if (userId) {
        await removeRefreshToken(userId);
      }
      await removeToken();
      await removeLastAuthenticatedUserId();
    } finally {
      setUserRole(null);
      setUserId(null);
      setUserName(null);
      setUserEmail(null);
      setIsLocked(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        userRole,
        userId,
        userName,
        userEmail,
        isLoading,
        isLocked,
        login,
        verify,
        register,
        loginWithGoogle,
        logout,
        logoutAll,
        unlockWithBiometrics,
        unlockWithPassword,
        reloadUser: loadUserFromToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
