// Flyby — content script.
//
// Injected on demand into the active tab. On a { type: "FLYBY" } message it
// flies a realistic little airliner across the screen towing a fabric banner
// that shows the reminder. The banner ripples as a traveling wave (more whip
// toward the free end), sags under gravity, and is coupled to the plane's
// gentle bob + pitch — a lightweight physics loop rather than a canned CSS
// animation. Everything lives inside a Shadow DOM so page CSS can't touch it
// and it can't touch the page.

(() => {
  if (window.__flybyReady) return;
  window.__flybyReady = true;

  const LANES = [12, 24, 6, 30]; // vh offsets so stacked planes don't overlap
  let laneIndex = 0;

  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- geometry (SVG user units; viewBox 0 0 880 220) -----------------------
  const VB_W = 880, VB_H = 220;
  const CENTER_Y = 108;
  const X_FREE = 26;     // banner free (left, flutters most) end
  const X_ATTACH = 508;  // banner attached (right, near plane) end
  const HALF_H = 31;     // banner half-height
  const AMP = 22;        // max flutter amplitude (at the free end)
  const K = (2 * Math.PI) / 285; // spatial wavenumber (~1.7 waves across)
  const OMEGA = 4.4;     // temporal frequency (rad/s)
  const NOTCH = 24;      // swallow-tail depth at the free end
  const FLIGHT_S = 12;   // seconds to cross the screen

  const SAMPLES = 40;
  const XS = Array.from({ length: SAMPLES + 1 }, (_, i) => X_FREE + ((X_ATTACH - X_FREE) * i) / SAMPLES);

  // Vertical position of the banner centerline at position x and time t.
  function baseline(x, t, planeBobY) {
    const u = Math.min(1, Math.max(0, (X_ATTACH - x) / (X_ATTACH - X_FREE))); // 0 attached → 1 free
    const couple = planeBobY * (1 - 0.55 * u);          // attached end tracks the plane
    const sag = 13 * u * u;                             // gravity droop toward the free end
    const flutter =
      AMP * Math.pow(u, 1.25) * Math.sin(K * (x - X_FREE) - OMEGA * t) +
      AMP * 0.34 * Math.pow(u, 1.7) * Math.sin(2 * K * (x - X_FREE) - 1.7 * OMEGA * t + 1);
    const sway = 5 * u * Math.sin(0.5 * OMEGA * t + 0.4);
    return CENTER_Y + couple + sag + flutter + sway;
  }

  function halfHeight(x) {
    const u = (X_ATTACH - x) / (X_ATTACH - X_FREE);
    return HALF_H * (1 - 0.12 * u); // slightly narrower toward the free tip
  }

  // Build the ribbon outline + the (hidden) centerline the text rides on.
  function buildPaths(t, planeBobY) {
    const base = XS.map((x) => baseline(x, t, planeBobY));
    const hh = XS.map((x) => halfHeight(x));

    let d = `M ${XS[0].toFixed(1)} ${(base[0] - hh[0]).toFixed(1)}`;
    for (let i = 1; i <= SAMPLES; i++) d += ` L ${XS[i].toFixed(1)} ${(base[i] - hh[i]).toFixed(1)}`;
    d += ` L ${XS[SAMPLES].toFixed(1)} ${(base[SAMPLES] + hh[SAMPLES]).toFixed(1)}`;
    for (let i = SAMPLES - 1; i >= 0; i--) d += ` L ${XS[i].toFixed(1)} ${(base[i] + hh[i]).toFixed(1)}`;
    d += ` L ${(X_FREE + NOTCH).toFixed(1)} ${base[0].toFixed(1)} Z`; // swallow-tail notch

    // Centerline for the text, inset from both ends.
    let c = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const x = XS[i];
      if (x < X_FREE + 34 || x > X_ATTACH - 16) continue;
      c += (c ? " L" : "M") + ` ${x.toFixed(1)} ${(base[i] + 1).toFixed(1)}`;
    }

    // Attachment corners (for the tow lines).
    const attTop = [X_ATTACH, base[SAMPLES] - hh[SAMPLES]];
    const attBot = [X_ATTACH, base[SAMPLES] + hh[SAMPLES]];
    return { d, c, attTop, attBot };
  }

  const PLANE = `
    <g id="fb-plane">
      <!-- far wing (behind the fuselage) -->
      <path d="M 762,106 L 702,150 L 722,151 L 782,109 Z" fill="#c2cfe0"/>
      <!-- horizontal stabilizer -->
      <path d="M 626,101 L 585,92 L 584,99 L 626,108 Z" fill="#ccd7e5"/>
      <!-- vertical tail fin (blue livery) -->
      <path d="M 634,90 L 588,50 L 612,52 L 656,90 Z" fill="url(#fb-tail)"/>
      <path d="M 634,90 L 606,60 L 612,61 L 650,90 Z" fill="#ffffff" opacity=".15"/>
      <!-- fuselage -->
      <path d="M 618,86
               C 678,81 748,81 806,86
               C 836,88 852,95 852,105
               C 852,114 836,120 806,122
               C 748,127 678,127 622,122
               L 606,114 C 600,110 600,100 606,95 Z"
            fill="url(#fb-fus)" stroke="#bcc7d6" stroke-width=".7"/>
      <!-- top highlight + belly shade for volume -->
      <path d="M 648,87 C 710,83 776,83 824,88 C 776,85.5 710,85.5 648,87 Z" fill="#ffffff" opacity=".5"/>
      <path d="M 626,120 C 704,124.5 782,124 836,118 C 786,122 704,123 626,120 Z" fill="#adbbcd" opacity=".55"/>
      <!-- blue cheatline -->
      <path d="M 628,103.5 C 704,106.5 788,106.5 838,102.5" fill="none" stroke="url(#fb-tail)" stroke-width="2.6" stroke-linecap="round" opacity=".92"/>
      <!-- passenger windows -->
      <line x1="666" y1="98" x2="814" y2="98" stroke="#53667e" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="2 6.2"/>
      <!-- cockpit windscreen -->
      <path d="M 824,94.5 C 835,95.5 843,98.5 847,103 L 836,103.5 C 833,99.5 830,97.5 823,96.5 Z" fill="#41516a"/>
      <!-- near wing (foreground) + winglet -->
      <path d="M 786,118 L 668,149 L 690,152 L 790,122 Z" fill="url(#fb-wing)" stroke="#a8b6c8" stroke-width=".6"/>
      <path d="M 670,149 L 661,137 L 671,141 Z" fill="#aebccd"/>
      <!-- pylon + engine slung under the wing -->
      <path d="M 728,117 L 744,117 L 740,128 L 725,128 Z" fill="#a6b4c5"/>
      <path d="M 700,128 C 700,124 705,122 714,122 L 750,122 C 757,122 762,125 762,129
               L 762,139 C 762,143 757,146 750,146 L 714,146 C 705,146 700,144 700,140 Z"
            fill="url(#fb-metal)" stroke="#a4b3c4" stroke-width=".6"/>
      <ellipse cx="760" cy="134" rx="4.2" ry="10.6" fill="#7890a9"/>
      <ellipse cx="760" cy="134" rx="2" ry="6.6" fill="#4d617a"/>
      <path d="M 700,128 L 695,131 L 695,137 L 700,140 Z" fill="#93a3b8"/>
    </g>`;

  const SVG = `
    <svg id="fb-svg" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg"
         xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <linearGradient id="fb-fus" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef2f7"/><stop offset="1" stop-color="#ccd5e1"/>
        </linearGradient>
        <linearGradient id="fb-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#eef2f7"/><stop offset="1" stop-color="#bdc8d7"/>
        </linearGradient>
        <linearGradient id="fb-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e6ebf2"/><stop offset="1" stop-color="#b1bfd0"/>
        </linearGradient>
        <linearGradient id="fb-tail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4a90ff"/><stop offset="1" stop-color="#1b58c6"/>
        </linearGradient>
        <linearGradient id="fb-ban" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9edf3"/>
        </linearGradient>
        <filter id="fb-sh" x="-10%" y="-30%" width="120%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#0d2a52" flood-opacity=".22"/>
        </filter>
        <path id="fb-center" d=""/>
      </defs>
      <g filter="url(#fb-sh)">
        <path id="fb-banner" d="" fill="url(#fb-ban)" stroke="#d3dbe6" stroke-width="1"/>
        <line id="fb-tow1" stroke="#8f9fb4" stroke-width="1.1"/>
        <line id="fb-tow2" stroke="#8f9fb4" stroke-width="1.1"/>
        ${PLANE}
      </g>
      <text id="fb-text" fill="#e0322c" font-family="'Arial Narrow', Arial, Helvetica, sans-serif"
            font-weight="700" letter-spacing=".4">
        <textPath id="fb-textpath" href="#fb-center" xlink:href="#fb-center" startOffset="0"><tspan id="fb-ttl"></tspan><tspan id="fb-tm" font-size="72%" fill="#b23b34"></tspan></textPath>
      </text>
    </svg>`;

  const STYLE = `
    :host { all: initial; }
    .lane { position: fixed; left: 0; width: 100%; pointer-events: none; }
    .cross {
      position: absolute; left: 0; width: 640px; max-width: 82vw;
      animation: fb-cross ${FLIGHT_S}s linear forwards; will-change: transform;
    }
    #fb-svg { display: block; width: 100%; height: auto; overflow: visible; }
    @keyframes fb-cross {
      from { transform: translateX(calc(-100% - 90px)); }
      to   { transform: translateX(calc(100vw + 90px)); }
    }
    @keyframes fb-fade {
      0% { opacity: 0; transform: translateY(-10px); }
      12% { opacity: 1; transform: translateY(0); }
      86% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-6px); }
    }
    :host(.reduced) .lane { display: flex; justify-content: center; }
    :host(.reduced) .cross { position: static; animation: fb-fade 6s ease forwards; }
  `;

  function fitText(textEl, centerLen) {
    // Choose a size that fills the banner, then compress only if still too long.
    const n = Math.max(1, (textEl.textContent || "").length);
    let size = Math.round((1.55 * centerLen) / n);
    size = Math.max(15, Math.min(40, size));
    textEl.setAttribute("font-size", size);
    const drawn = textEl.getComputedTextLength();
    const tp = textEl.firstElementChild;
    if (drawn > centerLen) {
      textEl.setAttribute("textLength", centerLen);
      textEl.setAttribute("lengthAdjust", "spacingAndGlyphs");
      tp.setAttribute("startOffset", "0");
    } else {
      textEl.removeAttribute("textLength");
      tp.setAttribute("startOffset", Math.max(0, (centerLen - drawn) / 2).toFixed(1));
    }
  }

  function render(payload) {
    let title = String(payload && payload.title ? payload.title : "Upcoming event").trim();
    if (title.length > 44) title = title.slice(0, 43).trimEnd() + "…";

    // Short "when" tag appended after the title, so the banner carries the whole
    // reminder ("Design sync with the team · in 10 min").
    let timeText = "";
    const mins = payload && payload.minutes;
    if (typeof mins === "number" && isFinite(mins)) {
      timeText = mins <= 1 ? "now" : `in ${Math.round(mins)} min`;
    } else if (payload && payload.subtitle) {
      const m = String(payload.subtitle).match(/(\d+)/);
      timeText = m ? `in ${m[1]} min` : "";
    }

    const host = document.createElement("div");
    host.setAttribute("data-flyby", "");
    host.style.cssText = [
      "all: initial", "position: fixed", "top: 0", "left: 0",
      "width: 100vw", "height: 100vh", "margin: 0", "border: 0", "padding: 0",
      "background: transparent", "pointer-events: none", "z-index: 2147483647",
    ].map((r) => r + " !important").join(";");
    if (prefersReduced) host.classList.add("reduced");

    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;

    const lane = document.createElement("div");
    lane.className = "lane";
    lane.style.top = LANES[laneIndex % LANES.length] + "vh";
    laneIndex += 1;

    const cross = document.createElement("div");
    cross.className = "cross";
    cross.innerHTML = SVG;

    root.append(style, lane);
    lane.append(cross);
    (document.body || document.documentElement).appendChild(host);

    const svg = root.getElementById("fb-svg");
    const banner = root.getElementById("fb-banner");
    const center = root.getElementById("fb-center");
    const tow1 = root.getElementById("fb-tow1");
    const tow2 = root.getElementById("fb-tow2");
    const plane = root.getElementById("fb-plane");
    const textEl = root.getElementById("fb-text");
    root.getElementById("fb-ttl").textContent = title;
    root.getElementById("fb-tm").textContent = timeText ? "   ·   " + timeText : "";

    const centerLen = X_ATTACH - 16 - (X_FREE + 34);

    const frame = (t) => {
      const bob = 4 * Math.sin(1.15 * t + 0.3);
      const pitch = 1.5 * Math.sin(1.15 * t + 0.9);
      const p = buildPaths(t, bob);
      banner.setAttribute("d", p.d);
      center.setAttribute("d", p.c);
      plane.setAttribute("transform", `translate(0 ${bob.toFixed(2)}) rotate(${pitch.toFixed(2)} 728 110)`);
      const tTop = [606, 96 + bob], tBot = [610, 113 + bob];
      tow1.setAttribute("x1", p.attTop[0]); tow1.setAttribute("y1", p.attTop[1].toFixed(1));
      tow1.setAttribute("x2", tTop[0]); tow1.setAttribute("y2", tTop[1].toFixed(1));
      tow2.setAttribute("x1", p.attBot[0]); tow2.setAttribute("y1", p.attBot[1].toFixed(1));
      tow2.setAttribute("x2", tBot[0]); tow2.setAttribute("y2", tBot[1].toFixed(1));
    };

    // First frame + text fit.
    frame(0);
    try { fitText(textEl, centerLen); } catch (_) {}

    let raf = 0;
    const start = performance.now();
    const cleanup = () => { if (raf) cancelAnimationFrame(raf); host.remove(); };

    if (prefersReduced) {
      // Calm: one gentle static ripple, no fly-across, no rAF churn.
      frame(0.9);
      try { fitText(textEl, centerLen); } catch (_) {}
      setTimeout(cleanup, 6200);
      return;
    }

    const loop = (now) => {
      frame((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    cross.addEventListener("animationend", (e) => {
      if (e.animationName === "fb-cross") cleanup();
    });
    setTimeout(cleanup, (FLIGHT_S + 2) * 1000); // safety net
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "FLYBY") {
      try {
        render(msg.payload || {});
        sendResponse && sendResponse({ ok: true });
      } catch (e) {
        sendResponse && sendResponse({ ok: false, error: String(e) });
      }
    }
  });
})();
