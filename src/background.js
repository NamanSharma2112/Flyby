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
  leadTimes: [10], // minutes before an event to fly the plane; user can pick several
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
// Auth
// ---------------------------------------------------------------------------

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) {
        reject(new Error(err ? err.message : "No token returned"));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    if (!token) return resolve();
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

// Interactive sign-in triggered from the popup.
async function connect() {
  try {
    const token = await getAuthToken(true);
    await setLocal({ connected: true, needsReauth: false, lastError: null });
    // Prime the pump so the user sees state right away.
    await poll().catch(() => {});
    await ensureAlarm();
    return { ok: true, ...(await getState(token)) };
  } catch (e) {
    await setLocal({ connected: false, lastError: String(e.message || e) });
    return { ok: false, error: String(e.message || e) };
  }
}

// Fully revoke the cached token and forget it locally.
async function disconnect() {
  try {
    const token = await getAuthToken(false).catch(() => null);
    if (token) {
      await removeCachedToken(token);
      // Best-effort revoke so the grant is dropped on Google's side too.
      try {
        await fetch(
          "https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(token),
          { method: "POST" }
        );
      } catch (_) {
        /* offline is fine — the cached token is already gone */
      }
    }
  } finally {
    await setLocal({ connected: false, needsReauth: false, lastError: null });
  }
  return { ok: true, ...(await getState()) };
}

// Return a usable token or throw. On a 401 the caller clears the cached token
// and retries once via `authedFetch`.
async function getTokenSilently() {
  return getAuthToken(false);
}

// Fetch against the Calendar API, transparently refreshing a stale token once.
async function authedFetch(path, params) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  let token = await getTokenSilently();
  let res = await fetch(url, { headers: { Authorization: "Bearer " + token } });

  if (res.status === 401) {
    // Token expired/revoked in Chrome's cache — drop it and mint a fresh one.
    await removeCachedToken(token);
    token = await getTokenSilently();
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
    timeMin: new Date(now).toISOString(),
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
    .filter((ev) => ev.startMs > Date.now());

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

  const leads = (settings.leadTimes && settings.leadTimes.length ? settings.leadTimes : [10])
    .map(Number)
    .filter((n) => n > 0);
  if (!leads.length) return;

  let events;
  try {
    // Look a little past the largest lead time so nothing slips through.
    events = await fetchEvents(Math.max(...leads) + 1, 15);
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
      // Fire once when the event first falls inside this lead window.
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
  }

  if (changed) await setLocal({ reminded });
}

// ---------------------------------------------------------------------------
// Flying the plane
// ---------------------------------------------------------------------------

function subtitleFor(data) {
  if (data.minutes <= 1) return "starts in about a minute";
  return `starts in ${data.minutes} minutes`;
}

async function showFlyby(data) {
  const payload = {
    title: data.title,
    minutes: data.minutes,
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
      return true;
    } catch (_) {
      /* restricted frame or no receiver — fall back to a notification */
    }
  }

  return notifyFallback(payload);
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
        case "test":
          sendResponse({ ok: await testFlyby() });
          break;
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
