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
  const leads = new Set((settings.leadTimes || []).map(Number));
  document.querySelectorAll("#leadChips input").forEach((el) => {
    el.checked = leads.has(Number(el.value));
  });
  $("leadHint").classList.toggle("hidden", leads.size > 0);
}

function whenLabel(minutesUntil, startISO) {
  if (minutesUntil <= 0) return "now";
  if (minutesUntil < 60) return `in ${minutesUntil} min`;
  try {
    return new Date(startISO).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (_) {
    return `in ${minutesUntil} min`;
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
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "ev__title";
    title.textContent = ev.title;
    const when = document.createElement("span");
    when.className = "ev__when";
    when.textContent = whenLabel(ev.minutesUntil, ev.startISO);
    li.append(title, when);
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

  document.querySelectorAll("#leadChips input").forEach((el) => {
    el.addEventListener("change", async () => {
      const leads = currentLeads();
      $("leadHint").classList.toggle("hidden", leads.length > 0);
      await saveSettings({ leadTimes: leads });
    });
  });

  $("testBtn").addEventListener("click", async () => {
    const btn = $("testBtn");
    busy(btn, true, "Launching…");
    const resp = await send("test");
    busy(btn, false);
    const note = $("footnote");
    note.classList.remove("err");
    if (resp && resp.ok) {
      note.textContent = "Look at your page — here it comes!";
    } else {
      note.textContent = "Couldn't draw on this page. Try a regular website tab.";
      note.classList.add("err");
    }
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

document.addEventListener("DOMContentLoaded", async () => {
  wire();
  setupOnboarding();
  render(await send("getState"));
});
