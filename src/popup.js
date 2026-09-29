// Flyby — popup controller. Talks to the background service worker.

const $ = (id) => document.getElementById(id);

function send(action, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...(extra || {}) }, (resp) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(resp || {});
    });
  });
}

// ---- rendering -------------------------------------------------------------

function renderConnection(state) {
  const dot = $("connDot");
  const title = $("connTitle");
  const sub = $("connSub");
  const connectBtn = $("connectBtn");
  const disconnectBtn = $("disconnectBtn");

  dot.className = "dot";
  if (!state.connected) {
    dot.classList.add("dot--off");
    title.textContent = "Not connected";
    sub.textContent = "Connect your Google Calendar to get started.";
    connectBtn.textContent = "Connect Google Calendar";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  } else if (state.needsReauth) {
    dot.classList.add("dot--warn");
    title.textContent = "Reconnect needed";
    sub.textContent = "Your Google sign-in expired.";
    connectBtn.textContent = "Reconnect";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.remove("hidden");
  } else {
    dot.classList.add("dot--on");
    title.textContent = "Connected";
    sub.textContent = "Watching your primary calendar.";
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
  }
}

function renderSettings(settings) {
  $("enabled").checked = !!settings.enabled;
  $("notifyBackup").checked = !!settings.notifyBackup;
  $("finalReminder").checked = settings.finalReminder !== false;
  const leads = new Set((settings.leadTimes || []).map(Number));
  document.querySelectorAll("#leadChips input").forEach((el) => {
    el.checked = leads.has(Number(el.value));
  });
  updateLeadHint();
}

// The heads-up chips are optional as long as the final reminder is on; keep the
// hint informative rather than an error.
function updateLeadHint() {
  const leads = currentLeads();
  const finalOn = $("finalReminder").checked;
  const hint = $("leadHint");
  if (leads.length > 0) {
    hint.classList.add("hidden");
  } else if (finalOn) {
    hint.textContent = "No heads-up — only the final reminder will fly.";
    hint.classList.remove("hidden");
  } else {
    hint.textContent = "Pick a heads-up time, or turn on the final reminder.";
    hint.classList.remove("hidden");
  }
}

// Relative countdown that complements the clock time on the stub.
function relLabel(minutesUntil) {
  if (minutesUntil <= 0) return "now";
  if (minutesUntil < 60) return `in ${minutesUntil} min`;
  const h = Math.floor(minutesUntil / 60);
  const m = minutesUntil % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

// Split a start time into "5:06" + "PM" for the boarding-pass stub.
function clockParts(startISO) {
  try {
    const s = new Date(startISO).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const m = s.match(/^\s*(.+?)\s*([AP]\.?M\.?)?\s*$/i);
    return { time: (m && m[1]) || s, mer: ((m && m[2]) || "").replace(/\./g, "").toUpperCase() };
  } catch (_) {
    return { time: "--:--", mer: "" };
  }
}

function renderUpcoming(upcoming) {
  const list = $("events");
  const empty = $("eventsEmpty");
  list.innerHTML = "";
  if (!upcoming || !upcoming.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const ev of upcoming) {
    const { time, mer } = clockParts(ev.startISO);

    const li = document.createElement("li");
    li.className = "tkt";

    const stub = document.createElement("div");
    stub.className = "tkt__stub";
    const t = document.createElement("div");
    t.className = "tkt__time";
    t.textContent = time;
    stub.appendChild(t);
    if (mer) {
      const m = document.createElement("div");
      m.className = "tkt__mer";
      m.textContent = mer;
      stub.appendChild(m);
    }

    const perf = document.createElement("div");
    perf.className = "tkt__perf";

    const body = document.createElement("div");
    body.className = "tkt__body";
    const title = document.createElement("div");
    title.className = "ev__title";
    title.textContent = ev.title;
    const meta = document.createElement("div");
    meta.className = "tkt__meta";
    meta.textContent = relLabel(ev.minutesUntil);
    body.append(title, meta);

    li.append(stub, perf, body);
    list.appendChild(li);
  }
}

function renderFootnote(state) {
  const el = $("footnote");
  el.classList.remove("err");
  if (state.error) {
    el.textContent = state.error;
    el.classList.add("err");
  } else if (state.lastError && state.connected && !state.needsReauth) {
    el.textContent = state.lastError;
    el.classList.add("err");
  } else {
    el.textContent = "";
  }
}

function render(state) {
  if (!state || state.error) {
    $("footnote").textContent = (state && state.error) || "Something went wrong.";
    $("footnote").classList.add("err");
    return;
  }
  renderConnection(state);
  renderSettings(state.settings || {});
  renderUpcoming(state.upcoming || []);
  renderFootnote(state);
}

// ---- actions ---------------------------------------------------------------

function currentLeads() {
  return [...document.querySelectorAll("#leadChips input:checked")].map((el) => Number(el.value));
}

async function saveSettings(patch) {
  const resp = await send("saveSettings", { settings: patch });
  return resp;
}

function busy(btn, on, labelWhileBusy) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = labelWhileBusy || "Working…";
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
  }
}

