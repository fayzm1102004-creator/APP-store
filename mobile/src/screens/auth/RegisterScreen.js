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

const RoleCard = ({ roleKey, icon, isSelected, onSelect, t }) => (
  <TouchableOpacity
    onPress={() => onSelect(roleKey)}
    activeOpacity={0.8}
    style={[styles.roleCard, isSelected && styles.roleCardSelected]}
  >
    {isSelected && (
      <LinearGradient
        colors={[colors.accent, '#FF8C33']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    )}
    <View style={[styles.roleIconWrap, isSelected && styles.roleIconWrapSelected]}>
      <Ionicons
        name={icon}
        size={24}
        color={isSelected ? colors.accent : colors.textSecondary}
      />
    </View>
    <Text style={[styles.roleTitle, isSelected && styles.roleTitleSelected]}>
      {t(`auth.role${roleKey}`)}
    </Text>
    <Text style={[styles.roleSub, isSelected && styles.roleSubSelected]}>
      {t(`auth.roleSub${roleKey}`)}
    </Text>
    {isSelected && (
      <View style={styles.roleCheck}>
        <Ionicons name="checkmark-circle" size={22} color="#fff" />
      </View>
    )}
  </TouchableOpacity>
);

const RegisterScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { register } = useContext(AuthContext);

  const [signupMethod, setSignupMethod] = useState('email'); // 'email' | 'phone'
  const [phoneSignupEnabled, setPhoneSignupEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Buyer');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const { signIn: signInWithGoogle, isLoading: googleLoading } = useGoogleAuth({
    role,
    acceptedTermsAndPrivacy: acceptedTerms,
    marketingConsent,
  });

  const handleGoogleRegister = async () => {
    if (!acceptedTerms) {
      Alert.alert(t('common.error'), t('auth.mustAgreeTerms'));
      return;
    }
    await signInWithGoogle();
  };

  // Animations
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(30));
  const [logoScale] = useState(() => new Animated.Value(0.8));

  useEffect(() => {
    getAppConfig()
      .then((res) => {
        if (res?.data) {
          if (res.data.googleEnabled != null) {
            setGoogleEnabled(Boolean(res.data.googleEnabled));
          }
          if (res.data.phoneSignupEnabled != null) {
            setPhoneSignupEnabled(Boolean(res.data.phoneSignupEnabled));
          }
        }
      })
      .catch(() => {
        setGoogleEnabled(false);
        setPhoneSignupEnabled(false);
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

  const handleRegister = async () => {
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }

    let targetEmail = null;
    let targetPhone = null;

    if (signupMethod === 'phone') {
      const cleanPhone = phone.trim();
      if (!cleanPhone || !isValidEgyptianPhone(cleanPhone)) {
        Alert.alert(t('common.error'), t('common.invalidPhone'));
        return;
      }
      targetPhone = normalizeEgyptianPhone(cleanPhone);
    } else {
      const cleanEmail = email.trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        Alert.alert(t('common.error'), t('common.fillAllFields'));
        return;
      }
      targetEmail = cleanEmail;
    }

    if (!password || password.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordMinLength'));
      return;
    }

    if (!acceptedTerms) {
      Alert.alert(t('common.error'), t('auth.mustAgreeTerms'));
      return;
    }

    setLoading(true);
    try {
      const res = await register({
        name: name.trim(),
        email: targetEmail,
        phone: targetPhone,
        password,
        role,
        acceptedTermsAndPrivacy: acceptedTerms,
        marketingConsent,
      });

      const target = res?.target || (signupMethod === 'phone' ? targetPhone : targetEmail);
      navigation.navigate('Verify', {
        target,
        maskedTarget: res?.target || target,
        purpose: 'Verify',
      });
    } catch (err) {
      let msg = err.response?.data?.error || err.message;
      if (err.response?.data?.errors) {
        const details = Object.values(err.response.data.errors).flat().join('\n');
        if (details) msg = details;
      }
      Alert.alert(t('common.error'), msg);
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
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

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
              <Ionicons name="person-add" size={28} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={styles.headerTitle}>{t('auth.registerTitle')}</Text>
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
            {/* Subtitle */}
            <Text style={styles.subtitle}>{t('auth.registerSubtitle')}</Text>

            {/* Role selection */}
            <Text style={styles.sectionLabel}>{t('auth.chooseRole')}</Text>
            <View style={styles.roleRow}>
              <RoleCard
                roleKey="Buyer"
                icon="cart-outline"
                isSelected={role === 'Buyer'}
                onSelect={setRole}
                t={t}
              />
              <RoleCard
                roleKey="Seller"
                icon="storefront-outline"
                isSelected={role === 'Seller'}
                onSelect={setRole}
                t={t}
              />
            </View>

            {/* Email / Phone Method Toggle (Only if phoneSignupEnabled) */}
            {phoneSignupEnabled && (
              <View style={styles.methodToggleContainer}>
                <Text style={styles.sectionLabel}>{t('auth.chooseMethod')}</Text>
                <View style={styles.toggleRow}>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      signupMethod === 'email' && styles.toggleButtonActive,
                    ]}
                    onPress={() => setSignupMethod('email')}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={18}
                      color={signupMethod === 'email' ? '#fff' : colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.toggleButtonText,
                        signupMethod === 'email' && styles.toggleButtonTextActive,
                      ]}
                    >
                      {t('auth.registerWithEmail')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      signupMethod === 'phone' && styles.toggleButtonActive,
                    ]}
                    onPress={() => setSignupMethod('phone')}
                  >
                    <Ionicons
                      name="call-outline"
                      size={18}
                      color={signupMethod === 'phone' ? '#fff' : colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.toggleButtonText,
                        signupMethod === 'phone' && styles.toggleButtonTextActive,
                      ]}
                    >
                      {t('auth.registerWithPhone')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Name input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('auth.name')}</Text>
              <View
                style={[
                  styles.inputContainer,
                  focusedField === 'name' && styles.inputFocused,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={focusedField === 'name' ? colors.accent : colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.namePlaceholder')}
                  placeholderTextColor={colors.oldPrice}
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>
            </View>

            {/* Email OR Phone input depending on signupMethod */}
            {signupMethod === 'phone' && phoneSignupEnabled ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('auth.phone')}</Text>
                <View
                  style={[
                    styles.inputContainer,
                    focusedField === 'phone' && styles.inputFocused,
                  ]}
                >
                  <Ionicons
                    name="call-outline"
                    size={20}
                    color={focusedField === 'phone' ? colors.accent : colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.phonePlaceholder')}
                    placeholderTextColor={colors.oldPrice}
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('auth.email')}</Text>
                <View
                  style={[
                    styles.inputContainer,
                    focusedField === 'email' && styles.inputFocused,
                  ]}
                >
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={focusedField === 'email' ? colors.accent : colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.emailPlaceholder')}
                    placeholderTextColor={colors.oldPrice}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              </View>
            )}

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
            </View>

            {/* PDPL 151/2020 Mandatory Terms & Privacy Checkbox */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.checkboxRow}
              onPress={() => setAcceptedTerms(!acceptedTerms)}
            >
              <View style={[styles.checkboxBox, acceptedTerms && styles.checkboxBoxChecked]}>
                {acceptedTerms && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <Text style={styles.checkboxLabel}>
                {t('auth.termsCheckbox')}{' '}
                <Text style={styles.requiredAsterisk}>*</Text>
              </Text>
            </TouchableOpacity>

            {/* Optional Marketing Consent Checkbox */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.checkboxRow, { marginBottom: 16 }]}
              onPress={() => setMarketingConsent(!marketingConsent)}
            >
              <View style={[styles.checkboxBox, marketingConsent && styles.checkboxBoxChecked]}>
                {marketingConsent && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <Text style={styles.checkboxLabel}>
                {t('auth.marketingCheckbox')}
              </Text>
            </TouchableOpacity>

            {/* Register button */}
            <TouchableOpacity
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
              style={{ marginTop: 4 }}
            >
              <LinearGradient
                colors={loading ? [colors.disabledBg, colors.disabledBg] : [colors.accent, '#FF8C33']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.registerButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.registerButtonText}>{t('auth.register')}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Google Register button (only rendered when enabled by server config) */}
            {googleEnabled && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('auth.orContinueWith')}</Text>
                  <View style={styles.dividerLine} />
                </View>

                <GoogleSignInButton
                  onPress={handleGoogleRegister}
                  loading={googleLoading}
                  style={{ marginBottom: 4 }}
                />
              </>
            )}

            {/* Terms */}
            <Text style={styles.termsText}>{t('auth.agreeTerms')}</Text>

            {/* Login link */}
            <View style={styles.bottomLink}>
              <Text style={styles.bottomLinkText}>{t('auth.haveAccount')} </Text>
              <TouchableOpacity onPress={() => navigation.goBack()}>
                <Text style={styles.bottomLinkAction}>{t('auth.signInNow')}</Text>
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
    paddingBottom: 44,
    alignItems: 'center',
    overflow: 'hidden',
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
    marginBottom: 10,
  },
  logoGradient: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 22,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  roleCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.primarySoft,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  roleCardSelected: {
    borderColor: colors.accent,
    borderWidth: 0,
  },
  roleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  roleIconWrapSelected: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  roleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  roleTitleSelected: {
    color: '#fff',
  },
  roleSub: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  roleSubSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  roleCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  methodToggleContainer: {
    marginBottom: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  toggleButtonActive: {
    backgroundColor: colors.accent,
  },
  toggleButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleButtonTextActive: {
    color: '#fff',
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
  registerButton: {
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
  registerButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  termsText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 16,
    lineHeight: 16,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 6,
    paddingHorizontal: 2,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  requiredAsterisk: {
    color: colors.danger || '#DC2626',
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
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
});

export default RegisterScreen;
