const assert = require('assert');

/**
 * Unit Test Suite for Requirement B.3: Server Refresh Token Grace Window
 * Verifies:
 * 1. Immediate retry within grace window (20s) accepts previous token ONCE (crash recovery).
 * 2. Unreceived replacement token is revoked, fresh token is issued.
 * 3. Second retry of the previous token triggers reuse detection and revokes the family.
 * 4. Retry after the 20-second grace window triggers reuse detection and revokes the family.
 * 5. Explicitly revoked tokens (e.g. from logout) are never eligible for grace.
 */

// Simulated database state for RefreshTokens
class MockRefreshTokenStore {
  constructor() {
    this.tokens = [];
    this.nextId = 1;
    this.graceWindowSeconds = 20;
  }

  createToken({ userId, deviceId, rawToken, expiresAt }) {
    const token = {
      id: this.nextId++,
      userId,
      deviceId,
      tokenHash: `hash_${rawToken}`,
      createdAt: new Date(),
      expiresAt: expiresAt || new Date(Date.now() + 60 * 86400000),
      lastUsedAt: null,
      revokedAt: null,
      replacedByTokenId: null,
    };
    this.tokens.push(token);
    return token;
  }

  findByHash(hash) {
    return this.tokens.find((t) => t.tokenHash === hash);
  }

  findActiveFamily(userId, deviceId) {
    return this.tokens.filter(
      (t) => t.userId === userId && t.deviceId === deviceId && t.revokedAt === null
    );
  }

  // Exact reproduction of AuthService.cs: RefreshTokenAsync logic with Grace Window
  async refreshToken({ rawToken, deviceId, currentTime = new Date() }) {
    const hash = `hash_${rawToken}`;
    const tokenRecord = this.findByHash(hash);

    if (!tokenRecord) {
      throw new Error('401: Invalid refresh token.');
    }

    // Reuse detection with Grace Window (default 20s)
    let handledInGrace = false;

    if (tokenRecord.revokedAt !== null) {
      const revokedElapsedSeconds = (currentTime.getTime() - tokenRecord.revokedAt.getTime()) / 1000;

      if (
        tokenRecord.replacedByTokenId !== null &&
        revokedElapsedSeconds <= this.graceWindowSeconds &&
        tokenRecord.deviceId.toLowerCase() === deviceId.trim().toLowerCase()
      ) {
        // Verify the replacement token exists and has NOT yet been used/revoked
        const replacementToken = this.tokens.find((t) => t.id === tokenRecord.replacedByTokenId);
        if (replacementToken && replacementToken.revokedAt === null) {
          handledInGrace = true;

          // Revoke the unreceived replacement token
          replacementToken.revokedAt = currentTime;

          // Invalidate grace eligibility for this token so it cannot be used a second time
          tokenRecord.revokedAt = new Date(currentTime.getTime() - (this.graceWindowSeconds + 10) * 1000);
        }
      }

      if (!handledInGrace) {
        // Family Revocation
        const familyTokens = this.findActiveFamily(tokenRecord.userId, tokenRecord.deviceId);
        for (const t of familyTokens) {
          t.revokedAt = currentTime;
        }
        throw new Error('401: Revoked refresh token reuse detected. All sessions for this device have been revoked.');
      }
    }

    // Expired check
    if (tokenRecord.expiresAt <= currentTime) {
      tokenRecord.revokedAt = currentTime;
      throw new Error('401: Refresh token has expired.');
    }

    // DeviceId mismatch check
    if (tokenRecord.deviceId.toLowerCase() !== deviceId.trim().toLowerCase()) {
      throw new Error('401: Device ID mismatch.');
    }

    // Rotation: issue new token
    const newRaw = `rotated_${this.nextId}_${Date.now()}`;
    const newToken = this.createToken({
      userId: tokenRecord.userId,
      deviceId: tokenRecord.deviceId,
      rawToken: newRaw,
      expiresAt: new Date(currentTime.getTime() + 60 * 86400000),
    });

    tokenRecord.revokedAt = handledInGrace
      ? new Date(currentTime.getTime() - (this.graceWindowSeconds + 10) * 1000)
      : currentTime;
    tokenRecord.lastUsedAt = currentTime;
    tokenRecord.replacedByTokenId = newToken.id;

    return {
      accessToken: `jwt_for_user_${tokenRecord.userId}`,
      refreshToken: newRaw,
      tokenId: newToken.id,
    };
  }
}

