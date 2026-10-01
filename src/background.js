// Flyby — background service worker (Manifest V3)
//
// Responsibilities:
//   * Hold the Google OAuth token (via chrome.identity.getAuthToken).
//   * Poll Google Calendar once a minute for events starting soon.
//   * When an event crosses one of the configured lead times (e.g. 10 or 5
//     minutes out), fly a little banner-towing airplane across the active tab.
//   * Answer messages from the popup (connect / disconnect / save settings /
//     test flight / manual refresh).

const ALARM_NAME = "flyby-poll";
const POLL_MINUTES = 1;
const CALENDAR_ID = "primary";
const API_BASE = "https://www.googleapis.com/calendar/v3";

const DEFAULT_SETTINGS = {
  enabled: true,
  clientId: "", // Google OAuth Client ID, entered once in the popup
  leadTimes: [10], // minutes before an event to fly the plane; user can pick several
  finalReminder: true, // also fly once more the moment the event starts
  notifyBackup: true, // show a desktop notification when no page can host the plane
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getSettings() {
  const stored = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

async function getLocal(key, fallback) {
  const stored = await chrome.storage.local.get(key);
  return stored[key] === undefined ? fallback : stored[key];
}

async function setLocal(obj) {
  await chrome.storage.local.set(obj);
}

// ---------------------------------------------------------------------------
// Auth — "Sign in with Google" via chrome.identity.launchWebAuthFlow.
//
// The Client ID lives in settings (entered once in the popup), not in the
// manifest, so nobody has to edit files. The extension ID is pinned by the
// manifest "key", so the redirect URI below never changes.
// ---------------------------------------------------------------------------

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function redirectUri() {
  return chrome.identity.getRedirectURL();
}

function buildAuthUrl(clientId, interactive) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "token");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("include_granted_scopes", "true");
  // Silent refreshes must never pop UI; the first sign-in should let the user
  // pick an account.
  u.searchParams.set("prompt", interactive ? "select_account" : "none");
  return u.toString();
}

function launchFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirect) => {
      const err = chrome.runtime.lastError;
      if (err || !redirect) reject(new Error(err ? err.message : "Sign-in was cancelled"));
      else resolve(redirect);
    });
  });
}

// Run the OAuth flow and cache the resulting access token.
async function signIn(interactive) {
  const { clientId } = await getSettings();
  if (!clientId) throw new Error("No Google Client ID set yet");

  const redirect = await launchFlow(buildAuthUrl(clientId, interactive), interactive);
  const params = new URLSearchParams((redirect.split("#")[1] || "").replace(/^\/+/, ""));
  const token = params.get("access_token");
  if (!token) {
    const q = new URLSearchParams(redirect.split("?")[1] || "");
    throw new Error(params.get("error") || q.get("error") || "Google returned no access token");
  }
  const expiresIn = Number(params.get("expires_in") || 3600);
  await setLocal({
    token: { accessToken: token, expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000 },
  });
  return token;
}

// A cached token while it's fresh, otherwise a silent re-auth.
async function getTokenSilently() {
  const tok = await getLocal("token", null);
  if (tok && tok.accessToken && tok.expiresAt > Date.now()) return tok.accessToken;
  return signIn(false);
}

async function fetchAccountEmail(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return null;
    const info = await res.json();
    return info.email || null;
  } catch (_) {
    return null;
  }
}

// Interactive sign-in triggered from the popup.
async function connect() {
  try {
    const token = await signIn(true);
    const email = await fetchAccountEmail(token);
    await setLocal({ connected: true, needsReauth: false, lastError: null, email });
    await ensureAlarm();
    await poll().catch(() => {});
    return { ok: true, ...(await getState()) };
  } catch (e) {
    const msg = String(e.message || e);
    await setLocal({ connected: false, lastError: msg });
    return { ok: false, error: msg };
  }
}

// Forget the token locally and revoke the grant on Google's side.
async function disconnect() {
  try {
    const tok = await getLocal("token", null);
    if (tok && tok.accessToken) {
      try {
        await fetch(
          "https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tok.accessToken),
          { method: "POST" }
        );
      } catch (_) {
        /* offline is fine — we drop the local token either way */
      }
    }
  } finally {
    await setLocal({ connected: false, needsReauth: false, lastError: null, email: null, token: null });
  }
  return { ok: true, ...(await getState()) };
}

