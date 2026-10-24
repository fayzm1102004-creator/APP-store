const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const TEST_PORT = 5219;
const CSPROJ_PATH = path.resolve(__dirname, '../Marketplace.API/Marketplace.API.csproj');

function request(method, pathName, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: 'localhost',
        port: TEST_PORT,
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
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createJwt(secret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'MarketplaceApi',
      aud: 'MarketplaceClients',
      nbf: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function runServerExpectExit(extraEnv) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Production',
      UseInMemoryDatabase: 'true',
      ...extraEnv,
    };

    const child = spawn(
      'dotnet',
      ['run', '--no-launch-profile', '--no-build', '--project', CSPROJ_PATH, '--urls', `http://localhost:${TEST_PORT}`],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill();
      resolve({ exited: false, stdout, stderr, code: null });
    }, 15000);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ exited: true, code, stdout, stderr });
    });
  });
}

function startServer(extraEnv) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Production',
      UseInMemoryDatabase: 'true',
      ...extraEnv,
    };

    const child = spawn(
      'dotnet',
      ['run', '--no-launch-profile', '--no-build', '--project', CSPROJ_PATH, '--urls', `http://localhost:${TEST_PORT}`],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let logs = '';
    let started = false;

    child.stdout.on('data', (d) => {
      const str = d.toString();
      logs += str;
      if (str.includes('Application started.') || str.includes('Now listening on:')) {
        if (!started) {
          started = true;
          resolve({ child, getLogs: () => logs });
        }
      }
    });

    child.stderr.on('data', (d) => {
      logs += d.toString();
    });

    child.on('error', (err) => {
      if (!started) reject(err);
    });

    child.on('exit', (code) => {
      if (!started) {
        reject(new Error(`Server exited unexpectedly with code ${code}. Logs:\n${logs}`));
      }
    });

    setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error(`Server timed out waiting for startup. Logs:\n${logs}`));
      }
    }, 20000);
  });
}

