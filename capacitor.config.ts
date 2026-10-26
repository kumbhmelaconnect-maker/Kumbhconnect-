import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.kumbhconnect.nashik',
  appName: 'KumbhConnect',
  webDir: 'www',

  // IMPORTANT: server.url vaparu nako. App www/ madhun local load zali pahije,
  // nahitar Indus la "website converted into app" disto.
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

    // @capacitor/local-notifications (aarti / snan reminders)
    LocalNotifications: {
      iconColor: '#FF6D00'
    },

    // @capacitor/push-notifications (Android sathi presentationOptions lagat nahi;
    // FCM sathi android/app/google-services.json lagto)
    PushNotifications: {}
  },

  android: {
    backgroundColor: '#FF6D00',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
