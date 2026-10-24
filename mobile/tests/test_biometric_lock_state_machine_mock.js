const assert = require('assert');

// Pure state machine logic (mirrored from src/utils/biometrics.js)
const LockState = {
  UNLOCKED: 'UNLOCKED',
  LOCKED: 'LOCKED',
  LOGGED_OUT: 'LOGGED_OUT',
};

const DEFAULT_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 120,000 ms

function evaluateLockStateOnResume({
  currentState = LockState.UNLOCKED,
  backgroundElapsedMs = 0,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  biometricsEnabled = false,
  hasRefreshToken = false,
  isInitialLaunch = false,
}) {
  if (!hasRefreshToken) {
    return LockState.LOGGED_OUT;
  }

  if (!biometricsEnabled) {
    return LockState.UNLOCKED;
  }

  if (isInitialLaunch) {
    return LockState.LOCKED;
  }

  if (backgroundElapsedMs >= timeoutMs) {
    return LockState.LOCKED;
  }

  return currentState;
}

function evaluateUnlockResult({
  biometricSuccess = false,
  refreshSuccess = false,
}) {
  if (!biometricSuccess) {
    return { nextState: LockState.LOCKED, action: 'RETRY_OR_FALLBACK' };
  }

  if (!refreshSuccess) {
    return { nextState: LockState.LOGGED_OUT, action: 'REQUIRE_PASSWORD_LOGIN' };
  }

  return { nextState: LockState.UNLOCKED, action: 'RESUME_APP' };
}

// ─── RUN UNIT TESTS ─────────────────────────────────────────
console.log('================================================================');
console.log('🧪 BIOMETRIC LOCK / UNLOCK STATE MACHINE UNIT TESTS');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${description}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${description}`);
    console.error(`   ${err.message}`);
    failed++;
  }
}

// 1. Initial Launch / Cold Start Tests
it('Cold start: biometrics enabled + refresh token -> transitions to LOCKED', () => {
  const state = evaluateLockStateOnResume({
    isInitialLaunch: true,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.LOCKED);
});

it('Cold start: biometrics disabled -> transitions to UNLOCKED', () => {
  const state = evaluateLockStateOnResume({
    isInitialLaunch: true,
    biometricsEnabled: false,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.UNLOCKED);
});

it('Cold start: no refresh token -> transitions to LOGGED_OUT', () => {
  const state = evaluateLockStateOnResume({
    isInitialLaunch: true,
    biometricsEnabled: true,
    hasRefreshToken: false,
  });
  assert.strictEqual(state, LockState.LOGGED_OUT);
});

// 2. Background Resume Timing Tests
it('Resume < 2 minutes (e.g. 45s): remains UNLOCKED', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 45 * 1000,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.UNLOCKED);
});

it('Resume < 2 minutes (boundary 119,999ms): remains UNLOCKED', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 119999,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.UNLOCKED);
});

it('Resume exactly 2 minutes (120,000ms): transitions to LOCKED', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 120000,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.LOCKED);
});

it('Resume > 2 minutes (e.g. 5m): transitions to LOCKED', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 5 * 60 * 1000,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.LOCKED);
});

it('Resume > 2 minutes but biometrics disabled: remains UNLOCKED', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 5 * 60 * 1000,
    biometricsEnabled: false,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.UNLOCKED);
});

it('Resume > 2 minutes but no refresh token: transitions to LOGGED_OUT', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 5 * 60 * 1000,
    biometricsEnabled: true,
    hasRefreshToken: false,
  });
  assert.strictEqual(state, LockState.LOGGED_OUT);
});

it('Custom configurable timeout (e.g. 30s): locks after 31s', () => {
  const state = evaluateLockStateOnResume({
    currentState: LockState.UNLOCKED,
    backgroundElapsedMs: 31 * 1000,
    timeoutMs: 30 * 1000,
    biometricsEnabled: true,
    hasRefreshToken: true,
  });
  assert.strictEqual(state, LockState.LOCKED);
});

// 3. Unlock Result & Error Handling Tests
it('Unlock prompt: biometric success + refresh success -> transitions to UNLOCKED and resumes app', () => {
  const res = evaluateUnlockResult({
    biometricSuccess: true,
    refreshSuccess: true,
  });
  assert.strictEqual(res.nextState, LockState.UNLOCKED);
  assert.strictEqual(res.action, 'RESUME_APP');
});

it('Unlock prompt: biometric cancelled/failed -> remains LOCKED with retry', () => {
  const res = evaluateUnlockResult({
    biometricSuccess: false,
    refreshSuccess: false,
  });
  assert.strictEqual(res.nextState, LockState.LOCKED);
  assert.strictEqual(res.action, 'RETRY_OR_FALLBACK');
});

it('Unlock prompt: biometric succeeded but backend refresh failed (401/expired) -> transitions to LOGGED_OUT', () => {
  const res = evaluateUnlockResult({
    biometricSuccess: true,
    refreshSuccess: false,
  });
  assert.strictEqual(res.nextState, LockState.LOGGED_OUT);
  assert.strictEqual(res.action, 'REQUIRE_PASSWORD_LOGIN');
});

// 4. Fresh Install Wipe Logic
it('Fresh install detection: first run wipes credentials and marks initialized', () => {
  let fakeAsyncStorage = {};
  let fakeSecureStore = { jwt_token: 'old_surviving_ios_token' };

  function simulateFreshInstallCheck() {
    const isInitialized = fakeAsyncStorage['app_installed_initialized'];
    if (!isInitialized) {
      delete fakeSecureStore['jwt_token'];
      fakeAsyncStorage['app_installed_initialized'] = 'true';
      return true; // wiped
    }
    return false; // not fresh
  }

  const firstRun = simulateFreshInstallCheck();
  assert.strictEqual(firstRun, true, 'First launch detected fresh install');
  assert.strictEqual(fakeSecureStore['jwt_token'], undefined, 'Leftover token purged');
  assert.strictEqual(fakeAsyncStorage['app_installed_initialized'], 'true');

  const secondRun = simulateFreshInstallCheck();
  assert.strictEqual(secondRun, false, 'Second launch does not trigger fresh install purge');
});

console.log('\n================================================================');
console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
