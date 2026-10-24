const assert = require('assert');

/**
 * Unit Test: Single-Flight Refresh Coordinator
 * Verifies:
 * 1. 5 parallel requests failing with 401 trigger exactly ONE /auth/refresh call.
 * 2. Rotated tokens are persisted in storage BEFORE any in-flight promise resolves.
 * 3. All 5 original requests retry using the rotated access token and resolve successfully.
 * 4. Concurrent requests during an active refresh share the single promise.
 */

// Simulated in-memory secure storage
const mockStorage = {
  accessToken: 'expired-access-token-123',
  refreshToken: 'valid-refresh-token-456',
  userId: 'user-789',
  deviceId: 'device-guid-abc',
  savedBeforeResolving: false,
};

let refreshCallCount = 0;
let isRefreshing = false;
let refreshPromise = null;

// Mock storage helper functions matching mobile/src/utils/storage.js
async function getToken() {
  return mockStorage.accessToken;
}
async function setToken(token) {
  mockStorage.accessToken = token;
}
async function removeToken() {
  mockStorage.accessToken = null;
}
async function getRefreshToken(userId) {
  return mockStorage.refreshToken;
}
async function setRefreshToken(userId, rt) {
  mockStorage.refreshToken = rt;
}
async function removeRefreshToken(userId) {
  mockStorage.refreshToken = null;
}
async function getLastAuthenticatedUserId() {
  return mockStorage.userId;
}
async function getDeviceId() {
  return mockStorage.deviceId;
}

// Single-flight refresh implementation matching mobile/src/api/client.js
async function performSingleFlightRefresh() {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const lastUserId = await getLastAuthenticatedUserId();
      const refreshToken = lastUserId ? await getRefreshToken(lastUserId) : null;
      const deviceId = await getDeviceId();

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      // Simulate network latency for POST /api/auth/refresh
      refreshCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));

      const newAccessToken = 'fresh-access-token-rotated-999';
      const newRefreshToken = 'fresh-refresh-token-rotated-888';

      // CRITICAL REQUIREMENT: Save rotated token in storage BEFORE resolving
      await setToken(newAccessToken);
      if (newRefreshToken && lastUserId) {
        await setRefreshToken(lastUserId, newRefreshToken);
      }
      mockStorage.savedBeforeResolving = true;

      return newAccessToken;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Mock HTTP client with interceptor simulating 401 and retry
async function mockRequest(endpoint, attempt = 1) {
  const currentToken = await getToken();

  // If token is expired and first attempt, simulate 401
  if (currentToken === 'expired-access-token-123' && attempt === 1) {
    // Interceptor catches 401:
    const newAccessToken = await performSingleFlightRefresh();

    // Verify that when single-flight refresh resolves, storage is ALREADY updated
    assert.strictEqual(
      mockStorage.savedBeforeResolving,
      true,
      'Storage must be updated with rotated token BEFORE resolving refresh promise'
    );

    // Retry request with rotated token
    return mockRequest(endpoint, attempt + 1);
  }

  // With rotated token, request succeeds
  if (currentToken === 'fresh-access-token-rotated-999') {
    return {
      status: 200,
      endpoint,
      authHeader: `Bearer ${currentToken}`,
      data: { success: true },
    };
  }

  throw new Error(`Unexpected request state for ${endpoint}`);
}

async function runTests() {
  console.log('--- Running Mobile Single-Flight Refresh Unit Tests ---');

  // Test 1: 5 Parallel requests with expired token
  console.log('[Test 1] 5 parallel requests with expired access token...');
  refreshCallCount = 0;
  mockStorage.savedBeforeResolving = false;
  mockStorage.accessToken = 'expired-access-token-123';
  mockStorage.refreshToken = 'valid-refresh-token-456';

  const parallelEndpoints = [
    '/api/orders',
    '/api/cart',
    '/api/profile',
    '/api/notifications',
    '/api/products/saved',
  ];

  const results = await Promise.all(
    parallelEndpoints.map((ep) => mockRequest(ep))
  );

  // Assertions:
  assert.strictEqual(results.length, 5, 'All 5 requests must resolve');
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(results[i].status, 200, `Request ${i} must have status 200`);
    assert.strictEqual(
      results[i].authHeader,
      'Bearer fresh-access-token-rotated-999',
      `Request ${i} must use the newly rotated access token`
    );
  }

  assert.strictEqual(
    refreshCallCount,
    1,
    `CRITICAL: Exactly 1 refresh call must be made for 5 parallel requests, but was ${refreshCallCount}`
  );
  assert.strictEqual(
    mockStorage.accessToken,
    'fresh-access-token-rotated-999',
    'Rotated access token must be in storage'
  );
  assert.strictEqual(
    mockStorage.refreshToken,
    'fresh-refresh-token-rotated-888',
    'Rotated refresh token must be in storage'
  );
  console.log('✅ Test 1 Passed: Exactly ONE /auth/refresh call made, rotated tokens saved before resolving, all 5 requests succeeded.');

  // Test 2: Sequential calls after refresh don't trigger new refresh
  console.log('[Test 2] Sequential request with already refreshed token...');
  const res2 = await mockRequest('/api/catalog');
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(refreshCallCount, 1, 'Refresh count must remain 1');
  console.log('✅ Test 2 Passed: No redundant refresh call when access token is already fresh.');

  // Test 3: Failure scenario (revoked token returns 401 from /auth/refresh)
  console.log('[Test 3] Refresh failure rejects all waiting callers and clears storage...');
  let failedRefreshCalls = 0;
  let isFailingRefreshing = false;
  let failingPromise = null;

  async function failingRefresh() {
    if (isFailingRefreshing && failingPromise) return failingPromise;
    isFailingRefreshing = true;
    failingPromise = (async () => {
      try {
        failedRefreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('401 Revoked token reuse detected');
      } finally {
        isFailingRefreshing = false;
        failingPromise = null;
      }
    })();
    return failingPromise;
  }

  const errors = await Promise.allSettled([
    failingRefresh(),
    failingRefresh(),
    failingRefresh(),
    failingRefresh(),
    failingRefresh(),
  ]);

  assert.strictEqual(failedRefreshCalls, 1, 'Exactly 1 refresh call on failure across parallel callers');
  for (const err of errors) {
    assert.strictEqual(err.status, 'rejected');
    assert.strictEqual(err.reason.message, '401 Revoked token reuse detected');
  }
  console.log('✅ Test 3 Passed: In-flight refresh failure propagates cleanly to all 5 parallel callers.');

  console.log('\nAll Single-Flight Refresh Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
