import { supabase } from "./supabaseClient.js";

let companies = [];
let companyUsers = [];
let userInvites = [];
let companySubscriptions = [];
let supportTickets = [];
let selectedSupportTicket = null;
let companyMetrics = new Map();
let tableHealth = [];
let readinessItems = [];
let companyQualityWarnings = [];
let selectedAccountCompanyId = null;

const PLAN_PRICES = {
  starter: 99,
  professional: 199,
  business: 399,
  enterprise: 0
};

const PAYMENT_SETUP_STATUSES = ["not_started", "payment_link_sent", "payment_method_on_file", "auto_billing_ready"];
const CUSTOMER_LIFECYCLE_STAGES = ["lead", "trial", "onboarding", "live", "at_risk", "canceled"];

const msg = document.getElementById("platformAdminMessage");
const companyForm = document.getElementById("platformCompanyForm");
const userForm = document.getElementById("platformUserForm");
const inviteForm = document.getElementById("platformInviteForm");
const platformSupportReplyForm = document.getElementById("platformSupportReplyForm");

async function initPlatformAdmin() {
  msg.textContent = "Loading platform admin...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    msg.textContent = "Redirecting to login...";
    msg.style.color = "#ef4444";
    window.location.href = "login.html?next=platform-admin.html";
    return;
  }

  const { data: isPlatformAdmin, error } = await supabase.rpc("user_is_platform_admin");
  if (error || !isPlatformAdmin) {
    msg.textContent = "Platform Admin is only available to active platform admins.";
    msg.style.color = "#ef4444";
    return;
  }

  await loadPlatformData();
  msg.textContent = "";
}

async function loadPlatformData() {
  const [
    { data: companyRows, error: companiesError },
    { data: userRows, error: usersError },
    inviteRows,
    subscriptionRows,
    supportRows
  ] = await Promise.all([
    supabase.from("companies").select("*").order("company_name", { ascending: true }),
    supabase.from("company_users").select("*").order("created_at", { ascending: false }),
    loadInvites(),
    loadSubscriptions(),
    loadSupportTickets()
  ]);

  if (companiesError) throw companiesError;
  if (usersError) throw usersError;

  companies = companyRows || [];
  companyUsers = userRows || [];
  userInvites = inviteRows || [];
  companySubscriptions = subscriptionRows || [];
  supportTickets = supportRows || [];
  await loadCompanyMetrics();
  await loadReadinessData();
  renderCompanies();
  renderCompanyOptions();
  renderSubscriptions();
  renderPaymentReadiness();
  renderDeploymentReadiness();
  renderQaChecklist();
  renderInvites();
  renderCompanyUsers();
  renderSupportTickets();
  updateKpis();
  renderReadiness();
  renderDemoAdminPanel();
  renderIsolationTestPlaceholder();
  renderOnboardingReadiness();
  renderCustomerAccountProfile();
}

async function loadInvites() {
  const { data, error } = await supabase
    .from("user_invites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("User invite table unavailable:", error.message);
    return [];
  }

  return data || [];
}

async function loadSubscriptions() {
  const { data, error } = await supabase
    .from("company_subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Company subscriptions table unavailable:", error.message);
    return [];
  }

  return data || [];
}

async function loadSupportTickets() {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    console.warn("Support tickets table unavailable:", error.message);
    return [];
  }

  return data || [];
}

async function loadCompanyMetrics() {
  companyMetrics = new Map();

  await Promise.all(companies.map(async company => {
    const [drivers, trucks, loads, invoices, quotes, documents, assignments, customers, carriers] = await Promise.all([
      countRows("drivers", company.id),
      countRows("trucks", company.id),
      countRows("loads", company.id),
      countRows("invoices", company.id),
      countRows("quotes", company.id),
      countRows("documents", company.id),
      countRows("assignments", company.id),
      countRows("customers", company.id),
      countRows("carriers", company.id)
    ]);

    companyMetrics.set(company.id, { drivers, trucks, loads, invoices, quotes, documents, assignments, customers, carriers });
  }));
}

async function countRows(table, companyId) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (error) return 0;
  return count || 0;
}

async function loadReadinessData() {
  tableHealth = await checkRequiredTables();
  readinessItems = buildReadinessItems();
  companyQualityWarnings = buildCompanyQualityWarnings();
}

