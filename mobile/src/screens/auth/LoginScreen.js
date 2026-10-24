import React, { useState, useContext, useEffect } from 'react';
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
import { AuthContext } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { useGoogleAuth } from '../../utils/googleAuth';
import GoogleSignInButton from '../../components/GoogleSignInButton';
import { getAppConfig } from '../../api/configApi';
import { isValidEgyptianPhone, normalizeEgyptianPhone } from '../../utils/egyptianPhone';

const LoginScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { login } = useContext(AuthContext);
  const { signIn: signInWithGoogle, isLoading: googleLoading } = useGoogleAuth({
    role: 'Buyer',
    acceptedTermsAndPrivacy: true,
  });

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // Animations
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(30));
  const [logoScale] = useState(() => new Animated.Value(0.8));

  useEffect(() => {
    getAppConfig()
      .then((res) => {
        if (res?.data?.googleEnabled != null) {
          setGoogleEnabled(Boolean(res.data.googleEnabled));
        }
      })
      .catch(() => {
        setGoogleEnabled(false);
      });

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, logoScale]);

  const handleLogin = async () => {
    const rawIdentifier = identifier.trim();
    if (!rawIdentifier || !password) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }

    let cleanIdentifier = rawIdentifier;
    if (isValidEgyptianPhone(rawIdentifier)) {
      cleanIdentifier = normalizeEgyptianPhone(rawIdentifier);
    }

    setLoading(true);
    try {
      await login(cleanIdentifier, password);
    } catch (err) {
      // Check if user is not verified yet (HTTP 403 NOT_VERIFIED)
      if (err.response?.status === 403 && err.response?.data?.code === 'NOT_VERIFIED') {
        const target = err.response.data.target || cleanIdentifier;
        navigation.navigate('Verify', {
          target,
          maskedTarget: err.response.data.target || cleanIdentifier,
          purpose: 'Verify',
        });
        return;
      }
      Alert.alert(t('common.error'), err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top gradient header */}
      <LinearGradient
        colors={['#0F172A', '#1E3A5F', '#0F172A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.decorCircle1} />
        <View style={styles.decorCircle2} />

        <Animated.View
          style={[
            styles.headerContent,
            {
              opacity: fadeAnim,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={[colors.accent, '#FF8C33']}
              style={styles.logoGradient}
            >
              <Ionicons name="storefront" size={32} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={styles.brandName}>Marketplace</Text>
          <Text style={styles.brandTagline}>🇪🇬</Text>
        </Animated.View>
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
            {/* Welcome text */}
            <Text style={styles.title}>{t('auth.loginTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.loginSubtitle')}</Text>

            {/* Email or Phone input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('auth.emailOrPhone')}</Text>
              <View
                style={[
                  styles.inputContainer,
                  focusedField === 'identifier' && styles.inputFocused,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={focusedField === 'identifier' ? colors.accent : colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.emailOrPhonePlaceholder')}
                  placeholderTextColor={colors.oldPrice}
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={setIdentifier}
                  onFocus={() => setFocusedField('identifier')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>
            </View>

            {/* Password input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('auth.password')}</Text>
              <View
                style={[
                  styles.inputContainer,
                  focusedField === 'password' && styles.inputFocused,
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focusedField === 'password' ? colors.accent : colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.passwordPlaceholder')}
                  placeholderTextColor={colors.oldPrice}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
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

              {/* Forgot password link */}
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('ForgotPassword', {
                    initialIdentifier: identifier.trim(),
                  })
                }
                style={styles.forgotPasswordContainer}
              >
                <Text style={styles.forgotPasswordText}>{t('auth.forgotPassword')}</Text>
              </TouchableOpacity>
            </View>

            {/* Login button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              style={{ marginTop: 8 }}
            >
              <LinearGradient
                colors={loading ? [colors.disabledBg, colors.disabledBg] : [colors.accent, '#FF8C33']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>{t('auth.login')}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Google Sign In Button (only rendered when enabled by server config) */}
            {googleEnabled && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('auth.orContinueWith')}</Text>
                  <View style={styles.dividerLine} />
                </View>

                <GoogleSignInButton
                  onPress={signInWithGoogle}
                  loading={googleLoading}
                  style={{ marginBottom: 20 }}
                />
              </>
            )}

            {/* Register link */}
            <View style={[styles.bottomLink, !googleEnabled && { marginTop: 24 }]}>
              <Text style={styles.bottomLinkText}>{t('auth.noAccount')} </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                <Text style={styles.bottomLinkAction}>{t('auth.signUpNow')}</Text>
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
    paddingBottom: 50,
    alignItems: 'center',
    overflow: 'hidden',
  },
  decorCircle1: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  decorCircle2: {
    position: 'absolute',
    bottom: -20,
    left: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 107, 0, 0.08)',
  },
  headerContent: {
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 12,
  },
  logoGradient: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  brandName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  brandTagline: {
    fontSize: 18,
    marginTop: 4,
  },
  formWrapper: {
    flex: 1,
    marginTop: -28,
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
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 28,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 18,
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
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  forgotPasswordText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
  },
  loginButton: {
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
  loginButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: 14,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  bottomLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomLinkText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  bottomLinkAction: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
});

export default LoginScreen;