async function runGraceWindowTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING B.3 SERVER REFRESH TOKEN GRACE WINDOW UNIT TESTS');
  console.log('================================================================');

  const store = new MockRefreshTokenStore();
  const userId = 100;
  const deviceId = 'device-guid-xyz';

  // TEST 1: Initial token works and rotates T1 -> T2
  console.log('\n--- TEST 1: Standard token rotation T1 -> T2 ---');
  const t1 = store.createToken({ userId, deviceId, rawToken: 'T1' });
  const rot1 = await store.refreshToken({ rawToken: 'T1', deviceId, currentTime: new Date(1000000) });
  assert.strictEqual(rot1.refreshToken.startsWith('rotated_'), true);
  const t2Record = store.findByHash(`hash_${rot1.refreshToken}`);
  assert.strictEqual(t2Record.revokedAt, null, 'T2 must be active');
  console.log('✅ TEST 1 PASSED: T1 rotated to T2 successfully.');

  // TEST 2: Network crash recovery: T1 presented within 5s grace window is accepted ONCE
  console.log('\n--- TEST 2: Crash recovery within 20s grace window (T1 -> T3) ---');
  // Client retries T1 after 5 seconds
  const retryTime = new Date(1000000 + 5000);
  const rot2 = await store.refreshToken({ rawToken: 'T1', deviceId, currentTime: retryTime });
  assert.strictEqual(t2Record.revokedAt.getTime(), retryTime.getTime(), 'Unreceived T2 was revoked');
  assert.notStrictEqual(rot2.refreshToken, rot1.refreshToken, 'Issued fresh replacement token T3');
  console.log('✅ TEST 2 PASSED: T1 accepted under grace window; T2 revoked and fresh T3 issued.');

  // TEST 3: Repeat use of T1 (2nd retry) triggers reuse detection & revokes family
  console.log('\n--- TEST 3: Repeat use of T1 (2nd retry) triggers reuse detection & kills family ---');
  let errTest3 = null;
  try {
    await store.refreshToken({ rawToken: 'T1', deviceId, currentTime: new Date(1000000 + 7000) });
  } catch (err) {
    errTest3 = err.message;
  }
  assert.strictEqual(
    errTest3.includes('Revoked refresh token reuse detected'),
    true,
    'Must trigger reuse detection on 2nd reuse of T1'
  );

  // Verify active tokens for this user & device are now ALL killed
  const activeTokens = store.findActiveFamily(userId, deviceId);
  assert.strictEqual(activeTokens.length, 0, 'Family revocation killed all active tokens for device');
  console.log('✅ TEST 3 PASSED: Second reuse of T1 detected and family revoked with HTTP 401.');

  // TEST 4: Token presented after grace window (> 20s) revokes family
  console.log('\n--- TEST 4: Reuse attempt beyond 20-second grace window kills family ---');
  const store2 = new MockRefreshTokenStore();
  const tA = store2.createToken({ userId: 200, deviceId: 'device-2', rawToken: 'TA' });
  const rotA = await store2.refreshToken({ rawToken: 'TA', deviceId: 'device-2', currentTime: new Date(2000000) });

  let errTest4 = null;
  try {
    // Retried after 25 seconds (grace window is 20s)
    await store2.refreshToken({ rawToken: 'TA', deviceId: 'device-2', currentTime: new Date(2000000 + 25000) });
  } catch (err) {
    errTest4 = err.message;
  }
  assert.strictEqual(
    errTest4.includes('Revoked refresh token reuse detected'),
    true,
    'Must trigger reuse detection after grace window has expired'
  );
  assert.strictEqual(store2.findActiveFamily(200, 'device-2').length, 0, 'Family killed on expired grace attempt');
  console.log('✅ TEST 4 PASSED: Attempt beyond 20s grace window killed token family with HTTP 401.');

  // TEST 5: Explicitly revoked token (e.g. from logout) is never granted grace
  console.log('\n--- TEST 5: Explicitly revoked token without rotation never receives grace ---');
  const store3 = new MockRefreshTokenStore();
  const tLogout = store3.createToken({ userId: 300, deviceId: 'device-3', rawToken: 'T_LOGOUT' });
  tLogout.revokedAt = new Date(3000000); // Revoked via logout (replacedByTokenId === null)

  let errTest5 = null;
  try {
    await store3.refreshToken({ rawToken: 'T_LOGOUT', deviceId: 'device-3', currentTime: new Date(3000005) });
  } catch (err) {
    errTest5 = err.message;
  }
  assert.strictEqual(
    errTest5.includes('Revoked refresh token reuse detected'),
    true,
    'Logout tokens are never eligible for grace'
  );
  console.log('✅ TEST 5 PASSED: Explicitly revoked token rejected immediately without grace.');

  console.log('\n================================================================');
  console.log('🎉 ALL B.3 SERVER GRACE WINDOW TESTS PASSED SUCCESSFULLY! (5/5)');
  console.log('================================================================\n');
}

runGraceWindowTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
