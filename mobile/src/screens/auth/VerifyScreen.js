import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
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
import { AuthContext } from '../../context/AuthContext';
import { resendCode as resendCodeApi } from '../../api/authApi';
import { colors } from '../../theme/colors';
import OtpInput from '../../components/OtpInput';

const RESEND_COOLDOWN_SECONDS = 60;

const VerifyScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { verify } = useContext(AuthContext);

  const { target = '', maskedTarget = '', purpose = 'Verify' } = route.params || {};

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);

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

  const handleVerify = async (codeToVerify) => {
    const finalCode = (codeToVerify || code).trim();
    if (finalCode.length !== 6) {
      Alert.alert(t('common.error'), t('auth.invalidCodeLength'));
      return;
    }

    setLoading(true);
    try {
      await verify(target, finalCode);
      // Navigation is handled reactively by AuthContext when userRole is populated
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;

    setResending(true);
    try {
      await resendCodeApi({ target, purpose });
      setCountdown(RESEND_COOLDOWN_SECONDS);
      Alert.alert(t('common.success'), t('auth.codeResent'));
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      Alert.alert(t('common.error'), msg);
    } finally {
      setResending(false);
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
          <Ionicons name="shield-checkmark" size={32} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>{t('auth.verifyTitle')}</Text>
      </LinearGradient>

      {/* Main card */}
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
            {/* Subtitle / Instructions */}
            <Text style={styles.title}>{t('auth.enterVerificationCode')}</Text>
            <Text style={styles.subtitle}>
              {t('auth.verifySubtitle', { target: maskedTarget || target })}
            </Text>

            {/* 6-box OTP Input */}
            <OtpInput
              length={6}
              value={code}
              onChange={setCode}
              onComplete={(completedCode) => handleVerify(completedCode)}
              disabled={loading}
            />

            {/* Verify Button */}
            <TouchableOpacity
              onPress={() => handleVerify(code)}
              disabled={loading || code.length !== 6}
              activeOpacity={0.85}
              style={{ marginTop: 12 }}
            >
              <LinearGradient
                colors={
                  loading || code.length !== 6
                    ? [colors.disabledBg, colors.disabledBg]
                    : [colors.accent, '#FF8C33']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.actionButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.actionButtonText}>{t('auth.verifyButton')}</Text>
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Resend Section */}
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

            {/* Change identifier / back */}
            <View style={styles.bottomLink}>
              <TouchableOpacity onPress={() => navigation.goBack()}>
                <Text style={styles.changeLinkText}>{t('auth.changeIdentifier')}</Text>
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
    marginTop: 24,
    flexWrap: 'wrap',
  },
  resendPrompt: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  countdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.oldPrice,
  },
  resendAction: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  bottomLink: {
    alignItems: 'center',
    marginTop: 28,
  },
  changeLinkText: {
    fontSize: 14,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});

export default VerifyScreen;
