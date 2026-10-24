import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  I18nManager,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import tw from 'twrnc';
import { colors } from '../../theme/colors';
import { promptBiometricAuth } from '../../utils/biometrics';

export default function UnlockScreen({
  userName,
  userEmail,
  onUnlockSuccess,
  onUsePassword,
}) {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language?.startsWith('ar');
  const isRTL = isArabic ?? I18nManager.isRTL;

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const triggerBiometricPrompt = async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setErrorMessage(null);

    try {
      const result = await promptBiometricAuth({
        promptMessage: t('biometrics.promptMessage', 'فتح تطبيق السوق'),
        fallbackLabel: t('biometrics.usePasscode', 'استخدم رمز الهاتف'),
      });

      if (result.success) {
        if (onUnlockSuccess) {
          await onUnlockSuccess();
        }
      } else {
        setErrorMessage(t('biometrics.unlockFailed', 'فشل التحقق من البصمة. يمكنك المحاولة مجدداً أو استخدام كلمة المرور.'));
      }
    } catch {
      setErrorMessage(t('biometrics.unlockFailed', 'فشل التحقق من البصمة. يمكنك المحاولة مجدداً أو استخدام كلمة المرور.'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    // Automatically trigger biometric prompt on screen appearance
    const timer = setTimeout(() => {
      triggerBiometricPrompt();
    }, 400);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={styles.gradient}
      >
        <View style={styles.content}>
          {/* App Branding */}
          <View style={styles.logoBadge}>
            <MaterialCommunityIcons name="shield-lock-outline" size={44} color="#38BDF8" />
          </View>
          <Text style={styles.appTitle}>سوق مصر</Text>
          <Text style={styles.appSubtitle}>Marketplace</Text>

          {/* User Identifier */}
          <View style={styles.userCard}>
            <MaterialCommunityIcons name="account-circle-outline" size={20} color="#94A3B8" />
            <Text style={[styles.userName, isRTL ? tw`mr-2` : tw`ml-2`]} numberOfLines={1}>
              {userName || userEmail || 'مستخدم مسجل'}
            </Text>
          </View>

          {/* Biometric Icon & Prompt */}
          <TouchableOpacity
            style={styles.biometricCircle}
            onPress={triggerBiometricPrompt}
            disabled={isAuthenticating}
            activeOpacity={0.8}
          >
            {isAuthenticating ? (
              <ActivityIndicator size="large" color="#38BDF8" />
            ) : (
              <MaterialCommunityIcons name="fingerprint" size={64} color="#38BDF8" />
            )}
          </TouchableOpacity>

          <Text style={styles.promptText}>
            {t('biometrics.unlockTitle', 'فتح التطبيق')}
          </Text>
          <Text style={styles.promptSubtext}>
            {t('biometrics.unlockSubtitle', 'يرجى تأكيد البصمة لمتابعة استخدام التطبيق')}
          </Text>

          {/* Error Message */}
          {errorMessage && (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#EF4444" />
              <Text style={[styles.errorText, isRTL ? tw`mr-2` : tw`ml-2`]}>{errorMessage}</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={triggerBiometricPrompt}
              disabled={isAuthenticating}
            >
              <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
              <Text style={[styles.retryText, isRTL ? tw`mr-1.5` : tw`ml-1.5`]}>
                {t('biometrics.retry', 'إعادة المحاولة')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.passwordButton}
              onPress={onUsePassword}
              disabled={isAuthenticating}
            >
              <MaterialCommunityIcons name="key-outline" size={18} color="#94A3B8" />
              <Text style={[styles.passwordText, isRTL ? tw`mr-1.5` : tw`ml-1.5`]}>
                {t('biometrics.usePassword', 'استخدم كلمة المرور')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 20,
    letterSpacing: 1.5,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    marginBottom: 36,
  },
  userName: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '500',
  },
  biometricCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderWidth: 2,
    borderColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  promptText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 6,
    textAlign: 'center',
  },
  promptSubtext: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 20,
    maxWidth: '90%',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  actions: {
    width: '100%',
    marginTop: 10,
    gap: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 12,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  passwordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderWidth: 1,
    borderColor: '#475569',
    paddingVertical: 13,
    borderRadius: 12,
  },
  passwordText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
});