// Fetch against the Calendar API, transparently refreshing a stale token once.
async function authedFetch(path, params) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  let token = await getTokenSilently();
  let res = await fetch(url, { headers: { Authorization: "Bearer " + token } });

  if (res.status === 401) {
    // Token expired or was revoked — drop it and silently mint a fresh one.
    await setLocal({ token: null });
    token = await signIn(false);
    res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

// Return timed (non all-day) events between now and now+minutes that the user
// has not declined, soonest first.
async function fetchEvents(minutesAhead, maxResults) {
  const now = Date.now();
  const data = await authedFetch(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    timeMin: new Date(now - 2 * 60000).toISOString(), // small back-window for the "starting now" flyby
    timeMax: new Date(now + minutesAhead * 60000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults || 10),
  });

  const items = (data.items || [])
    .filter((ev) => ev.status !== "cancelled")
    .filter((ev) => ev.start && ev.start.dateTime) // skip all-day events
    .filter((ev) => !isDeclined(ev))
    .map((ev) => {
      const startMs = new Date(ev.start.dateTime).getTime();
      return {
        id: ev.id,
        title: (ev.summary || "(no title)").trim(),
        location: ev.location || "",
        hangoutLink: ev.hangoutLink || "",
        startMs,
        startISO: ev.start.dateTime,
        minutesUntil: (startMs - Date.now()) / 60000,
      };
    })
    .filter((ev) => ev.startMs > Date.now() - 2 * 60000);

  return items;
}

function isDeclined(ev) {
  if (!Array.isArray(ev.attendees)) return false;
  const me = ev.attendees.find((a) => a.self);
  return me && me.responseStatus === "declined";
}

// ---------------------------------------------------------------------------
// Reminder bookkeeping (so each event fires once per lead time)
// ---------------------------------------------------------------------------

function reminderKey(event, lead) {
  return `${event.id}|${event.startISO}|${lead}`;
}

// Drop keys for events that have already started so storage never grows without
// bound.
function pruneReminded(reminded) {
  const now = Date.now();
  const out = {};
  for (const [key, startMs] of Object.entries(reminded)) {
    if (startMs > now - 5 * 60000) out[key] = startMs;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The main poll
// ---------------------------------------------------------------------------

async function poll() {
  const settings = await getSettings();
  const connected = await getLocal("connected", false);
  if (!settings.enabled || !connected) return;

  const leads = (settings.leadTimes || [])
    .map(Number)
    .filter((n) => n > 0);
  const wantFinal = settings.finalReminder !== false;
  if (!leads.length && !wantFinal) return;

  let events;
  try {
    // Look a little past the largest lead time so nothing slips through.
    const horizon = (leads.length ? Math.max(...leads) : 1) + 1;
    events = await fetchEvents(horizon, 15);
    await setLocal({ needsReauth: false, lastError: null });
  } catch (e) {
    const msg = String(e.message || e);
    // A silent token failure means the grant needs a fresh interactive sign-in.
    const authish = /token|OAuth|auth|401|invalid/i.test(msg);
    await setLocal({ needsReauth: authish, lastError: msg });
    return;
  }

  const reminded = pruneReminded(await getLocal("reminded", {}));
  let changed = false;

  for (const event of events) {
    for (const lead of leads) {
      // Heads-up: fire once when the event first falls inside this lead window.
      if (event.minutesUntil > 0 && event.minutesUntil <= lead) {
        const key = reminderKey(event, lead);
        if (!reminded[key]) {
          reminded[key] = event.startMs;
          changed = true;
          await showFlyby({
            title: event.title,
            minutes: Math.max(1, Math.round(event.minutesUntil)),
            location: event.location,
            hangoutLink: event.hangoutLink,
          });
        }
      }
    }

    // Final reminder: one more flyby the moment the event starts.
    if (wantFinal && event.minutesUntil <= 0.5 && event.minutesUntil > -2) {
      const key = reminderKey(event, "final");
      if (!reminded[key]) {
        reminded[key] = event.startMs;
        changed = true;
        await showFlyby({
          title: event.title,
          minutes: 0,
          starting: true,
          location: event.location,
          hangoutLink: event.hangoutLink,
        });
      }
    }
  }

  if (changed) await setLocal({ reminded });
}

// ---------------------------------------------------------------------------
// Flying the plane
// ---------------------------------------------------------------------------

function subtitleFor(data) {
  if (data.starting) return "starting now";
  if (data.minutes <= 1) return "starts in about a minute";
  return `starts in ${data.minutes} minutes`;
}

async function showFlyby(data) {
  const payload = {
    title: data.title,
    minutes: data.minutes,
    starting: !!data.starting,
    subtitle: subtitleFor(data),
    location: data.location || "",
  };

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch (_) {
    /* no window focused */
  }

  const canInject = tab && tab.id != null && /^(https?|file):/i.test(tab.url || "");
  if (canInject) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "FLYBY", payload });
      return "plane";
    } catch (_) {
      /* restricted frame or no receiver — fall back to a notification */
    }
  }

  // The visible tab is a page Chrome won't let any extension draw on
  // (chrome:// pages, the New Tab page, the Web Store, PDFs). Notify instead.
  return (await notifyFallback(payload)) ? "notification" : "none";
}

