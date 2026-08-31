# Flyby — Install & Start Using (easy guide)

Flyby is a Chrome extension. **There is no server and nothing to deploy** — it
runs entirely inside your browser. Getting started is two parts:

- **A. Load Flyby into Chrome** — 2 minutes.
- **B. Connect your Google Calendar** — about 5 minutes, one time.

You can do part A and immediately watch a test plane, then do part B whenever
you're ready.

---

## A. Load Flyby into Chrome

1. **Unzip** this folder somewhere you'll keep it (don't delete it later —
   Chrome loads the extension from this folder).
2. Open Chrome and go to **`chrome://extensions`**.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and choose the unzipped **`flyby`** folder.
5. The Flyby ✈️ icon appears in your toolbar. Pin it if you like.

### See it work right now (no Google account needed)

Click the Flyby icon → **✈️ Send a test flight**. A little airliner flies across
your current tab towing a banner. That confirms Flyby is installed and working.

---

## B. Connect your Google Calendar (one time)

This gives Flyby permission to **read** your calendar so it knows when your
meetings are. The friendliest way is the built-in guide:

> Click the Flyby icon → **Open the step-by-step guide**
> (or open the file `src/setup.html` from this folder in your browser).

**Short version:**

1. Copy your **extension ID** (the Flyby popup shows it, or find it on
   `chrome://extensions`).
2. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create a
   project (any name).
3. **APIs & Services → Library** → enable **Google Calendar API**.
4. **APIs & Services → OAuth consent screen** → choose **External**, add your
   email, and add yourself under **Test users**.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   type **Chrome Extension** → paste your extension ID.
6. Copy the **Client ID** and paste it into **`manifest.json`** (the `client_id`
   line), then click **reload** ↻ on Flyby at `chrome://extensions`.
7. Click the Flyby icon → **Connect Google Calendar** → approve.

Done! Flyby now flies a banner across your screen a few minutes before each
meeting.

---

## Do I need to deploy or pay anything?

- **No deployment.** No website, server, or hosting — it's a browser extension.
- **No cost.** A personal Google Cloud project and the Calendar API are free.
- **Private.** Your calendar data stays in your browser. Flyby has no backend and
  sends nothing to anyone except Google's own Calendar API (read-only).

## Everyday use

Open the Flyby popup to:

- Choose when the plane flies: **1 / 5 / 10 / 15 / 30 minutes** before an event.
- Turn reminders **on/off** with the header switch.
- Keep a **desktop-notification backup** for pages where the plane can't draw
  (like `chrome://` tabs).
- **Disconnect** anytime to revoke access.

Enjoy your flights! ✈️
