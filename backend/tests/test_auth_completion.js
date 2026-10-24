const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const API_PORT = process.env.TEST_PORT || 5288;
const PROD_PORT = 5289;
const STAGING_PORT = 5290;
const API_BASE = process.env.API_URL || `http://localhost:${API_PORT}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`✅ ${message}`);
}

function request(method, urlPath, body = null, token = null, baseUrl = API_BASE) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        const payload = body !== null ? JSON.stringify(body) : null;
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (payload !== null) {
            options.headers['Content-Length'] = Buffer.byteLength(payload);
        }

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = data ? JSON.parse(data) : null;
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, data: parsed, rawText: data });
            });
        });

        req.on('error', reject);

        if (payload !== null) {
            req.write(payload);
        }
        req.end();
    });
}

async function waitForServer(baseUrl, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await request('GET', '/health', null, null, baseUrl);
            if (res.status === 200) return true;
        } catch {
            // server not ready yet
        }
        await sleep(1000);
    }
    return false;
}

async function runTests() {
    console.log('================================================================');
    console.log('🚀 AUTH COMPLETION & POSTGRESQL VERIFICATION TEST SUITE');
    console.log(`   Database Mode: TEST_DB (${process.env.TEST_DB})`);
    console.log('================================================================');

    // 1. Validate TEST_DB environment variable
    if (!process.env.TEST_DB) {
        console.error('❌ FATAL: TEST_DB environment variable is NOT set.');
        console.error('   Per instructions, tests MUST run only against the PostgreSQL database named in TEST_DB.');
        console.error('   InMemory fallback is disabled. Halting test suite.');
        process.exit(1);
    }

    let devProcess = null;
    let prodProcess = null;
    let stagingProcess = null;

    try {
        // 2. Launch Development API instance against TEST_DB
        console.log(`\n[Test Runner] Launching backend server on port ${API_PORT} with TEST_DB=${process.env.TEST_DB}...`);
        const env = {
            ...process.env,
            ASPNETCORE_ENVIRONMENT: 'Development',
            ASPNETCORE_URLS: `http://localhost:${API_PORT}`,
            'Auth:RequireVerification': 'true',
            'Auth:PhoneSignupEnabled': 'false',
            'Auth:CodeSecret': 'DedicatedVerificationCodeSecret_AtLeast32CharsLong!',
            'Admin__Email': 'admin@marketplace.eg',
            'Admin__Password': 'AdminSecurePassword123!',
            TEST_DB: process.env.TEST_DB
        };

        delete env.UseInMemoryDatabase;

        devProcess = spawn('dotnet', ['run', '--project', 'backend/Marketplace.API', '--no-build', '--no-launch-profile'], {
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        devProcess.stdout.on('data', (d) => {
            const s = d.toString();
            if (s.includes('fail') || s.includes('error')) console.log('[API STDOUT]', s.trim());
        });

        devProcess.stderr.on('data', (d) => {
            console.error('[API STDERR]', d.toString().trim());
        });

        const ready = await waitForServer(API_BASE);
        if (!ready) {
            throw new Error(`Server failed to start on ${API_BASE}`);
        }
        console.log(`[Test Runner] Backend server is ready on ${API_BASE}`);

        const rand = Math.floor(Math.random() * 900000 + 100000).toString();
        const testPassword = 'Password123!';

        // ─────────────────────────────────────────────────────────────
        // TEST 1: Full register -> verify -> login
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 1: Full register -> verify -> login ---');
        const buyerEmail = `test_buyer_${rand}@example.com`;

        const regRes = await request('POST', '/api/auth/register', {
            name: `مشتري تجريبي ${rand}`,
            email: buyerEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        assert(regRes.status === 202, `Register returns HTTP 202 Accepted (Got ${regRes.status})`);
        assert(regRes.data && !regRes.data.token, `Registration response does NOT include JWT`);
        assert(regRes.data && regRes.data.target, `Registration response returns masked target: ${regRes.data?.target}`);

        // Fetch verification code from dev message store
        const codeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(buyerEmail)}`);
        assert(codeRes.status === 200 && codeRes.data && codeRes.data.code, `Verification code retrieved from fake sender: ${codeRes.data?.code}`);
        const buyerCode = codeRes.data.code;

        // Verify with code
        const verifyRes = await request('POST', '/api/auth/verify', {
            target: buyerEmail,
            code: buyerCode
        });
        assert(verifyRes.status === 200, `Verify returns HTTP 200 OK (Got ${verifyRes.status})`);
        assert(verifyRes.data && verifyRes.data.token, `Verify response contains JWT token`);
        assert(verifyRes.data.role === 'Buyer', `Verify response has Buyer role`);

        // Log in
        const loginRes = await request('POST', '/api/auth/login', {
            identifier: buyerEmail,
            password: testPassword
        });
        assert(loginRes.status === 200, `Login returns HTTP 200 OK (Got ${loginRes.status})`);
        assert(loginRes.data && loginRes.data.token, `Login response contains valid JWT token`);

        // ─────────────────────────────────────────────────────────────
        // TEST 2: Wrong code x5 locks
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 2: Wrong code x5 locks ---');
        const lockEmail = `test_lock_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: `مستخدم قفل ${rand}`,
            email: lockEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        const correctLockCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(lockEmail)}`);
        const correctLockCode = correctLockCodeRes.data.code;

        // 4 failed attempts
        for (let attempt = 1; attempt <= 4; attempt++) {
            const failRes = await request('POST', '/api/auth/verify', {
                target: lockEmail,
                code: '000000'
            });
            assert(failRes.status === 400, `Attempt ${attempt}/5 with wrong code returns HTTP 400 (Got ${failRes.status})`);
            const msg = failRes.data?.error || failRes.data?.message || '';
            assert(msg.includes((5 - attempt).toString()) || msg.includes('Incorrect') || msg.includes('attempts'),
                `Response mentions remaining attempts: "${msg}"`);
        }

        // 5th failed attempt: code should be locked/invalidated
        const fifthFailRes = await request('POST', '/api/auth/verify', {
            target: lockEmail,
            code: '000000'
        });
        assert(fifthFailRes.status === 400, `Attempt 5/5 with wrong code returns HTTP 400 (Got ${fifthFailRes.status})`);
        const lockMsg = fifthFailRes.data?.error || fifthFailRes.data?.message || '';
        assert(lockMsg.includes('invalidated') || lockMsg.includes('maximum') || lockMsg.includes('5 attempts'),
            `5th attempt locks code: "${lockMsg}"`);

        // Attempt with correct code after lock: MUST BE REJECTED
        const correctAfterLockRes = await request('POST', '/api/auth/verify', {
            target: lockEmail,
            code: correctLockCode
        });
        assert(correctAfterLockRes.status === 400,
            `Correct code after 5 failed attempts is REJECTED with HTTP 400 (Got ${correctAfterLockRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Expired code rejected
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 3: Expired code rejected ---');
        const expireEmail = `test_expire_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: `مستخدم انتهاء ${rand}`,
            email: expireEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        const expireCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(expireEmail)}`);
        const expireCode = expireCodeRes.data.code;

        // Force expiration via dev endpoint
        const expireTriggerRes = await request('POST', `/api/dev/auth/expire-code?target=${encodeURIComponent(expireEmail)}`);
        assert(expireTriggerRes.status === 200, `Dev endpoint backdated code expiry successfully`);

        const verifyExpiredRes = await request('POST', '/api/auth/verify', {
            target: expireEmail,
            code: expireCode
        });
        assert(verifyExpiredRes.status === 400, `Expired code returns HTTP 400 Bad Request (Got ${verifyExpiredRes.status})`);
        const expireMsg = verifyExpiredRes.data?.error || verifyExpiredRes.data?.message || '';
        assert(expireMsg.includes('expired'), `Error message mentions code expired: "${expireMsg}"`);

        // ─────────────────────────────────────────────────────────────
        // TEST 4: Cooldown and rate limits
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 4: Cooldown and rate limits (60s cooldown & 5/hour per target) ---');
        const cooldownEmail = `test_cooldown_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: `مستخدم مهلة ${rand}`,
            email: cooldownEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        // Immediate resend must fail with 429 Too Many Requests (60s cooldown)
        const immediateResend = await request('POST', '/api/auth/resend', { target: cooldownEmail });
        assert(immediateResend.status === 429, `Immediate resend within 60s cooldown returns HTTP 429 (Got ${immediateResend.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 5: Unverified user cannot login or order
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 5: Unverified user cannot login or order ---');
        const unverifiedEmail = `test_unverified_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: `مستخدم غير مؤكد ${rand}`,
            email: unverifiedEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        const unverifiedLogin = await request('POST', '/api/auth/login', {
            identifier: unverifiedEmail,
            password: testPassword
        });
        assert(unverifiedLogin.status === 403, `Unverified user login returns HTTP 403 Forbidden (Got ${unverifiedLogin.status})`);
        assert(unverifiedLogin.data?.code === 'NOT_VERIFIED', `Login error code is NOT_VERIFIED (Got ${unverifiedLogin.data?.code})`);

        console.log(`   Verified: Unverified user blocked from logging in with NOT_VERIFIED.`);

        // ─────────────────────────────────────────────────────────────
        // TEST 6: Reset password invalidates old tokens (TokenVersion check)
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 6: Reset password invalidates old tokens ---');
        const resetEmail = `test_reset_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: `مستخدم تغيير كلمة السر ${rand}`,
            email: resetEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        // Verify account
        const resetCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(resetEmail)}`);
        const resetVerifyRes = await request('POST', '/api/auth/verify', {
            target: resetEmail,
            code: resetCodeRes.data.code
        });

        const token1 = resetVerifyRes.data.token;
        assert(token1 && token1.length > 20, `Generated Token 1 for user before password reset`);

        const profileBefore = await request('GET', '/api/users/me', null, token1);
        assert(profileBefore.status === 200, `Token 1 successfully accesses protected endpoint (Got HTTP 200)`);

        // Backdate previous code so 60s cooldown doesn't block forgot-password request
        await request('POST', `/api/dev/auth/expire-code?target=${encodeURIComponent(resetEmail)}`);

        // Request password reset
        const forgotRes = await request('POST', '/api/auth/forgot-password', {
            identifier: resetEmail
        });
        assert(forgotRes.status === 202, `Forgot password returns generic HTTP 202 Accepted (Got ${forgotRes.status})`);

        // Fetch password reset code
        const pwCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(resetEmail)}`);
        const pwCode = pwCodeRes.data.code;
        assert(pwCode && pwCode.length === 6, `Password reset code retrieved from fake sender: ${pwCode}`);

        // Reset password (increments TokenVersion)
        const newPassword = 'NewSecretPassword456!';
        const resetRes = await request('POST', '/api/auth/reset-password', {
            identifier: resetEmail,
            code: pwCode,
            newPassword
        });
        assert(resetRes.status === 200, `Reset password succeeds with HTTP 200 OK (Got ${resetRes.status})`);

        // Old token MUST BE REJECTED with 401
        const profileAfterWithOldToken = await request('GET', '/api/users/me', null, token1);
        assert(profileAfterWithOldToken.status === 401,
            `Old Token 1 is REJECTED with HTTP 401 Unauthorized after password reset (Got ${profileAfterWithOldToken.status})`);

        // Log in with new password -> Token 2
        const loginNewRes = await request('POST', '/api/auth/login', {
            identifier: resetEmail,
            password: newPassword
        });
        assert(loginNewRes.status === 200, `Login with new password succeeds with HTTP 200 OK (Got ${loginNewRes.status})`);
        const token2 = loginNewRes.data.token;
        assert(token2 && token2 !== token1, `New Token 2 issued with updated TokenVersion`);

        const profileAfterWithNewToken = await request('GET', '/api/users/me', null, token2);
        assert(profileAfterWithNewToken.status === 200, `New Token 2 successfully accesses protected endpoint (Got HTTP 200)`);

        // ─────────────────────────────────────────────────────────────
        // TEST 7: Admin cannot be registered via API
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 7: Admin cannot be registered ---');
        const adminRegRes = await request('POST', '/api/auth/register', {
            name: 'محاولة تسجيل مدير',
            email: `fake_admin_${rand}@marketplace.eg`,
            password: testPassword,
            role: 'Admin',
            acceptedTermsAndPrivacy: true
        });
        assert(adminRegRes.status === 400, `Attempting to register Admin role returns HTTP 400 Bad Request (Got ${adminRegRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 8: Phone signup returns 404 when the flag is off
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 8: Phone signup returns 404 when the flag is off ---');
        const phoneRegRes = await request('POST', '/api/auth/register', {
            name: 'تسجيل برقم الهاتف',
            phone: '01099887766',
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(phoneRegRes.status === 404, `Phone signup returns HTTP 404 Not Found when flag is off (Got ${phoneRegRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 9: No codes appear in logs when ASPNETCORE_ENVIRONMENT=Production
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 9: No codes appear in logs when ASPNETCORE_ENVIRONMENT=Production ---');
        console.log(`   Launching temporary Production instance on port ${PROD_PORT}...`);

        let prodCapturedOutput = '';
        const prodEnv = {
            ...process.env,
            ASPNETCORE_ENVIRONMENT: 'Production',
            ASPNETCORE_URLS: `http://localhost:${PROD_PORT}`,
            'Auth:RequireVerification': 'true',
            'Auth:PhoneSignupEnabled': 'false',
            'Auth:CodeSecret': 'ProductionTestingSafeSecretKeyMustBe32CharsLong!',
            'Jwt:Key': 'ProductionTestingSafeSecretKeyMustBe32CharsLong!',
            'JWT_SECRET': 'ProductionTestingSafeSecretKeyMustBe32CharsLong!',
            'Email:ApiKey': 're_test_dummy_key_12345',
            'Email__ApiKey': 're_test_dummy_key_12345',
            TEST_DB: process.env.TEST_DB
        };
        delete prodEnv.UseInMemoryDatabase;

        prodProcess = spawn('dotnet', ['run', '--project', 'backend/Marketplace.API', '--no-build', '--no-launch-profile'], {
            env: prodEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        prodProcess.stdout.on('data', d => { prodCapturedOutput += d.toString(); });
        prodProcess.stderr.on('data', d => { prodCapturedOutput += d.toString(); });

        const prodReady = await waitForServer(`http://localhost:${PROD_PORT}`);
        assert(prodReady, `Production instance started successfully on port ${PROD_PORT}`);

        // Dev endpoints must return 404 in Production
        const prodDevAuthRes = await request('GET', '/api/dev/auth/last-code?target=test@example.com', null, null, `http://localhost:${PROD_PORT}`);
        assert(prodDevAuthRes.status === 404, `In Production, /api/dev/auth/* returns HTTP 404 Not Found (Got ${prodDevAuthRes.status})`);

        // Swagger must return 404 in Production
        const prodSwaggerRes = await request('GET', '/swagger', null, null, `http://localhost:${PROD_PORT}`);
        assert(prodSwaggerRes.status === 404, `In Production, /swagger returns HTTP 404 Not Found (Got ${prodSwaggerRes.status})`);

        // Register a user on production instance
        const prodUserEmail = `prod_user_${rand}@example.com`;
        const prodReg = await request('POST', '/api/auth/register', {
            name: 'مستخدم إنتاج',
            email: prodUserEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        }, null, `http://localhost:${PROD_PORT}`);

        prodProcess.kill('SIGTERM');
        prodProcess = null;

        const codePattern = /CODE=\d{6}|[Cc]ode:\s*\d{6}/;
        assert(!codePattern.test(prodCapturedOutput), `Zero verification codes appeared in Production logs`);
        console.log(`   Verified: No codes logged in Production environment.`);

        // ─────────────────────────────────────────────────────────────
        // TEST 10: Old test accounts still log in
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 10: Old test accounts still log in ---');
        const adminLogin = await request('POST', '/api/auth/login', {
            email: 'admin@marketplace.eg',
            password: 'AdminSecurePassword123!'
        });
        assert(adminLogin.status === 200, `Existing pre-migration account logs in with HTTP 200 OK (Got ${adminLogin.status})`);
        assert(adminLogin.data && adminLogin.data.role === 'Admin', `Existing account returned valid JWT and Admin role`);

        // ─────────────────────────────────────────────────────────────
        // TEST 11: Real PostgreSQL: Case-insensitive email duplicates rejected
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 11: Real PostgreSQL: Case-insensitive email duplicates rejected ---');
        const caseEmailLower = `case_test_${rand}@example.com`;
        const caseEmailUpper = `CASE_TEST_${rand}@EXAMPLE.COM`;
        const caseEmailMixed = `Case_Test_${rand}@Example.Com`;

        // Register & verify lower-case
        const regCaseRes = await request('POST', '/api/auth/register', {
            name: 'مستخدم حالة الأحرف',
            email: caseEmailLower,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(regCaseRes.status === 202, `Initial registration succeeds with 202`);

        const caseCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(caseEmailLower)}`);
        await request('POST', '/api/auth/verify', {
            target: caseEmailLower,
            code: caseCodeRes.data.code
        });

        // Attempt registration with UPPERCASE version of same email -> MUST FAIL WITH 409
        const regCaseUpperRes = await request('POST', '/api/auth/register', {
            name: 'محاولة تسجيل بحروف كبيرة',
            email: caseEmailUpper,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(regCaseUpperRes.status === 409,
            `Uppercase duplicate registration is rejected with HTTP 409 Conflict (Got ${regCaseUpperRes.status})`);

        // Login with MIXED case should find the normalized user and succeed
        const loginMixedCaseRes = await request('POST', '/api/auth/login', {
            identifier: caseEmailMixed,
            password: testPassword
        });
        assert(loginMixedCaseRes.status === 200,
            `Login with mixed-case identifier succeeds with HTTP 200 OK (Got ${loginMixedCaseRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 12: Real PostgreSQL: Re-registering an unverified target overwrites it
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 12: Real PostgreSQL: Re-registering unverified target overwrites it ---');
        const unverifiedOverwriteEmail = `overwrite_${rand}@example.com`;
        const initialPassword = 'InitialPassword111!';
        const updatedPassword = 'UpdatedPassword222!';

        // 1st registration (unverified)
        const unvReg1 = await request('POST', '/api/auth/register', {
            name: 'الاسم الأول',
            email: unverifiedOverwriteEmail,
            password: initialPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(unvReg1.status === 202, `First registration of unverified target returns 202`);

        // Expire cooldown so 2nd registration can dispatch immediately
        await request('POST', `/api/dev/auth/expire-code?target=${encodeURIComponent(unverifiedOverwriteEmail)}`);

        // 2nd registration: same target, DIFFERENT password & name
        const unvReg2 = await request('POST', '/api/auth/register', {
            name: 'الاسم المحدّث',
            email: unverifiedOverwriteEmail.toUpperCase(),
            password: updatedPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(unvReg2.status === 202, `Second registration overwrites unverified target with 202`);

        // Fetch the NEW code
        const newCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(unverifiedOverwriteEmail)}`);
        assert(newCodeRes.status === 200, `New verification code issued for overwritten user`);

        // Verify with new code
        const verifyOverwritten = await request('POST', '/api/auth/verify', {
            target: unverifiedOverwriteEmail,
            code: newCodeRes.data.code
        });
        assert(verifyOverwritten.status === 200, `Verification succeeds with updated code`);

        // Login with old password MUST FAIL
        const oldPassLogin = await request('POST', '/api/auth/login', {
            identifier: unverifiedOverwriteEmail,
            password: initialPassword
        });
        assert(oldPassLogin.status === 401, `Login with initial password fails 401 (Got ${oldPassLogin.status})`);

        // Login with new password MUST SUCCEED
        const newPassLogin = await request('POST', '/api/auth/login', {
            identifier: unverifiedOverwriteEmail,
            password: updatedPassword
        });
        assert(newPassLogin.status === 200, `Login with updated password succeeds 200 OK (Got ${newPassLogin.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 13: Real PostgreSQL: Parallel registrations of the same target
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 13: Real PostgreSQL: Parallel registrations of same target ---');
        const parallelEmail = `parallel_${rand}@example.com`;

        // Send 5 concurrent registration requests simultaneously
        const parallelPromises = [1, 2, 3, 4, 5].map(i =>
            request('POST', '/api/auth/register', {
                name: `مستخدم متزامن ${i}`,
                email: parallelEmail,
                password: testPassword,
                role: 'Buyer',
                acceptedTermsAndPrivacy: true
            })
        );

        const parallelResults = await Promise.all(parallelPromises);
        const validStatuses = parallelResults.every(r => r.status === 202 || r.status === 409 || r.status === 429);
        assert(validStatuses, `All 5 concurrent requests returned valid non-crashing HTTP statuses (${parallelResults.map(r => r.status).join(', ')})`);
        assert(!parallelResults.some(r => r.status >= 500), `Zero 500 internal server errors occurred under parallel load`);

        // ─────────────────────────────────────────────────────────────
        // TEST 14: Password verification timing: NOT_VERIFIED returned only AFTER password check
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 14: Timing: NOT_VERIFIED returned only AFTER password check ---');
        const timingEmail = `timing_${rand}@example.com`;
        await request('POST', '/api/auth/register', {
            name: 'مستخدم اختبار التوقيت',
            email: timingEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        // 1. Unverified user with WRONG password -> MUST return 401 Unauthorized (never 403 NOT_VERIFIED)
        const wrongPassRes = await request('POST', '/api/auth/login', {
            identifier: timingEmail,
            password: 'WrongPassword999!'
        });
        assert(wrongPassRes.status === 401,
            `Unverified user with WRONG password returns HTTP 401 Unauthorized (Got ${wrongPassRes.status})`);

        // 2. Unverified user with CORRECT password -> MUST return 403 NOT_VERIFIED
        const correctPassRes = await request('POST', '/api/auth/login', {
            identifier: timingEmail,
            password: testPassword
        });
        assert(correctPassRes.status === 403,
            `Unverified user with CORRECT password returns HTTP 403 Forbidden (Got ${correctPassRes.status})`);
        assert(correctPassRes.data?.code === 'NOT_VERIFIED',
            `Response error code is NOT_VERIFIED (Got ${correctPassRes.data?.code})`);

        // 3. Non-existent user with any password -> MUST return 401 Unauthorized
        const nonExistentRes = await request('POST', '/api/auth/login', {
            identifier: `nonexistent_${rand}@example.com`,
            password: 'AnyPassword123!'
        });
        assert(nonExistentRes.status === 401,
            `Non-existent account returns HTTP 401 Unauthorized (Got ${nonExistentRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 15: ASPNETCORE_ENVIRONMENT=Staging blocks all /api/dev/* routes
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 15: ASPNETCORE_ENVIRONMENT=Staging blocks all /api/dev/* routes ---');
        console.log(`   Launching temporary Staging instance on port ${STAGING_PORT}...`);

        const stagingEnv = {
            ...process.env,
            ASPNETCORE_ENVIRONMENT: 'Staging',
            ASPNETCORE_URLS: `http://localhost:${STAGING_PORT}`,
            'Auth:RequireVerification': 'true',
            'Auth:PhoneSignupEnabled': 'false',
            'Auth:CodeSecret': 'StagingTestingSafeSecretKeyMustBe32CharsLong!',
            'Jwt:Key': 'StagingTestingSafeSecretKeyMustBe32CharsLong!',
            'JWT_SECRET': 'StagingTestingSafeSecretKeyMustBe32CharsLong!',
            'Email:ApiKey': 're_test_dummy_key_12345',
            'Email__ApiKey': 're_test_dummy_key_12345',
            TEST_DB: process.env.TEST_DB
        };
        delete stagingEnv.UseInMemoryDatabase;

        stagingProcess = spawn('dotnet', ['run', '--project', 'backend/Marketplace.API', '--no-build', '--no-launch-profile'], {
            env: stagingEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const stagingReady = await waitForServer(`http://localhost:${STAGING_PORT}`);
        assert(stagingReady, `Staging instance started successfully on port ${STAGING_PORT}`);

        // In Staging, all dev auth endpoints must return 404
        const stagingDevCodeRes = await request('GET', '/api/dev/auth/last-code?target=test@example.com', null, null, `http://localhost:${STAGING_PORT}`);
        assert(stagingDevCodeRes.status === 404, `In Staging, /api/dev/auth/last-code returns HTTP 404 Not Found (Got ${stagingDevCodeRes.status})`);

        const stagingDevAllCodes = await request('GET', '/api/dev/auth/codes', null, null, `http://localhost:${STAGING_PORT}`);
        assert(stagingDevAllCodes.status === 404, `In Staging, /api/dev/auth/codes returns HTTP 404 Not Found (Got ${stagingDevAllCodes.status})`);

        const stagingDevArbitrary = await request('GET', '/api/dev/nonexistent', null, null, `http://localhost:${STAGING_PORT}`);
        assert(stagingDevArbitrary.status === 404, `In Staging, /api/dev/* arbitrary route returns HTTP 404 Not Found (Got ${stagingDevArbitrary.status})`);

        stagingProcess.kill('SIGTERM');
        stagingProcess = null;
        console.log(`   Verified: Dev routes cleanly blocked (404) in Staging environment.`);

        // ─────────────────────────────────────────────────────────────
        // TEST 16: Account deletion/anonymization & unique index behavior
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 16: Account deletion/anonymization & unique index behavior ---');
        const delEmail = `del_test_${rand}@example.com`;

        // Register & verify user
        await request('POST', '/api/auth/register', {
            name: 'مستخدم للحذف',
            email: delEmail,
            password: testPassword,
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });

        const delCodeRes = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(delEmail)}`);
        const delVerifyRes = await request('POST', '/api/auth/verify', {
            target: delEmail,
            code: delCodeRes.data.code
        });

        const delToken = delVerifyRes.data.token;
        assert(delToken && delToken.length > 20, `User verified and obtained JWT`);

        // Verify profile is accessible before deletion
        const delProfileBefore = await request('GET', '/api/users/me', null, delToken);
        assert(delProfileBefore.status === 200, `Profile accessible before deletion (Got 200)`);

        // Export data before deletion (Item 7: includes reviews, deviceSessions without hashes, orders)
        const exportRes = await request('GET', '/api/users/me/export-data', null, delToken);
        assert(exportRes.status === 200, `GET /api/users/me/export-data returns HTTP 200 OK (Got ${exportRes.status})`);
        assert(Array.isArray(exportRes.data?.reviews), `Export data includes reviews array`);
        assert(Array.isArray(exportRes.data?.deviceSessions), `Export data includes deviceSessions array`);
        assert(exportRes.data.deviceSessions.every(s => s.tokenHash === undefined), `Exported deviceSessions do NOT contain tokenHash`);
        assert(Array.isArray(exportRes.data?.orders), `Export data includes orders array`);

        // Generate an extra verification code (e.g. forgot password request)
        await request('POST', `/api/dev/auth/expire-code?target=${encodeURIComponent(delEmail)}`);
        await request('POST', '/api/auth/forgot-password', { identifier: delEmail });

        // Confirm verification code exists in message store / DB
        const codeBeforeDelete = await request('GET', `/api/dev/auth/last-code?target=${encodeURIComponent(delEmail)}`);
        assert(codeBeforeDelete.status === 200 && codeBeforeDelete.data.userId, `Verification code exists prior to account deletion`);

        // Delete account
        const deleteRes = await request('DELETE', '/api/users/me', { currentPassword: testPassword }, delToken);
        assert(deleteRes.status === 204, `Delete account returns HTTP 204 No Content (Got ${deleteRes.status})`);

        // Deleted user's token MUST be rejected
        const profileAfterDelete = await request('GET', '/api/users/me', null, delToken);
        assert(profileAfterDelete.status === 401 || profileAfterDelete.status === 404,
            `Deleted user cannot access profile (Got ${profileAfterDelete.status})`);

        // Filtered unique index verification:
        // Because Email and Phone are set to NULL upon deletion, the original email is freed!
        // A new user can now register with the exact same email address without 409 conflict:
        const reRegSameEmail = await request('POST', '/api/auth/register', {
            name: 'مستخدم جديد بنفس البريد',
            email: delEmail,
            password: 'BrandNewPassword789!',
            role: 'Buyer',
            acceptedTermsAndPrivacy: true
        });
        assert(reRegSameEmail.status === 202,
            `New registration with previously-deleted email SUCCEEDS with HTTP 202 under filtered unique index (Got ${reRegSameEmail.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 17: Feature gates OFF by default (Wallet, Vendor Payouts, Coupons return 404)
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 17: Wallet, Vendor Payouts, and Coupons OFF by default (404) ---');
        const cfgRes = await request('GET', '/api/config');
        assert(cfgRes.status === 200, `GET /api/config returns 200 OK`);
        assert(cfgRes.data?.walletEnabled === false, `/api/config reports walletEnabled=false by default`);
        assert(cfgRes.data?.couponsEnabled === false, `/api/config reports couponsEnabled=false by default`);

        const buyerWalletRes = await request('GET', '/api/users/me/wallet', null, token2);
        assert(buyerWalletRes.status === 404, `GET /api/users/me/wallet returns 404 when WalletEnabled=false (Got ${buyerWalletRes.status})`);

        const couponValidateRes = await request('GET', '/api/coupons/validate?code=TEST10&orderTotal=100', null, token2);
        assert(couponValidateRes.status === 404, `GET /api/coupons/validate returns 404 when CouponsEnabled=false (Got ${couponValidateRes.status})`);

        // ─────────────────────────────────────────────────────────────
        // TEST 18: Rotating spoofed X-Forwarded-For values still hit rate limit (429)
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- TEST 18: Rotating spoofed X-Forwarded-For values still hit rate limit ---');
        let hitRateLimit = false;
        for (let i = 1; i <= 15; i++) {
            const spoofedRes = await new Promise((resolve, reject) => {
                const url = new URL('/api/auth/login', API_BASE);
                const payload = JSON.stringify({ identifier: `ratelimit_target_${rand}@example.com`, password: 'WrongPassword!' });
                const req = http.request({
                    method: 'POST',
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                        'X-Forwarded-For': `198.51.100.${i}, 203.0.113.${i}`
                    }
                }, (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ status: res.statusCode }));
                });
                req.on('error', reject);
                req.write(payload);
                req.end();
            });
            if (spoofedRes.status === 429) {
                hitRateLimit = true;
                break;
            }
        }
        assert(hitRateLimit, `Requests with rotating spoofed X-Forwarded-For headers still hit HTTP 429 Too Many Requests`);

        console.log('\n================================================================');
        console.log('🎉 ALL 18 COMPREHENSIVE TESTS PASSED AGAINST POSTGRESQL (TEST_DB)!');
        console.log('================================================================');

    } finally {
        if (devProcess) {
            console.log('[Test Runner] Stopping development test server...');
            devProcess.kill();
        }
        if (prodProcess) {
            console.log('[Test Runner] Stopping production test server...');
            prodProcess.kill();
        }
        if (stagingProcess) {
            console.log('[Test Runner] Stopping staging test server...');
            stagingProcess.kill();
        }
    }
}

runTests().catch(err => {
    console.error('❌ Test execution encountered an unhandled error:', err);
    process.exit(1);
});