async function notifyFallback(payload) {
  const settings = await getSettings();
  if (!settings.notifyBackup) return false;
  try {
    chrome.notifications.create(`flyby-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `✈️ ${payload.title}`,
      message: payload.subtitle + (payload.location ? `\n📍 ${payload.location}` : ""),
      priority: 2,
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Fired from the popup's "Test flight" button.
async function testFlyby() {
  return showFlyby({
    title: "Design sync with the team",
    minutes: 10,
    location: "Meet — flyby.test/demo",
  });
}

// ---------------------------------------------------------------------------
// State for the popup
// ---------------------------------------------------------------------------

async function getState() {
  const settings = await getSettings();
  const connected = await getLocal("connected", false);
  const needsReauth = await getLocal("needsReauth", false);
  const lastError = await getLocal("lastError", null);

  let upcoming = [];
  if (connected) {
    try {
      const events = await fetchEvents(12 * 60, 5); // next 12 hours, up to 5
      upcoming = events.slice(0, 5).map((e) => ({
        title: e.title,
        startISO: e.startISO,
        minutesUntil: Math.round(e.minutesUntil),
      }));
      await setLocal({ needsReauth: false });
    } catch (e) {
      const msg = String(e.message || e);
      if (/token|OAuth|auth|401|invalid/i.test(msg)) {
        await setLocal({ needsReauth: true });
      }
    }
  }

  return {
    connected,
    needsReauth: await getLocal("needsReauth", needsReauth),
    email: await getLocal("email", null),
    hasClientId: !!(settings.clientId || "").trim(),
    redirectUri: redirectUri(),
    extensionId: chrome.runtime.id,
    settings,
    upcoming,
    lastError,
  };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: POLL_MINUTES,
      delayInMinutes: 0,
    });
  }
}

// Guarantee the poll alarm exists whenever the service worker starts, in
// addition to onInstalled/onStartup — belt and suspenders so reminders never
// silently stop if a lifecycle event is missed.
ensureAlarm().catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await setSettings({}); // materialize defaults
  await ensureAlarm();
  await poll().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await poll().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) poll().catch((e) => console.warn("Flyby poll failed", e));
});

// Clicking a fallback notification opens Google Calendar.
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("flyby-")) chrome.tabs.create({ url: "https://calendar.google.com" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.action) {
        case "getState":
          sendResponse(await getState());
          break;
        case "connect":
          sendResponse(await connect());
          break;
        case "disconnect":
          sendResponse(await disconnect());
          break;
        case "saveSettings": {
          const settings = await setSettings(msg.settings || {});
          await ensureAlarm();
          if (settings.enabled) await poll().catch(() => {});
          sendResponse({ ok: true, settings });
          break;
        }
        case "test": {
          const shown = await testFlyby();
          sendResponse({ ok: shown !== "none", shown });
          break;
        }
        case "refresh":
          await poll().catch(() => {});
          sendResponse(await getState());
          break;
        default:
          sendResponse({ error: "unknown action" });
      }
    } catch (e) {
      sendResponse({ error: String(e.message || e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
