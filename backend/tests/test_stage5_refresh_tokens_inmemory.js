const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const TEST_PORT = 5295;
const PROD_PORT = 5296;
const CSPROJ_PATH = path.resolve(__dirname, '../Marketplace.API/Marketplace.API.csproj');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function request(method, pathName, body = null, token = null, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: pathName,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, rawText: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await request('GET', '/health', null, null, port);
      if (res.status === 200) return true;
    } catch {
      // waiting
    }
    await sleep(1000);
  }
  return false;
}

async function runStage5Tests() {
  console.log('================================================================');
  console.log('🚀 STAGE 5: REFRESH TOKENS & SESSION MANAGEMENT TEST SUITE');
  console.log('   Testing rotation, reuse detection, device mismatch, eviction,');
  console.log('   password reset, logout, logout-all, and rate limiting.');
  console.log('================================================================');

  let devServer = null;
  let prodServer = null;

  try {
    // 1. Launch dev server
    console.log(`\n[Test Runner] Launching backend dev server on port ${TEST_PORT}...`);
    devServer = spawn(
      'dotnet',
      [
        'run',
        '--project',
        CSPROJ_PATH,
        '--no-build',
        '--no-launch-profile',
        '--urls',
        `http://localhost:${TEST_PORT}`,
      ],
      {
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: 'Development',
          UseInMemoryDatabase: 'true',
          'Auth:RequireVerification': 'true',
          'Auth:PhoneSignupEnabled': 'false',
          'Auth:RefreshTokenLifetimeDays': '60',
          'Auth:MaxActiveDevicesPerUser': '5',
          'Admin__Email': 'admin@marketplace.eg',
          'Admin__Password': 'AdminPasswordAtLeast16Chars!',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    devServer.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('fail') || s.includes('error')) console.log('[DEV STDOUT]', s.trim());
    });
    devServer.stderr.on('data', (d) => {
      console.error('[DEV STDERR]', d.toString().trim());
    });

    const devReady = await waitForServer(TEST_PORT);
    if (!devReady) {
      throw new Error(`Dev server failed to start on port ${TEST_PORT}`);
    }
    console.log(`[Test Runner] Dev server is ready on port ${TEST_PORT}`);

    const rand = Math.floor(Math.random() * 900000 + 100000).toString();
    const testPassword = 'Password123!';
    const userEmail = `stage5_user_${rand}@example.com`;

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Register + Verify returns AccessToken and RefreshToken
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Register and Verify returns token pair ---');
    const regRes = await request('POST', '/api/auth/register', {
      name: `مستخدم مرحلة 5 ${rand}`,
      email: userEmail,
      password: testPassword,
      role: 'Buyer',
      acceptedTermsAndPrivacy: true,
    });
    assert(regRes.status === 202, `Register returns HTTP 202 (Got ${regRes.status})`);

    const codeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(userEmail)}`);
    assert(codeRes.status === 200 && codeRes.data?.code, `Verification code retrieved: ${codeRes.data?.code}`);
    const verifyCode = codeRes.data.code;

    const verifyRes = await request('POST', '/api/auth/verify', {
      target: userEmail,
      code: verifyCode,
      deviceId: 'device-initial',
      deviceName: 'Pixel 8',
    });
    assert(verifyRes.status === 200, `Verify returns HTTP 200 (Got ${verifyRes.status})`);
    assert(!!verifyRes.data.accessToken, `Verify returns accessToken`);
    assert(!!verifyRes.data.refreshToken, `Verify returns refreshToken`);
    assert(verifyRes.data.expiresIn > 0, `Verify returns expiresIn in seconds (${verifyRes.data.expiresIn})`);
    assert(verifyRes.data.token === verifyRes.data.accessToken, `Legacy token property is populated as alias`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Login returns AccessToken and RefreshToken
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Login returns fresh token pair for device ---');
    const loginRes = await request('POST', '/api/auth/login', {
      identifier: userEmail,
      password: testPassword,
      deviceId: 'device-desktop',
      deviceName: 'Chrome Windows',
    });
    assert(loginRes.status === 200, `Login returns HTTP 200 (Got ${loginRes.status})`);
    assert(!!loginRes.data.accessToken, `Login returns accessToken`);
    assert(!!loginRes.data.refreshToken, `Login returns refreshToken`);
    assert(loginRes.data.expiresIn > 0, `Login returns expiresIn > 0`);

    const desktopAccessToken = loginRes.data.accessToken;
    const desktopRefreshToken1 = loginRes.data.refreshToken;

    // Verify access token can access protected endpoints
    const profileRes = await request('GET', '/api/users/me', null, desktopAccessToken);
    assert(profileRes.status === 200, `Protected endpoint /api/users/me accessible with accessToken`);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Rotation works (POST /api/auth/refresh)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Refresh token rotation issues new pair and revokes old ---');
    const refreshRes1 = await request('POST', '/api/auth/refresh', {
      refreshToken: desktopRefreshToken1,
      deviceId: 'device-desktop',
    });
    assert(refreshRes1.status === 200, `Refresh returns HTTP 200 (Got ${refreshRes1.status})`);
    assert(!!refreshRes1.data.accessToken, `Refresh returns new accessToken`);
    assert(!!refreshRes1.data.refreshToken, `Refresh returns new refreshToken`);
    assert(
      refreshRes1.data.refreshToken !== desktopRefreshToken1,
      `New refresh token is rotated (different from previous token)`
    );
    assert(refreshRes1.data.expiresIn > 0, `Refresh returns expiresIn > 0`);

    const desktopAccessToken2 = refreshRes1.data.accessToken;
    const desktopRefreshToken2 = refreshRes1.data.refreshToken;

    // Verify new access token works
    const profileRes2 = await request('GET', '/api/users/me', null, desktopAccessToken2);
    assert(profileRes2.status === 200, `New access token is valid and accesses profile`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Reuse detection kills token family
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Reuse detection kills token family on revoked token presentation ---');
    // Attempt to use the already rotated desktopRefreshToken1
    const reuseRes = await request('POST', '/api/auth/refresh', {
      refreshToken: desktopRefreshToken1,
      deviceId: 'device-desktop',
    });
    assert(reuseRes.status === 401, `Reusing revoked token returns HTTP 401 Unauthorized (Got ${reuseRes.status})`);

    // Attempt to use desktopRefreshToken2 (which was valid before the reuse attack)
    const victimRes = await request('POST', '/api/auth/refresh', {
      refreshToken: desktopRefreshToken2,
      deviceId: 'device-desktop',
    });
    assert(
      victimRes.status === 401,
      `Token family reuse detection killed active token for this device (Got HTTP 401)`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Wrong deviceId is rejected
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Wrong deviceId is rejected ---');
    const loginDevRes = await request('POST', '/api/auth/login', {
      identifier: userEmail,
      password: testPassword,
      deviceId: 'device-legit',
    });
    assert(loginDevRes.status === 200, `Login on device-legit returns HTTP 200`);
    const legitToken = loginDevRes.data.refreshToken;

    const wrongDeviceRes = await request('POST', '/api/auth/refresh', {
      refreshToken: legitToken,
      deviceId: 'device-attacker',
    });
    assert(
      wrongDeviceRes.status === 401,
      `Refresh with mismatched deviceId rejected with HTTP 401 (Got ${wrongDeviceRes.status})`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Single token logout revokes token
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: POST /api/auth/logout revokes specific refresh token ---');
    const logoutRes = await request('POST', '/api/auth/logout', {
      refreshToken: legitToken,
    });
    assert(logoutRes.status === 200, `Logout returns HTTP 200 (Got ${logoutRes.status})`);

    // Refreshing after logout must return 401
    const postLogoutRefresh = await request('POST', '/api/auth/refresh', {
      refreshToken: legitToken,
      deviceId: 'device-legit',
    });
    assert(
      postLogoutRefresh.status === 401,
      `Refresh on logged-out token returns HTTP 401 (Got ${postLogoutRefresh.status})`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Password reset revokes all refresh tokens & bumps TokenVersion
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Password reset revokes all refresh tokens & bumps TokenVersion ---');
    const adminEmail = 'admin@marketplace.eg';
    const adminPassword = 'AdminPasswordAtLeast16Chars!';

    // Login on Device A and Device B
    const devARes = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: adminPassword,
      deviceId: 'device-A',
    });
    const devBRes = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: adminPassword,
      deviceId: 'device-B',
    });
    assert(devARes.status === 200 && devBRes.status === 200, `Logged in admin on Device A and Device B`);

    const devAJwt = devARes.data.accessToken;
    const devARefresh = devARes.data.refreshToken;
    const devBRefresh = devBRes.data.refreshToken;

    // Both JWTs work before reset
    const preCheck = await request('GET', '/api/users/me', null, devAJwt);
    assert(preCheck.status === 200, `Device A JWT works before password reset`);

    // Request password reset for admin
    const forgotRes = await request('POST', '/api/auth/forgot-password', {
      identifier: adminEmail,
    });
    assert(forgotRes.status === 202, `Forgot password returns HTTP 202 (Got ${forgotRes.status})`);

    const resetCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(adminEmail)}`);
    assert(resetCodeRes.status === 200 && resetCodeRes.data?.code, `Reset code retrieved`);
    const resetCode = resetCodeRes.data.code;

    const newAdminPassword = 'NewAdminPassword456!';
    const resetRes = await request('POST', '/api/auth/reset-password', {
      identifier: adminEmail,
      code: resetCode,
      newPassword: newAdminPassword,
    });
    assert(resetRes.status === 200, `Reset password returns HTTP 200`);

    // Verify old JWT is now rejected due to bumped TokenVersion
    const oldJwtCheck = await request('GET', '/api/users/me', null, devAJwt);
    assert(
      oldJwtCheck.status === 401,
      `Old JWT is rejected after password reset due to TokenVersion bump (Got HTTP 401)`
    );

    // Verify Device A refresh token is revoked
    const refreshACheck = await request('POST', '/api/auth/refresh', {
      refreshToken: devARefresh,
      deviceId: 'device-A',
    });
    assert(
      refreshACheck.status === 401,
      `Device A refresh token rejected after password reset (Got HTTP 401)`
    );

    // Verify Device B refresh token is revoked
    const refreshBCheck = await request('POST', '/api/auth/refresh', {
      refreshToken: devBRefresh,
      deviceId: 'device-B',
    });
    assert(
      refreshBCheck.status === 401,
      `Device B refresh token rejected after password reset (Got HTTP 401)`
    );

    // Login with new password succeeds
    const newLoginRes = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: newAdminPassword,
      deviceId: 'device-A',
    });
    assert(newLoginRes.status === 200, `Login with new password succeeds`);
    const newAccessToken = newLoginRes.data.accessToken;
    const newProfile = await request('GET', '/api/users/me', null, newAccessToken);
    assert(newProfile.status === 200, `New session JWT works properly`);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: POST /api/auth/logout-all revokes all devices
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: POST /api/auth/logout-all revokes all sessions ---');
    const session1 = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: newAdminPassword,
      deviceId: 'session-1',
    });
    const session2 = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: newAdminPassword,
      deviceId: 'session-2',
    });
    assert(session1.status === 200 && session2.status === 200, `Established session-1 and session-2`);

    // Call logout-all with session-1 access token
    const logoutAllRes = await request('POST', '/api/auth/logout-all', null, session1.data.accessToken);
    assert(logoutAllRes.status === 200, `POST /api/auth/logout-all returns HTTP 200 (Got ${logoutAllRes.status})`);

    // Verify both refresh tokens are revoked
    const s1Refresh = await request('POST', '/api/auth/refresh', {
      refreshToken: session1.data.refreshToken,
      deviceId: 'session-1',
    });
    assert(s1Refresh.status === 401, `Session-1 refresh token rejected after logout-all (HTTP 401)`);

    const s2Refresh = await request('POST', '/api/auth/refresh', {
      refreshToken: session2.data.refreshToken,
      deviceId: 'session-2',
    });
    assert(s2Refresh.status === 401, `Session-2 refresh token rejected after logout-all (HTTP 401)`);

    // Verify access tokens are invalidated (TokenVersion bumped)
    const s1JwtCheck = await request('GET', '/api/users/me', null, session1.data.accessToken);
    assert(s1JwtCheck.status === 401, `Session-1 access token rejected after logout-all (HTTP 401)`);

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Max active devices cap (max 5 active devices)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Max active devices limit (5 devices) evicts oldest device ---');
    const capTokens = [];
    for (let i = 1; i <= 5; i++) {
      const res = await request('POST', '/api/auth/login', {
        identifier: adminEmail,
        password: newAdminPassword,
        deviceId: `cap-device-${i}`,
      });
      assert(res.status === 200, `Device cap-device-${i} logged in`);
      capTokens.push({ id: `cap-device-${i}`, token: res.data.refreshToken });
      await sleep(100); // ensure distinct timestamps
    }

    // Now log in device 6 -> should evict cap-device-1
    const dev6Res = await request('POST', '/api/auth/login', {
      identifier: adminEmail,
      password: newAdminPassword,
      deviceId: 'cap-device-6',
    });
    assert(dev6Res.status === 200, `Device cap-device-6 logged in (exceeding limit of 5)`);

    // Device 1 should be evicted (401 on refresh)
    const dev1Refresh = await request('POST', '/api/auth/refresh', {
      refreshToken: capTokens[0].token,
      deviceId: capTokens[0].id,
    });
    assert(
      dev1Refresh.status === 401,
      `Oldest device (cap-device-1) was evicted upon adding 6th device (Got HTTP 401)`
    );

    // Device 6 should be valid
    const dev6Refresh = await request('POST', '/api/auth/refresh', {
      refreshToken: dev6Res.data.refreshToken,
      deviceId: 'cap-device-6',
    });
    assert(dev6Refresh.status === 200, `Newest device (cap-device-6) is active (Got HTTP 200)`);

    // Kill dev server
    devServer.kill();
    devServer = null;

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Rate Limiter on /refresh (Production Mode)
    // ─────────────────────────────────────────────────────────────
    console.log(`\n--- TEST 10: Rate limiting on /api/auth/refresh in Production mode ---`);
    console.log(`[Test Runner] Launching backend in Production mode on port ${PROD_PORT}...`);
    prodServer = spawn(
      'dotnet',
      [
        'run',
        '--project',
        CSPROJ_PATH,
        '--no-build',
        '--no-launch-profile',
        '--urls',
        `http://localhost:${PROD_PORT}`,
      ],
      {
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: 'Production',
          UseInMemoryDatabase: 'true',
          'Jwt:Key': 'ThisIsAStrongProductionSecretKeyAtLeast32CharsLong!',
          'ConnectionStrings:DefaultConnection': 'Host=localhost;Database=MarketplaceMVP;Username=postgres;Password=postgres',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    prodServer.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('fail') || s.includes('error')) console.log('[PROD STDOUT]', s.trim());
    });
    prodServer.stderr.on('data', (d) => {
      console.error('[PROD STDERR]', d.toString().trim());
    });

    const prodReady = await waitForServer(PROD_PORT);
    if (!prodReady) {
      throw new Error(`Production server failed to start on port ${PROD_PORT}`);
    }
    console.log(`[Test Runner] Production server is ready on port ${PROD_PORT}`);

    // Fire 35 rapid requests to /api/auth/refresh (limit is 30/min)
    let triggered429 = false;
    for (let i = 0; i < 35; i++) {
      const res = await request(
        'POST',
        '/api/auth/refresh',
        { refreshToken: 'some-dummy-token', deviceId: 'some-device' },
        null,
        PROD_PORT
      );
      if (res.status === 429) {
        triggered429 = true;
        console.log(`[Rate Limiter] Received HTTP 429 Too Many Requests on request #${i + 1}`);
        break;
      }
    }
    assert(triggered429, `Rate limiter triggers HTTP 429 Too Many Requests on /api/auth/refresh`);

    console.log('\n================================================================');
    console.log('🎉 ALL STAGE 5 REFRESH TOKEN TESTS PASSED SUCCESSFULLY! (10/10)');
    console.log('================================================================');
  } finally {
    if (devServer) devServer.kill();
    if (prodServer) prodServer.kill();
  }
}

runStage5Tests().catch((err) => {
  console.error('\n❌ TEST RUNNER ERROR:', err);
  process.exit(1);
});
