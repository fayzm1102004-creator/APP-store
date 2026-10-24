const API_BASE = process.env.API_URL || 'http://localhost:5209';

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`✅ ${message}`);
}

async function request(method, path, body = null, token = null) {
    const url = `${API_BASE}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    const text = await res.text();
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    return { status: res.status, data };
}

async function runTests() {
    console.log('====================================================');
    console.log('🏛️ RUNNING FEATURE 1 (ADMIN) & FEATURE 2 (WALLET) TESTS');
    console.log('====================================================');

    const rand = Math.floor(Math.random() * 900000) + 100000;
    const randDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
    const sellerEmail = `vendor_${rand}@example.com`;
    const buyerEmail = `customer_${rand}@example.com`;
    const sellerPhone = `010${randDigits}`;
    const buyerPhone = `011${randDigits}`;
    const password = 'Password123!';

    // --- 1. Admin Authentication ---
    console.log('\n--- 1. Testing Admin Authentication & RBAC ---');
    const adminLoginRes = await request('POST', '/api/auth/login', {
        email: 'admin@marketplace.eg',
        password: process.env.ADMIN_PASSWORD || 'AdminSecurePassword123!'
    });
    assert(adminLoginRes.status === 200, 'Admin logged in successfully (HTTP 200)');
    const adminToken = adminLoginRes.data.token;
    const adminId = adminLoginRes.data.userId;
    assert(adminLoginRes.data.role === 'Admin', 'Logged in user has Admin role');

    // Register a Seller and a Buyer
    const sellerReg = await request('POST', '/api/auth/register', {
        name: `تاجر_${rand}`,
        email: sellerEmail,
        password,
        role: 'Seller',
        phone: sellerPhone,
        acceptedTermsAndPrivacy: true
    });
    assert(sellerReg.status === 201, 'Seller registered successfully (HTTP 201)');
    const sellerToken = sellerReg.data.token;
    const sellerId = sellerReg.data.userId;

    // Set Seller dispatch city
    const profRes = await request('PUT', '/api/users/me/seller-profile', {
        dispatchCity: 'القاهرة',
        dispatchAddress: 'شارع عباس العقاد، مدينة نصر، القاهرة',
        contactPhone: sellerPhone
    }, sellerToken);
    assert(profRes.status === 200, 'Seller dispatch profile configured (HTTP 200)');

    const buyerReg = await request('POST', '/api/auth/register', {
        name: `مشتري_${rand}`,
        email: buyerEmail,
        password,
        role: 'Buyer',
        phone: buyerPhone,
        acceptedTermsAndPrivacy: true
    });
    assert(buyerReg.status === 201, 'Buyer registered successfully (HTTP 201)');
    const buyerToken = buyerReg.data.token;
    const buyerId = buyerReg.data.userId;

    // RBAC: Buyer and Seller cannot access Admin endpoints
    const buyerAdminAccess = await request('GET', '/api/admin/users', null, buyerToken);
    assert(buyerAdminAccess.status === 403, 'Buyer forbidden from /api/admin/users (HTTP 403)');

    const sellerAdminAccess = await request('GET', '/api/admin/stats', null, sellerToken);
    assert(sellerAdminAccess.status === 403, 'Seller forbidden from /api/admin/stats (HTTP 403)');

    // Admin can list users and filter
    const adminUsersRes = await request('GET', '/api/admin/users?role=Seller', null, adminToken);
    assert(adminUsersRes.status === 200, 'Admin fetched users filtered by role=Seller (HTTP 200)');
    assert(Array.isArray(adminUsersRes.data) && adminUsersRes.data.some(u => u.id === sellerId), 'Listed sellers contains newly registered seller');

    // Admin stats
    const statsRes = await request('GET', '/api/admin/stats', null, adminToken);
    assert(statsRes.status === 200, 'Admin fetched platform stats (HTTP 200)');
    assert(typeof statsRes.data.totalUsers === 'number', 'Platform stats contains totalUsers count');

    // Admin bans a buyer, buyer login gets 403, unban works
    console.log('\n--- 2. Testing Admin User Status & Self-Deactivation Protection ---');
    const banRes = await request('PUT', `/api/admin/users/${buyerId}/status`, { isActive: false }, adminToken);
    assert(banRes.status === 200, 'Admin deactivated buyer account (HTTP 200)');

    const bannedLogin = await request('POST', '/api/auth/login', {
        email: buyerEmail,
        password
    });
    assert(bannedLogin.status === 403, 'Deactivated buyer login rejected with HTTP 403');

    // Unban buyer
    const unbanRes = await request('PUT', `/api/admin/users/${buyerId}/status`, { isActive: true }, adminToken);
    assert(unbanRes.status === 200, 'Admin reactivated buyer account (HTTP 200)');

    const unbannedLogin = await request('POST', '/api/auth/login', {
        email: buyerEmail,
        password
    });
    assert(unbannedLogin.status === 200, 'Reactivated buyer logged in successfully (HTTP 200)');

    // Admin self-deactivation protection
    const adminSelfBan = await request('PUT', `/api/admin/users/${adminId}/status`, { isActive: false }, adminToken);
    assert(adminSelfBan.status === 400, 'Admin self-deactivation rejected with HTTP 400');

    // --- 3. Vendor Wallet & Order Completion Hook ---
    console.log('\n--- 3. Testing Vendor Wallet & Order Completion Hook ---');
    
    // Check initial seller wallet
    const initWalletRes = await request('GET', '/api/wallet/me', null, sellerToken);
    assert(initWalletRes.status === 200, 'Seller retrieved initial wallet (HTTP 200)');
    assert(initWalletRes.data.balance === 0, 'Initial balance is 0 ج.م');
    assert(initWalletRes.data.recentTransactions.length === 0, 'Initial transaction count is 0');

    // Buyer cannot access wallet
    const buyerWalletAccess = await request('GET', '/api/wallet/me', null, buyerToken);
    assert(buyerWalletAccess.status === 403, 'Buyer forbidden from /api/wallet/me (HTTP 403)');

    // Create a product for the seller (500 EGP)
    const prodRes = await request('POST', '/api/products', {
        name: `ساعة ذكية فاخرة_${rand}`,
        description: 'ساعة ذكية مقاومة للماء مع بطارية تدوم 7 أيام',
        price: 500,
        stock: 10,
        weightGrams: 400,
        categoryId: 1,
        imageUrls: ['https://images.local/sample.jpg']
    }, sellerToken);
    assert(prodRes.status === 201, 'Product created at 500 EGP (HTTP 201)');
    const productId = prodRes.data.id;

    // Buyer places order for 1 item (500 + 70 delivery = 570 EGP total)
    const orderRes = await request('POST', '/api/orders', {
        recipientName: 'أحمد محمود',
        recipientPhone: buyerPhone,
        governorate: 'القاهرة',
        city: 'القاهرة',
        area: 'مدينة نصر',
        streetBuilding: 'شارع عباس العقاد عمارة 10',
        deliveryMethod: 'Courier',
        paymentMethod: 'OnReceipt',
        items: [{ productId, quantity: 1 }]
    }, buyerToken);
    assert(orderRes.status === 201, 'Order created successfully (HTTP 201)');
    const shipmentId = orderRes.data.shipments[0].id;

    // Seller hands over shipment to carrier
    const handRes = await request('PUT', `/api/shipments/${shipmentId}/status`, {
        status: 'HandedToCarrier'
    }, sellerToken);
    assert(handRes.status === 200, 'Shipment status updated to HandedToCarrier (HTTP 200)');

    // Carrier moves to Delivered
    const carrierDeliveredRes = await request('PUT', `/api/dev/carrier/shipments/${shipmentId}/status`, {
        status: 'Delivered'
    });
    if (carrierDeliveredRes.status !== 200) {
        console.log('carrierDeliveredRes debug:', carrierDeliveredRes);
    }
    assert(carrierDeliveredRes.status === 200, 'Carrier marked shipment as Delivered (HTTP 200)');

    // Inspect seller wallet after delivery
    // Item price = 500. Commission = 10% (50). Vendor net = 450.
    const creditedWalletRes = await request('GET', '/api/wallet/me', null, sellerToken);
    assert(creditedWalletRes.status === 200, 'Retrieved seller wallet after delivery (HTTP 200)');
    assert(creditedWalletRes.data.balance === 450, `Wallet balance is exactly 450 EGP (got ${creditedWalletRes.data.balance})`);
    assert(creditedWalletRes.data.totalEarned === 450, `Total earned is exactly 450 EGP (got ${creditedWalletRes.data.totalEarned})`);
    assert(creditedWalletRes.data.recentTransactions.length === 2, '2 transactions recorded: COD collection & Commission');

    // Test idempotency: Calling delivered again must not double credit
    await request('PUT', `/api/dev/carrier/shipments/${shipmentId}/status`, {
        status: 'Delivered'
    });
    const idemWalletRes = await request('GET', '/api/wallet/me', null, sellerToken);
    assert(idemWalletRes.data.balance === 450, 'Wallet balance remains 450 EGP after duplicate Delivered call (Idempotency confirmed)');

    // --- 4. Vendor Payout Request & Admin Processing ---
    console.log('\n--- 4. Testing Vendor Payout Request & Admin Processing ---');

    // Overdraft attempt (requesting 500 when balance is 450)
    const overdraftRes = await request('POST', '/api/wallet/payout-request', {
        amount: 500,
        method: 'InstaPay',
        destinationAccount: sellerPhone
    }, sellerToken);
    assert(overdraftRes.status === 400, 'Payout request exceeding balance rejected with HTTP 400');

    // Valid payout request (200 EGP)
    const validPayoutRes = await request('POST', '/api/wallet/payout-request', {
        amount: 200,
        method: 'InstaPay',
        destinationAccount: sellerPhone
    }, sellerToken);
    assert(validPayoutRes.status === 200 || validPayoutRes.status === 201, 'Payout request created successfully (HTTP 200/201)');
    const payoutId = validPayoutRes.data.id;
    assert(validPayoutRes.data.status === 'Pending', 'Payout status is Pending');

    // Check wallet balance after payout request: 450 - 200 = 250 EGP
    const postPayoutWallet = await request('GET', '/api/wallet/me', null, sellerToken);
    assert(postPayoutWallet.data.balance === 250, `Wallet balance deducted to 250 EGP (got ${postPayoutWallet.data.balance})`);

    // Admin views payout requests
    const adminPayoutsRes = await request('GET', '/api/admin/wallet/payouts?status=Pending', null, adminToken);
    assert(adminPayoutsRes.status === 200, 'Admin retrieved pending payouts list (HTTP 200)');
    assert(adminPayoutsRes.data.some(p => p.id === payoutId), 'Pending payouts list contains seller payout request');

    // Admin processes payout: Completed
    const processRes = await request('POST', `/api/admin/wallet/payouts/${payoutId}/process`, {
        status: 'Completed',
        adminNotes: 'تم التحويل عبر إنستاباي بنجاح'
    }, adminToken);
    assert(processRes.status === 200, 'Admin marked payout as Completed (HTTP 200)');
    assert(processRes.data.status === 'Completed', 'Payout request updated to Completed');

    // Seller views their payouts history
    const sellerPayoutsRes = await request('GET', '/api/wallet/payouts', null, sellerToken);
    assert(sellerPayoutsRes.status === 200, 'Seller fetched payouts history (HTTP 200)');
    const completedPayout = sellerPayoutsRes.data.find(p => p.id === payoutId);
    assert(completedPayout && completedPayout.status === 'Completed', 'Seller payout shows status Completed');
    assert(completedPayout.adminNotes === 'تم التحويل عبر إنستاباي بنجاح', 'Seller can see admin notes');

    console.log('\n====================================================');
    console.log('🎉 ALL FEATURE 1 & FEATURE 2 TESTS PASSED PERFECTLY!');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('Unhandled test error:', err);
    process.exit(1);
});
