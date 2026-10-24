import client from './client';

/**
 * Fetch public application feature configuration flags.
 * Returns { googleEnabled, phoneSignupEnabled, verificationRequired, walletEnabled, couponsEnabled }
 */
export const getAppConfig = () => client.get('/config');
