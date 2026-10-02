# Deploying Flyby to production — step by step

Plain-language guide to taking Flyby from "works on my machine" to something
other people can install.

---

## First: do you actually need all of this?

There are three levels. **Pick the smallest one that fits** — most people don't
need the full path.

| Who will use it | What you need | Effort |
| --- | --- | --- |
| **Just you** (or a few friends you send the zip to) | Nothing more. Load unpacked, keep your Google project in "Testing" mode and add each person as a Test user (up to 100). | ✅ Already done |
| **Your company / team** | Publish the extension **Unlisted** (link-only) and keep OAuth internal to your Google Workspace. No public review of your calendar access. | ~1 hour |
| **Anyone on the internet** | Chrome Web Store listing **plus** Google OAuth verification (because reading calendars is a "sensitive" permission). | Days → weeks |

> **Important:** the slow part is never the extension — it's **Google verifying
> your calendar access**. The Chrome Web Store review is usually a few days; OAuth
> verification for a sensitive scope can take weeks. Plan around that.

---

## Step 1 — Put your Client ID into the build

Right now each person pastes their own Client ID. For a real release *you* supply
one, so your users just click **Sign in with Google**.

1. Open `src/config.js`.
2. Paste your Client ID:

```js
self.FLYBY_CONFIG = {
  clientId: "YOUR-ID.apps.googleusercontent.com",
};
```

3. Rebuild:

```bash
python3 tools/build_zip.py
```

That's it — the one-time setup card disappears for everyone who installs this
build.

> A Client ID is **not** a secret. It's meant to ship inside apps. Flyby has no
> client secret at all.

---

## Step 2 — Make your Google project production-ready

In the [Google Cloud Console](https://console.cloud.google.com/), open
**APIs & Services → OAuth consent screen** and fill in the real details:

- App name (what users see on the consent screen) and your logo
- Support email and developer contact email
- **Application home page** and **Privacy policy URL** (see Step 3)
- Confirm the scope: `.../auth/calendar.events.readonly`

Then change the publishing status from **Testing** to **In production**.

Google will tell you that your scope is **sensitive** and ask you to submit for
**verification**. They typically want:

- A link to your privacy policy
- A short **demo video** showing the sign-in and what you do with the data
- A written justification ("we read upcoming events only, to show a reminder")

Submit it and carry on with the other steps while you wait.

---

## Step 3 — Publish a privacy policy

Both the Web Store and OAuth verification require a **public URL**.

Use the `PRIVACY.md` in this repo as your starting point, then host it somewhere
public. The easiest free option:

1. Push this repo to GitHub.
2. **Settings → Pages → Deploy from branch** → pick your branch, root.
3. Your policy is at `https://<you>.github.io/Flyby/PRIVACY` (or link directly to
   the file on GitHub — that works too).

Paste that URL into the consent screen and the store listing.

---

## Step 4 — Become a Chrome Web Store developer

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in and pay the **one-time $5 registration fee**.
3. Verify your contact email.

---

## Step 5 — Create the listing

Click **Add new item** and upload `flyby-1.0.0.zip`.

You'll be asked for:

| Field | What to use |
| --- | --- |
| Name | Flyby — Calendar Airplane Reminders |
| Short description | Comes from `manifest.json` |
| Detailed description | Borrow from `README.md` |
| Category | Productivity |
| Icon | `icons/icon128.png` |
| Screenshots (1280×800) | `docs/store/screenshot-1-flight.png`, `docs/store/screenshot-2-popup.png` |
| Privacy policy URL | From Step 3 |

**Privacy practices tab** — be straightforward, it speeds up review:

- Declare you handle **"Web history"? No. "Personal communications"? No.**
  You read **calendar event data**.
- Justify each permission:
  - `identity` — to sign the user in with Google
  - `storage` — to save settings and remember which reminders already fired
  - `alarms` — to check the calendar once a minute
  - `scripting` + host access — to draw the reminder on the page you're viewing
  - `notifications` — fallback when the page can't show the plane
- Confirm you **don't sell or transfer** the data (Flyby has no server).

---

## Step 6 — Submit and wait

Hit **Submit for review**. Typical wait is a few days. You'll get an email if
they want changes.

---

## Step 7 — ⚠️ After publishing, check the extension ID

This is the one step people miss and it breaks sign-in.

Your OAuth redirect URI is tied to the extension's ID:

```
https://<EXTENSION-ID>.chromiumapp.org/
```

Once the item is live, copy the **Item ID** from the developer dashboard and
confirm it matches the redirect URI you registered in Google Cloud. If it
differs:

1. Google Cloud → **Credentials** → your OAuth client.
2. Add `https://<the-store-id>.chromiumapp.org/` under **Authorized redirect URIs**.
3. Save. (Keep the old one too while you test.)

Then install from the store and do a real sign-in to confirm.

---

## Step 8 — Shipping updates later

1. Bump `"version"` in `manifest.json` (e.g. `1.0.1`).
2. `python3 tools/build_zip.py`
3. Upload the new zip in the dashboard → submit.

Chrome auto-updates installed copies within a few hours.

---

## Costs

| Item | Cost |
| --- | --- |
| Chrome Web Store developer account | **$5 once** |
| Google Cloud project + Calendar API | **Free** at this usage |
| Hosting | **None** — there is no server |

---

## Troubleshooting

**"Error 400: redirect_uri_mismatch"** → the redirect URI in Google Cloud doesn't
match the extension's ID. See Step 7.

**"This app is blocked" / "unverified"** → your consent screen is still in
Testing, or verification isn't finished. Add the person as a **Test user** to
unblock them in the meantime.

**Reminders stop after an hour** → the sign-in expired and silent refresh
failed; open the popup and sign in again. (Normally Flyby refreshes on its own.)

**No plane, only a notification** → you were on a `chrome://` page, the New Tab
page, the Web Store or a PDF. Chrome forbids every extension from drawing there.
