const allowCleartext = process.env.ALLOW_CLEARTEXT === '1';

const FACE_ID_PERMISSION_TEXT =
  'السماح بالدخول السريع والآمن بالبصمة / Allow Face ID for quick and secure biometric login';

const PHOTOS_PERMISSION_TEXT =
  'يحتاج التطبيق للوصول إلى الصور لرفع صور المنتجات وصور طلبات الاسترجاع / Allow access to your photos to upload product images and return defect photos.';

const CAMERA_PERMISSION_TEXT =
  'يحتاج التطبيق للوصول إلى الكاميرا لالتقاط صور المنتجات وصور طلبات الاسترجاع / Allow access to your camera to take product and return defect photos.';

module.exports = {
  expo: {
    name: 'MarketplaceMobile',
    slug: 'MarketplaceMobile',
    version: '1.0.0',
    scheme: 'marketplacemobile',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
    },
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSFaceIDUsageDescription: FACE_ID_PERMISSION_TEXT,
        NSPhotoLibraryUsageDescription: PHOTOS_PERMISSION_TEXT,
        NSCameraUsageDescription: CAMERA_PERMISSION_TEXT,
      },
    },
    android: {
      package: 'com.egyptianmarketplace.app',
      versionCode: 1,
      permissions: [
        'android.permission.INTERNET',
        'android.permission.CAMERA',
      ],
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.RECORD_AUDIO',
      ],
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      ...(allowCleartext ? ['./plugins/withCleartextTraffic'] : []),
      'expo-image',
      'expo-web-browser',
      'expo-font',
      [
        'expo-local-authentication',
        {
          faceIDPermission: FACE_ID_PERMISSION_TEXT,
        },
      ],
      [
        'expo-secure-store',
        {
          faceIDPermission: FACE_ID_PERMISSION_TEXT,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: PHOTOS_PERMISSION_TEXT,
          cameraPermission: CAMERA_PERMISSION_TEXT,
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      supportsRTL: true,
      eas: {
        projectId: '29c03258-b731-4ab9-870f-ea3571f77f3f',
      },
    },
  },
};
