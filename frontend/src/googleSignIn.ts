/**
 * Native-only: opens the OS's own Google account picker and returns a verified ID token, or throws.
 * The web redirect flow (window.location.href to Google's consent page) doesn't work inside the
 * native app's WebView — Google blocks completing sign-in in an embedded browser — so this is native's
 * only path. Shared by the login screen (views/auth.ts) and the Settings claim card, so both hand the
 * resulting token to whichever backend endpoint fits (fresh login vs. attaching to an existing session).
 */
export async function getNativeGoogleIdToken(): Promise<string> {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error("Google didn't return a usable sign-in token");
  return idToken;
}
