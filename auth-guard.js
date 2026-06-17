(function () {
  const PUBLIC_PAGES = new Set([
    "login.html",
    "signup.html",
    "logout.html",
    "privacy.html",
    "terms.html",
    "support-contact.html",
    "track-load.html"
  ]);

  const page = getCurrentPage();
  if (PUBLIC_PAGES.has(page)) return;

  const style = document.createElement("style");
  style.textContent = "html.auth-guard-pending body{visibility:hidden}";
  document.head.appendChild(style);
  document.documentElement.classList.add("auth-guard-pending");

  if (!hasValidSupabaseSession()) {
    const next = encodeURIComponent(`${page}${window.location.search || ""}`);
    window.location.replace(`login.html?next=${next}`);
    return;
  }

  document.documentElement.classList.remove("auth-guard-pending");

  function getCurrentPage() {
    const raw = window.location.pathname.split("/").pop();
    return raw || "index.html";
  }

  function hasValidSupabaseSession() {
    const session = getStoredSupabaseSession();
    if (!session?.access_token) return false;
    if (!session.expires_at) return true;
    return Number(session.expires_at) > Math.floor(Date.now() / 1000);
  }

  function getStoredSupabaseSession() {
    const exact = localStorage.getItem("sb-ygrikxlbfmtkovktwhdp-auth-token");
    if (exact) return safeJsonParse(exact);

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = localStorage.getItem(key);
      if (!value || !value.includes("access_token")) continue;
      return safeJsonParse(value);
    }

    return null;
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }
})();
