
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.kumbhconnect.nashik',
  appName: 'KumbhConnect',
  webDir: 'www',

  // App must load bundled local assets.
  // Do not configure server.url.
  server: {
    androidScheme: 'https',
    cleartext: false
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      backgroundColor: '#FF6D00'
    },

    LocalNotifications: {
      iconColor: '#FF6D00'
    },

    PushNotifications: {},

    // v1.7.0 Google + phone OTP. skipNativeAuth: the Firebase JS SDK (used by the whole app) owns the session;
    // the plugin only returns the Google idToken / phone verificationId.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'phone']
    }
  },

  android: {
    backgroundColor: '#FF6D00',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
