import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.colebeing.ping',
  appName: 'Ping',
  webDir: 'dist',
  // Points the native WebView at the live GitHub Pages deploy instead of the
  // bundled dist/ copy in the APK, so every web-only push is instantly live
  // in the native app too — no rebuild/reinstall needed while iterating.
  // Trade-off: needs a live network connection to load (no offline access),
  // and it's a testing-phase choice, not a shipping one — revert to the
  // bundled webDir (drop server.url) before wider distribution, since Google
  // Play's "minimum functionality" policy can flag apps that are thin
  // wrappers around a remote site, and native code changes still need a real
  // rebuild regardless of this setting.
  server: {
    url: 'https://colebeing.github.io/Ping/',
  },
  plugins: {
    FirebaseAuthentication: {
      providers: ['google.com'],
    },
  },
};

export default config;
