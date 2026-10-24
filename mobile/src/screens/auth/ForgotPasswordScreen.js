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
import { forgotPassword as forgotPasswordApi } from '../../api/authApi';
import { colors } from '../../theme/colors';
import { isValidEgyptianPhone, normalizeEgyptianPhone } from '../../utils/egyptianPhone';

const ForgotPasswordScreen = ({ route, navigation }) => {
  const { t } = useTranslation();
  const initialIdentifier = route?.params?.initialIdentifier || '';

  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [loading, setLoading] = useState(false);
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

  const handleSendCode = async () => {
    const raw = identifier.trim();
    if (!raw) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }

    // Normalize if Egyptian phone format
    let normalized = raw;
    if (isValidEgyptianPhone(raw)) {
      normalized = normalizeEgyptianPhone(raw);
    }

    setLoading(true);
    try {
      const response = await forgotPasswordApi({ identifier: normalized });
      const maskedTarget = response.data?.target || normalized;

      navigation.navigate('ResetPassword', {
        identifier: normalized,
        maskedTarget,
      });
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
          <Ionicons name="key-outline" size={32} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>{t('auth.forgotPasswordTitle')}</Text>
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
            <Text style={styles.title}>{t('auth.forgotPasswordTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.forgotPasswordSubtitle')}</Text>

            {/* Identifier input */}
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

            {/* Send Code button */}
            <TouchableOpacity
              onPress={handleSendCode}
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
                    <Text style={styles.actionButtonText}>{t('auth.sendResetCode')}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />
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
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
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

export default ForgotPasswordScreen;
