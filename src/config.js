// Flyby build configuration.
//
// Leave `clientId` empty for personal/dev use: each person pastes their own
// Google Client ID into the popup (the one-time setup card).
//
// For a PUBLIC release (Chrome Web Store), put YOUR OAuth Client ID here before
// you package. Everyone who installs that build then skips setup entirely and
// just clicks "Sign in with Google".
//
// An OAuth Client ID is not a secret — it is designed to ship inside client
// apps. There is no client secret in this extension.
self.FLYBY_CONFIG = {
  clientId: "",
};
