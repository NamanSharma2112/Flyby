// Fills in the live redirect URI and wires the copy button on the setup page.
// Guarded so the page also works if opened as a plain file (outside the extension).
(function () {
  const inExtension =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.identity;

  const redirect = inExtension ? chrome.identity.getRedirectURL() : "";

  if (redirect) {
    const el = document.getElementById("extId");
    if (el) el.textContent = redirect;
  }

  document.querySelectorAll("button.copy[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-copy") === "id" ? redirect : btn.getAttribute("data-copy");
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
