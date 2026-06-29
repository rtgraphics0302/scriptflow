// ============================================================================
//  ScriptFlow — Live Sync Configuration
// ============================================================================
//
//  The app works WITHOUT this (it saves on your device). But to make it LIVE —
//  so your editor sees your changes the instant you make them — paste your free
//  Firebase keys below.
//
//  HOW TO GET THESE KEYS (5 minutes, free, no credit card):
//   1. Go to https://console.firebase.google.com  and click "Add project".
//   2. Give it a name (e.g. "scriptflow"), accept, and create it.
//   3. In the left menu open  Build → Firestore Database → Create database.
//        - Choose "Start in production mode" (or test mode) and pick a location.
//   4. Click the gear icon → Project settings → scroll to "Your apps" →
//        click the  </>  (Web) icon, register an app, and copy the
//        firebaseConfig object it shows you.
//   5. Paste those values over the placeholders below and save this file.
//   6. (Security) In Firestore → Rules, paste the rules from README.md.
//
//  That's it. Reopen the app and the status pill turns green: "Live".
// ============================================================================

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// The shared "room" you and your editor join. Anyone using the same workspace
// name + same Firebase project sees the same board, live. Change it to make a
// fresh, separate board (e.g. for a different client or channel).
export const WORKSPACE_ID = "main";

// Returns true only when the keys above have actually been filled in.
export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("PASTE_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("PASTE_")
  );
}
