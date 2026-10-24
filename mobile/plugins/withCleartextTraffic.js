const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to enable android:usesCleartextTraffic="true"
 * Enabled ONLY when process.env.ALLOW_CLEARTEXT === '1' for local LAN preview/testing.
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    mainApplication.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
};
