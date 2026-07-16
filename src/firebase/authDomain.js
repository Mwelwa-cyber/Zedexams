/**
 * Resolve the Firebase Auth `authDomain` for this page load.
 *
 * The Google sign-in popup shows the authDomain to the user ("Choose an
 * account — to continue to <authDomain>"). With the env default
 * (`examsprepzambia.firebaseapp.com`) learners see a raw firebaseapp.com
 * domain instead of the brand. Every domain connected to Firebase Hosting —
 * including the custom zedexams.com domain — also serves the Auth helper
 * endpoints (`/__/auth/*`), so when the SPA is being served from the
 * production domain we can point authDomain at the page's own hostname and
 * the popup reads "to continue to zedexams.com". Same-origin authDomain also
 * sidesteps the third-party-storage partitioning that breaks cross-origin
 * auth iframes in Safari/incognito.
 *
 * Everything else keeps the env value: localhost dev, the smoke build, and
 * the Capacitor shell (origin `https://localhost`) don't serve `/__/auth/*`,
 * and unknown origins shouldn't silently become the OAuth redirect target.
 * The allowlist below must stay in sync with the domains registered in
 * Firebase Console → Authentication → Settings → Authorized domains (which
 * also registers the `https://<domain>/__/auth/handler` redirect URI on the
 * Google OAuth client).
 */
const CUSTOM_AUTH_DOMAINS = ['zedexams.com', 'www.zedexams.com']

export function resolveAuthDomain(envAuthDomain, hostname) {
  if (hostname && CUSTOM_AUTH_DOMAINS.includes(hostname)) return hostname
  return envAuthDomain
}