async function runAllTests() {
  console.log('=== STAGE 1: SECURITY AUTOMATED INTEGRATION TESTS ===\n');
  let passed = 0;
  let failed = 0;

  function assert(desc, condition, detail = '') {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc} ${detail ? '(' + detail + ')' : ''}`);
      failed++;
    }
  }

  // --- 1. Startup Fail-Fast Tests ---
  console.log('--- 1. Testing Fail-Fast Startup Validations ---');

  // 1a. AllowFakeGoogleTokens=true in Production -> MUST throw and exit
  console.log('Testing: AllowFakeGoogleTokens in Production fails fast...');
  const fakeTokenRes = await runServerExpectExit({
    Auth__AllowFakeGoogleTokens: 'true',
    JWT_SECRET: 'ProdSecretKeyMinimumLength32Chars1234567890!',
  });
  assert(
    'Startup fails fast if Auth:AllowFakeGoogleTokens=true in Production',
    fakeTokenRes.exited && fakeTokenRes.code !== 0,
    `Code: ${fakeTokenRes.code}`
  );

  // 1b. Known default JWT secret in Production -> MUST throw and exit
  console.log('Testing: Known default JWT secret in Production fails fast...');
  const knownSecretRes = await runServerExpectExit({
    Jwt__Key: 'SuperSecretKeyForDevelopmentOnly123!AtLeast32Chars',
  });
  assert(
    'Startup fails fast if a known default JWT secret is used in Production',
    knownSecretRes.exited && knownSecretRes.code !== 0,
    `Code: ${knownSecretRes.code}`
  );

  // 1c. JWT secret shorter than 32 chars -> MUST throw and exit
  console.log('Testing: Short JWT secret fails fast...');
  const shortSecretRes = await runServerExpectExit({
    Jwt__Key: 'ShortSecret123',
    JWT_SECRET: '',
  });
  assert(
    'Startup fails fast if JWT secret is shorter than 32 characters',
    shortSecretRes.exited && shortSecretRes.code !== 0,
    `Code: ${shortSecretRes.code}`
  );

  // --- 2. Live Production Tests with Valid Secret ---
  console.log('\n--- 2. Starting Production Server with Production Settings ---');
  const validSecret = 'ProdSecretKeyMinimumLength32CharsLongEnoughForSecurity123!';

  // Test server with GoogleEnabled=true to verify real GoogleTokenValidator rejects mock token with 401
  const server = await startServer({
    JWT_SECRET: validSecret,
    Jwt__Key: validSecret,
    Auth__GoogleEnabled: 'true',
    Auth__AllowFakeGoogleTokens: 'false',
    Features__WalletEnabled: 'false',
    Features__CouponsEnabled: 'false',
    Admin__Email: 'admin@marketplace.eg',
    Admin__Password: 'AdminSecurePassword123!',
  });
  console.log('Server started successfully on port', TEST_PORT);

  try {
    // 2a. Mock token in production returns 401 Unauthorized
    console.log('\n--- 3. Testing Mock Google Token in Production ---');
    const mockTokenRes = await request('POST', '/api/auth/google', {
      idToken: 'mock-google-token:testuser@example.com:Test User',
      role: 'Buyer',
      acceptedTermsAndPrivacy: true,
    });
    assert(
      'Mock Google token returns 401 Unauthorized in Production',
      mockTokenRes.status === 401,
      `Status: ${mockTokenRes.status}`
    );

    // 2b. /api/dev/* returns 404 in Production
    console.log('\n--- 4. Testing /api/dev/* Endpoints in Production ---');
    const devCarrierRes = await request('PUT', '/api/dev/carrier/shipments/1/status', {
      status: 'Delivered',
    });
    assert(
      'PUT /api/dev/carrier/shipments/1/status returns 404 in Production',
      devCarrierRes.status === 404,
      `Status: ${devCarrierRes.status}`
    );

    const devRandomRes = await request('GET', '/api/dev/nonexistent');
    assert(
      'GET /api/dev/* arbitrary route returns 404 in Production',
      devRandomRes.status === 404,
      `Status: ${devRandomRes.status}`
    );

    // 2c. Swagger is not served in Production
    console.log('\n--- 5. Testing Swagger Disabled in Production ---');
    const swaggerHtml = await request('GET', '/swagger/index.html');
    assert(
      'GET /swagger/index.html returns 404 in Production',
      swaggerHtml.status === 404,
      `Status: ${swaggerHtml.status}`
    );

    const swaggerJson = await request('GET', '/swagger/v1/swagger.json');
    assert(
      'GET /swagger/v1/swagger.json returns 404 in Production',
      swaggerJson.status === 404,
      `Status: ${swaggerJson.status}`
    );

    // 2d. Admin role cannot be obtained through registration
    console.log('\n--- 6. Testing Registration Role Restriction ---');
    const adminRegRes = await request('POST', '/api/auth/register', {
      name: 'Malicious User',
      email: `malicious_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      role: 'Admin',
      acceptedTermsAndPrivacy: true,
    });
    assert(
      'Registration with role "Admin" returns 400 Bad Request',
      adminRegRes.status === 400,
      `Status: ${adminRegRes.status}`
    );

    // Also test lowercase "admin"
    const adminLowerRegRes = await request('POST', '/api/auth/register', {
      name: 'Malicious User 2',
      email: `malicious2_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      role: 'admin',
      acceptedTermsAndPrivacy: true,
    });
    assert(
      'Registration with role "admin" (lowercase) returns 400 Bad Request',
      adminLowerRegRes.status === 400,
      `Status: ${adminLowerRegRes.status}`
    );

    // 2e. Server-generated JWT lifetime is 60 minutes
    console.log('\n--- 7. Testing Admin Login and JWT Lifetime (60 minutes) ---');
    const adminLoginRes = await request('POST', '/api/auth/login', {
      identifier: 'admin@marketplace.eg',
      password: 'AdminSecurePassword123!',
    });
    assert(
      'Seeded Admin login returns 200 OK with valid JWT',
      adminLoginRes.status === 200 && adminLoginRes.body?.token,
      `Status: ${adminLoginRes.status}`
    );

    if (adminLoginRes.body?.expiresAt) {
      const expiresAt = new Date(adminLoginRes.body.expiresAt);
      const diffMinutes = Math.round((expiresAt - Date.now()) / (1000 * 60));
      assert(
        `JWT token lifetime is ~60 minutes (actual: ${diffMinutes}m)`,
        diffMinutes >= 58 && diffMinutes <= 62,
        `diffMinutes: ${diffMinutes}`
      );
    }

    // 2f. Public GET /api/config returns non-sensitive flags
    console.log('\n--- 8. Testing Public GET /api/config ---');
    const configRes = await request('GET', '/api/config');
    assert(
      'GET /api/config returns 200 OK',
      configRes.status === 200,
      `Status: ${configRes.status}`
    );
    assert(
      'GET /api/config returns expected non-sensitive keys',
      configRes.body &&
        'googleEnabled' in configRes.body &&
        'phoneSignupEnabled' in configRes.body &&
        'verificationRequired' in configRes.body &&
        'walletEnabled' in configRes.body &&
        'couponsEnabled' in configRes.body,
      `Body: ${JSON.stringify(configRes.body)}`
    );

    // 2g. Wallet and Coupons endpoints return 404 when disabled
    console.log('\n--- 9. Testing Feature Flags (Wallet & Coupons 404 when disabled) ---');
    const sellerToken = createJwt(validSecret, {
      sub: '10',
      role: 'Seller',
      name: 'Seller Test',
      email: 'seller@test.eg',
    });
    const buyerToken = createJwt(validSecret, {
      sub: '20',
      role: 'Buyer',
      name: 'Buyer Test',
      email: 'buyer@test.eg',
    });

    const walletRes = await request('GET', '/api/wallet/me', null, sellerToken);
    assert(
      'GET /api/wallet/me returns 404 when WalletEnabled=false',
      walletRes.status === 404,
      `Status: ${walletRes.status}`
    );

    const buyerWalletRes = await request('GET', '/api/users/me/wallet', null, buyerToken);
    assert(
      'GET /api/users/me/wallet returns 404 when WalletEnabled=false',
      buyerWalletRes.status === 404,
      `Status: ${buyerWalletRes.status}`
    );

    const couponRes = await request('POST', '/api/coupons/validate', { code: 'SAVE10' }, buyerToken);
    assert(
      'POST /api/coupons/validate returns 404 when CouponsEnabled=false',
      couponRes.status === 404,
      `Status: ${couponRes.status}`
    );

    // 2h. Rate limiter triggers 429 Too Many Requests
    console.log('\n--- 10. Testing Rate Limiting (auth-policy triggers 429 in Production) ---');
    console.log('Sending requests up to permit limit (15 requests/min in Production)...');
    let got429 = false;
    let attempts = 0;

    for (let i = 0; i < 25; i++) {
      attempts++;
      const res = await request('POST', '/api/auth/login', {
        identifier: 'nobody@example.com',
        password: 'wrongpassword',
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert(
      'Rate limiter triggers 429 Too Many Requests after exceeding window limit',
      got429,
      `429 received at attempt #${attempts}`
    );
  } finally {
    server.child.kill();
    console.log('\nProduction test server stopped.');
  }

  // --- 4. Test GoogleAuth returns 404 when Auth:GoogleEnabled=false ---
  console.log('\n--- 11. Testing GoogleAuth 404 when GoogleEnabled=false ---');
  const serverNoGoogle = await startServer({
    JWT_SECRET: validSecret,
    Jwt__Key: validSecret,
    Auth__GoogleEnabled: 'false',
  });

  try {
    const disabledGoogleRes = await request('POST', '/api/auth/google', {
      idToken: 'some-token',
      role: 'Buyer',
      acceptedTermsAndPrivacy: true,
    });
    assert(
      'POST /api/auth/google returns 404 when Auth:GoogleEnabled=false',
      disabledGoogleRes.status === 404,
      `Status: ${disabledGoogleRes.status}`
    );
  } finally {
    serverNoGoogle.child.kill();
    console.log('Test server stopped.');
  }

  console.log(`\n========================================`);
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  console.error('Test suite failed with unhandled error:', err);
  process.exit(1);
});
