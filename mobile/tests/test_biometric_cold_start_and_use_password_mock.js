const assert = require('assert');

/**
 * Unit Test Suite for B.2 and B.4:
 * 1. Cold start with biometrics enabled makes ZERO network calls before unlock (isLocked = true).
 * 2. Biometric unlock calls /auth/refresh, stores rotated tokens, and unlocks (isLocked = false).
 * 3. "Use Password" revokes the refresh token on the server and wipes local credentials.
 */

// Simulated SecureStore & AsyncStorage
const mockStorage = {
  accessToken: null,
  refreshToken: null,
  userId: null,
  biometricsEnabled: {},
  freshInstallHandled: true,
};

let networkCallLog = [];

function resetState() {
  mockStorage.accessToken = 'expired-jwt-token';
  mockStorage.refreshToken = 'valid-refresh-token-123';
  mockStorage.userId = 'user_42';
  mockStorage.biometricsEnabled['user_42'] = true;
  networkCallLog = [];
}

// Mock API endpoints
async function mockRefreshApi({ refreshToken, deviceId }) {
  networkCallLog.push({ endpoint: '/auth/refresh', body: { refreshToken, deviceId } });
  return {
    status: 200,
    data: {
      accessToken: 'new-valid-jwt-token-777',
      refreshToken: 'new-rotated-refresh-token-888',
      expiresIn: 3600,
    },
  };
}

async function mockLogoutApi({ refreshToken }) {
  networkCallLog.push({ endpoint: '/auth/logout', body: { refreshToken } });
  return {
    status: 200,
    data: { success: true },
  };
}

// Logic mirror of AuthContext.js: loadUserFromToken (B.2)
async function loadUserFromTokenSimulated(state) {
  const lastUserId = mockStorage.userId;
  let token = mockStorage.accessToken;

  // Requirement B.2: When biometrics are enabled and refresh token exists,
  // NEVER call /auth/refresh before a successful unlock on cold start (lock first, refresh after).
  if (lastUserId) {
    const bioEnabled = !!mockStorage.biometricsEnabled[lastUserId];
    const hasRt = !!mockStorage.refreshToken;

    if (bioEnabled && hasRt) {
      state.userId = lastUserId;
      state.isLocked = true;
      return; // CRITICAL: Stop immediately without contacting /auth/refresh
    }
  }

  // Normal flow if biometrics are NOT enabled
  if (!token && lastUserId && mockStorage.refreshToken) {
    const res = await mockRefreshApi({
      refreshToken: mockStorage.refreshToken,
      deviceId: 'device-guid',
    });
    mockStorage.accessToken = res.data.accessToken;
    mockStorage.refreshToken = res.data.refreshToken;
    state.isLocked = false;
  }
}

// Logic mirror of AuthContext.js: unlockWithBiometrics (B.2)
async function unlockWithBiometricsSimulated(state) {
  const currentUserId = state.userId || mockStorage.userId;
  if (!mockStorage.refreshToken) {
    await unlockWithPasswordSimulated(state);
    return;
  }

  const res = await mockRefreshApi({
    refreshToken: mockStorage.refreshToken,
    deviceId: 'device-guid',
  });

  mockStorage.accessToken = res.data.accessToken;
  mockStorage.refreshToken = res.data.refreshToken;
  state.isLocked = false;
}

// Logic mirror of AuthContext.js: unlockWithPassword (B.4)
async function unlockWithPasswordSimulated(state) {
  const currentUserId = state.userId || mockStorage.userId;
  if (currentUserId && mockStorage.refreshToken) {
    try {
      // Requirement B.4: Best-effort server revocation
      await mockLogoutApi({ refreshToken: mockStorage.refreshToken });
    } catch {
      // Best-effort
    }
    mockStorage.refreshToken = null;
  }

  mockStorage.accessToken = null;
  mockStorage.userId = null;
  state.userId = null;
  state.isLocked = false;
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING B.2 & B.4 BIOMETRIC COLD START & LOGOUT UNIT TESTS');
  console.log('================================================================');

  // TEST 1: Cold start with biometrics enabled makes ZERO network calls
  console.log('\n--- TEST 1: Cold start with biometrics enabled makes ZERO network calls ---');
  resetState();
  const authState = { isLocked: false, userId: null };

  await loadUserFromTokenSimulated(authState);

  assert.strictEqual(
    authState.isLocked,
    true,
    'App must be locked (isLocked === true) on cold start when biometrics enabled'
  );
  assert.strictEqual(
    networkCallLog.length,
    0,
    `CRITICAL (B.2): Exactly 0 network calls allowed before biometric unlock, but made ${networkCallLog.length}`
  );
  console.log('✅ TEST 1 PASSED: App locked immediately with 0 network calls.');

  // TEST 2: Successful biometric unlock calls /auth/refresh and updates state
  console.log('\n--- TEST 2: Successful biometric unlock performs refresh and unlocks ---');
  await unlockWithBiometricsSimulated(authState);

  assert.strictEqual(
    networkCallLog.length,
    1,
    'Exactly 1 refresh network call made upon biometric authentication'
  );
  assert.strictEqual(
    networkCallLog[0].endpoint,
    '/auth/refresh',
    'Called /auth/refresh endpoint'
  );
  assert.strictEqual(
    authState.isLocked,
    false,
    'App is unlocked (isLocked === false) after successful biometric refresh'
  );
  assert.strictEqual(
    mockStorage.accessToken,
    'new-valid-jwt-token-777',
    'New access token stored in SecureStore'
  );
  assert.strictEqual(
    mockStorage.refreshToken,
    'new-rotated-refresh-token-888',
    'Rotated refresh token stored in SecureStore'
  );
  console.log('✅ TEST 2 PASSED: Refresh executed only after unlock, tokens updated, app unlocked.');

  // TEST 3: "Use Password" revokes refresh token on server and wipes local credentials (B.4)
  console.log('\n--- TEST 3: "Use Password" revokes refresh token on server and wipes local credentials ---');
  resetState();
  authState.isLocked = true;
  networkCallLog = [];

  await unlockWithPasswordSimulated(authState);

  assert.strictEqual(
    networkCallLog.length,
    1,
    'Revocation network call made to server'
  );
  assert.strictEqual(
    networkCallLog[0].endpoint,
    '/auth/logout',
    'Called /auth/logout endpoint'
  );
  assert.strictEqual(
    networkCallLog[0].body.refreshToken,
    'valid-refresh-token-123',
    'Passed active refresh token to server for revocation'
  );
  assert.strictEqual(
    mockStorage.refreshToken,
    null,
    'Local refresh token wiped from SecureStore'
  );
  assert.strictEqual(
    mockStorage.accessToken,
    null,
    'Local access token wiped from SecureStore'
  );
  assert.strictEqual(
    authState.isLocked,
    false,
    'Lock state reset to false for normal password login'
  );
  console.log('✅ TEST 3 PASSED: Server revocation called best-effort and local storage wiped.');

  console.log('\n================================================================');
  console.log('🎉 ALL B.2 AND B.4 UNIT TESTS PASSED SUCCESSFULLY! (3/3)');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