async function checkRequiredTables() {
  const requiredTables = [
    ["Core SaaS", "companies"],
    ["Core SaaS", "company_users"],
    ["Core SaaS", "platform_admins"],
    ["Core SaaS", "user_invites"],
    ["Billing", "company_subscriptions"],
    ["Operations", "drivers"],
    ["Operations", "trucks"],
    ["Operations", "loads"],
    ["Operations", "assignments"],
    ["Operations", "customers"],
    ["3PL", "carriers"],
    ["3PL", "load_tenders"],
    ["Operations", "load_communications"],
    ["Operations", "load_issues"],
    ["Operations", "quotes"],
    ["Billing", "invoices"],
    ["Billing", "settlements"],
    ["Documents", "documents"],
    ["Maintenance", "maintenance_logs"],
    ["Maintenance", "maintenance_schedules"],
    ["Tracking", "load_events"],
    ["Audit", "activity_logs"],
    ["Support", "support_tickets"],
    ["Support", "notifications"]
  ];

  const results = await Promise.all(requiredTables.map(async ([area, table]) => {
    if (table === "platform_admins") {
      const { data, error } = await supabase.rpc("user_is_platform_admin");
      return {
        area,
        table,
        ok: !error && Boolean(data),
        message: error ? error.message : "Verified by platform admin RPC"
      };
    }

    const { error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    return {
      area,
      table,
      ok: !error,
      message: error ? error.message : "Ready"
    };
  }));

  return results;
}

function buildReadinessItems() {
  const sellableCompanies = getSellableCompanies();
  const activeSubscriptions = companySubscriptions.filter(subscription => subscription.billing_status === "active" && isSellableCompanyId(subscription.company_id));
  const platformAdmins = companyUsers.filter(user => ["company_owner", "company_admin", "owner", "admin"].includes(user.role));
  const tablesReady = tableHealth.filter(row => row.ok).length;
  const requiredTableCount = tableHealth.length;

  return [
    {
      title: "Required database tables",
      status: tablesReady === requiredTableCount ? "pass" : "blocker",
      detail: `${tablesReady} of ${requiredTableCount} required tables are reachable.`
    },
    {
      title: "Platform admin access",
      status: "pass",
      detail: "Current user passed the platform admin RPC check."
    },
    {
      title: "Customer companies",
      status: sellableCompanies.length > 0 ? "pass" : "blocker",
      detail: `${sellableCompanies.length} active customer compan${sellableCompanies.length === 1 ? "y" : "ies"} configured.`
    },
    {
      title: "Company users",
      status: companyUsers.length > 0 ? "pass" : "blocker",
      detail: `${companyUsers.length} company user${companyUsers.length === 1 ? "" : "s"} configured.`
    },
    {
      title: "Company admins",
      status: platformAdmins.length > 0 ? "pass" : "warning",
      detail: `${platformAdmins.length} owner/admin role${platformAdmins.length === 1 ? "" : "s"} found across companies.`
    },
    {
      title: "Subscription records",
      status: activeSubscriptions.length > 0 ? "pass" : "warning",
      detail: `${activeSubscriptions.length} active subscription${activeSubscriptions.length === 1 ? "" : "s"} found.`
    },
    {
      title: "Invite workflow",
      status: tableHealth.find(row => row.table === "user_invites")?.ok ? "pass" : "blocker",
      detail: `${userInvites.filter(invite => invite.status === "pending").length} pending invite${userInvites.filter(invite => invite.status === "pending").length === 1 ? "" : "s"}.`
    },
    {
      title: "Audit logging",
      status: tableHealth.find(row => row.table === "activity_logs")?.ok ? "pass" : "warning",
      detail: "Activity logs table is used to record admin actions."
    },
    {
      title: "Customer tracking",
      status: tableHealth.find(row => row.table === "load_events")?.ok && tableHealth.find(row => row.table === "documents")?.ok ? "pass" : "warning",
      detail: "Load events and documents support customer-facing tracking."
    },
    {
      title: "Demo data readiness",
      status: hasDemoOperationsData() ? "pass" : "warning",
      detail: "At least one company should have drivers, trucks, customers, and loads for demos."
    }
  ];
}

function hasDemoOperationsData() {
  return companies.some(company => {
    const metrics = companyMetrics.get(company.id) || {};
    return (metrics.drivers || 0) > 0 && (metrics.trucks || 0) > 0 && (metrics.loads || 0) > 0;
  });
}

function buildCompanyQualityWarnings() {
  const subscriptionMap = new Map(companySubscriptions.map(subscription => [subscription.company_id, subscription]));

  return getSellableCompanies().flatMap(company => {
    const metrics = companyMetrics.get(company.id) || {};
    const subscription = subscriptionMap.get(company.id);
    const users = companyUsers.filter(user => user.company_id === company.id && user.status === "active");
    const warnings = [];

    if (!company.email && !company.phone) warnings.push("Missing company email/phone.");
    if (!company.mc_number && !company.dot_number) warnings.push("Missing MC/DOT number.");
    if (!subscription) warnings.push("No subscription record.");
    if (subscription && !["trial", "active"].includes(subscription.billing_status)) warnings.push(`Billing status is ${formatStatus(subscription.billing_status)}.`);
    if (!users.length) warnings.push("No active company users.");
    if (!(metrics.drivers || 0)) warnings.push("No drivers.");
    if (!(metrics.trucks || 0)) warnings.push("No trucks.");
    if (!(metrics.loads || 0)) warnings.push("No loads.");

    return warnings.map(warning => ({
      company: company.company_name,
      warning
    }));
  });
}

function getSellableCompanies() {
  return companies.filter(company => (
    company.status !== "archived" &&
    (company.account_type || "customer") === "customer"
  ));
}

function isSellableCompanyId(companyId) {
  return getSellableCompanies().some(company => String(company.id) === String(companyId));
}

function renderCompanies() {
  const container = document.getElementById("platformCompaniesTableBody");
  renderCustomerLifecyclePipeline();
  container.innerHTML = "";

  if (!companies.length) {
    container.innerHTML = `<div class="empty-state">No companies found.</div>`;
    return;
  }

  companies.forEach(company => {
    const metrics = companyMetrics.get(company.id) || {};
    const row = document.createElement("article");
    row.className = "platform-company-card";
    row.innerHTML = `
      <div class="platform-company-main">
        <strong>${escapeHtml(company.company_name)}</strong>
        <span class="muted-line">${escapeHtml(company.legal_name || company.email || "No secondary detail")}</span>
      </div>
      <div class="platform-company-controls">
        ${companySelect("Type", "company-type", company.id, [
          ["customer", "Customer"],
          ["demo", "Demo/Test"],
          ["internal", "Internal"]
        ], company.account_type || "customer")}
        ${companySelect("Operation", "operation-type", company.id, [
          ["carrier", formatOperationType("carrier")],
          ["dispatcher", formatOperationType("dispatcher")],
          ["broker_3pl", formatOperationType("broker_3pl")],
          ["hybrid", formatOperationType("hybrid")]
        ], company.operation_type || "carrier")}
        ${companySelect("Stage", "lifecycle-stage", company.id, CUSTOMER_LIFECYCLE_STAGES.map(stage => [
          stage,
          formatStatus(stage)
        ]), company.lifecycle_stage || "trial")}
        ${companySelect("Handoff", "handoff-status", company.id, [
          ["setup", formatStatus("setup")],
          ["training", formatStatus("training")],
          ["live", formatStatus("live")],
          ["needs_attention", formatStatus("needs_attention")]
        ], company.handoff_status || "setup")}
        ${companySelect("Health", "customer-health", company.id, [
          ["healthy", formatStatus("healthy")],
          ["watch", formatStatus("watch")],
          ["at_risk", formatStatus("at_risk")]
        ], company.customer_health || "healthy")}
        ${companySelect("Status", "company-status", company.id, [
          ["active", "Active"],
          ["inactive", "Inactive"],
          ["archived", "Archived"]
        ], company.status || "active")}
      </div>
      <div class="platform-company-stats">
        ${companyStat("Follow-Up", company.next_follow_up_date ? formatDate(company.next_follow_up_date) : "Not set")}
        ${companyStat("Drivers", metrics.drivers || 0)}
        ${companyStat("Trucks", metrics.trucks || 0)}
        ${companyStat("Loads", metrics.loads || 0)}
        ${companyStat("Invoices", metrics.invoices || 0)}
      </div>
      <div class="platform-company-actions">
        <button class="view" type="button" data-use-company="${escapeHtml(company.id)}">Open</button>
        <button class="view secondary-action" type="button" data-archive-company="${escapeHtml(company.id)}">${company.status === "archived" ? "Restore" : "Archive"}</button>
        <button class="delete" type="button" data-safe-delete-company="${escapeHtml(company.id)}">Safe Delete</button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-company-status]").forEach(select => {
    select.addEventListener("change", () => updateCompanyStatus(select.dataset.companyStatus, select.value));
  });

  container.querySelectorAll("[data-company-type]").forEach(select => {
    select.addEventListener("change", () => updateCompanyType(select.dataset.companyType, select.value));
  });

  container.querySelectorAll("[data-operation-type]").forEach(select => {
    select.addEventListener("change", () => updateOperationType(select.dataset.operationType, select.value));
  });

  container.querySelectorAll("[data-lifecycle-stage]").forEach(select => {
    select.addEventListener("change", () => updateLifecycleStage(select.dataset.lifecycleStage, select.value));
  });

  container.querySelectorAll("[data-handoff-status]").forEach(select => {
    select.addEventListener("change", () => updateHandoffStatus(select.dataset.handoffStatus, select.value));
  });

  container.querySelectorAll("[data-customer-health]").forEach(select => {
    select.addEventListener("change", () => updateCustomerHealth(select.dataset.customerHealth, select.value));
  });

  container.querySelectorAll("[data-use-company]").forEach(button => {
    button.addEventListener("click", () => openCustomerAccountProfile(button.dataset.useCompany));
  });

  container.querySelectorAll("[data-archive-company]").forEach(button => {
    button.addEventListener("click", () => toggleArchiveCompany(button.dataset.archiveCompany));
  });

  container.querySelectorAll("[data-safe-delete-company]").forEach(button => {
    button.addEventListener("click", () => safeDeleteCompany(button.dataset.safeDeleteCompany));
  });
}

function renderCustomerLifecyclePipeline() {
  const pipeline = document.getElementById("customerLifecyclePipeline");
  if (!pipeline) return;

  const activeCustomers = companies.filter(company =>
    company.status !== "archived" &&
    (company.account_type || "customer") === "customer"
  );

  pipeline.innerHTML = CUSTOMER_LIFECYCLE_STAGES.map(stage => {
    const count = activeCustomers.filter(company => (company.lifecycle_stage || "trial") === stage).length;
    return `
      <div>
        <span>${escapeHtml(formatStatus(stage))}</span>
        <strong>${count}</strong>
      </div>
    `;
  }).join("");
}

function companySelect(label, datasetName, companyId, options, selectedValue) {
  return `
    <label class="platform-company-field">
      <span>${escapeHtml(label)}</span>
      <select data-${datasetName}="${escapeHtml(companyId)}">
        ${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
      </select>
    </label>
  `;
}

function companyStat(label, value) {
  return `
    <div class="platform-company-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function openCustomerAccountProfile(companyId) {
  selectedAccountCompanyId = companyId;
  renderCustomerAccountProfile(companyId);
  document.getElementById("customerAccountProfileCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCustomerAccountProfile(companyId = selectedAccountCompanyId) {
  const company = companies.find(row => String(row.id) === String(companyId));
  const title = document.getElementById("customerAccountProfileTitle");
  const body = document.getElementById("customerAccountProfileBody");
  const workspaceButton = document.getElementById("customerProfileOpenWorkspace");
  const onboardingButton = document.getElementById("customerProfileOpenOnboarding");
  if (!title || !body || !workspaceButton || !onboardingButton) return;

  if (!company) {
    title.textContent = "Select A Company";
    body.innerHTML = `<div class="empty-state">Use Open beside a company below to review launch readiness, subscription, users, missing setup items, and handoff status.</div>`;
    workspaceButton.disabled = true;
    onboardingButton.disabled = true;
    return;
  }

  const metrics = companyMetrics.get(company.id) || {};
  const subscription = companySubscriptions.find(row => String(row.company_id) === String(company.id)) || {};
  const users = companyUsers.filter(row => String(row.company_id) === String(company.id));
  const invites = userInvites.filter(row => String(row.company_id) === String(company.id) && row.status !== "canceled");
  const tickets = supportTickets.filter(row => String(row.company_id) === String(company.id) && !["closed", "resolved"].includes(String(row.status || "").toLowerCase()));
  const launch = buildCustomerLaunchProfile(company, metrics, subscription, users, invites);
  const success = buildCustomerSuccessProfile(company, metrics, tickets);

  title.textContent = company.company_name || "Customer Account";
  workspaceButton.disabled = false;
  onboardingButton.disabled = false;
  workspaceButton.onclick = () => openCompanyWorkspace(company.id, "company-admin.html");
  onboardingButton.onclick = () => openCompanyWorkspace(company.id, "onboarding.html");

  body.innerHTML = `
    <div class="customer-account-hero">
      <div>
        <p class="section-eyebrow">${escapeHtml(formatOperationType(company.operation_type || "carrier"))} / ${escapeHtml(formatStatus(company.account_type || "customer"))}</p>
        <h3>${escapeHtml(company.company_name || "Unnamed Company")}</h3>
        <p>${escapeHtml(company.legal_name || company.email || "No legal name or contact email saved yet.")}</p>
      </div>
      <div class="customer-launch-score ${launch.blockers.length ? "attention" : "complete"}">
        <strong>${launch.percent}%</strong>
        <span>${launch.blockers.length ? `${launch.blockers.length} launch blocker${launch.blockers.length === 1 ? "" : "s"}` : "Ready for handoff"}</span>
      </div>
    </div>

    <div class="customer-account-grid">
      ${accountStat("Status", formatStatus(company.status || "active"))}
      ${accountStat("Stage", formatStatus(company.lifecycle_stage || "trial"))}
      ${accountStat("Handoff", formatStatus(company.handoff_status || "setup"))}
      ${accountStat("Health", formatStatus(company.customer_health || "healthy"))}
      ${accountStat("Renewal Risk", formatStatus(company.renewal_risk || "low"))}
      ${accountStat("Subscription", subscription.plan_name ? `${formatPlanLabel(subscription.plan_name)} / ${formatStatus(subscription.billing_status || "trial")}` : "Missing")}
      ${accountStat("Users", `${users.length} active / ${invites.length} invite${invites.length === 1 ? "" : "s"}`)}
      ${accountStat("Loads", metrics.loads || 0)}
      ${accountStat("Customers", metrics.customers || 0)}
      ${accountStat("Documents", metrics.documents || 0)}
    </div>

    <div class="customer-account-columns">
      <article>
        <h3>Launch Checklist</h3>
        <div class="dashboard-list">
          ${launch.items.map(item => `
            <div class="dashboard-list-item">
              <span class="readiness-status ${item.ok ? "pass" : item.required ? "blocker" : "warning"}">${item.ok ? "OK" : item.required ? "!" : "?"}</span>
              <span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </span>
            </div>
          `).join("")}
        </div>
      </article>
      <article>
        <h3>Handoff Notes</h3>
        <form class="handoff-note-box" id="customerHandoffForm">
          <div class="handoff-form-grid">
            <div class="field">
              <label>Handoff Status</label>
              <select name="handoff_status">
                ${["setup", "training", "live", "needs_attention"].map(status => (
                  `<option value="${status}" ${(company.handoff_status || "setup") === status ? "selected" : ""}>${formatStatus(status)}</option>`
                )).join("")}
              </select>
            </div>
            <div class="field">
              <label>Last Customer Contact</label>
              <input name="last_customer_contact" type="date" value="${escapeHtml(company.last_customer_contact || "")}" />
            </div>
            <div class="field">
              <label>Go-Live Date</label>
              <input name="go_live_date" type="date" value="${escapeHtml(company.go_live_date || "")}" />
            </div>
          </div>
          <div class="field full-width">
            <label>Internal Onboarding Notes</label>
            <textarea name="onboarding_notes" rows="5" placeholder="Training notes, customer requests, blockers, handoff details">${escapeHtml(company.onboarding_notes || "")}</textarea>
          </div>
          ${launch.blockers.length
            ? `<strong>Do not hand off yet.</strong><p>Finish: ${escapeHtml(launch.blockers.join(", "))}.</p>`
            : `<strong>Ready for customer handoff.</strong><p>Confirm login, onboarding, subscription, and one live workflow with the customer.</p>`}
          <p><strong>Suggested next action:</strong> ${escapeHtml(launch.nextAction)}</p>
          <button class="btn" type="submit">Save Handoff</button>
        </form>
      </article>
    </div>

    <div class="customer-account-columns">
      <article>
        <h3>Customer Success</h3>
        <form class="handoff-note-box" id="customerSuccessForm">
          <div class="handoff-form-grid">
            <div class="field">
              <label>Account Health</label>
              <select name="customer_health">
                ${["healthy", "watch", "at_risk"].map(status => (
                  `<option value="${status}" ${(company.customer_health || "healthy") === status ? "selected" : ""}>${formatStatus(status)}</option>`
                )).join("")}
              </select>
            </div>
            <div class="field">
              <label>Usage Level</label>
              <select name="usage_level">
                ${["unknown", "low", "medium", "high"].map(level => (
                  `<option value="${level}" ${(company.usage_level || "unknown") === level ? "selected" : ""}>${formatStatus(level)}</option>`
                )).join("")}
              </select>
            </div>
            <div class="field">
              <label>Renewal Risk</label>
              <select name="renewal_risk">
                ${["low", "medium", "high"].map(risk => (
                  `<option value="${risk}" ${(company.renewal_risk || "low") === risk ? "selected" : ""}>${formatStatus(risk)}</option>`
                )).join("")}
              </select>
            </div>
            <div class="field">
              <label>Last Check-In</label>
              <input name="last_success_checkin" type="date" value="${escapeHtml(company.last_success_checkin || "")}" />
            </div>
            <div class="field">
              <label>Next Follow-Up</label>
              <input name="next_follow_up_date" type="date" value="${escapeHtml(company.next_follow_up_date || "")}" />
            </div>
          </div>
          <div class="field full-width">
            <label>Customer Success Notes</label>
            <textarea name="customer_success_notes" rows="5" placeholder="Usage notes, renewal concerns, customer goals, support follow-ups">${escapeHtml(company.customer_success_notes || "")}</textarea>
          </div>
          <button class="btn" type="submit">Save Customer Success</button>
        </form>
      </article>
      <article>
        <h3>Success Signals</h3>
        <div class="dashboard-list">
          ${success.items.map(item => `
            <div class="dashboard-list-item">
              <span class="readiness-status ${item.status}">${item.status === "pass" ? "OK" : item.status === "warning" ? "?" : "!"}</span>
              <span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </span>
            </div>
          `).join("")}
        </div>
      </article>
    </div>
  `;

  document.getElementById("customerHandoffForm")?.addEventListener("submit", event => saveCustomerHandoff(event, company.id));
  document.getElementById("customerSuccessForm")?.addEventListener("submit", event => saveCustomerSuccess(event, company.id));
}

function accountStat(label, value) {
  return `
    <div class="customer-account-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function buildCustomerLaunchProfile(company, metrics, subscription, users, invites) {
  const operationType = company.operation_type || "carrier";
  const profileComplete = Boolean(company.company_name && (company.legal_name || company.email || company.phone) && (company.mc_number || company.dot_number || operationType === "dispatcher"));
  const hasSubscription = Boolean(subscription.plan_name);
  const hasOwner = users.some(user => ["company_owner", "company_admin", "owner", "admin"].includes(user.role));
  const hasCustomers = Number(metrics.customers || 0) > 0;
  const hasLoads = Number(metrics.loads || 0) > 0;
  const hasDrivers = Number(metrics.drivers || 0) > 0;
  const hasTrucks = Number(metrics.trucks || 0) > 0;
  const hasCarriers = Number(metrics.carriers || 0) > 0;
  const hasDocuments = Number(metrics.documents || 0) > 0;

  const items = [
    launchItem("Company profile", profileComplete, "Company has name, contact/legal detail, and applicable MC/DOT information.", true),
    launchItem("Subscription", hasSubscription, hasSubscription ? `${formatPlanLabel(subscription.plan_name)} plan is saved.` : "No subscription record found.", true),
    launchItem("Owner/admin user", hasOwner, `${users.length} active user${users.length === 1 ? "" : "s"} and ${invites.length} invite${invites.length === 1 ? "" : "s"} found.`, true)
  ];

  if (["carrier", "dispatcher", "hybrid"].includes(operationType)) {
    items.push(launchItem("Drivers", hasDrivers, `${metrics.drivers || 0} driver${metrics.drivers === 1 ? "" : "s"} saved.`, operationType !== "broker_3pl"));
    items.push(launchItem("Trucks", hasTrucks, `${metrics.trucks || 0} truck${metrics.trucks === 1 ? "" : "s"} saved.`, operationType !== "broker_3pl"));
  }

  items.push(launchItem("Customers", hasCustomers, `${metrics.customers || 0} customer${metrics.customers === 1 ? "" : "s"} saved.`, true));

  if (["broker_3pl", "hybrid"].includes(operationType)) {
    items.push(launchItem("Carrier network", hasCarriers, `${metrics.carriers || 0} carrier${metrics.carriers === 1 ? "" : "s"} saved.`, true));
  }

  items.push(launchItem("First load", hasLoads, `${metrics.loads || 0} load${metrics.loads === 1 ? "" : "s"} saved.`, true));
  items.push(launchItem("Documents", hasDocuments, `${metrics.documents || 0} document${metrics.documents === 1 ? "" : "s"} saved.`, false));

  const required = items.filter(item => item.required);
  const completeRequired = required.filter(item => item.ok).length;
  const blockers = required.filter(item => !item.ok).map(item => item.title);
  const percent = required.length ? Math.round((completeRequired / required.length) * 100) : 0;
  const nextAction = blockers[0] || (hasDocuments ? "Schedule customer walkthrough." : "Upload sample POD, insurance, or load document.");

  return { items, blockers, percent, nextAction };
}

function launchItem(title, ok, detail, required) {
  return { title, ok, detail, required };
}

function buildCustomerSuccessProfile(company, metrics, tickets) {
  const today = new Date();
  const nextFollowUp = company.next_follow_up_date ? new Date(company.next_follow_up_date) : null;
  const lastCheckin = company.last_success_checkin ? new Date(company.last_success_checkin) : null;
  const activeRecords = Number(metrics.loads || 0) + Number(metrics.customers || 0) + Number(metrics.documents || 0);
  const followUpDue = nextFollowUp && !Number.isNaN(nextFollowUp.getTime()) && nextFollowUp < startOfDay(today);
  const checkinOld = !lastCheckin || daysBetween(lastCheckin, today) > 30;
  const openSupport = tickets.length;
  const highRisk = company.renewal_risk === "high" || company.customer_health === "at_risk";

  return {
    items: [
      successItem("Usage level", activeRecords > 0 ? "pass" : "warning", activeRecords > 0 ? `${activeRecords} operating records show workspace activity.` : "No active operating records found yet."),
      successItem("Follow-up schedule", followUpDue ? "blocker" : "pass", followUpDue ? `Follow-up was due on ${formatDate(company.next_follow_up_date)}.` : company.next_follow_up_date ? `Next follow-up is ${formatDate(company.next_follow_up_date)}.` : "No follow-up date set."),
      successItem("Check-in freshness", checkinOld ? "warning" : "pass", checkinOld ? "No customer success check-in recorded in the last 30 days." : `Last check-in was ${formatDate(company.last_success_checkin)}.`),
      successItem("Support issues", openSupport > 0 ? "warning" : "pass", openSupport > 0 ? `${openSupport} open support ticket${openSupport === 1 ? "" : "s"} found.` : "No open support tickets found."),
      successItem("Renewal risk", highRisk ? "blocker" : "pass", highRisk ? "Account is marked at risk or high renewal risk." : "Renewal risk is not currently high.")
    ]
  };
}

function successItem(title, status, detail) {
  return { title, status, detail };
}

async function saveCustomerHandoff(event, companyId) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });
  data.handoff_updated_at = new Date().toISOString();
  data.updated_at = new Date().toISOString();

  msg.textContent = "Saving customer handoff...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update(data)
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("handoff_status") || error.message.includes("onboarding_notes")
      ? "Run customer-handoff.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "company_handoff",
    entity_id: companyId,
    description: `Updated customer handoff status to ${data.handoff_status}.`,
    metadata: data
  });

  msg.textContent = "Customer handoff saved.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function saveCustomerSuccess(event, companyId) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });
  data.success_updated_at = new Date().toISOString();
  data.updated_at = new Date().toISOString();

  msg.textContent = "Saving customer success...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update(data)
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("customer_health") || error.message.includes("renewal_risk")
      ? "Run customer-success.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "customer_success",
    entity_id: companyId,
    description: `Updated customer success health to ${data.customer_health}.`,
    metadata: data
  });

  msg.textContent = "Customer success saved.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateCustomerHealth(companyId, customerHealth) {
  msg.textContent = "Updating customer health...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update({
      customer_health: customerHealth,
      success_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("customer_health")
      ? "Run customer-success.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const company = companies.find(row => String(row.id) === String(companyId));
  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "customer_success",
    entity_id: companyId,
    description: `Set ${company?.company_name || "company"} customer health to ${formatStatus(customerHealth)}.`,
    metadata: { customer_health: customerHealth }
  });

  msg.textContent = "Customer health updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

function openCompanyWorkspace(companyId, page) {
  window.CompanyContext?.setCompanyId(companyId);
  window.location.href = page;
}

function renderCompanyOptions() {
  const selects = [
    document.getElementById("platformUserCompany"),
    document.getElementById("platformInviteCompany")
  ].filter(Boolean);

  selects.forEach(select => {
    select.innerHTML = `<option value="">Select company</option>`;

    companies.forEach(company => {
      const option = document.createElement("option");
      option.value = company.id;
      option.textContent = company.company_name;
      select.appendChild(option);
    });
  });
}

function renderInvites() {
  const tbody = document.getElementById("platformInvitesTableBody");
  tbody.innerHTML = "";

  if (!userInvites.length) {
    tbody.innerHTML = `<tr><td colspan="7">No user invites found.</td></tr>`;
    return;
  }

  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  userInvites.forEach(invite => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(companyNames.get(invite.company_id) || "Unknown company")}</td>
      <td>${escapeHtml(invite.email)}</td>
      <td>${formatStatus(invite.role)}</td>
      <td>${formatStatus(invite.status)}</td>
      <td>${formatDate(invite.created_at)}</td>
      <td>
        <input
          class="compact-input"
          data-invite-user-id="${escapeHtml(invite.id)}"
          placeholder="Paste Auth User ID"
          ${invite.status === "accepted" ? "disabled" : ""}
        />
      </td>
      <td>
        <button class="view" type="button" data-activate-invite="${escapeHtml(invite.id)}" ${invite.status === "accepted" ? "disabled" : ""}>Activate</button>
        <button class="delete" type="button" data-cancel-invite="${escapeHtml(invite.id)}">Cancel</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-activate-invite]").forEach(button => {
    button.addEventListener("click", () => activateInvite(button.dataset.activateInvite));
  });

  tbody.querySelectorAll("[data-cancel-invite]").forEach(button => {
    button.addEventListener("click", () => updateInviteStatus(button.dataset.cancelInvite, "canceled"));
  });
}

function renderSubscriptions() {
  const tbody = document.getElementById("platformSubscriptionsTableBody");
  tbody.innerHTML = "";

  if (!companies.length) {
    tbody.innerHTML = `<tr><td colspan="10">No companies found.</td></tr>`;
    return;
  }

  const subscriptionMap = new Map(companySubscriptions.map(subscription => [subscription.company_id, subscription]));

  companies.forEach(company => {
    const subscription = subscriptionMap.get(company.id) || {};
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(company.company_name)}</td>
      <td>
        <select data-subscription-field="plan_name" data-plan-select="${escapeHtml(company.id)}" data-subscription-company="${escapeHtml(company.id)}">
          ${["starter", "professional", "business", "enterprise"].map(plan => (
            `<option value="${plan}" ${(subscription.plan_name || "professional") === plan ? "selected" : ""}>${formatPlanLabel(plan)}</option>`
          )).join("")}
        </select>
      </td>
      <td><input class="compact-input" type="number" min="0" step="0.01" data-subscription-field="monthly_price" data-price-input="${escapeHtml(company.id)}" data-subscription-company="${escapeHtml(company.id)}" value="${escapeHtml(subscription.monthly_price ?? PLAN_PRICES[subscription.plan_name || "professional"])}" /></td>
      <td>
        <select data-subscription-field="billing_status" data-subscription-company="${escapeHtml(company.id)}">
          ${["trial", "active", "past_due", "suspended", "canceled"].map(status => (
            `<option value="${status}" ${(subscription.billing_status || "trial") === status ? "selected" : ""}>${formatStatus(status)}</option>`
          )).join("")}
        </select>
      </td>
      <td><input class="compact-input" type="date" data-subscription-field="trial_ends_at" data-subscription-company="${escapeHtml(company.id)}" value="${escapeHtml(subscription.trial_ends_at || "")}" /></td>
      <td><input class="compact-input" type="date" data-subscription-field="renews_at" data-subscription-company="${escapeHtml(company.id)}" value="${escapeHtml(subscription.renews_at || "")}" /></td>
      <td>
        <select data-subscription-field="payment_setup_status" data-subscription-company="${escapeHtml(company.id)}">
          ${PAYMENT_SETUP_STATUSES.map(status => (
            `<option value="${status}" ${(subscription.payment_setup_status || "not_started") === status ? "selected" : ""}>${formatStatus(status)}</option>`
          )).join("")}
        </select>
      </td>
      <td>
        <div class="subscription-stack">
          <input class="compact-input" type="email" data-subscription-field="billing_email" data-subscription-company="${escapeHtml(company.id)}" placeholder="billing@email.com" value="${escapeHtml(subscription.billing_email || company.email || "")}" />
          <input class="compact-input" data-subscription-field="payment_link" data-subscription-company="${escapeHtml(company.id)}" placeholder="Payment link" value="${escapeHtml(subscription.payment_link || "")}" />
        </div>
      </td>
      <td><input class="compact-input" data-subscription-field="notes" data-subscription-company="${escapeHtml(company.id)}" value="${escapeHtml(subscription.notes || "")}" /></td>
      <td><button class="view" type="button" data-save-subscription="${escapeHtml(company.id)}">Save</button></td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-save-subscription]").forEach(button => {
    button.addEventListener("click", () => saveSubscription(button.dataset.saveSubscription));
  });

  tbody.querySelectorAll("[data-plan-select]").forEach(select => {
    select.addEventListener("change", () => {
      const priceInput = Array.from(document.querySelectorAll("[data-price-input]"))
        .find(input => String(input.dataset.priceInput) === String(select.dataset.planSelect));
      if (priceInput) priceInput.value = PLAN_PRICES[select.value] ?? 0;
    });
  });
}

function renderPaymentReadiness() {
  const list = document.getElementById("paymentReadinessList");
  if (!list) return;

  const sellableCompanies = getSellableCompanies();
  const activeSubscriptions = companySubscriptions.filter(subscription =>
    subscription.billing_status === "active" && isSellableCompanyId(subscription.company_id)
  );
  const trialSubscriptions = companySubscriptions.filter(subscription =>
    subscription.billing_status === "trial" && isSellableCompanyId(subscription.company_id)
  );
  const pastDueSubscriptions = companySubscriptions.filter(subscription =>
    ["past_due", "suspended"].includes(subscription.billing_status) && isSellableCompanyId(subscription.company_id)
  );
  const paymentReadySubscriptions = companySubscriptions.filter(subscription =>
    ["payment_method_on_file", "auto_billing_ready"].includes(subscription.payment_setup_status) && isSellableCompanyId(subscription.company_id)
  );
  const missingBillingSetup = companySubscriptions.filter(subscription =>
    ["trial", "active"].includes(subscription.billing_status) &&
    isSellableCompanyId(subscription.company_id) &&
    !["payment_link_sent", "payment_method_on_file", "auto_billing_ready"].includes(subscription.payment_setup_status)
  );
  const companiesWithoutSubscription = sellableCompanies.filter(company =>
    !companySubscriptions.some(subscription => String(subscription.company_id) === String(company.id))
  );
  const mrr = activeSubscriptions.reduce((sum, subscription) => sum + Number(subscription.monthly_price || 0), 0);
  const trialPipeline = trialSubscriptions.reduce((sum, subscription) => sum + Number(subscription.monthly_price || 0), 0);

  const items = [
    {
      title: "Active monthly revenue",
      status: activeSubscriptions.length ? "pass" : "warning",
      detail: `${formatCurrency(mrr)} active MRR from ${activeSubscriptions.length} active subscription${activeSubscriptions.length === 1 ? "" : "s"}.`
    },
    {
      title: "Trial pipeline",
      status: trialSubscriptions.length ? "pass" : "warning",
      detail: `${formatCurrency(trialPipeline)} possible MRR from ${trialSubscriptions.length} trial subscription${trialSubscriptions.length === 1 ? "" : "s"}.`
    },
    {
      title: "Missing subscription records",
      status: companiesWithoutSubscription.length ? "warning" : "pass",
      detail: `${companiesWithoutSubscription.length} customer compan${companiesWithoutSubscription.length === 1 ? "y is" : "ies are"} missing subscription records.`
    },
    {
      title: "Past due accounts",
      status: pastDueSubscriptions.length ? "blocker" : "pass",
      detail: `${pastDueSubscriptions.length} subscription${pastDueSubscriptions.length === 1 ? "" : "s"} are past due or suspended.`
    },
    {
      title: "Payment setup tracked",
      status: missingBillingSetup.length ? "warning" : "pass",
      detail: `${paymentReadySubscriptions.length} subscription${paymentReadySubscriptions.length === 1 ? "" : "s"} have payment method or auto-billing readiness marked.`
    },
    {
      title: "Stripe/live payment collection",
      status: "warning",
      detail: "Manual billing tracking is ready. Use payment links now, then connect Stripe Checkout before public self-service selling."
    }
  ];

  list.innerHTML = items.map(item => `
    <div class="dashboard-list-item readiness-item ${escapeHtml(item.status)}">
      <span class="readiness-dot ${escapeHtml(item.status)}">${item.status === "pass" ? "OK" : item.status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </div>
  `).join("");
}

function renderDeploymentReadiness() {
  const list = document.getElementById("deploymentReadinessList");
  if (!list) return;

  const host = window.location.hostname;
  const isPreviewHost = host.includes("stackblitz") || host.includes("webcontainer") || host === "localhost" || host === "127.0.0.1";
  const isSecure = window.location.protocol === "https:";
  const hasRealDomain = !isPreviewHost && host.includes(".");

  const items = [
    {
      title: "Production domain",
      status: hasRealDomain ? "pass" : "warning",
      detail: hasRealDomain
        ? `Running on ${host}.`
        : "Still running on preview/local hosting. Move to app.hyperrouteintelligence.com or another production domain before selling."
    },
    {
      title: "HTTPS",
      status: isSecure ? "pass" : "blocker",
      detail: isSecure ? "Secure HTTPS connection detected." : "Production app must use HTTPS."
    },
    {
      title: "Supabase production project",
      status: "pass",
      detail: "Supabase client is configured. Confirm Auth URL redirects include your final production domain."
    },
    {
      title: "Email confirmation redirects",
      status: hasRealDomain ? "pass" : "warning",
      detail: hasRealDomain
        ? "Update Supabase Auth redirect URLs to this domain if not already done."
        : "When deployed, add the production login/onboarding URLs in Supabase Auth settings."
    },
    {
      title: "Backups and owner access",
      status: "warning",
      detail: "Before selling, confirm Supabase backups, platform admin access, and recovery email are controlled by HyperRoute."
    }
  ];

  list.innerHTML = items.map(item => `
    <div class="dashboard-list-item readiness-item ${escapeHtml(item.status)}">
      <span class="readiness-dot ${escapeHtml(item.status)}">${item.status === "pass" ? "OK" : item.status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </div>
  `).join("");
}

const QA_STORAGE_KEY = "hyperroute_platform_qa_checklist";

const QA_ITEMS = [
  ["auth", "Login / logout", "Log in, log out, refresh, and confirm protected pages redirect correctly."],
  ["company-switch", "Company switching", "Switch companies and confirm dashboards/data change to the selected company."],
  ["drivers", "Drivers", "Create, view, edit, delete/archive, and compliance dates."],
  ["vehicles", "Vehicles", "Create, view, edit, delete/archive, assignment visibility."],
  ["loads", "Loads", "Create, view details, edit, dispatch statuses, delete/archive if available."],
  ["customers", "Customers", "Create, view, edit, connect to loads/invoices."],
  ["invoices", "Invoices", "Create from load, view, edit, status updates, totals."],
  ["documents", "Documents", "Upload/link document records and confirm POD logic."],
  ["maintenance", "Maintenance", "Create logs, schedules, due/overdue alerts."],
  ["reports", "Reports", "Open reports, export/print where available, check totals."],
  ["support", "Support", "Create ticket, reply, update status, platform admin queue."],
  ["notifications", "Notifications", "Scan business events and mark read/all read."],
  ["roles", "Roles/access", "Test owner/admin/dispatcher/accounting/maintenance/driver access."],
  ["mobile", "Mobile preview", "Check sidebar, tables, forms, and buttons on narrow screen."]
];

function renderQaChecklist() {
  const summary = document.getElementById("qaChecklistSummary");
  const list = document.getElementById("qaChecklistList");
  if (!summary || !list) return;

  const completed = getQaCompleted();
  const done = QA_ITEMS.filter(([id]) => completed[id]).length;
  const percent = Math.round((done / QA_ITEMS.length) * 100);
  const status = percent === 100 ? "pass" : percent >= 70 ? "warning" : "blocker";

  summary.innerHTML = `
    <div class="dashboard-list-item readiness-item ${status}">
      <span class="readiness-dot ${status}">${status === "pass" ? "OK" : status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${done}/${QA_ITEMS.length} QA checks complete (${percent}%)</strong>
        <small>Complete this before selling to companies outside your trusted beta group.</small>
      </span>
    </div>
  `;

  list.innerHTML = QA_ITEMS.map(([id, title, detail]) => `
    <label class="qa-checklist-item">
      <input type="checkbox" data-qa-item="${escapeHtml(id)}" ${completed[id] ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
      </span>
    </label>
  `).join("");

  list.querySelectorAll("[data-qa-item]").forEach(input => {
    input.addEventListener("change", updateQaChecklist);
  });
}

function getQaCompleted() {
  try {
    return JSON.parse(localStorage.getItem(QA_STORAGE_KEY) || "{}");
  } catch (err) {
    return {};
  }
}

function updateQaChecklist(event) {
  const completed = getQaCompleted();
  completed[event.target.dataset.qaItem] = event.target.checked;
  localStorage.setItem(QA_STORAGE_KEY, JSON.stringify(completed));
  renderQaChecklist();
}

function resetQaChecklist() {
  localStorage.removeItem(QA_STORAGE_KEY);
  renderQaChecklist();
}

function renderCompanyUsers() {
  const tbody = document.getElementById("platformUsersTableBody");
  tbody.innerHTML = "";

  if (!companyUsers.length) {
    tbody.innerHTML = `<tr><td colspan="5">No company users found.</td></tr>`;
    return;
  }

  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  companyUsers.forEach(user => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(companyNames.get(user.company_id) || "Unknown company")}</td>
      <td>${escapeHtml(user.user_id)}</td>
      <td>${formatStatus(user.role)}</td>
      <td>${formatStatus(user.status)}</td>
      <td>${formatDate(user.created_at)}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderSupportTickets() {
  const tbody = document.getElementById("platformSupportTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!supportTickets.length) {
    tbody.innerHTML = `<tr><td colspan="6">No support tickets found.</td></tr>`;
    return;
  }

  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  supportTickets.forEach(ticket => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(companyNames.get(ticket.company_id) || "Unknown company")}</td>
      <td>
        <strong>${escapeHtml(ticket.subject)}</strong>
        <span class="muted-line">${escapeHtml(ticket.description || "")}</span>
      </td>
      <td><span class="status-pill ${getTicketPriorityClass(ticket.priority)}">${formatStatus(ticket.priority)}</span></td>
      <td>
        <select data-ticket-status="${escapeHtml(ticket.id)}">
          ${["open", "in_progress", "resolved", "closed"].map(status => (
            `<option value="${status}" ${ticket.status === status ? "selected" : ""}>${formatStatus(status)}</option>`
          )).join("")}
        </select>
      </td>
      <td>${formatDate(ticket.updated_at || ticket.created_at)}</td>
      <td>
        <button class="view" type="button" data-open-support-ticket="${escapeHtml(ticket.id)}">Open</button>
        <button class="view secondary-action" type="button" data-save-ticket="${escapeHtml(ticket.id)}">Save</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-open-support-ticket]").forEach(button => {
    button.addEventListener("click", () => openPlatformSupportConversation(button.dataset.openSupportTicket));
  });

  tbody.querySelectorAll("[data-save-ticket]").forEach(button => {
    button.addEventListener("click", () => saveTicketStatus(button.dataset.saveTicket));
  });
}

function updateKpis() {
  const totalLoads = Array.from(companyMetrics.values()).reduce((sum, metrics) => sum + (metrics.loads || 0), 0);

  document.getElementById("platformCompanyCount").textContent = companies.length;
  document.getElementById("platformActiveCompanyCount").textContent = getSellableCompanies().filter(company => company.status === "active").length;
  document.getElementById("platformUserCount").textContent = companyUsers.length;
  document.getElementById("platformInviteCount").textContent = userInvites.filter(invite => invite.status === "pending").length;
  document.getElementById("platformLoadCount").textContent = totalLoads;
  document.getElementById("platformMonthlyRevenue").textContent = formatCurrency(companySubscriptions
    .filter(subscription => subscription.billing_status === "active" && isSellableCompanyId(subscription.company_id))
    .reduce((sum, subscription) => sum + Number(subscription.monthly_price || 0), 0));
  document.getElementById("platformPastDueCount").textContent = companySubscriptions
    .filter(subscription => ["past_due", "suspended"].includes(subscription.billing_status)).length;
}

function renderReadiness() {
  const blockers = readinessItems.filter(item => item.status === "blocker");
  const warnings = readinessItems.filter(item => item.status === "warning");
  const passed = readinessItems.filter(item => item.status === "pass").length;
  const total = readinessItems.length || 1;
  const score = Math.max(0, Math.min(100, Math.round((passed / total) * 100) - (blockers.length * 6)));
  const readyTables = tableHealth.filter(row => row.ok).length;

  document.getElementById("readinessScore").textContent = `${score}%`;
  document.getElementById("readinessScoreBar").style.width = `${score}%`;
  document.getElementById("readinessBlockers").textContent = blockers.length;
  document.getElementById("readinessWarnings").textContent = warnings.length + companyQualityWarnings.length;
  document.getElementById("readinessTablesReady").textContent = `${readyTables}/${tableHealth.length}`;

  document.getElementById("readinessSummary").textContent = getReadinessSummary(score, blockers.length, warnings.length);
  const nextFix = blockers[0] || warnings[0] || (companyQualityWarnings[0] ? { title: companyQualityWarnings[0].company, detail: companyQualityWarnings[0].warning } : null);
  document.getElementById("readinessNextFix").textContent = nextFix
    ? `${nextFix.title}: ${nextFix.detail}`
    : "No major readiness issues found.";

  renderReadinessChecklist();
  renderTableHealth();
  renderLaunchPlan();
  renderCompanyQualityWarnings();
}

function getReadinessSummary(score, blockerCount, warningCount) {
  if (blockerCount > 0) return `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} must be fixed before selling.`;
  if (score >= 85) return "This system is close to sell-ready. Focus on final testing, hosting, and customer support process.";
  if (warningCount > 0) return `${warningCount} platform warning${warningCount === 1 ? "" : "s"} remain before a confident launch.`;
  return "Core platform checks are passing. Continue production testing with real workflows.";
}

function renderReadinessChecklist() {
  const list = document.getElementById("readinessChecklist");
  list.innerHTML = readinessItems.map(item => `
    <div class="dashboard-list-item readiness-item ${escapeHtml(item.status)}">
      <span class="readiness-dot ${escapeHtml(item.status)}">${item.status === "pass" ? "OK" : item.status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </div>
  `).join("");
}

function renderTableHealth() {
  const tbody = document.getElementById("tableHealthBody");
  tbody.innerHTML = "";

  tableHealth.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.area)}</td>
      <td>${escapeHtml(row.table)}</td>
      <td><span class="status-pill ${row.ok ? "success" : "warning"}">${row.ok ? "Ready" : "Missing / blocked"}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderLaunchPlan() {
  const checklist = document.getElementById("launchChecklist");
  const revenuePlan = document.getElementById("launchRevenuePlan");
  if (!checklist || !revenuePlan) return;

  const launchItems = buildLaunchItems();
  checklist.innerHTML = launchItems.map(item => `
    <div class="dashboard-list-item readiness-item ${escapeHtml(item.status)}">
      <span class="readiness-dot ${escapeHtml(item.status)}">${item.status === "pass" ? "OK" : item.status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </div>
  `).join("");

  const monthlyRevenue = getActiveMonthlyRevenue();
  const trialPipeline = getTrialPipelineRevenue();
  const targets = [
    { label: "Current MRR", value: formatCurrency(monthlyRevenue), detail: "Active paying subscription revenue." },
    { label: "Trial Pipeline", value: formatCurrency(trialPipeline), detail: "Potential MRR if trials convert." },
    { label: "10 Customers", value: formatCurrency(1990), detail: "Starter beta goal at roughly $199 average." },
    { label: "25 Customers", value: formatCurrency(4975), detail: "Early traction target before scaling support." }
  ];

  revenuePlan.innerHTML = targets.map(target => `
    <div class="launch-revenue-card">
      <strong>${escapeHtml(target.value)}</strong>
      <span>${escapeHtml(target.label)}</span>
      <small>${escapeHtml(target.detail)}</small>
    </div>
  `).join("");
}

function renderIsolationTestPlaceholder() {
  const summary = document.getElementById("isolationTestSummary");
  const tbody = document.getElementById("isolationTestTableBody");
  if (!summary || !tbody) return;

  renderSecurityAuditStats([]);
  summary.innerHTML = `
    <div class="dashboard-list-item readiness-item warning">
      <span class="readiness-dot warning">?</span>
      <span>
        <strong>Security audit not run this session</strong>
        <small>Run this before onboarding real customers. It checks company-scoped tables, missing company IDs, platform admin access, and isolation readiness.</small>
      </span>
    </div>
  `;
  tbody.innerHTML = `<tr><td colspan="4">Click Run Security Audit.</td></tr>`;
}

async function runIsolationTest() {
  const button = document.getElementById("runIsolationTestBtn");
  const summary = document.getElementById("isolationTestSummary");
  const tbody = document.getElementById("isolationTestTableBody");
  if (!summary || !tbody) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Auditing...";
  }

  summary.innerHTML = `
    <div class="dashboard-list-item readiness-item warning">
      <span class="readiness-dot warning">?</span>
      <span>
        <strong>Running security audit...</strong>
        <small>Checking company isolation, required security tables, and scoped records.</small>
      </span>
    </div>
  `;

  const testTables = [
    "drivers", "trucks", "loads", "assignments", "customers", "carriers", "load_tenders", "load_communications", "load_issues", "quotes",
    "invoices", "settlements", "documents", "maintenance_logs",
    "maintenance_schedules", "alerts", "load_events", "support_tickets",
    "notifications"
  ];

  const structuralResults = await buildSecurityStructuralChecks();
  const tableResults = await Promise.all(testTables.map(testCompanyScopedTable));
  const results = [...structuralResults, ...tableResults];
  const blockers = results.filter(row => row.status === "blocker");
  const warnings = results.filter(row => row.status === "warning");
  const passes = results.filter(row => row.status === "pass");
  renderSecurityAuditStats(results);

  summary.innerHTML = `
    <div class="dashboard-list-item readiness-item ${blockers.length ? "blocker" : warnings.length ? "warning" : "pass"}">
      <span class="readiness-dot ${blockers.length ? "blocker" : warnings.length ? "warning" : "pass"}">${blockers.length ? "!" : warnings.length ? "?" : "OK"}</span>
      <span>
        <strong>${passes.length}/${results.length} security checks passed</strong>
        <small>${blockers.length} blocker${blockers.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}. This verifies app-visible company scoping; keep the SQL policy audit as your final proof before launch.</small>
      </span>
    </div>
  `;

  tbody.innerHTML = results.map(row => `
    <tr>
      <td>${escapeHtml(row.table)}</td>
      <td><span class="status-pill ${row.status === "pass" ? "success" : row.status === "warning" ? "caution" : "warning"}">${escapeHtml(row.label)}</span></td>
      <td>${escapeHtml(row.recordSummary)}</td>
      <td>${escapeHtml(row.issue)}</td>
    </tr>
  `).join("");

  if (button) {
    button.disabled = false;
    button.textContent = "Run Security Audit";
  }
}

function renderSecurityAuditStats(results) {
  const scoreEl = document.getElementById("securityAuditScore");
  const blockersEl = document.getElementById("securityAuditBlockers");
  const warningsEl = document.getElementById("securityAuditWarnings");
  const tablesEl = document.getElementById("securityAuditTables");
  if (!scoreEl || !blockersEl || !warningsEl || !tablesEl) return;

  if (!results.length) {
    scoreEl.textContent = "Not Run";
    blockersEl.textContent = "-";
    warningsEl.textContent = "-";
    tablesEl.textContent = "-";
    return;
  }

  const blockers = results.filter(row => row.status === "blocker").length;
  const warnings = results.filter(row => row.status === "warning").length;
  const passes = results.filter(row => row.status === "pass").length;
  const score = Math.max(0, Math.min(100, Math.round((passes / results.length) * 100) - (blockers * 8)));

  scoreEl.textContent = `${score}%`;
  blockersEl.textContent = blockers;
  warningsEl.textContent = warnings;
  tablesEl.textContent = results.length;
}

async function buildSecurityStructuralChecks() {
  const securityTables = ["companies", "company_users", "user_invites", "platform_admins", "activity_logs"];
  const missingSecurityTables = securityTables.filter(table => !tableHealth.find(row => row.table === table)?.ok);
  const activeCompanies = companies.filter(company => company.status === "active");
  const activeCompanyUsers = companyUsers.filter(user => user.status === "active");
  const platformAdminResult = await testPlatformAdminRpc();

  return [
    {
      table: "Platform admin access",
      status: platformAdminResult.status,
      label: platformAdminResult.label,
      recordSummary: platformAdminResult.recordSummary,
      issue: platformAdminResult.issue
    },
    {
      table: "Security foundation",
      status: missingSecurityTables.length ? "blocker" : "pass",
      label: missingSecurityTables.length ? "Missing table" : "Ready",
      recordSummary: `${securityTables.length - missingSecurityTables.length}/${securityTables.length} tables ready`,
      issue: missingSecurityTables.length
        ? `Missing or blocked: ${missingSecurityTables.join(", ")}.`
        : "Core SaaS security tables are reachable."
    },
    {
      table: "Customer workspace separation",
      status: activeCompanies.length >= 2 ? "pass" : "warning",
      label: activeCompanies.length >= 2 ? "Testable" : "Needs demo data",
      recordSummary: `${activeCompanies.length} active compan${activeCompanies.length === 1 ? "y" : "ies"}`,
      issue: activeCompanies.length >= 2
        ? "Multiple active companies exist for Company A / Company B testing."
        : "Create at least two active companies to prove isolation."
    },
    {
      table: "Company user mapping",
      status: activeCompanyUsers.length ? "pass" : "blocker",
      label: activeCompanyUsers.length ? "Mapped" : "No users",
      recordSummary: `${activeCompanyUsers.length} active user${activeCompanyUsers.length === 1 ? "" : "s"}`,
      issue: activeCompanyUsers.length
        ? "Company users are mapped to workspaces."
        : "Add company_users rows before selling."
    }
  ];
}

async function testPlatformAdminRpc() {
  const { data, error } = await supabase.rpc("user_is_platform_admin");
  if (error) {
    return {
      status: "blocker",
      label: "RPC blocked",
      recordSummary: "Unavailable",
      issue: error.message
    };
  }

  return {
    status: data ? "pass" : "warning",
    label: data ? "Verified" : "Not admin",
    recordSummary: data ? "Current user passed" : "Current user did not pass",
    issue: data ? "Platform admin RPC returned true." : "Current user is not platform admin."
  };
}

async function testCompanyScopedTable(table) {
  const { data, error } = await supabase
    .from(table)
    .select("id, company_id")
    .limit(500);

  if (error) {
    return {
      table,
      status: "blocker",
      label: "Blocked",
      recordSummary: "Unavailable",
      issue: error.message
    };
  }

  const rows = data || [];
  const missingCompanyId = rows.filter(row => !row.company_id).length;
  const companyIds = new Set(rows.map(row => row.company_id).filter(Boolean));

  if (missingCompanyId) {
    return {
      table,
      status: "blocker",
      label: "Missing company",
      recordSummary: `${rows.length} checked`,
      issue: `${missingCompanyId} row${missingCompanyId === 1 ? "" : "s"} missing company_id.`
    };
  }

  return {
    table,
    status: rows.length ? "pass" : "warning",
    label: rows.length ? "Scoped" : "No rows",
    recordSummary: rows.length ? `${rows.length} checked across ${companyIds.size} compan${companyIds.size === 1 ? "y" : "ies"}` : "No records to test",
    issue: rows.length ? "Rows include company_id." : "Create demo records to fully prove isolation."
  };
}

function renderOnboardingReadiness() {
  const list = document.getElementById("onboardingReadinessList");
  if (!list) return;

  const sellableCompanies = getSellableCompanies();
  const activeUsers = companyUsers.filter(user => user.status === "active");
  const pendingInvites = userInvites.filter(invite => invite.status === "pending");
  const trialOrActiveSubscriptions = companySubscriptions.filter(subscription =>
    ["trial", "active"].includes(subscription.billing_status) && isSellableCompanyId(subscription.company_id)
  );
  const signupTablesReady = ["companies", "company_users", "user_invites", "company_subscriptions"]
    .every(table => tableHealth.find(row => row.table === table)?.ok);
  const companiesWithUsers = sellableCompanies.filter(company =>
    activeUsers.some(user => String(user.company_id) === String(company.id))
  );
  const companiesWithSubscriptions = sellableCompanies.filter(company =>
    trialOrActiveSubscriptions.some(subscription => String(subscription.company_id) === String(company.id))
  );

  const items = [
    {
      title: "Signup foundation",
      status: signupTablesReady ? "pass" : "blocker",
      detail: signupTablesReady
        ? "Companies, company users, invites, and subscriptions tables are reachable."
        : "Run the signup/onboarding SQL before selling."
    },
    {
      title: "Customer workspace creation",
      status: sellableCompanies.length ? "pass" : "blocker",
      detail: `${sellableCompanies.length} sellable customer workspace${sellableCompanies.length === 1 ? "" : "s"} found.`
    },
    {
      title: "User access mapping",
      status: companiesWithUsers.length === sellableCompanies.length && sellableCompanies.length ? "pass" : "warning",
      detail: `${companiesWithUsers.length}/${sellableCompanies.length} customer workspace${sellableCompanies.length === 1 ? "" : "s"} have active users.`
    },
    {
      title: "Plan selection",
      status: companiesWithSubscriptions.length === sellableCompanies.length && sellableCompanies.length ? "pass" : "warning",
      detail: `${companiesWithSubscriptions.length}/${sellableCompanies.length} customer workspace${sellableCompanies.length === 1 ? "" : "s"} have trial or active subscription records.`
    },
    {
      title: "Invite follow-up",
      status: pendingInvites.length ? "warning" : "pass",
      detail: `${pendingInvites.length} pending invite${pendingInvites.length === 1 ? "" : "s"} waiting for activation.`
    }
  ];

  list.innerHTML = items.map(item => `
    <div class="dashboard-list-item readiness-item ${escapeHtml(item.status)}">
      <span class="readiness-dot ${escapeHtml(item.status)}">${item.status === "pass" ? "OK" : item.status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </div>
  `).join("");
}

function buildLaunchItems() {
  const sellableCompanies = getSellableCompanies();
  const activeCompanies = sellableCompanies.filter(company => company.status === "active");
  const betaCompanies = sellableCompanies.filter(company => {
    const metrics = companyMetrics.get(company.id) || {};
    const users = companyUsers.filter(user => String(user.company_id) === String(company.id) && user.status === "active");
    return users.length && (metrics.drivers || 0) && (metrics.trucks || 0) && (metrics.loads || 0);
  });
  const hasActiveOrTrialSubscription = companySubscriptions.some(subscription =>
    ["active", "trial"].includes(subscription.billing_status) && isSellableCompanyId(subscription.company_id)
  );
  const requiredTablesReady = tableHealth.length && tableHealth.every(row => row.ok);
  const inviteWorkflowReady = Boolean(tableHealth.find(row => row.table === "user_invites")?.ok);
  const trackingReady = Boolean(
    tableHealth.find(row => row.table === "load_events")?.ok &&
    tableHealth.find(row => row.table === "documents")?.ok
  );
  const supportReady = Boolean(tableHealth.find(row => row.table === "support_tickets")?.ok);
  const signupReady = Boolean(tableHealth.find(row => row.table === "user_invites")?.ok && tableHealth.find(row => row.table === "company_users")?.ok);
  const hasDemoCompany = companies.some(company => company.account_type === "demo" || /demo/i.test(company.company_name || ""));
  const hasSubscriptionTable = Boolean(tableHealth.find(row => row.table === "company_subscriptions")?.ok);
  const hasRealCustomerReady = betaCompanies.some(company => company.account_type !== "demo" && company.account_type !== "internal");

  return [
    {
      title: "1. Final app testing",
      status: requiredTablesReady ? "pass" : "blocker",
      detail: requiredTablesReady
        ? "Core tables are reachable. Continue page-by-page create/view/edit/delete testing."
        : "Fix blocked/missing tables before full app testing."
    },
    {
      title: "2. Multi-company isolation",
      status: requiredTablesReady && activeCompanies.length >= 2 ? "warning" : "blocker",
      detail: activeCompanies.length >= 2
        ? "Test two active companies and confirm each only sees its own records."
        : "Create or keep two test companies so isolation can be verified."
    },
    {
      title: "3. Subscription/payment setup",
      status: hasActiveOrTrialSubscription && hasSubscriptionTable ? "warning" : "blocker",
      detail: hasActiveOrTrialSubscription
        ? "Subscription records exist. Stripe/payment collection still needs final connection before public selling."
        : "Add trial or active subscription records and connect payment collection."
    },
    {
      title: "4. Production hosting",
      status: "warning",
      detail: "Move from StackBlitz preview to a real domain before selling to outside companies."
    },
    {
      title: "5. Customer signup/onboarding",
      status: signupReady && companyUsers.length ? "pass" : "warning",
      detail: signupReady
        ? "Company-user and invite tools are available. Test a fresh customer signup end to end."
        : "Company-user and invite workflow must be reachable before onboarding."
    },
    {
      title: "6. Demo account polish",
      status: hasDemoCompany && hasDemoOperationsData() ? "pass" : "warning",
      detail: hasDemoCompany && hasDemoOperationsData()
        ? "Demo account has operational data for walkthroughs."
        : "Keep one clean demo company with drivers, trucks, loads, invoices, alerts, documents, and reports."
    },
    {
      title: "7. Legal/business pages",
      status: "warning",
      detail: "Add Privacy Policy, Terms, cancellation/refund language, and support contact before public launch."
    },
    {
      title: "8. Support process",
      status: supportReady ? "pass" : "warning",
      detail: supportReady
        ? "Support tickets are available. Define your response process before scaling customers."
        : "Support ticket table/page should be ready before selling."
    },
    {
      title: "Customer-facing tracking",
      status: trackingReady ? "pass" : "warning",
      detail: trackingReady
        ? "Load events and documents are ready for tracking visibility."
        : "Tracking needs load events and documents before customer demos."
    },
    {
      title: "First beta customer",
      status: hasRealCustomerReady ? "pass" : "warning",
      detail: `${betaCompanies.length} compan${betaCompanies.length === 1 ? "y has" : "ies have"} users plus driver, truck, and load data.`
    }
  ];
}

function getActiveMonthlyRevenue() {
  return companySubscriptions
    .filter(subscription => subscription.billing_status === "active" && isSellableCompanyId(subscription.company_id))
    .reduce((sum, subscription) => sum + Number(subscription.monthly_price || 0), 0);
}

function getTrialPipelineRevenue() {
  return companySubscriptions
    .filter(subscription => subscription.billing_status === "trial" && isSellableCompanyId(subscription.company_id))
    .reduce((sum, subscription) => sum + Number(subscription.monthly_price || 0), 0);
}

function renderCompanyQualityWarnings() {
  const list = document.getElementById("companyQualityList");

  if (!companyQualityWarnings.length) {
    list.innerHTML = `<div class="empty-state">No company setup warnings found.</div>`;
    return;
  }

  list.innerHTML = companyQualityWarnings.slice(0, 12).map(item => `
    <div class="dashboard-list-item">
      <span class="status-count warning-count">!</span>
      <span>
        <strong>${escapeHtml(item.company)}</strong>
        <small>${escapeHtml(item.warning)}</small>
      </span>
    </div>
  `).join("");
}

function renderDemoAdminPanel() {
  const summary = document.getElementById("demoAdminSummary");
  const readinessList = document.getElementById("demoReadinessList");
  const openButton = document.getElementById("openDemoCompany");
  const copyScriptButton = document.getElementById("copyPlatformDemoScript");
  const copyPitchButton = document.getElementById("copyElevatorPitch");
  const copyPricingButton = document.getElementById("copyPricingTalkTrack");
  const copyCloseButton = document.getElementById("copyCloseScript");
  const copyResetButton = document.getElementById("copyDemoResetNote");
  if (!summary || !openButton || !copyScriptButton || !copyResetButton) return;

  const demoCompany = companies.find(company =>
    (company.account_type || "").toLowerCase() === "demo" ||
    String(company.company_name || "").toLowerCase() === "hyperroute demo"
  );

  if (!demoCompany) {
    summary.textContent = "No HyperRoute Demo company found. Run the demo data SQL to create one.";
    if (readinessList) {
      readinessList.innerHTML = `
        <div class="dashboard-list-item readiness-item blocker">
          <span class="readiness-dot blocker">!</span>
          <span><strong>Demo company missing</strong><small>Create a HyperRoute Demo company before sales calls.</small></span>
        </div>
      `;
    }
    openButton.disabled = true;
  } else {
    const metrics = companyMetrics.get(demoCompany.id) || {};
    summary.textContent = `${demoCompany.company_name} is ready with ${metrics.loads || 0} loads, ${metrics.drivers || 0} drivers, ${metrics.trucks || 0} trucks, and ${metrics.invoices || 0} invoices.`;
    renderDemoReadiness(readinessList, metrics);
    openButton.disabled = false;
    openButton.onclick = () => {
      window.CompanyContext?.setCompanyId(demoCompany.id);
      window.location.href = "dashboard.html";
    };
  }

  copyScriptButton.onclick = async () => {
    await copyText(buildPlatformDemoScript());
    flashButton(copyScriptButton, "Copied");
  };

  copyPitchButton.onclick = async () => {
    await copyText(buildElevatorPitch());
    flashButton(copyPitchButton, "Copied");
  };

  copyPricingButton.onclick = async () => {
    await copyText(buildPricingTalkTrack());
    flashButton(copyPricingButton, "Copied");
  };

  copyCloseButton.onclick = async () => {
    await copyText(buildCloseScript());
    flashButton(copyCloseButton, "Copied");
  };

  copyResetButton.onclick = async () => {
    await copyText("To reset the HyperRoute Demo account, rerun the latest HyperRoute Demo SQL script in Supabase SQL Editor, then refresh Platform Admin and open the HyperRoute Demo company.");
    flashButton(copyResetButton, "Copied");
  };
}

function renderDemoReadiness(list, metrics = {}) {
  if (!list) return;

  const items = [
    ["Drivers", metrics.drivers >= 2, `${metrics.drivers || 0} drivers. Target: 2+.`],
    ["Trucks", metrics.trucks >= 2, `${metrics.trucks || 0} trucks. Target: 2+.`],
    ["Loads", metrics.loads >= 2, `${metrics.loads || 0} loads. Target: active and delivered examples.`],
    ["Invoices", metrics.invoices >= 1, `${metrics.invoices || 0} invoices. Target: 1+.`],
    ["Quotes", metrics.quotes >= 1, `${metrics.quotes || 0} quotes. Target: 1+ sales pipeline example.`],
    ["Documents", metrics.documents >= 1, `${metrics.documents || 0} documents. Target: POD/document example.`],
    ["Assignments", metrics.assignments >= 1, `${metrics.assignments || 0} assignments. Target: driver/truck/load connection.`]
  ];

  const readyCount = items.filter(([, ready]) => ready).length;
  const status = readyCount === items.length ? "pass" : readyCount >= 4 ? "warning" : "blocker";

  list.innerHTML = `
    <div class="dashboard-list-item readiness-item ${status}">
      <span class="readiness-dot ${status}">${status === "pass" ? "OK" : status === "blocker" ? "!" : "?"}</span>
      <span>
        <strong>${readyCount}/${items.length} demo areas ready</strong>
        <small>Use this to confirm the demo tells a complete sales story.</small>
      </span>
    </div>
    ${items.map(([title, ready, detail]) => `
      <div class="dashboard-list-item readiness-item ${ready ? "pass" : "warning"}">
        <span class="readiness-dot ${ready ? "pass" : "warning"}">${ready ? "OK" : "?"}</span>
        <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
      </div>
    `).join("")}
  `;
}

function buildPlatformDemoScript() {
  return [
    "HyperRoute Demo talking points",
    "",
    buildElevatorPitch(),
    "",
    "Live demo flow:",
    "1. Dashboard: show health score, risks, open receivables, and quote pipeline.",
    "2. Loads: show dispatched and delivered work, customer tracking, timeline updates, and billing workflow.",
    "3. Alerts: show compliance, maintenance, missing POD, overdue billing, and follow-up issues.",
    "4. Quotes: show future revenue and quote-to-load conversion.",
    "5. Maintenance and Compliance: show prevention of downtime and violations.",
    "6. Reports: show how owners can see operational performance without spreadsheets.",
    "",
    buildPricingTalkTrack(),
    "",
    buildCloseScript()
  ].join("\n");
}

function buildElevatorPitch() {
  return "HyperRoute Intelligence is a transportation operations command center for small and mid-sized trucking and logistics companies. It helps dispatchers and owners see what is moving, what is risky, what is owed, and what needs action today without relying on spreadsheets, scattered paperwork, or disconnected tools.";
}

function buildPricingTalkTrack() {
  return [
    "Pricing talk track:",
    "Starter at $99/month is for small carriers getting organized.",
    "Professional at $199/month is the best fit for active dispatch teams that need loads, customers, invoices, compliance, documents, and alerts.",
    "Business at $399/month is for companies with heavier volume, more users, and stronger operational oversight.",
    "For larger networks or custom needs, Enterprise can be quoted based on users, volume, onboarding, and integrations."
  ].join("\n");
}

function buildCloseScript() {
  return [
    "Close / next step:",
    "Based on what you saw, the best next step is to set up your company workspace, add your first drivers, trucks, and active loads, and run the alert dashboard against your real operation.",
    "We can start with a trial workspace, verify your workflow, and then move you into the plan that matches your dispatch volume."
  ].join("\n");
}

function flashButton(button, label) {
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

async function createCompany(event) {
  event.preventDefault();
  msg.textContent = "Creating company...";
  msg.style.color = "";

  const data = Object.fromEntries(new FormData(companyForm).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });
  data.status = "active";
  data.account_type = "customer";
  data.operation_type = "carrier";

  const { data: savedRows, error } = await supabase
    .from("companies")
    .insert(data)
    .select()
    .limit(1);
  if (error) {
    msg.textContent = error.message.includes("account_type")
      ? "Run company-lifecycle.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const saved = savedRows?.[0];
  await logActivity({
    company_id: saved?.id || null,
    action: "create",
    entity_type: "company",
    entity_id: saved?.id || null,
    description: `Created company ${data.company_name}.`,
    metadata: { company_name: data.company_name }
  });

  companyForm.reset();
  msg.textContent = "Company created.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateCompanyStatus(companyId, status) {
  msg.textContent = "Updating company status...";
  msg.style.color = "";

  const updateData = { status, updated_at: new Date().toISOString() };
  if (status === "archived") {
    updateData.archived_at = new Date().toISOString();
  } else {
    updateData.archived_at = null;
  }

  const { error } = await supabase
    .from("companies")
    .update(updateData)
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("archived_at")
      ? "Run company-lifecycle.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "company",
    entity_id: companyId,
    description: `Updated company status to ${status}.`,
    metadata: { status }
  });

  msg.textContent = "Company status updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateCompanyType(companyId, accountType) {
  msg.textContent = "Updating company type...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update({ account_type: accountType, updated_at: new Date().toISOString() })
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("account_type")
      ? "Run company-lifecycle.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const company = companies.find(row => String(row.id) === String(companyId));
  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "company",
    entity_id: companyId,
    description: `Marked ${company?.company_name || "company"} as ${accountType}.`,
    metadata: { account_type: accountType }
  });

  msg.textContent = "Company type updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateOperationType(companyId, operationType) {
  msg.textContent = "Updating operation type...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update({ operation_type: operationType, updated_at: new Date().toISOString() })
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("operation_type")
      ? "Run operation-type.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const company = companies.find(row => String(row.id) === String(companyId));
  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "company",
    entity_id: companyId,
    description: `Set ${company?.company_name || "company"} operation type to ${formatOperationType(operationType)}.`,
    metadata: { operation_type: operationType }
  });

  msg.textContent = "Operation type updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateLifecycleStage(companyId, lifecycleStage) {
  msg.textContent = "Updating customer stage...";
  msg.style.color = "";

  const updateData = {
    lifecycle_stage: lifecycleStage,
    lifecycle_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (lifecycleStage === "live") {
    updateData.go_live_date = new Date().toISOString().slice(0, 10);
  }

  const { error } = await supabase
    .from("companies")
    .update(updateData)
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("lifecycle_stage")
      ? "Run customer-lifecycle-pipeline.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const company = companies.find(row => String(row.id) === String(companyId));
  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "customer_lifecycle",
    entity_id: companyId,
    description: `Set ${company?.company_name || "company"} lifecycle stage to ${formatStatus(lifecycleStage)}.`,
    metadata: { lifecycle_stage: lifecycleStage }
  });

  msg.textContent = "Customer stage updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateHandoffStatus(companyId, handoffStatus) {
  msg.textContent = "Updating handoff status...";
  msg.style.color = "";

  const { error } = await supabase
    .from("companies")
    .update({
      handoff_status: handoffStatus,
      handoff_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", companyId);

  if (error) {
    msg.textContent = error.message.includes("handoff_status")
      ? "Run customer-handoff.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const company = companies.find(row => String(row.id) === String(companyId));
  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "company_handoff",
    entity_id: companyId,
    description: `Set ${company?.company_name || "company"} handoff status to ${formatStatus(handoffStatus)}.`,
    metadata: { handoff_status: handoffStatus }
  });

  msg.textContent = "Handoff status updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function toggleArchiveCompany(companyId) {
  const company = companies.find(row => String(row.id) === String(companyId));
  if (!company) return;

  const nextStatus = company.status === "archived" ? "active" : "archived";
  const action = nextStatus === "archived" ? "archive" : "restore";
  if (!confirm(`${action === "archive" ? "Archive" : "Restore"} ${company.company_name}?`)) return;

  await updateCompanyStatus(companyId, nextStatus);
}

async function safeDeleteCompany(companyId) {
  const company = companies.find(row => String(row.id) === String(companyId));
  if (!company) return;

  const blockers = getCompanyDeleteBlockers(companyId);
  if (blockers.length) {
    alert(`Safe delete blocked for ${company.company_name}.\n\nArchive this company instead, or remove these records first:\n- ${blockers.join("\n- ")}`);
    return;
  }

  if (!confirm(`Safe delete ${company.company_name}? This cannot be undone.`)) return;

  msg.textContent = "Deleting company...";
  msg.style.color = "";

  try {
    await supabase.from("company_subscriptions").delete().eq("company_id", companyId);
    await supabase.from("user_invites").delete().eq("company_id", companyId);

    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", companyId);

    if (error) throw error;

    await logActivity({
      company_id: null,
      action: "delete",
      entity_type: "company",
      entity_id: companyId,
      description: `Safely deleted empty company ${company.company_name}.`,
      metadata: { company_name: company.company_name }
    });

    msg.textContent = "Company deleted.";
    msg.style.color = "#047857";
    await loadPlatformData();
  } catch (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
  }
}

function getCompanyDeleteBlockers(companyId) {
  const metrics = companyMetrics.get(companyId) || {};
  const users = companyUsers.filter(user => String(user.company_id) === String(companyId));
  const invites = userInvites.filter(invite => String(invite.company_id) === String(companyId) && invite.status !== "canceled");
  const subscriptions = companySubscriptions.filter(subscription => String(subscription.company_id) === String(companyId));

  const blockers = [];
  if (users.length) blockers.push(`${users.length} company user${users.length === 1 ? "" : "s"}`);
  if (invites.length) blockers.push(`${invites.length} invite${invites.length === 1 ? "" : "s"}`);
  if (subscriptions.some(subscription => subscription.billing_status === "active")) blockers.push("active subscription");
  ["drivers", "trucks", "loads", "invoices", "quotes", "documents", "assignments"].forEach(key => {
    if (metrics[key]) blockers.push(`${metrics[key]} ${key}`);
  });

  return blockers;
}

async function saveCompanyUser(event) {
  event.preventDefault();
  msg.textContent = "Saving company user...";
  msg.style.color = "";

  const data = Object.fromEntries(new FormData(userForm).entries());

  const { error } = await supabase
    .from("company_users")
    .upsert(data, { onConflict: "company_id,user_id" });

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: data.company_id,
    action: "update",
    entity_type: "company_user",
    entity_id: data.user_id,
    description: `Saved company user with role ${data.role}.`,
    metadata: { user_id: data.user_id, role: data.role, status: data.status }
  });

  userForm.reset();
  msg.textContent = "Company user saved.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function saveInvite(event) {
  event.preventDefault();
  msg.textContent = "Saving invite...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  const data = Object.fromEntries(new FormData(inviteForm).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });
  data.email = String(data.email || "").trim().toLowerCase();
  data.status = "pending";
  data.invited_by = sessionData.session?.user?.id || null;

  const { error } = await supabase
    .from("user_invites")
    .upsert(data, { onConflict: "company_id,email" });

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run platform-user-invites.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: data.company_id,
    action: "invite",
    entity_type: "user_invite",
    entity_id: data.email,
    description: `Invited ${data.email} as ${data.role}.`,
    metadata: { email: data.email, role: data.role }
  });

  inviteForm.reset();
  msg.textContent = "Invite saved. Create the Supabase Auth user when ready, then add their User ID under Company Users.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function updateInviteStatus(inviteId, status) {
  msg.textContent = "Updating invite...";
  msg.style.color = "";

  const { error } = await supabase
    .from("user_invites")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", inviteId);

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  const invite = userInvites.find(row => String(row.id) === String(inviteId));
  await logActivity({
    company_id: invite?.company_id || null,
    action: "update",
    entity_type: "user_invite",
    entity_id: String(inviteId),
    description: `Marked invite ${status}.`,
    metadata: { invite_id: inviteId, status, email: invite?.email || null }
  });

  msg.textContent = "Invite updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function activateInvite(inviteId) {
  const invite = userInvites.find(row => String(row.id) === String(inviteId));
  const input = Array.from(document.querySelectorAll("[data-invite-user-id]"))
    .find(field => String(field.dataset.inviteUserId) === String(inviteId));
  const userId = input?.value?.trim();

  if (!invite) {
    msg.textContent = "Invite not found. Refresh and try again.";
    msg.style.color = "#ef4444";
    return;
  }

  if (!userId) {
    msg.textContent = "Paste the Supabase Auth User ID before activating this invite.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Activating invite...";
  msg.style.color = "";

  const companyUser = {
    company_id: invite.company_id,
    user_id: userId,
    role: invite.role,
    status: "active"
  };

  const { error: userError } = await supabase
    .from("company_users")
    .upsert(companyUser, { onConflict: "company_id,user_id" });

  if (userError) {
    msg.textContent = userError.message;
    msg.style.color = "#ef4444";
    return;
  }

  const { error: inviteError } = await supabase
    .from("user_invites")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", inviteId);

  if (inviteError) {
    msg.textContent = inviteError.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: invite.company_id,
    action: "update",
    entity_type: "company_user",
    entity_id: userId,
    description: `Activated invite for ${invite.email} as ${invite.role}.`,
    metadata: { invite_id: inviteId, email: invite.email, user_id: userId, role: invite.role }
  });

  msg.textContent = "Invite activated and company user created.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function saveSubscription(companyId) {
  msg.textContent = "Saving subscription...";
  msg.style.color = "";

  const fields = Array.from(document.querySelectorAll("[data-subscription-company]"))
    .filter(field => String(field.dataset.subscriptionCompany) === String(companyId));
  const data = { company_id: companyId, updated_at: new Date().toISOString() };

  fields.forEach(field => {
    const key = field.dataset.subscriptionField;
    data[key] = field.value || null;
  });

  data.monthly_price = Number(data.monthly_price || 0);

  const { error } = await supabase
    .from("company_subscriptions")
    .upsert(data, { onConflict: "company_id" });

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run company-subscriptions.sql in Supabase first, then try again."
      : error.message.includes("payment_setup_status") || error.message.includes("billing_email") || error.message.includes("payment_link")
      ? "Run billing-payment-setup.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: companyId,
    action: "update",
    entity_type: "subscription",
    entity_id: companyId,
    description: `Updated subscription to ${data.plan_name} / ${data.billing_status}.`,
    metadata: {
      plan_name: data.plan_name,
      billing_status: data.billing_status,
      monthly_price: data.monthly_price,
      renews_at: data.renews_at,
      payment_setup_status: data.payment_setup_status,
      billing_email: data.billing_email
    }
  });

  msg.textContent = "Subscription saved.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function saveTicketStatus(ticketId) {
  const select = Array.from(document.querySelectorAll("[data-ticket-status]"))
    .find(field => String(field.dataset.ticketStatus) === String(ticketId));
  const ticket = supportTickets.find(row => String(row.id) === String(ticketId));
  if (!select || !ticket) return;

  msg.textContent = "Updating support ticket...";
  msg.style.color = "";

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: select.value })
    .eq("id", ticketId);

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: ticket.company_id,
    action: "update",
    entity_type: "support_ticket",
    entity_id: ticketId,
    description: `Updated support ticket status to ${select.value}.`,
    metadata: { subject: ticket.subject, status: select.value }
  });

  msg.textContent = "Support ticket updated.";
  msg.style.color = "#047857";
  await loadPlatformData();
}

async function openPlatformSupportConversation(ticketId) {
  selectedSupportTicket = supportTickets.find(row => String(row.id) === String(ticketId));
  if (!selectedSupportTicket) return;

  const panel = document.getElementById("platformSupportConversationPanel");
  const title = document.getElementById("platformSupportConversationTitle");
  const messages = document.getElementById("platformSupportConversationMessages");

  title.textContent = selectedSupportTicket.subject;
  panel.classList.remove("hidden");
  messages.innerHTML = `<div class="empty-state">Loading ticket thread...</div>`;

  await loadPlatformSupportMessages(selectedSupportTicket);
}

function closePlatformSupportConversation() {
  selectedSupportTicket = null;
  document.getElementById("platformSupportConversationPanel")?.classList.add("hidden");
  document.getElementById("platformSupportConversationMessages").innerHTML = "";
  document.getElementById("platformSupportReplyMessage").value = "";
}

async function loadPlatformSupportMessages(ticket) {
  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  if (error) {
    document.getElementById("platformSupportConversationMessages").innerHTML =
      `<div class="empty-state">Run the latest support SQL to enable ticket replies.</div>`;
    return;
  }

  renderPlatformSupportMessages(ticket, data || []);
}

function renderPlatformSupportMessages(ticket, messages) {
  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  const rows = [
    {
      id: "opening",
      created_at: ticket.created_at,
      author_role: companyNames.get(ticket.company_id) || "customer",
      message: ticket.description,
      internal_note: false
    },
    ...messages
  ];

  document.getElementById("platformSupportConversationMessages").innerHTML = rows.map(row => `
    <article class="support-message ${row.internal_note ? "internal" : ""}">
      <div>
        <strong>${row.internal_note ? "Internal Note" : formatStatus(row.author_role || "user")}</strong>
        <small>${formatDate(row.created_at)}</small>
      </div>
      <p>${escapeHtml(row.message)}</p>
    </article>
  `).join("");
}

async function savePlatformSupportReply(event) {
  event.preventDefault();
  if (!selectedSupportTicket) return;

  const submitter = event.submitter;
  const internalNote = submitter?.dataset.replyMode === "internal";
  const messageField = document.getElementById("platformSupportReplyMessage");
  const message = messageField.value.trim();
  if (!message) return;

  const { data: userData } = await supabase.auth.getUser();
  msg.textContent = internalNote ? "Saving internal note..." : "Sending support reply...";
  msg.style.color = "";

  const payload = {
    ticket_id: selectedSupportTicket.id,
    company_id: selectedSupportTicket.company_id,
    created_by: userData.user?.id || null,
    author_role: internalNote ? "platform_internal" : "platform_support",
    message,
    internal_note: internalNote
  };

  const { error } = await supabase.from("support_ticket_messages").insert(payload);

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  if (!internalNote && selectedSupportTicket.status === "open") {
    await supabase
      .from("support_tickets")
      .update({ status: "in_progress" })
      .eq("id", selectedSupportTicket.id);
  }

  if (!internalNote) {
    await createNotification({
      company_id: selectedSupportTicket.company_id,
      audience: "company",
      notification_type: "support_reply",
      priority: selectedSupportTicket.priority || "normal",
      title: "Support replied to your ticket",
      message: selectedSupportTicket.subject,
      target_url: "support.html",
      notification_key: `${selectedSupportTicket.company_id}:platform_support_reply:${selectedSupportTicket.id}:${Date.now()}`
    });
  }

  await logActivity({
    company_id: selectedSupportTicket.company_id,
    action: internalNote ? "note" : "reply",
    entity_type: "support_ticket",
    entity_id: selectedSupportTicket.id,
    description: internalNote
      ? `Added internal note to support ticket ${selectedSupportTicket.subject}.`
      : `Replied to support ticket ${selectedSupportTicket.subject}.`,
    metadata: { internal_note: internalNote }
  });

  messageField.value = "";
  msg.textContent = internalNote ? "Internal note saved." : "Support reply sent.";
  msg.style.color = "#047857";
  await loadPlatformSupportMessages(selectedSupportTicket);
  await loadPlatformData();
}

async function createNotification(payload) {
  const { data: userData } = await supabase.auth.getUser();
  const notification = {
    ...payload,
    created_by: userData.user?.id || null,
    notification_key: payload.notification_key || null,
    metadata: payload.metadata || {}
  };

  const { error } = await supabase.from("notifications").insert(notification);
  if (error) console.warn("Notification skipped:", error.message);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "N/A";
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetween(start, end) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(end) - startOfDay(start)) / oneDay);
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function formatPlanLabel(plan) {
  const labels = {
    starter: "Starter - $99/mo",
    professional: "Professional - $199/mo",
    business: "Business - $399/mo",
    enterprise: "Enterprise - Custom"
  };
  return labels[plan] || formatStatus(plan);
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function getTicketPriorityClass(priority) {
  if (priority === "urgent" || priority === "high") return "warning";
  if (priority === "normal") return "caution";
  return "success";
}

function formatOperationType(type) {
  const labels = {
    carrier: "Carrier / Fleet",
    dispatcher: "Dispatch Service",
    broker_3pl: "Broker / 3PL",
    hybrid: "Hybrid Operation"
  };
  return labels[type] || formatStatus(type);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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

async function logActivity(entry) {
  const { data: sessionData } = await supabase.auth.getSession();
  const payload = {
    company_id: entry.company_id || null,
    actor_user_id: sessionData.session?.user?.id || null,
    actor_role: window.CompanyContext?.getRole?.() || null,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ? String(entry.entity_id) : null,
    description: entry.description,
    metadata: entry.metadata || {}
  };

  const { error } = await supabase.from("activity_logs").insert(payload);
  if (error) console.warn("Activity log skipped:", error.message);
}

companyForm.addEventListener("submit", createCompany);
userForm.addEventListener("submit", saveCompanyUser);
inviteForm.addEventListener("submit", saveInvite);
platformSupportReplyForm?.addEventListener("submit", savePlatformSupportReply);
document.getElementById("closePlatformSupportConversationBtn")?.addEventListener("click", closePlatformSupportConversation);
document.getElementById("runIsolationTestBtn")?.addEventListener("click", runIsolationTest);
document.getElementById("resetQaChecklistBtn")?.addEventListener("click", resetQaChecklist);

initPlatformAdmin().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading Platform Admin.";
  msg.style.color = "#ef4444";
});
