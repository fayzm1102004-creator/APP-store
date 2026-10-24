import { useEffect, useState, useContext, useCallback } from 'react';
import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { AuthContext } from '../context/AuthContext';
import i18n from '../locales/i18n';

// Completes the auth session for web/browser redirects
WebBrowser.maybeCompleteAuthSession();

// Google OAuth Client IDs (can be provided via EXPO_PUBLIC_* env vars)
export const GOOGLE_CONFIG = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
};

// Fallback dummy client id so that expo-auth-session invariant doesn't crash during mount when env vars are missing
const PLACEHOLDER_CLIENT_ID = 'unconfigured-client-id.apps.googleusercontent.com';

export const useGoogleAuth = ({
  role = 'Buyer',
  acceptedTermsAndPrivacy = true,
  marketingConsent = false,
  onError,
} = {}) => {
  const { loginWithGoogle } = useContext(AuthContext);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasConfiguredClientId = Boolean(
    GOOGLE_CONFIG.webClientId ||
    GOOGLE_CONFIG.androidClientId ||
    GOOGLE_CONFIG.iosClientId
  );

  // Setup Expo Google Auth Request (always pass a valid string to prevent invariant crash on Android/iOS/Web)
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_CONFIG.webClientId || PLACEHOLDER_CLIENT_ID,
    androidClientId: GOOGLE_CONFIG.androidClientId || PLACEHOLDER_CLIENT_ID,
    iosClientId: GOOGLE_CONFIG.iosClientId || PLACEHOLDER_CLIENT_ID,
  });

  const handleToken = useCallback(
    async (idToken) => {
      setIsSubmitting(true);
      try {
        await loginWithGoogle(idToken, role, acceptedTermsAndPrivacy, marketingConsent);
      } catch (err) {
        let msg = err.response?.data?.error || err.message;
        if (err.response?.data?.errors) {
          const details = Object.values(err.response.data.errors).flat().join('\n');
          if (details) msg = details;
        }
        if (onError) onError(msg);
        else Alert.alert(i18n.t('common.error'), msg || i18n.t('auth.googleAuthError'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [loginWithGoogle, role, acceptedTermsAndPrivacy, marketingConsent, onError]
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      if (id_token) {
        queueMicrotask(() => {
          handleToken(id_token);
        });
      }
    } else if (response?.type === 'error') {
      queueMicrotask(() => {
        setIsSubmitting(false);
        const errorMsg = response.error?.message || i18n.t('auth.googleAuthError');
        if (onError) onError(errorMsg);
        else Alert.alert(i18n.t('common.error'), errorMsg);
      });
    }
  }, [response, handleToken, onError]);

  const signIn = async () => {
    if (hasConfiguredClientId && request) {
      try {
        setIsSubmitting(true);
        await promptAsync();
      } catch (err) {
        setIsSubmitting(false);
        Alert.alert(i18n.t('common.error'), err.message || i18n.t('auth.googleAuthError'));
      }
      return;
    }

    // Outside __DEV__, demo dialog is completely removed
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
      Alert.alert(
        i18n.t('common.error'),
        i18n.t('auth.googleAuthUnavailable', { defaultValue: 'Google Sign-In is currently unavailable.' })
      );
      return;
    }

    Alert.alert(
      i18n.t('common.error'),
      i18n.t('auth.googleAuthUnavailable', { defaultValue: 'Google Sign-In is not configured.' })
    );
  };

  return {
    signIn,
    isLoading: isSubmitting,
    isReady: !!request,
  };
};
