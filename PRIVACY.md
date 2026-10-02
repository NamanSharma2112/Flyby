# Privacy Policy — Flyby

_Last updated: 2 October 2026_

Flyby is a browser extension that shows a reminder before your calendar events.
This policy explains exactly what it touches.

## The short version

Flyby runs entirely inside your browser. **There is no Flyby server**, no
account with us, and no analytics. Your calendar data is never sent anywhere
except between your own browser and Google's own API.

## What Flyby accesses

When you sign in with Google, Flyby requests two read-only permissions:

| Permission | Why |
| --- | --- |
| `calendar.events.readonly` | To read the **start time and title** of your upcoming events, so it knows when to show a reminder. |
| `userinfo.email` | To display which account you're signed in as, so you can confirm it's the right one. |

Flyby **cannot** create, edit or delete anything in your calendar — the access
is read-only.

## What Flyby stores, and where

Everything is stored locally by your browser:

- **Your settings** (reminder times, toggles, your Client ID) — in Chrome's
  extension storage, which may sync across your own Chrome profiles.
- **Your sign-in token** — stored locally and refreshed as needed.
- **Which reminders already fired** — so the same event doesn't remind you twice.
  Entries are discarded shortly after the event starts.
- **Your email address** — only to show it in the popup.

Event titles are held in memory just long enough to draw the reminder, and are
shown only on your own screen.

## What Flyby does NOT do

- ❌ No data is sent to any server operated by us — **we don't operate one**.
- ❌ No analytics, tracking, advertising or profiling.
- ❌ Your data is never sold, rented or shared with third parties.
- ❌ No reading of the web pages you visit. Flyby only *draws* its reminder on
  the page you're currently viewing; it does not read page content.

## Why Flyby asks for access to websites

To draw the little airplane on whatever page you're looking at, Chrome requires
permission to inject into pages. Flyby uses this **only** to display its own
reminder overlay, and only at the moment a reminder fires.

## Removing your data

- **Sign out** in the popup — this revokes Flyby's access with Google and
  deletes the stored token and email.
- **Uninstall the extension** — this removes all remaining local settings.
- You can also revoke access any time at
  [Google Account → Third-party access](https://myaccount.google.com/connections).

## Children

Flyby is not directed at children under 13.

## Changes

If this policy changes, the date at the top will be updated.

## Contact

Questions about this policy: open an issue on the project's GitHub repository.
