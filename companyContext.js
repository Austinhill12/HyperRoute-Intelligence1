(function () {
  const SUPABASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
  const SUPABASE_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
  const requestHeaders = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  const STORAGE_KEY = "hyperroute_active_company_id";
  const PUBLIC_PAGES = new Set([
    "login.html",
    "signup.html",
    "logout.html",
    "privacy.html",
    "terms.html",
    "support-contact.html",
    "track-load.html"
  ]);

  const ROLE_ACCESS = {
    platform_admin: "all",
    owner: "all_company",
    company_owner: "all_company",
    admin: "all_company",
    company_admin: "all_company",
    dispatcher: [
      "dashboard.html", "onboarding.html", "activity.html", "dispatch.html", "alerts.html",
      "index.html", "drivers.html", "driver-details.html", "edit-driver.html",
      "rate-con-import.html", "create-load.html", "loads.html", "load-details.html", "edit-load.html", "dispatch-packet.html", "tender-load.html", "rate-confirmation.html",
      "quotes.html", "customers.html", "create-customer.html", "customer-details.html", "edit-customer.html",
      "carriers.html",
      "create-vehicle.html", "vehicles.html", "vehicle-details.html", "edit-vehicle.html",
      "assign-vehicle.html", "documents.html", "support.html", "notifications.html",
      "support-contact.html", "privacy.html", "terms.html", "login.html", "logout.html"
    ],
    accounting: [
      "dashboard.html", "onboarding.html", "activity.html", "reports.html", "profit-intelligence.html", "customers.html", "customer-profitability.html", "create-customer.html",
      "customer-details.html", "edit-customer.html", "invoices.html", "invoice-details.html",
      "edit-invoice.html", "settlements.html", "accounting-sync.html", "quotes.html", "rate-con-import.html", "loads.html", "load-details.html", "dispatch-packet.html", "tender-load.html", "rate-confirmation.html", "carriers.html", "documents.html", "expense-review.html", "integrations.html", "support.html",
      "notifications.html", "subscription.html", "support-contact.html", "privacy.html", "terms.html", "login.html", "logout.html"
    ],
    maintenance: [
      "dashboard.html", "onboarding.html", "activity.html", "alerts.html", "create-vehicle.html", "vehicles.html",
      "vehicle-details.html", "edit-vehicle.html", "create-maintenance.html", "maintenance.html",
      "reports.html", "profit-intelligence.html", "documents.html", "support.html", "notifications.html", "support-contact.html", "privacy.html", "terms.html", "login.html", "logout.html"
    ],
    driver: [
      "driver-portal.html", "dispatch-packet.html", "support.html", "notifications.html", "support-contact.html", "privacy.html", "terms.html", "login.html", "logout.html"
    ]
  };

  const COMPANY_ADMIN_PAGES = ["company-admin.html", "settings.html"];
  const PLATFORM_ADMIN_PAGES = ["platform-admin.html", "demo-center.html"];
  const FEATURE_GROUPS = {
    core: [
      "dashboard.html", "onboarding.html", "activity.html", "reports.html", "profit-intelligence.html", "alerts.html",
      "loads.html", "load-details.html", "edit-load.html", "dispatch-packet.html", "create-load.html", "rate-con-import.html",
      "customers.html", "customer-profitability.html", "create-customer.html", "customer-details.html", "edit-customer.html",
      "documents.html", "expense-review.html", "integrations.html", "notifications.html", "support.html", "subscription.html",
      "support-contact.html", "privacy.html", "terms.html", "track-load.html",
      "signup.html", "login.html", "logout.html"
    ],
    fleet: [
      "index.html", "drivers.html", "driver-details.html", "edit-driver.html",
      "create-vehicle.html", "vehicles.html", "vehicle-details.html", "edit-vehicle.html",
      "assign-vehicle.html", "driver-portal.html"
    ],
    fleetCompliance: [
      "compliance.html", "create-maintenance.html", "maintenance.html"
    ],
    brokerage: [
      "quotes.html", "carriers.html", "tender-load.html", "rate-confirmation.html"
    ],
    billing: [
      "invoices.html", "invoice-details.html", "edit-invoice.html", "settlements.html", "accounting-sync.html", "expense-review.html"
    ],
    dispatcherTools: [
      "dispatch.html", "rate-con-import.html", "carriers.html", "tender-load.html", "rate-confirmation.html"
    ]
  };
  const OPERATION_FEATURES = {
    carrier: ["core", "fleet", "fleetCompliance", "billing", "dispatcherTools"],
    broker_3pl: ["core", "brokerage", "billing", "dispatcherTools"],
    dispatcher: ["core", "fleet", "dispatcherTools"],
    hybrid: ["core", "fleet", "fleetCompliance", "brokerage", "billing", "dispatcherTools"]
  };

  let contextPromise = null;
  let context = {
    companyId: null,
    company: null,
    companies: [],
    role: "dispatcher",
    userId: null,
    authHeaders: requestHeaders,
    isAuthenticated: false,
    isPlatformAdmin: false
  };

  async function ready() {
    if (!contextPromise) contextPromise = loadContext();
    return contextPromise;
  }

  async function loadContext() {
    const authContext = await fetchAuthContext();
    const companies = await fetchCompanies(authContext);
    const savedCompanyId = localStorage.getItem(STORAGE_KEY);
    const company = companies.find(row => String(row.id) === String(savedCompanyId)) || companies[0] || null;

    context.companies = companies;
    context.company = company;
    context.companyId = company?.id || null;
    context.userId = authContext.userId;
    context.authHeaders = authContext.authHeaders;
    context.isAuthenticated = authContext.isAuthenticated;
    context.isPlatformAdmin = authContext.isPlatformAdmin;

    if (context.companyId) {
      localStorage.setItem(STORAGE_KEY, context.companyId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    context.role = await fetchCompanyRole(context.companyId, authContext);

    renderSidebarControls();
    renderCompanySwitcher();
    renderGlobalLogoutButton();
    renderGlobalNavigationLinks();
    applyRoleNavigation();
    organizeSidebarNavigation();
    applyFeatureVisibility();
    loadNotificationBadge();
    enforcePageAccess();
    return context;
  }

  async function fetchAuthContext() {
    try {
      const parsed = getStoredSupabaseSession();
      const session = normalizeStoredSession(parsed);
      const accessToken = session?.access_token || null;
      const userId = session?.user?.id || session?.user_id || null;
      const authHeaders = accessToken
        ? { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
        : requestHeaders;

      let isPlatformAdmin = false;
      if (userId && accessToken) {
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/user_is_platform_admin`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json"
          },
          body: "{}"
        });

        if (rpcRes.ok) {
          isPlatformAdmin = Boolean(await rpcRes.json());
        } else {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/platform_admins?user_id=eq.${userId}&status=eq.active&select=id&limit=1`, {
            headers: authHeaders
          });
          if (res.ok) {
            const rows = await res.json();
            isPlatformAdmin = rows.length > 0;
          }
        }
      }

      return {
        userId,
        accessToken,
        authHeaders,
        isAuthenticated: Boolean(accessToken),
        isPlatformAdmin
      };
    } catch (err) {
      console.warn("Auth context unavailable:", err);
      return {
        userId: null,
        accessToken: null,
        authHeaders: requestHeaders,
        isAuthenticated: false,
        isPlatformAdmin: false
      };
    }
  }

  function getStoredSupabaseSession() {
    const exact = localStorage.getItem("sb-ygrikxlbfmtkovktwhdp-auth-token");
    if (exact) return JSON.parse(exact);

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const value = localStorage.getItem(key);
      if (!value || !value.includes("access_token")) continue;
      return JSON.parse(value);
    }

    return null;
  }

  function normalizeStoredSession(value) {
    if (!value) return null;
    if (value.access_token) return value;
    if (value.currentSession?.access_token) return value.currentSession;
    if (value.session?.access_token) return value.session;
    if (value.state?.session?.access_token) return value.state.session;
    return value;
  }

  async function fetchCompanyRole(companyId, authContext) {
    if (authContext.isPlatformAdmin) return "platform_admin";
    if (!companyId || !authContext.userId || !authContext.accessToken) return "dispatcher";

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/company_users?company_id=eq.${companyId}&user_id=eq.${authContext.userId}&status=eq.active&select=role&limit=1`,
        { headers: authContext.authHeaders }
      );
      if (!res.ok) return "dispatcher";
      const rows = await res.json();
      return rows[0]?.role || "dispatcher";
    } catch (err) {
      console.warn("Company role unavailable:", err);
      return "dispatcher";
    }
  }

  async function fetchCompanies(authContext = null) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=*&order=company_name.asc`, {
        headers: authContext?.authHeaders || requestHeaders
      });
      if (!res.ok) return [];
      return res.json();
    } catch (err) {
      console.warn("Company context unavailable:", err);
      return [];
    }
  }

  function renderCompanySwitcher() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar || document.getElementById("globalCompanySelect")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "company-switcher";

    if (!context.companies.length) {
      wrapper.innerHTML = `
        <label>Company</label>
        <div class="company-switcher-empty">No company selected</div>
      `;
      sidebar.insertBefore(wrapper, sidebar.querySelector("nav"));
      return;
    }

    wrapper.innerHTML = `
      <label for="globalCompanySelect">Company</label>
      <select id="globalCompanySelect">
        ${context.companies.map(company => (
          `<option value="${escapeHtml(company.id)}" ${String(company.id) === String(context.companyId) ? "selected" : ""}>${escapeHtml(company.company_name || "Unnamed Company")}</option>`
        )).join("")}
      </select>
    `;

    sidebar.insertBefore(wrapper, sidebar.querySelector("nav"));

    document.getElementById("globalCompanySelect").addEventListener("change", (event) => {
      setCompanyId(event.target.value, { reload: true });
    });
  }

  function renderSidebarControls() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar || document.getElementById("sidebarCollapseBtn")) return;
    if (window.location.pathname.endsWith("login.html") || window.location.pathname.endsWith("logout.html")) return;

    const logo = sidebar.querySelector(".logo, h2");
    const controls = document.createElement("div");
    controls.className = "sidebar-controls";
    controls.innerHTML = `
      <button type="button" id="sidebarCollapseBtn" class="sidebar-control-btn">Hide Menu</button>
      <button type="button" id="sidebarBackBtn" class="sidebar-control-btn sidebar-back-btn">Back</button>
    `;

    if (logo?.nextSibling) {
      sidebar.insertBefore(controls, logo.nextSibling);
    } else {
      sidebar.insertBefore(controls, sidebar.firstChild);
    }

    const collapseBtn = document.getElementById("sidebarCollapseBtn");
    const backBtn = document.getElementById("sidebarBackBtn");

    const setCollapsed = (collapsed) => {
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      localStorage.setItem("hyperroute_sidebar_collapsed", String(collapsed));
      collapseBtn.textContent = collapsed ? "Show Menu" : "Hide Menu";
    };

    setCollapsed(localStorage.getItem("hyperroute_sidebar_collapsed") === "true");

    collapseBtn.addEventListener("click", () => {
      setCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });

    backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = getFallbackPage();
      }
    });
  }

  function renderGlobalLogoutButton() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar || document.getElementById("globalLogoutBtn")) return;
    if (window.location.pathname.endsWith("login.html") || window.location.pathname.endsWith("logout.html")) return;

    const existingDashboardButton = document.getElementById("logoutBtn");
    const button = existingDashboardButton || document.createElement("button");
    button.id = existingDashboardButton ? existingDashboardButton.id : "globalLogoutBtn";
    button.type = "button";
    button.classList.add("logout-btn");
    button.textContent = "Logout";

    if (!existingDashboardButton) {
      sidebar.appendChild(button);
    }

    button.addEventListener("click", () => {
      window.location.href = "logout.html";
    });
  }

  function renderGlobalNavigationLinks() {
    const nav = document.querySelector(".sidebar nav");
    if (!nav) return;

    if (!nav.querySelector('a[href="quotes.html"]')) {
      const loadsLink = nav.querySelector('a[href="loads.html"]');
      const quoteLink = document.createElement("a");
      quoteLink.href = "quotes.html";
      quoteLink.textContent = "Quotes";
      if (normalizePage(window.location.pathname.split("/").pop()) === "quotes.html") {
        quoteLink.className = "active";
      }

      if (loadsLink?.nextSibling) {
        nav.insertBefore(quoteLink, loadsLink.nextSibling);
      } else {
        nav.appendChild(quoteLink);
      }
    }

    if (!nav.querySelector('a[href="support.html"]')) {
      const settingsLink = nav.querySelector('a[href="settings.html"]');
      const supportLink = document.createElement("a");
      supportLink.href = "support.html";
      supportLink.textContent = "Support";
      if (normalizePage(window.location.pathname.split("/").pop()) === "support.html") {
        supportLink.className = "active";
      }

      if (settingsLink) {
        nav.insertBefore(supportLink, settingsLink);
      } else {
        nav.appendChild(supportLink);
      }
    }

    if (context.isPlatformAdmin && !nav.querySelector('a[href="demo-center.html"]')) {
      const platformLink = nav.querySelector('a[href="platform-admin.html"]');
      const demoLink = document.createElement("a");
      demoLink.href = "demo-center.html";
      demoLink.textContent = "Demo Center";
      if (normalizePage(window.location.pathname.split("/").pop()) === "demo-center.html") {
        demoLink.className = "active";
      }

      if (platformLink?.nextSibling) {
        nav.insertBefore(demoLink, platformLink.nextSibling);
      } else {
        nav.appendChild(demoLink);
      }
    }

    if (!nav.querySelector('a[href="carriers.html"]')) {
      const customersLink = nav.querySelector('a[href="customers.html"]');
      const carriersLink = document.createElement("a");
      carriersLink.href = "carriers.html";
      carriersLink.textContent = "Carriers";
      if (normalizePage(window.location.pathname.split("/").pop()) === "carriers.html") {
        carriersLink.className = "active";
      }
      if (customersLink?.nextSibling) {
        nav.insertBefore(carriersLink, customersLink.nextSibling);
      } else {
        nav.appendChild(carriersLink);
      }
    }

    if (!nav.querySelector('a[href="rate-con-import.html"]')) {
      const createLoadLink = nav.querySelector('a[href="create-load.html"]');
      const importLink = document.createElement("a");
      importLink.href = "rate-con-import.html";
      importLink.textContent = "Rate Con Import";
      if (normalizePage(window.location.pathname.split("/").pop()) === "rate-con-import.html") {
        importLink.className = "active";
      }
      if (createLoadLink) {
        nav.insertBefore(importLink, createLoadLink);
      } else {
        nav.appendChild(importLink);
      }
    }

    if (!nav.querySelector('a[href="notifications.html"]')) {
      const supportLink = nav.querySelector('a[href="support.html"]');
      const notificationsLink = document.createElement("a");
      notificationsLink.href = "notifications.html";
      notificationsLink.textContent = "Notifications";
      notificationsLink.id = "globalNotificationsLink";
      if (normalizePage(window.location.pathname.split("/").pop()) === "notifications.html") {
        notificationsLink.className = "active";
      }

      if (supportLink?.nextSibling) {
        nav.insertBefore(notificationsLink, supportLink.nextSibling);
      } else {
        nav.appendChild(notificationsLink);
      }
    } else {
      nav.querySelector('a[href="notifications.html"]').id = "globalNotificationsLink";
    }

    if (!nav.querySelector('a[href="integrations.html"]')) {
      const notificationsLink = nav.querySelector('a[href="notifications.html"]');
      const supportLink = nav.querySelector('a[href="support.html"]');
      const integrationsLink = document.createElement("a");
      integrationsLink.href = "integrations.html";
      integrationsLink.textContent = "Integrations";
      if (normalizePage(window.location.pathname.split("/").pop()) === "integrations.html") {
        integrationsLink.className = "active";
      }

      const anchor = notificationsLink || supportLink;
      if (anchor?.nextSibling) {
        nav.insertBefore(integrationsLink, anchor.nextSibling);
      } else {
        nav.appendChild(integrationsLink);
      }
    }

    if (!nav.querySelector('a[href="accounting-sync.html"]')) {
      const settlementsLink = nav.querySelector('a[href="settlements.html"]');
      const invoicesLink = nav.querySelector('a[href="invoices.html"]');
      const accountingSyncLink = document.createElement("a");
      accountingSyncLink.href = "accounting-sync.html";
      accountingSyncLink.textContent = "Accounting Sync";
      if (normalizePage(window.location.pathname.split("/").pop()) === "accounting-sync.html") {
        accountingSyncLink.className = "active";
      }

      const anchor = settlementsLink || invoicesLink;
      if (anchor?.nextSibling) {
        nav.insertBefore(accountingSyncLink, anchor.nextSibling);
      } else {
        nav.appendChild(accountingSyncLink);
      }
    }

    addUtilityNavLink(nav, "support-contact.html", "Support Contact");
    addUtilityNavLink(nav, "privacy.html", "Privacy");
    addUtilityNavLink(nav, "terms.html", "Terms");
  }

  function addUtilityNavLink(nav, href, label) {
    if (nav.querySelector(`a[href="${href}"]`)) return;
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.className = "utility-link";
    if (normalizePage(window.location.pathname.split("/").pop()) === href) {
      link.classList.add("active");
    }
    nav.appendChild(link);
  }

  async function loadNotificationBadge() {
    if (!context.isAuthenticated) return;
    const link = document.getElementById("globalNotificationsLink");
    if (!link) return;

    try {
      let query = "select=id&read_at=is.null";
      if (!context.isPlatformAdmin && context.companyId) {
        query += `&company_id=eq.${context.companyId}&audience=eq.company`;
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/notifications?${query}`, {
        headers: {
          ...getHeaders(),
          Prefer: "count=exact"
        }
      });

      if (!res.ok) return;
      const rows = await res.json();
      const count = Number(res.headers.get("content-range")?.split("/")?.[1] || rows.length || 0);
      updateNotificationBadge(link, count);
    } catch (err) {
      console.warn("Notification badge unavailable:", err);
    }
  }

  function updateNotificationBadge(link, count) {
    link.querySelector(".notification-badge")?.remove();
    if (!count) return;

    const badge = document.createElement("span");
    badge.className = "notification-badge";
    badge.textContent = count > 99 ? "99+" : String(count);
    link.appendChild(badge);
  }

  function getCompanyId() {
    return context.companyId;
  }

  function getCompany() {
    return context.company;
  }

  function getCompanies() {
    return context.companies;
  }

  function getRole() {
    return context.role;
  }

  function isPlatformAdmin() {
    return context.isPlatformAdmin;
  }

  function getHeaders() {
    return context.authHeaders || requestHeaders;
  }

  function setCompanyId(companyId, options = {}) {
    const company = context.companies.find(row => String(row.id) === String(companyId)) || (companyId ? { id: companyId } : null);
    context.company = company;
    context.companyId = company?.id || null;

    if (context.companyId) {
      localStorage.setItem(STORAGE_KEY, context.companyId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    const select = document.getElementById("globalCompanySelect");
    if (select && context.companyId) select.value = context.companyId;

    if (options.reload) window.location.reload();
    return context;
  }

  function withCompanyId(data) {
    const companyId = getCompanyId();
    if (!companyId) return data;
    return { ...data, company_id: companyId };
  }

  function addCompanyFilter(query = "") {
    const companyId = getCompanyId();
    if (!companyId) return query;
    const trimmed = query || "";
    return trimmed ? `${trimmed}&company_id=eq.${companyId}` : `company_id=eq.${companyId}`;
  }

  function scopedUrl(table, query = "") {
    return `${SUPABASE_URL}/rest/v1/${table}?${addCompanyFilter(query)}`;
  }

  async function fetchRows(table, query = "") {
    const res = await fetch(scopedUrl(table, query), { headers: getHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function applyRoleNavigation() {
    Array.from(document.querySelectorAll(".sidebar nav a[href]")).forEach(link => {
      const page = normalizePage(link.getAttribute("href"));
      if (!page || page === "login.html" || page === "logout.html") return;

      if (!canAccessPage(page)) {
        link.remove();
      } else {
        link.classList.remove("role-hidden");
        link.removeAttribute("aria-hidden");
        link.removeAttribute("tabindex");
      }
    });
  }

  function organizeSidebarNavigation() {
    const nav = document.querySelector(".sidebar nav");
    if (!nav || nav.dataset.organized === "true") return;

    const isDispatcherWorkspace = getOperationType() === "dispatcher" && context.role !== "platform_admin";
    const dailyPages = new Set([
      "dashboard.html",
      "dispatch.html",
      "rate-con-import.html",
      "create-load.html",
      "loads.html",
      "customers.html",
      "carriers.html",
      "drivers.html",
      "index.html",
      "vehicles.html",
      "documents.html",
      "notifications.html",
      "support.html"
    ]);
    if (!isDispatcherWorkspace) {
      ["reports.html", "alerts.html"].forEach(page => dailyPages.add(page));
    }
    const utilityPages = new Set(["support-contact.html", "privacy.html", "terms.html", "login.html", "logout.html"]);
    const links = Array.from(nav.querySelectorAll(":scope > a[href]"));
    const advancedLinks = links.filter(link => {
      const page = normalizePage(link.getAttribute("href"));
      return page && !dailyPages.has(page) && !utilityPages.has(page);
    });

    if (!advancedLinks.length) {
      nav.dataset.organized = "true";
      return;
    }

    const details = document.createElement("details");
    details.className = "sidebar-more";
    const currentPage = normalizePage(window.location.pathname.split("/").pop());
    const hasActiveAdvanced = advancedLinks.some(link => normalizePage(link.getAttribute("href")) === currentPage);
    if (hasActiveAdvanced || context.role === "platform_admin") details.open = hasActiveAdvanced;

    const summary = document.createElement("summary");
    summary.textContent = context.role === "platform_admin" || ["owner", "company_owner", "admin", "company_admin"].includes(context.role)
      ? "Admin & More"
      : "More";
    details.appendChild(summary);

    advancedLinks.forEach(link => details.appendChild(link));

    const supportLink = nav.querySelector('a[href="support.html"]');
    if (supportLink?.nextSibling) {
      nav.insertBefore(details, supportLink.nextSibling);
    } else {
      nav.appendChild(details);
    }

    nav.dataset.organized = "true";
  }

  function applyFeatureVisibility() {
    Array.from(document.querySelectorAll("a[href]")).forEach(link => {
      if (link.closest(".sidebar nav")) return;
      const page = normalizePage(link.getAttribute("href"));
      if (!page || page === "login.html" || page === "logout.html") return;

      if (!canAccessPage(page)) {
        link.remove();
      } else {
        link.classList.remove("role-hidden");
        link.removeAttribute("aria-hidden");
        link.removeAttribute("tabindex");
      }
    });
  }

  function enforcePageAccess() {
    const page = normalizePage(window.location.pathname.split("/").pop() || "dashboard.html");
    if (!page || PUBLIC_PAGES.has(page)) return;

    if (!context.isAuthenticated) {
      window.location.replace(`login.html?next=${encodeURIComponent(page)}`);
      return;
    }

    if (canAccessPage(page)) return;

    const fallback = getFallbackPage();
    if (normalizePage(fallback) !== page) {
      window.location.replace(fallback);
    }
  }

  function canAccessPage(page) {
    if (PLATFORM_ADMIN_PAGES.includes(page)) return context.role === "platform_admin";
    if (COMPANY_ADMIN_PAGES.includes(page)) {
      return context.role === "platform_admin" || ["owner", "company_owner", "admin", "company_admin"].includes(context.role);
    }

    if (context.role === "platform_admin") return true;
    if (!canAccessOperationPage(page)) return false;

    const access = ROLE_ACCESS[context.role] || ROLE_ACCESS.dispatcher;
    if (access === "all" || access === "all_company") return true;
    return access.includes(page);
  }

  function canAccessOperationPage(page) {
    return getEnabledOperationPages().has(page);
  }

  function getOperationType() {
    return context.company?.operation_type || "carrier";
  }

  function getEnabledOperationPages() {
    const operationType = getOperationType();
    const groups = OPERATION_FEATURES[operationType] || OPERATION_FEATURES.carrier;
    const pages = new Set();
    groups.forEach(group => {
      (FEATURE_GROUPS[group] || []).forEach(page => pages.add(page));
    });
    COMPANY_ADMIN_PAGES.forEach(page => pages.add(page));
    PLATFORM_ADMIN_PAGES.forEach(page => pages.add(page));
    return pages;
  }

  function getFallbackPage() {
    if (context.role === "driver") return "driver-portal.html";
    if (context.role === "accounting") return "invoices.html";
    if (context.role === "maintenance") return "maintenance.html";
    return "dashboard.html";
  }

  function normalizePage(href) {
    if (!href || href.startsWith("#") || href.startsWith("http")) return "";
    return href.split("?")[0].split("#")[0].split("/").pop();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  window.CompanyContext = {
    ready,
    getCompanyId,
    getCompany,
    getCompanies,
    getRole,
    getOperationType,
    getEnabledOperationPages,
    isPlatformAdmin,
    getHeaders,
    setCompanyId,
    withCompanyId,
    addCompanyFilter,
    scopedUrl,
    fetchRows
  };
})();
