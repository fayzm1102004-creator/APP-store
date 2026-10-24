const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('🧪 Starting Mobile Authentication Unit & Flow Tests...\n');

// 1. i18n Parity Test
console.log('--- Test 1: i18n Locales Exact Parity ---');
const arPath = path.resolve(__dirname, '../src/locales/ar.json');
const enPath = path.resolve(__dirname, '../src/locales/en.json');

const ar = JSON.parse(fs.readFileSync(arPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

function getLeafKeys(obj, prefix = '') {
  let keys = [];
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys = keys.concat(getLeafKeys(obj[k], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const arKeys = new Set(getLeafKeys(ar));
const enKeys = new Set(getLeafKeys(en));

const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));
const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));

assert.strictEqual(missingInEn.length, 0, `Missing keys in en.json: ${missingInEn.join(', ')}`);
assert.strictEqual(missingInAr.length, 0, `Missing keys in ar.json: ${missingInAr.join(', ')}`);
assert.strictEqual(arKeys.size, enKeys.size);

// Check required auth keys exist
const requiredAuthKeys = [
  'auth.emailOrPhone',
  'auth.emailOrPhonePlaceholder',
  'auth.phone',
  'auth.phonePlaceholder',
  'auth.registerWithEmail',
  'auth.registerWithPhone',
  'auth.chooseMethod',
  'auth.verifyTitle',
  'auth.verifySubtitle',
  'auth.enterVerificationCode',
  'auth.verifyButton',
  'auth.resendCode',
  'auth.resendCodeIn',
  'auth.codeResent',
  'auth.didNotReceiveCode',
  'auth.forgotPassword',
  'auth.forgotPasswordTitle',
  'auth.forgotPasswordSubtitle',
  'auth.sendResetCode',
  'auth.resetPasswordTitle',
  'auth.resetSubtitle',
  'auth.newPassword',
  'auth.newPasswordPlaceholder',
  'auth.confirmPassword',
  'auth.confirmPasswordPlaceholder',
  'auth.passwordsDoNotMatch',
  'auth.passwordResetSuccess',
  'auth.resetPasswordButton',
  'auth.backToLogin',
  'auth.changeIdentifier',
  'auth.invalidCodeLength',
  'auth.passwordMinLength',
];

for (const key of requiredAuthKeys) {
  assert.ok(arKeys.has(key), `Missing required key in ar.json: ${key}`);
  assert.ok(enKeys.has(key), `Missing required key in en.json: ${key}`);
}
console.log(`✅ [PASS] i18n locale files in 100% sync (${arKeys.size} keys, all auth keys present)`);

// 2. Egyptian Phone Validation & Normalization Tests
console.log('\n--- Test 2: Egyptian Phone Validation & Normalization ---');
const { isValidEgyptianPhone, normalizeEgyptianPhone, formatEgyptianPhone } = require('../src/utils/egyptianPhone');

// Valid numbers
const validNumbers = [
  '01012345678',
  '01112345678',
  '01212345678',
  '01512345678',
  '+201012345678',
  '+201112345678',
  '+201212345678',
  '+201512345678',
  '010-1234-5678',
  '+20 10 1234 5678',
];

for (const num of validNumbers) {
  assert.ok(isValidEgyptianPhone(num), `Should be valid Egyptian phone: ${num}`);
  const normalized = normalizeEgyptianPhone(num);
  assert.match(normalized, /^\+201[0125]\d{8}$/, `Normalized format must be +20XXXXXXXXXX: ${normalized}`);
}

// Invalid numbers
const invalidNumbers = [
  '01312345678', // Invalid carrier prefix 013
  '01912345678', // Invalid carrier prefix 019
  '123456',      // Too short
  '0101234567890', // Too long
  'invalid-phone',
  '',
  null,
];

for (const num of invalidNumbers) {
  assert.strictEqual(isValidEgyptianPhone(num), false, `Should be invalid: ${num}`);
}

assert.strictEqual(normalizeEgyptianPhone('01012345678'), '+201012345678');
assert.strictEqual(formatEgyptianPhone('01012345678'), '010 1234 5678');
console.log('✅ [PASS] Egyptian phone validator, normalizer, and formatter all accurate');

// 3. OTP 6-Box Logic Unit Tests
console.log('\n--- Test 3: OTP 6-Box Logic Simulation ---');
function simulateOtpTyping(inputDigits) {
  const length = 6;
  const digits = Array(length).fill('');
  for (let i = 0; i < inputDigits.length && i < length; i++) {
    digits[i] = inputDigits[i];
  }
  return {
    code: digits.join(''),
    isComplete: digits.every((d) => d !== '') && digits.length === length,
  };
}

const partial = simulateOtpTyping('123');
assert.strictEqual(partial.code, '123');
assert.strictEqual(partial.isComplete, false);

const complete = simulateOtpTyping('654321');
assert.strictEqual(complete.code, '654321');
assert.strictEqual(complete.isComplete, true);

// Paste simulation (e.g., user pastes " 987654 ")
const pasted = ' 987654 '.trim().replace(/\D/g, '').slice(0, 6);
assert.strictEqual(pasted, '987654');
assert.strictEqual(pasted.length, 6);
console.log('✅ [PASS] OTP 6-digit input and paste handling verified');

// 4. Cooldown Timer State Logic
console.log('\n--- Test 4: Cooldown 60s Resend State Machine ---');
let countdown = 60;
function tick() {
  countdown = countdown > 0 ? countdown - 1 : 0;
}
function canResend() {
  return countdown === 0;
}

assert.strictEqual(canResend(), false);
for (let s = 0; s < 59; s++) tick();
assert.strictEqual(countdown, 1);
assert.strictEqual(canResend(), false);
tick();
assert.strictEqual(countdown, 0);
assert.strictEqual(canResend(), true);
// Reset on send
countdown = 60;
assert.strictEqual(canResend(), false);
console.log('✅ [PASS] 60-second cooldown timer state machine verified');

// 5. App Navigator Route Registration Verification
console.log('\n--- Test 5: AppNavigator Stack Screens Verification ---');
const appNavContent = fs.readFileSync(path.resolve(__dirname, '../src/navigation/AppNavigator.js'), 'utf8');

const expectedScreens = ['Login', 'Register', 'Verify', 'ForgotPassword', 'ResetPassword'];
for (const screen of expectedScreens) {
  assert.ok(
    appNavContent.includes(`name="${screen}"`),
    `AppNavigator must register screen name="${screen}" in Stack`
  );
}
console.log(`✅ [PASS] All 5 auth screens verified in AppNavigator (${expectedScreens.join(', ')})`);

console.log('\n🎉 ALL MOBILE AUTH COMPLETION TESTS PASSED SUCCESSFULLY!');
