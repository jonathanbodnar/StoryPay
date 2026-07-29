import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor native-shell config for the StoryVenue iOS + Android apps.
 *
 * AUTH STRATEGY — same-origin hosting (locked decision):
 *   The webview loads the LIVE production site directly (server.url below),
 *   so the webview's origin === the cookie domain (app.storyvenue.com). The
 *   existing `httpOnly; Secure; SameSite=Lax` session cookies (venue_id /
 *   member_id, set by src/lib/session.ts) attach to every request exactly as
 *   they do in mobile Safari / Chrome. No token bridge, no cookie-attribute
 *   changes. Do NOT point this at a bundled static export.
 *
 * The local `webDir` is only a fallback the CLI requires — it is never the
 * source of truth because `server.url` overrides it at runtime.
 */
const config: CapacitorConfig = {
  appId: 'com.storyvenue.app',
  appName: 'StoryVenue',
  // Placeholder bundle. Real content is loaded from server.url at runtime.
  webDir: 'capacitor-shell/www',
  server: {
    // Same-origin hosting: load the live site so session cookies attach.
    url: 'https://app.storyvenue.com',
    // Force HTTPS only — never allow plaintext (App Store / Play requirement).
    cleartext: false,
    // Serve the local shell over the https scheme on Android so the origin
    // model matches iOS and secure cookies are honored.
    androidScheme: 'https',
  },
  ios: {
    // Let the site's own theming drive the status bar; avoids a white gap.
    contentInset: 'always',
  },
  plugins: {
    PushNotifications: {
      // Show banners + play a sound + bump the badge while the app is
      // foregrounded. Matches the web-push UX users already expect.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
