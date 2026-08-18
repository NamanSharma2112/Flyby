// Flyby — content script.
//
// Injected on demand into the active tab. When it receives a { type: "FLYBY" }
// message it renders a little paper airplane towing a banner and flies it clear
// across the screen, then cleans itself up. Everything lives inside a Shadow DOM
// so the host page's CSS can never touch it (and ours never touches the page).

(() => {
  // executeScript may inject this file more than once into the same frame. The
  // IIFE keeps top-level names from colliding; this guard keeps us from adding
  // the message listener twice.
  if (window.__flybyReady) return;
  window.__flybyReady = true;

  const LANES = [14, 26, 9, 21, 33]; // vh offsets so stacked planes don't overlap
  let laneIndex = 0;

  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STYLE = `
    :host { all: initial; }
    .lane {
      position: fixed;
      left: 0;
      width: 100%;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .cross {
      position: absolute;
      left: 0;
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      animation: flyby-cross 9s linear forwards;
      will-change: transform;
    }
    .bob {
      display: inline-flex;
      align-items: center;
      animation: flyby-bob 2.3s ease-in-out infinite;
      will-change: transform;
    }
    .banner {
      position: relative;
      max-width: 60vw;
      padding: 10px 20px 10px 30px;
      border-radius: 12px;
      background: linear-gradient(180deg, #3b83ff 0%, #1e5fd0 100%);
      color: #fff;
      box-shadow: 0 10px 24px rgba(15, 45, 100, 0.28);
      transform-origin: right center;
      animation: flyby-ripple 1.15s ease-in-out infinite;
      /* swallow-tail notch cut into the trailing (left) edge */
      clip-path: polygon(100% 0, 100% 100%, 0 100%, 13% 50%, 0 0);
    }
    .title {
      display: block;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: 0.1px;
      max-width: 52vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      display: block;
      margin-top: 2px;
      font-size: 12.5px;
      font-weight: 500;
      opacity: 0.92;
    }
    .rope {
      width: 26px;
      height: 2px;
      margin: 0 2px 8px 2px;
      background: repeating-linear-gradient(90deg, rgba(30,60,110,0.55) 0 5px, transparent 5px 9px);
      align-self: center;
    }
    .plane {
      filter: drop-shadow(0 8px 10px rgba(15, 45, 100, 0.30));
      transform: translateY(-2px);
    }
    .plane svg { display: block; width: 72px; height: 56px; }

    @keyframes flyby-cross {
      from { transform: translateX(calc(-100% - 60px)); }
      to   { transform: translateX(calc(100vw + 60px)); }
    }
    @keyframes flyby-bob {
      0%, 100% { transform: translateY(2px) rotate(-1deg); }
      50%      { transform: translateY(-12px) rotate(1.6deg); }
    }
    @keyframes flyby-ripple {
      0%, 100% { transform: skewY(0deg) scaleY(1); }
      50%      { transform: skewY(-2deg) scaleY(0.985); }
    }
    @keyframes flyby-fade {
      0%   { opacity: 0; transform: translateY(-10px); }
      12%  { opacity: 1; transform: translateY(0); }
      85%  { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-6px); }
    }

    /* Respect reduced-motion: no fly-across, no bob/ripple — just a gentle
       fade in the top-center that lingers a few seconds. */
    :host(.reduced) .lane { display: flex; justify-content: center; }
    :host(.reduced) .cross {
      position: static;
      animation: flyby-fade 5.5s ease forwards;
    }
    :host(.reduced) .bob,
    :host(.reduced) .banner { animation: none; }
  `;

  const PLANE_SVG = `
    <svg viewBox="0 0 72 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polygon points="68,26 10,8 31,26" fill="#ffffff"/>
      <polygon points="68,26 31,26 15,50" fill="#d7e6fb"/>
      <polyline points="68,26 31,26" fill="none" stroke="#b9d2f5" stroke-width="1.5"/>
    </svg>`;

  function render(payload) {
    const title = String(payload && payload.title ? payload.title : "Upcoming event");
    const sub = String(payload && payload.subtitle ? payload.subtitle : "starts soon");

    const host = document.createElement("div");
    host.setAttribute("data-flyby", "");
    // Inline, !important host styles so the page can never move or hide us.
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 100vw",
      "height: 100vh",
      "margin: 0",
      "border: 0",
      "padding: 0",
      "background: transparent",
      "pointer-events: none",
      "z-index: 2147483647",
    ]
      .map((r) => r + " !important")
      .join(";");
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

    const bob = document.createElement("div");
    bob.className = "bob";

    const banner = document.createElement("div");
    banner.className = "banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", `${title} — ${sub}`);

    const titleEl = document.createElement("span");
    titleEl.className = "title";
    titleEl.textContent = title;

    const subEl = document.createElement("span");
    subEl.className = "sub";
    subEl.textContent = sub;

    banner.append(titleEl, subEl);

    const rope = document.createElement("div");
    rope.className = "rope";

    const plane = document.createElement("div");
    plane.className = "plane";
    plane.innerHTML = PLANE_SVG;

    bob.append(banner, rope, plane);
    cross.append(bob);
    lane.append(cross);
    root.append(style, lane);

    (document.body || document.documentElement).appendChild(host);

    const cleanup = () => host.remove();
    // The finite "cross"/"fade" animation on .cross ends the flight.
    cross.addEventListener("animationend", (e) => {
      if (e.animationName === "flyby-cross" || e.animationName === "flyby-fade") cleanup();
    });
    // Safety net in case animationend never fires (e.g. tab was backgrounded).
    setTimeout(cleanup, prefersReduced ? 7000 : 11000);
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
    // No async work — safe to let the channel close.
  });
})();
