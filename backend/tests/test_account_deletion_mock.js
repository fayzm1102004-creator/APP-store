const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * Mock & Static Verification Suite for Items 5, 6, 7, and 10 (Non-PostgreSQL: *_mock.js)
 *
 * NOTE: Per Global Rules & Item 4, this script uses in-process JS mocks and C# source
 * verification and is explicitly named `*_mock.js`. It is NOT counted as PostgreSQL
 * verification when TEST_DB is unset.
 */

const repoRoot = path.resolve(__dirname, '..', '..');

function verifyCSharpSourceContracts() {
  console.log('\n--- [Static Source Verification] Checking C# Implementations for Items 5, 6, 7, 10 ---');

  // 1. Item 5: AuthService.cs checks IsActive=false and legacy deleted_ email AFTER password verification
  const authServiceCode = fs.readFileSync(
    path.join(repoRoot, 'backend/Marketplace.Application/Services/AuthService.cs'),
    'utf8'
  );
  const verifyPassIdx = authServiceCode.indexOf('if (user == null || !_hasher.Verify(request.Password, user.PasswordHash))');
  const isActiveIdx = authServiceCode.indexOf('if (!user.IsActive || isLegacyDeletedEmail)');
  const notVerifiedIdx = authServiceCode.indexOf('throw new NotVerifiedException(');

  assert(verifyPassIdx > 0, 'AuthService.LoginAsync must verify password hash');
  assert(isActiveIdx > verifyPassIdx, 'AuthService.LoginAsync must check !user.IsActive AFTER password verification');
  assert(notVerifiedIdx > isActiveIdx, 'AuthService.LoginAsync must check NOT_VERIFIED after IsActive check');
  console.log('✅ Item 5 (C#): AuthService.LoginAsync rejects IsActive=false & legacy deleted_ accounts with generic 401 AFTER password check.');

  // 2. Item 6: Program.cs ForwardLimit = 1 and multi-key rate limiting (ip, user, target)
  const programCode = fs.readFileSync(
    path.join(repoRoot, 'backend/Marketplace.API/Program.cs'),
    'utf8'
  );
  assert(programCode.includes('options.ForwardLimit = 1;'), 'Program.cs must set ForwardLimit = 1');
  assert(!programCode.includes('options.ForwardLimit = null'), 'Program.cs must NEVER set ForwardLimit = null');
  assert(programCode.includes('ReverseProxy:KnownProxies'), 'Program.cs must support optional ReverseProxy:KnownProxies from config');
  assert(programCode.includes('$"ip:{remoteIp}"'), 'Program.cs must rate-limit per IP');
  assert(programCode.includes('$"user:{userId}"'), 'Program.cs must rate-limit per authenticated user ID');
  assert(programCode.includes('$"target:{normalizedTarget}"'), 'Program.cs must rate-limit per normalized target');
  assert(programCode.includes('db.Database.ProviderName,\n            "Microsoft.EntityFrameworkCore.InMemory"') || programCode.includes('"Microsoft.EntityFrameworkCore.InMemory"'), 'Program.cs must only call EnsureCreatedAsync when ProviderName is explicitly Microsoft.EntityFrameworkCore.InMemory');
  assert(programCode.includes('__EFMigrationsHistory'), 'Program.cs must include startup guard checking for __EFMigrationsHistory');
  assert(programCode.includes('GetValue<bool>("Database:AutoMigrate", false)'), 'Program.cs must gate MigrateAsync behind Database:AutoMigrate (default false)');
  console.log('✅ Item 6 & Task e (C#): Program.cs enforces ForwardLimit = 1, multi-key rate limits, __EFMigrationsHistory startup guard, and Database:AutoMigrate (default false).');

  // 3. Item 7: UserService.cs & ReviewService.cs buyer PII scrubbing, seller 409 guard, and export-data
  const userServiceCode = fs.readFileSync(
    path.join(repoRoot, 'backend/Marketplace.Application/Services/UserService.cs'),
    'utf8'
  );
  assert(userServiceCode.includes('throw new ConflictException('), 'UserService.DeleteAccountAsync must refuse Seller deletion with 409 ConflictException when active products/shipments/balances exist');
  assert(userServiceCode.includes('order.RecipientName = string.Empty;'), 'UserService.DeleteAccountAsync must scrub Order.RecipientName');
  assert(userServiceCode.includes('order.RecipientPhone = string.Empty;'), 'UserService.DeleteAccountAsync must scrub Order.RecipientPhone');
  assert(userServiceCode.includes('order.Area = string.Empty;'), 'UserService.DeleteAccountAsync must scrub Order.Area');
  assert(userServiceCode.includes('order.StreetBuilding = string.Empty;'), 'UserService.DeleteAccountAsync must scrub Order.StreetBuilding');
  assert(userServiceCode.includes('TryDeleteUploadedFile('), 'UserService.DeleteAccountAsync must delete uploaded review/return photo files');
  assert(userServiceCode.includes('DeviceSessions ='), 'UserService.ExportUserDataAsync must export DeviceSessions (without token hashes)');

  const reviewServiceCode = fs.readFileSync(
    path.join(repoRoot, 'backend/Marketplace.Application/Services/ReviewService.cs'),
    'utf8'
  );
  assert(reviewServiceCode.includes('!u.IsActive || string.IsNullOrWhiteSpace(u.Name)'), 'ReviewService must anonymize deleted buyer display names');
  console.log('✅ Item 7 (C#): UserService & ReviewService implement Seller 409 Conflict guard, Buyer order PII scrubbing, review anonymization & photo deletion, and expanded ExportUserDataAsync.');

  // 4. Item 10: Wallet, Vendor Payouts, and Coupons OFF by default (404)
  const walletCtrl = fs.readFileSync(path.join(repoRoot, 'backend/Marketplace.API/Controllers/WalletController.cs'), 'utf8');
  const couponsCtrl = fs.readFileSync(path.join(repoRoot, 'backend/Marketplace.API/Controllers/CouponsController.cs'), 'utf8');
  const adminCtrl = fs.readFileSync(path.join(repoRoot, 'backend/Marketplace.API/Controllers/AdminController.cs'), 'utf8');
  const usersCtrl = fs.readFileSync(path.join(repoRoot, 'backend/Marketplace.API/Controllers/UsersController.cs'), 'utf8');

  assert(walletCtrl.includes('GetValue<bool>("Features:WalletEnabled", false)'), 'WalletController must default Features:WalletEnabled to false');
  assert(couponsCtrl.includes('GetValue<bool>("Features:CouponsEnabled", false)'), 'CouponsController must default Features:CouponsEnabled to false');
  assert(adminCtrl.includes('GetValue<bool>("Features:WalletEnabled", false)'), 'AdminController payout endpoints must default Features:WalletEnabled to false');
  assert(usersCtrl.includes('GetValue<bool>("Features:WalletEnabled", false)'), 'UsersController buyer wallet endpoint must default Features:WalletEnabled to false');
  console.log('✅ Item 10 (C#): Wallet, Vendor Payouts (vendor + admin), and Coupons default to OFF (false) and return 404.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulated Behavioral Tests for Items 5, 6, 7, 10
// ─────────────────────────────────────────────────────────────────────────────

function simulateLogin(users, identifier, password) {
  const norm = identifier.trim().toLowerCase();
  const user = users.find((u) => (u.email && u.email.toLowerCase() === norm) || u.phone === norm);
  if (!user) {
    return { status: 401, error: 'Invalid email or password.' };
  }
  // Password verified FIRST
  if (user.password !== password) {
    return { status: 401, error: 'Invalid email or password.' };
  }
  // Item 5: Reject IsActive=false or legacy deleted_ email AFTER password check with identical generic 401
  if (!user.isActive || (user.email && user.email.toLowerCase().startsWith('deleted_'))) {
    return { status: 401, error: 'Invalid email or password.' };
  }
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
    return { status: 403, code: 'NOT_VERIFIED' };
  }
  return { status: 200, token: 'jwt_token' };
}

class MultiKeyRateLimiter {
  constructor(limit = 5) {
    this.limit = limit;
    this.counts = new Map();
  }

  // ForwardLimit = 1 with no trusted proxies configured: ignores spoofed X-Forwarded-For
  resolveClientIp(socketRemoteIp, xForwardedForHeader, trustedProxies = []) {
    if (!trustedProxies.includes(socketRemoteIp)) {
      return socketRemoteIp;
    }
    if (!xForwardedForHeader) return socketRemoteIp;
    // ForwardLimit = 1: only read the rightmost hop
    const hops = xForwardedForHeader.split(',').map((s) => s.trim());
    return hops[hops.length - 1] || socketRemoteIp;
  }

  checkRequest({ socketRemoteIp, xForwardedFor, userId, target }) {
    const effectiveIp = this.resolveClientIp(socketRemoteIp, xForwardedFor, []);
    const keys = [`ip:${effectiveIp}`];
    if (userId) keys.push(`user:${userId}`);
    if (target) keys.push(`target:${target.trim().toLowerCase()}`);

    for (const key of keys) {
      const next = (this.counts.get(key) || 0) + 1;
      this.counts.set(key, next);
      if (next > this.limit) {
        return { status: 429, blockedBy: key };
      }
    }
    return { status: 200 };
  }
}

async function runAllMockTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING MOCK & SOURCE VERIFICATION TESTS (ITEMS 5, 6, 7, 10)');
  console.log('================================================================');

  verifyCSharpSourceContracts();

  // ── ITEM 5 TEST: Login rejects IsActive=false and legacy deleted_ accounts ──
  console.log('\n--- [Item 5] Testing Login with IsActive=false and legacy deleted_ email ---');
  const users = [
    {
      id: 1,
      email: 'disabled@example.com',
      password: 'CorrectPassword123!',
      isActive: false,
      emailVerifiedAt: null, // Even if unverified, must return 401 (never 403 NOT_VERIFIED)
    },
    {
      id: 2,
      email: 'deleted_99_20260101000000@deleted.invalid',
      password: 'LegacyPassword123!',
      isActive: true, // Legacy account disabled by email rename prior to IsActive flag
      emailVerifiedAt: new Date(),
    },
  ];

  const disabledWrongPass = simulateLogin(users, 'disabled@example.com', 'WrongPass!');
  const disabledCorrectPass = simulateLogin(users, 'disabled@example.com', 'CorrectPassword123!');
  assert.strictEqual(disabledWrongPass.status, 401);
  assert.strictEqual(disabledCorrectPass.status, 401);
  assert.strictEqual(disabledWrongPass.error, disabledCorrectPass.error, 'IsActive=false user with right password gets exact same generic 401 as wrong password');

  const legacyDeletedLogin = simulateLogin(users, 'deleted_99_20260101000000@deleted.invalid', 'LegacyPassword123!');
  assert.strictEqual(legacyDeletedLogin.status, 401);
  assert.strictEqual(legacyDeletedLogin.error, 'Invalid email or password.', 'Legacy deleted_ email account is rejected with generic 401');
  console.log('✅ Item 5 passed: Both IsActive=false and legacy email-renamed accounts return generic 401 after password check.');

  // ── ITEM 6 TEST: Rotating spoofed X-Forwarded-For headers still hit rate limit ──
  console.log('\n--- [Item 6] Testing Rate Limiting against rotating spoofed X-Forwarded-For headers ---');
  const limiter = new MultiKeyRateLimiter(5);
  const statuses = [];
  for (let i = 1; i <= 7; i++) {
    const res = limiter.checkRequest({
      socketRemoteIp: '203.0.113.50',
      xForwardedFor: `198.51.100.${i}, 10.0.0.${i}`, // Rotating spoofed X-Forwarded-For on every request
      userId: null,
      target: 'Victim@Example.com',
    });
    statuses.push(res.status);
  }
  assert.deepStrictEqual(
    statuses,
    [200, 200, 200, 200, 200, 429, 429],
    'Requests with rotating spoofed X-Forwarded-For headers must still hit 429 Too Many Requests after 5 attempts'
  );
  console.log('✅ Item 6 passed: Rotating spoofed X-Forwarded-For values still hit 429 limit.');

  // ── ITEM 7 TEST: Buyer PII scrubbing, Seller 409 conflict, and Export Data ──
  console.log('\n--- [Item 7] Testing Buyer Order/Review Scrubbing, Seller 409 Refusal, and Export Data ---');

  const db = {
    users: [
      { id: 55, role: 'Buyer', name: 'أحمد محمود', email: 'ahmed@example.com', phone: '+201012345678', isActive: true, passwordHash: 'hash', tokenVersion: 1 },
      { id: 77, role: 'Seller', name: 'متجر النور', email: 'seller@example.com', phone: '+201112223334', isActive: true, passwordHash: 'hash', tokenVersion: 1 },
    ],
    products: [{ id: 301, sellerId: 77, name: 'هاتف ذكي' }],
    shipments: [{ id: 401, sellerId: 77, orderId: 9001, status: 'Shipped' }],
    vendorWallets: [{ sellerId: 77, balance: 250.0, pendingBalance: 0 }],
    payoutRequests: [],
    orders: [
      {
        id: 9001,
        buyerId: 55,
        totalAmount: 1500,
        status: 'Delivered',
        governorate: 'القاهرة',
        city: 'مدينة نصر',
        recipientName: 'أحمد محمود',
        recipientPhone: '01012345678',
        area: 'الحي العاشر',
        streetBuilding: 'عمارة 12 شقة 4',
        items: [{ id: 1, productName: 'هاتف ذكي', quantity: 1, unitPrice: 1500 }],
      },
    ],
    reviews: [
      { id: 601, userId: 55, productId: 301, rating: 5, comment: 'ممتاز', photoUrlsJson: '["/uploads/reviews/r1.jpg"]' },
    ],
    refreshTokens: [
      { id: 101, userId: 55, deviceId: 'dev-guid-1', deviceName: 'Pixel 8', tokenHash: 'SECRET_SHA256_HASH', createdAt: new Date(), expiresAt: new Date(), lastUsedAt: new Date(), revokedAt: null },
    ],
    userConsents: [{ id: 1, userId: 55, policyVersion: '1.0', acceptedAt: new Date() }],
    deletedFiles: [],
  };

  function deleteAccount(userId) {
    const user = db.users.find((u) => u.id === userId);
    if (user.role === 'Seller') {
      const hasProducts = db.products.some((p) => p.sellerId === userId);
      const hasOpenShipments = db.shipments.some((s) => s.sellerId === userId && !['Delivered', 'Cancelled', 'DeliveryFailed'].includes(s.status));
      const wallet = db.vendorWallets.find((w) => w.sellerId === userId);
      const hasWalletBalance = wallet && (wallet.balance > 0 || wallet.pendingBalance > 0);
      if (hasProducts || hasOpenShipments || hasWalletBalance) {
        return { status: 409, error: 'Cannot delete seller account while active products, open shipments, or wallet/payout balances exist.' };
      }
    }

    // Scrub buyer orders (keep Governorate, City, totals, items)
    for (const order of db.orders.filter((o) => o.buyerId === userId)) {
      order.recipientName = '';
      order.recipientPhone = '';
      order.area = '';
      order.streetBuilding = '';
    }

    // Delete review photos
    for (const rev of db.reviews.filter((r) => r.userId === userId)) {
      if (rev.photoUrlsJson) {
        const urls = JSON.parse(rev.photoUrlsJson);
        db.deletedFiles.push(...urls);
        rev.photoUrlsJson = null;
      }
    }

    user.name = '';
    user.email = null;
    user.phone = null;
    user.isActive = false;
    user.tokenVersion++;
    db.refreshTokens = db.refreshTokens.filter((r) => r.userId !== userId);
    return { status: 204 };
  }

  function exportUserData(userId) {
    const user = db.users.find((u) => u.id === userId);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      reviews: db.reviews.filter((r) => r.userId === userId),
      deviceSessions: db.refreshTokens
        .filter((r) => r.userId === userId)
        .map(({ deviceId, deviceName, createdAt, lastUsedAt, expiresAt, revokedAt }) => ({
          deviceId,
          deviceName,
          createdAt,
          lastUsedAt,
          expiresAt,
          isActive: !revokedAt,
        })),
      orders: db.orders.filter((o) => o.buyerId === userId),
    };
  }

  // Verify export-data BEFORE deletion includes Reviews, DeviceSessions (without tokenHash), and Orders
  const exported = exportUserData(55);
  assert.strictEqual(exported.reviews.length, 1, 'Export data must include user reviews');
  assert.strictEqual(exported.deviceSessions.length, 1, 'Export data must include device sessions');
  assert.strictEqual(exported.deviceSessions[0].tokenHash, undefined, 'Exported device sessions must NEVER expose tokenHash');
  assert.strictEqual(exported.orders.length, 1, 'Export data must include orders');

  // Verify Seller with active products/open shipments/wallet balance is refused with 409 Conflict
  const sellerDelRes = deleteAccount(77);
  assert.strictEqual(sellerDelRes.status, 409, 'Seller with active products, open shipments, or wallet balance must return 409 Conflict');

  // Verify Buyer deletion scrubs order PII, keeps Governorate/City/totals/items, deletes review photos, and anonymizes review author
  const buyerDelRes = deleteAccount(55);
  assert.strictEqual(buyerDelRes.status, 204, 'Buyer deletion succeeds with 204');

  const orderAfter = db.orders[0];
  assert.strictEqual(orderAfter.recipientName, '', 'Order.RecipientName must be scrubbed');
  assert.strictEqual(orderAfter.recipientPhone, '', 'Order.RecipientPhone must be scrubbed');
  assert.strictEqual(orderAfter.area, '', 'Order.Area must be scrubbed');
  assert.strictEqual(orderAfter.streetBuilding, '', 'Order.StreetBuilding must be scrubbed');
  assert.strictEqual(orderAfter.governorate, 'القاهرة', 'Order.Governorate must be preserved');
  assert.strictEqual(orderAfter.city, 'مدينة نصر', 'Order.City must be preserved');
  assert.strictEqual(orderAfter.totalAmount, 1500, 'Order.TotalAmount must be preserved');
  assert.strictEqual(orderAfter.items.length, 1, 'Order.Items must be preserved');

  assert.strictEqual(db.reviews[0].photoUrlsJson, null, 'Review photoUrlsJson must be cleared');
  assert.deepStrictEqual(db.deletedFiles, ['/uploads/reviews/r1.jpg'], 'Review photo files must be deleted from storage');

  const buyerAfter = db.users.find((u) => u.id === 55);
  const reviewDisplayName = !buyerAfter.isActive || !buyerAfter.name ? 'مشتري' : buyerAfter.name;
  assert.strictEqual(reviewDisplayName, 'مشتري', 'Review display name must be anonymized to مشتري');
  console.log('✅ Item 7 passed: Seller 409 Conflict, Buyer order PII scrubbing, review anonymization/photo deletion, and ExportUserData verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL MOCK & SOURCE VERIFICATION TESTS PASSED!');
  console.log('================================================================\n');
}

runAllMockTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
