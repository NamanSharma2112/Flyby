// Fills in the live extension ID and wires the copy buttons on the setup page.
// Guarded so the page also works if opened as a plain file (outside the extension).
(function () {
  const hasRuntime = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  const id = hasRuntime ? chrome.runtime.id : "";

  if (id) {
    const el = document.getElementById("extId");
    if (el) el.textContent = id;
  }

  document.querySelectorAll("button.copy[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-copy") === "id" ? id : btn.getAttribute("data-copy");
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = original), 1200);
      } catch (_) {
        /* clipboard blocked — ignore */
      }
    });
  });
})();
