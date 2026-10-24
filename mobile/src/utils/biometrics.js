import * as LocalAuthentication from 'expo-local-authentication';

export const DEFAULT_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes (configurable)

/**
 * Checks biometric hardware presence and enrolled credentials.
 * Explains in clear Arabic / key why biometrics are unavailable.
 */
export const checkBiometricSupport = async () => {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return {
        available: false,
        reason: 'hardware_unavailable',
        messageKey: 'biometrics.hardwareUnavailable',
      };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return {
        available: false,
        reason: 'not_enrolled',
        messageKey: 'biometrics.notEnrolled',
      };
    }

    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return {
      available: true,
      supportedTypes: supportedTypes || [],
    };
  } catch (error) {
    console.error('Error querying biometric support', error);
    return {
      available: false,
      reason: 'hardware_unavailable',
      messageKey: 'biometrics.hardwareUnavailable',
    };
  }
};

/**
 * Prompts user for biometric authentication with OS passcode/PIN fallback.
 */
export const promptBiometricAuth = async ({
  promptMessage = 'تأكيد البصمة للمتابعة',
  fallbackLabel = 'استخدم رمز الهاتف',
} = {}) => {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel,
      disableDeviceFallback: false, // Allows device PIN/passcode fallback
      cancelLabel: 'إلغاء',
    });

    return {
      success: !!result.success,
      error: result.error,
      warning: result.warning,
    };
  } catch (error) {
    console.error('Biometric authentication error', error);
    return {
      success: false,
      error: error?.message || 'unknown_error',
    };
  }
};

// ─── Pure Lock / Unlock State Machine ────────────────────────
export const LockState = {
  UNLOCKED: 'UNLOCKED',
  LOCKED: 'LOCKED',
  LOGGED_OUT: 'LOGGED_OUT',
};

/**
 * Evaluates whether the app should transition to LOCKED state
 * when returning from background or on initial launch.
 */
export const evaluateLockStateOnResume = ({
  currentState = LockState.UNLOCKED,
  backgroundElapsedMs = 0,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  biometricsEnabled = false,
  hasRefreshToken = false,
  isInitialLaunch = false,
}) => {
  if (!hasRefreshToken) {
    return LockState.LOGGED_OUT;
  }

  if (!biometricsEnabled) {
    return LockState.UNLOCKED;
  }

  // On cold start / fresh launch with biometrics enabled & refresh token present
  if (isInitialLaunch) {
    return LockState.LOCKED;
  }

  // When returning from background: lock if elapsed background time >= timeout
  if (backgroundElapsedMs >= timeoutMs) {
    return LockState.LOCKED;
  }

  return currentState;
};

/**
 * Handles transition upon biometric unlock prompt result.
 */
export const evaluateUnlockResult = ({
  biometricSuccess = false,
  refreshSuccess = false,
}) => {
  if (!biometricSuccess) {
    return { nextState: LockState.LOCKED, action: 'RETRY_OR_FALLBACK' };
  }

  if (!refreshSuccess) {
    return { nextState: LockState.LOGGED_OUT, action: 'REQUIRE_PASSWORD_LOGIN' };
  }

  return { nextState: LockState.UNLOCKED, action: 'RESUME_APP' };
};
