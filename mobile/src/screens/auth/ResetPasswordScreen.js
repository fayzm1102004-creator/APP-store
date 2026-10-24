import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  resetPassword as resetPasswordApi,
  forgotPassword as forgotPasswordApi,
} from '../../api/authApi';
import { colors } from '../../theme/colors';
import OtpInput from '../../components/OtpInput';

const RESEND_COOLDOWN_SECONDS = 60;

const ResetPasswordScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { identifier = '', maskedTarget = '' } = route.params || {};

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const [focusedField, setFocusedField] = useState(null);

  // Animations
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(30));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // 60-second countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  const handleResend = async () => {
    if (countdown > 0 || resending) return;

    setResending(true);
    try {
      await forgotPasswordApi({ identifier });
      setCountdown(RESEND_COOLDOWN_SECONDS);
      Alert.alert(t('common.success'), t('auth.codeResent'));
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      Alert.alert(t('common.error'), msg);
    } finally {
      setResending(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      Alert.alert(t('common.error'), t('auth.invalidCodeLength'));
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordMinLength'));
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert(t('common.error'), t('auth.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);
    try {
      await resetPasswordApi({
        identifier,
        code: trimmedCode,
        newPassword,
      });

      Alert.alert(
        t('common.success'),
        t('auth.passwordResetSuccess'),
        [
          {
            text: t('common.ok'),
            onPress: () => navigation.navigate('Login'),
          },
        ],
        { cancelable: false }
      );
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header gradient */}
      <LinearGradient
        colors={['#0F172A', '#1E3A5F', '#0F172A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.logoGradient}>
          <Ionicons name="lock-open-outline" size={32} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>{t('auth.resetPasswordTitle')}</Text>
      </LinearGradient>

      {/* Form card */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.formWrapper}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.formCard,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('auth.resetSubtitle', { target: maskedTarget || identifier })}
            </Text>

            {/* 6-box OTP Input */}
            <Text style={styles.inputLabel}>{t('auth.enterVerificationCode')}</Text>
            <OtpInput
              length={6}
              value={code}
              onChange={setCode}
              disabled={loading}
            />

            {/* Resend section */}
            <View style={styles.resendContainer}>
              <Text style={styles.resendPrompt}>{t('auth.didNotReceiveCode')}{' '}</Text>
              {countdown > 0 ? (
                <Text style={styles.countdownText}>
                  {t('auth.resendCodeIn', { seconds: countdown })}
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResend} disabled={resending}>
                  {resending ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.resendAction}>{t('auth.resendCode')}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* New Password input */}
            <View style={[styles.inputGroup, { marginTop: 14 }]}>
              <Text style={styles.inputLabel}>{t('auth.newPassword')}</Text>
              <View
                style={[
                  styles.inputContainer,
                  focusedField === 'newPassword' && styles.inputFocused,
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focusedField === 'newPassword' ? colors.accent : colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.newPasswordPlaceholder')}
                  placeholderTextColor={colors.oldPrice}
                  secureTextEntry={!showPassword}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  onFocus={() => setFocusedField('newPassword')}
                  onBlur={() => setFocusedField(null)}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('auth.confirmPassword')}</Text>
              <View
                style={[
                  styles.inputContainer,
                  focusedField === 'confirmPassword' && styles.inputFocused,
                ]}
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={focusedField === 'confirmPassword' ? colors.accent : colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  placeholderTextColor={colors.oldPrice}
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={() => setFocusedField('confirmPassword')}
                  onBlur={() => setFocusedField(null)}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Save Button */}
            <TouchableOpacity
              onPress={handleResetPassword}
              disabled={loading}
              activeOpacity={0.85}
              style={{ marginTop: 12 }}
            >
              <LinearGradient
                colors={loading ? [colors.disabledBg, colors.disabledBg] : [colors.accent, '#FF8C33']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.actionButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.actionButtonText}>{t('auth.resetPasswordButton')}</Text>
                    <Ionicons name="checkmark-done-outline" size={20} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Back to login */}
            <View style={styles.bottomLink}>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.bottomLinkAction}>{t('auth.backToLogin')}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.screenBg,
  },
  headerGradient: {
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingBottom: 46,
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 44,
    left: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoGradient: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
  formWrapper: {
    flex: 1,
    marginTop: -24,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 30,
  },
  formCard: {
    backgroundColor: colors.cardBg,
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 14,
    height: 52,
  },
  inputFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    height: '100%',
  },
  eyeButton: {
    padding: 4,
  },
  actionButton: {
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  resendPrompt: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  countdownText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.oldPrice,
  },
  resendAction: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  bottomLink: {
    alignItems: 'center',
    marginTop: 24,
  },
  bottomLinkAction: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
});

export default ResetPasswordScreen;
