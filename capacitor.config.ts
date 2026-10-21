import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.kumbhconnect.nashik',
  appName: 'KumbhConnect',
  webDir: 'www',
  bundledWebRuntime: false,

  server: {
    androidScheme: 'https'
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      backgroundColor: '#FF6D00'
    }
  },

  android: {
    backgroundColor: '#FF6D00'
  }
};

export default config;