function wire() {
  $("connectBtn").addEventListener("click", async () => {
    const btn = $("connectBtn");
    busy(btn, true, "Connecting…");
    const resp = await send("connect");
    busy(btn, false);
    if (resp && resp.ok) render(resp);
    else {
      const state = await send("getState");
      render({ ...state, error: (resp && resp.error) || "Could not connect." });
    }
  });

  $("disconnectBtn").addEventListener("click", async () => {
    const resp = await send("disconnect");
    render(resp);
  });

  $("enabled").addEventListener("change", async (e) => {
    const resp = await saveSettings({ enabled: e.target.checked });
    if (resp && resp.settings) renderSettings(resp.settings);
  });

  $("notifyBackup").addEventListener("change", async (e) => {
    await saveSettings({ notifyBackup: e.target.checked });
  });

  $("finalReminder").addEventListener("change", async (e) => {
    updateLeadHint();
    await saveSettings({ finalReminder: e.target.checked });
  });

  document.querySelectorAll("#leadChips input").forEach((el) => {
    el.addEventListener("change", async () => {
      updateLeadHint();
      await saveSettings({ leadTimes: currentLeads() });
    });
  });

  $("testBtn").addEventListener("click", async () => {
    const btn = $("testBtn");
    busy(btn, true, "Launching…");
    const resp = await send("test");
    busy(btn, false);
    const note = $("footnote");
    note.classList.remove("err");
    const shown = resp && resp.shown;
    if (shown === "plane") {
      note.textContent = "✈️ Look at your page — here it comes!";
    } else if (shown === "notification") {
      note.textContent =
        "This browser page can't show the plane — I sent a notification. Open a normal website tab to see it fly.";
      note.classList.add("err");
    } else {
      note.textContent = "Couldn't show it here. Open a normal website tab and try again.";
      note.classList.add("err");
    }
    checkActiveTab();
  });
}

// ---- boot ------------------------------------------------------------------

function setupOnboarding() {
  const manifest = chrome.runtime.getManifest();
  const cid = (manifest.oauth2 && manifest.oauth2.client_id) || "";
  const needsSetup = !cid || /^REPLACE_WITH/i.test(cid);

  $("setupCard").classList.toggle("hidden", !needsSetup);
  $("connCard").classList.toggle("hidden", needsSetup);
  if (needsSetup) $("extId").textContent = chrome.runtime.id;

  $("copyId").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(chrome.runtime.id);
      const b = $("copyId");
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    } catch (_) {}
  });
  $("guideBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/setup.html") });
  });
}

// Warn if the currently visible tab is a page Chrome won't let us draw on, so
// the user knows why a test flight (or reminder) would only show a notification.
async function checkActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = (tabs && tabs[0] && tabs[0].url) || "";
    const injectable = /^(https?|file):/i.test(url);
    $("tabHint").classList.toggle("hidden", injectable);
  } catch (_) {
    /* tabs unavailable — leave the hint hidden */
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  wire();
  setupOnboarding();
  checkActiveTab();
  render(await send("getState"));
});
