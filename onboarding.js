import { supabase } from "./supabaseClient.js";

const msg = document.getElementById("onboardingMessage");
const checklist = document.getElementById("onboardingChecklist");
const pendingSignupKey = "hyperroute_pending_signup";
const operationSummaries = {
  carrier: "Best for asset-based trucking companies that manage drivers, trucks, maintenance, compliance, loads, billing, and documents.",
  broker_3pl: "Best for brokers and 3PLs that manage customers, carrier networks, quotes, tenders, margins, tracking, billing, and documents.",
  dispatcher: "Best for dispatch services that coordinate loads, drivers, trucks, customers, updates, and documents without full back-office tools.",
  hybrid: "Best for companies that run both fleet operations and brokerage/3PL workflows in one system."
};

async function initOnboarding() {
  msg.textContent = "Loading onboarding checklist...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    msg.textContent = "Redirecting to login...";
    msg.style.color = "#ef4444";
    window.location.href = "login.html?next=onboarding.html";
    return;
  }

  await window.CompanyContext?.ready();
  let company = window.CompanyContext?.getCompany();
  let companyId = window.CompanyContext?.getCompanyId();

  if (!companyId) {
    const createdCompanyId = await completePendingSignupFromOnboarding();
    if (createdCompanyId) {
      localStorage.setItem("hyperroute_active_company_id", createdCompanyId);
      window.location.reload();
      return;
    }
  }

  company = window.CompanyContext?.getCompany();
  companyId = window.CompanyContext?.getCompanyId();

  if (!companyId) {
    msg.textContent = "No company selected. Create or select a company first.";
    msg.style.color = "#ef4444";
    return;
  }

  document.getElementById("onboardingCompanyName").textContent = `${company?.company_name || "Selected Company"} setup checklist`;
  bindOperationType(company);

  const data = await loadSetupData(companyId, company);
  const steps = buildSteps(data);
  renderChecklist(steps);
  renderProgress(steps);
  renderLaunchPhases(steps);
  renderOperationalStatus(steps, data);
  renderQuickStartActions(steps);
  msg.textContent = "";
}

async function completePendingSignupFromOnboarding() {
  const raw = localStorage.getItem(pendingSignupKey);
  const { data: userData } = await supabase.auth.getUser();
  const metadataSignup = userData.user?.user_metadata?.hyperroute_signup;
  if (!raw && !metadataSignup) return null;

  const signupData = raw ? JSON.parse(raw) : metadataSignup;
  msg.textContent = "Finishing company workspace setup...";
  msg.style.color = "#334155";

  const { data: companyId, error } = await supabase.rpc("create_self_service_company", {
    company_name_input: signupData.company_name,
    legal_name_input: signupData.legal_name,
    phone_input: signupData.phone,
    email_input: signupData.company_email,
    plan_name_input: signupData.plan_name,
    operation_type_input: signupData.operation_type || "carrier"
  });

  if (error) {
    msg.textContent = `Workspace setup failed: ${error.message}`;
    msg.style.color = "#ef4444";
    return null;
  }

  localStorage.removeItem(pendingSignupKey);
  return companyId;
}

function bindOperationType(company = {}) {
  const select = document.getElementById("operationTypeSelect");
  const summary = document.getElementById("operationTypeSummary");
  if (!select) return;

  select.value = company.operation_type || "carrier";
  if (summary) summary.textContent = operationSummaries[select.value] || operationSummaries.carrier;

  select.addEventListener("change", async () => {
    const companyId = window.CompanyContext?.getCompanyId();
    if (!companyId) return;
    if (summary) summary.textContent = operationSummaries[select.value] || operationSummaries.carrier;

    msg.textContent = "Saving company type...";
    msg.style.color = "";

    const { error } = await supabase
      .from("companies")
      .update({ operation_type: select.value, updated_at: new Date().toISOString() })
      .eq("id", companyId);

    if (error) {
      msg.textContent = error.message.includes("operation_type")
        ? "Run the operation type SQL first, then try again."
        : error.message;
      msg.style.color = "#ef4444";
      return;
    }

    msg.textContent = "Company type saved. Refreshing workspace tools...";
    msg.style.color = "#047857";
    setTimeout(() => window.location.reload(), 600);
  });
}

async function loadSetupData(companyId, company) {
  const [
    companyUsers,
    invites,
    subscription,
    drivers,
    trucks,
    customers,
    loads,
    invoices,
    documents,
    quotes,
    carriers,
    loadTenders,
    loadCommunications,
    loadIssues,
    maintenanceLogs,
    maintenanceSchedules
  ] = await Promise.all([
    countRows("company_users", "company_id", companyId),
    countRows("user_invites", "company_id", companyId),
    loadSubscription(companyId),
    countRows("drivers", "company_id", companyId),
    countRows("trucks", "company_id", companyId),
    countRows("customers", "company_id", companyId),
    countRows("loads", "company_id", companyId),
    countRows("invoices", "company_id", companyId),
    countRows("documents", "company_id", companyId),
    countRows("quotes", "company_id", companyId),
    countRows("carriers", "company_id", companyId),
    countRows("load_tenders", "company_id", companyId),
    countRows("load_communications", "company_id", companyId),
    countRows("load_issues", "company_id", companyId),
    countRows("maintenance_logs", "company_id", companyId),
    countRows("maintenance_schedules", "company_id", companyId)
  ]);

  return {
    company,
    companyUsers,
    invites,
    subscription,
    drivers,
    trucks,
    customers,
    loads,
    invoices,
    documents,
    quotes,
    carriers,
    loadTenders,
    loadCommunications,
    loadIssues,
    maintenanceLogs,
    maintenanceSchedules
  };
}

async function countRows(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);

  if (error) {
    console.warn(`Unable to count ${table}:`, error.message);
    return 0;
  }

  return count || 0;
}

async function loadSubscription(companyId) {
  const { data, error } = await supabase
    .from("company_subscriptions")
    .select("id, plan_name, billing_status")
    .eq("company_id", companyId)
    .limit(1);

  if (error) {
    console.warn("Unable to load subscription:", error.message);
    return null;
  }

  return data?.[0] || null;
}

function buildSteps(data) {
  const company = data.company || {};
  const operationType = company.operation_type || "carrier";
  const companyProfileComplete = Boolean(
    company.company_name &&
    (company.phone || company.email) &&
    (company.mc_number || company.dot_number || company.legal_name)
  );
  const subscriptionComplete = Boolean(data.subscription?.plan_name);
  const teamReady = data.companyUsers > 1 || data.invites > 0;
  const maintenanceReady = data.maintenanceSchedules > 0 || data.maintenanceLogs > 0;

  const base = [
    step("Company profile", "Add company contact, legal, MC, DOT, and address details.", companyProfileComplete, companyProfileComplete ? "Profile has core company details." : "Company profile needs more detail.", "Complete Profile", "company-admin.html", "foundation", true),
    step("Subscription plan", "Select the plan that matches the company's operating size.", subscriptionComplete, subscriptionComplete ? `${formatPlanName(data.subscription.plan_name)} plan is selected.` : "No subscription plan is selected yet.", "Review Plan", "subscription.html", "foundation", true),
    step("Company owner", "Confirm at least one active owner or admin user exists.", data.companyUsers > 0, `${data.companyUsers} company user${data.companyUsers === 1 ? "" : "s"} added.`, "Manage Users", "company-admin.html", "foundation", true),
    step("Invite team", "Invite dispatch, accounting, maintenance, or management users.", teamReady, teamReady ? `${data.companyUsers} active user${data.companyUsers === 1 ? "" : "s"} and ${data.invites} invite${data.invites === 1 ? "" : "s"} found.` : "No additional users or pending invites found.", "Invite User", "company-admin.html", "foundation", false)
  ];

  const fleet = [
    step("Drivers", "Create driver profiles and start compliance tracking.", data.drivers > 0, `${data.drivers} driver${data.drivers === 1 ? "" : "s"} saved.`, "Add Driver", "index.html", "workflow", true),
    step("Trucks", "Create equipment records for dispatch and maintenance.", data.trucks > 0, `${data.trucks} truck${data.trucks === 1 ? "" : "s"} saved.`, "Add Truck", "create-vehicle.html", "workflow", true),
    step("Maintenance readiness", "Create maintenance schedules or service history for downtime prevention.", maintenanceReady, `${data.maintenanceSchedules} schedule${data.maintenanceSchedules === 1 ? "" : "s"} and ${data.maintenanceLogs} service record${data.maintenanceLogs === 1 ? "" : "s"} saved.`, "Open Maintenance", "create-maintenance.html", "golive", false)
  ];

  const customersAndLoads = [
    step("Customers", "Add shippers, brokers, or direct customers.", data.customers > 0, `${data.customers} customer${data.customers === 1 ? "" : "s"} saved.`, "Add Customer", "create-customer.html", "workflow", true),
    step("Loads", "Create the first load to start live operations.", data.loads > 0, `${data.loads} load${data.loads === 1 ? "" : "s"} saved.`, "Create Load", "create-load.html", "workflow", true)
  ];

  const brokerage = [
    step("Carrier network", "Add approved outside carriers for brokered freight.", data.carriers > 0, `${data.carriers} carrier${data.carriers === 1 ? "" : "s"} saved.`, "Add Carrier", "carriers.html", "workflow", true),
    step("Quote pipeline", "Create the first customer quote or rate opportunity.", data.quotes > 0, `${data.quotes} quote${data.quotes === 1 ? "" : "s"} saved.`, "Open Quotes", "quotes.html", "workflow", false),
    step("Carrier tendering", "Tender a load to a carrier and track the response.", data.loadTenders > 0, `${data.loadTenders} tender${data.loadTenders === 1 ? "" : "s"} created.`, "Tender Load", "loads.html", "golive", true)
  ];

  const operations = [
    step("Communication log", "Record customer, carrier, driver, or internal load communications.", data.loadCommunications > 0, `${data.loadCommunications} communication record${data.loadCommunications === 1 ? "" : "s"} saved.`, "Open Loads", "loads.html", "golive", false),
    step("Documents", "Upload PODs, insurance, compliance, or equipment documents.", data.documents > 0, `${data.documents} document${data.documents === 1 ? "" : "s"} uploaded.`, "Open Documents", "documents.html", "golive", false),
    step("Issues and claims", "Track exceptions such as late delivery, missing POD, damage, or disputes.", data.loadIssues > 0, `${data.loadIssues} issue or claim record${data.loadIssues === 1 ? "" : "s"} saved.`, "Open Loads", "loads.html", "golive", false)
  ];

  const billing = [
    step("Invoices", "Create or generate an invoice from delivered work.", data.invoices > 0, `${data.invoices} invoice${data.invoices === 1 ? "" : "s"} saved.`, "View Invoices", "invoices.html", "golive", false),
    step("Profitability review", "Review revenue, carrier cost, claim exposure, and margin.", data.loads > 0, data.loads > 0 ? "Profitability report can calculate from existing loads." : "Create a load before profitability can be calculated.", "Open Reports", "reports.html", "golive", false)
  ];

  const byType = {
    carrier: [...base, ...fleet, ...customersAndLoads, ...operations, ...billing],
    broker_3pl: [...base, ...customersAndLoads, ...brokerage, ...operations, ...billing],
    dispatcher: [...base, ...customersAndLoads, ...fleet.slice(0, 2), ...operations],
    hybrid: [...base, ...fleet, ...customersAndLoads, ...brokerage, ...operations, ...billing]
  };

  return byType[operationType] || byType.carrier;
}

function step(title, description, complete, detail, action, href, phase = "workflow", required = false) {
  return { title, description, complete, detail, action, href, phase, required };
}

function renderChecklist(steps) {
  checklist.innerHTML = "";

  steps.forEach(itemData => {
    const item = document.createElement("article");
    item.className = `onboarding-item ${itemData.complete ? "complete" : "attention"}`;
    item.innerHTML = `
      <div>
        <div class="onboarding-status">${itemData.complete ? "Complete" : "Needs attention"}</div>
        <div class="onboarding-phase">${formatPhase(itemData.phase)}${itemData.required ? " Required" : " Recommended"}</div>
      </div>
      <div class="onboarding-copy">
        <h2>${escapeHtml(itemData.title)}</h2>
        <p>${escapeHtml(itemData.description)}</p>
        <span>${escapeHtml(itemData.detail)}</span>
      </div>
      <a class="view onboarding-action" href="${escapeHtml(itemData.href)}">${escapeHtml(itemData.action)}</a>
    `;
    checklist.appendChild(item);
  });
}

function renderProgress(steps) {
  const requiredSteps = steps.filter(item => item.required);
  const complete = requiredSteps.filter(item => item.complete).length;
  const total = requiredSteps.length;
  const remaining = total - complete;
  const percent = total ? Math.round((complete / total) * 100) : 0;
  const nextStep = requiredSteps.find(item => !item.complete) || steps.find(item => !item.complete);

  document.getElementById("setupProgress").textContent = `${percent}%`;
  document.getElementById("completeSteps").textContent = complete;
  document.getElementById("remainingSteps").textContent = remaining;
  document.getElementById("totalSteps").textContent = total;
  document.getElementById("onboardingProgressBar").style.width = `${percent}%`;
  document.getElementById("onboardingStage").textContent = getSetupStage(percent);
  document.getElementById("onboardingSummaryText").textContent =
    remaining === 0
      ? "This company has completed the required launch steps for its operation type."
      : `${remaining} required launch step${remaining === 1 ? "" : "s"} remaining for this company type.`;
  document.getElementById("onboardingNextStep").textContent =
    nextStep ? `Next recommended step: ${nextStep.title}` : "Next recommended step: keep operations current as work comes in.";
}

function renderLaunchPhases(steps) {
  ["foundation", "workflow", "golive"].forEach(phase => {
    const phaseSteps = steps.filter(item => item.phase === phase);
    const requiredSteps = phaseSteps.filter(item => item.required);
    const completeRequired = requiredSteps.filter(item => item.complete).length;
    const completeAll = phaseSteps.filter(item => item.complete).length;
    const card = document.querySelector(`[data-phase-card="${phase}"]`);
    const status = document.getElementById(`${phase}PhaseStatus`);
    if (!card || !status) return;

    const requiredReady = requiredSteps.length === 0 || completeRequired === requiredSteps.length;
    card.classList.toggle("complete", requiredReady);
    card.classList.toggle("attention", !requiredReady);
    status.textContent = requiredSteps.length
      ? `${completeRequired}/${requiredSteps.length} required, ${completeAll}/${phaseSteps.length} total`
      : `${completeAll}/${phaseSteps.length} recommended`;
  });
}

function renderOperationalStatus(steps, data) {
  const operationType = data.company?.operation_type || "carrier";
  const requiredSteps = steps.filter(item => item.required);
  const complete = requiredSteps.filter(item => item.complete).length;
  const percent = requiredSteps.length ? Math.round((complete / requiredSteps.length) * 100) : 0;
  const readyMap = {
    carrier: data.drivers > 0 && data.trucks > 0 && data.customers > 0 && data.loads > 0,
    broker_3pl: data.customers > 0 && data.carriers > 0 && data.loads > 0 && data.loadTenders > 0,
    dispatcher: data.customers > 0 && data.loads > 0,
    hybrid: data.drivers > 0 && data.trucks > 0 && data.customers > 0 && data.carriers > 0 && data.loads > 0
  };
  const title = document.getElementById("operationalStatusTitle");
  const text = document.getElementById("operationalStatusText");

  if (readyMap[operationType]) {
    title.textContent = "Ready For Daily Operations";
    text.textContent = getReadyText(operationType);
    return;
  }

  if (percent >= 70) {
    title.textContent = "Almost Operational";
    text.textContent = "Most setup steps are complete. Finish the remaining workflow items for this company type.";
    return;
  }

  if (percent >= 35) {
    title.textContent = "Setup In Progress";
    text.textContent = "This workspace has started setup. Continue with the recommended actions until the key operating workflow is connected.";
    return;
  }

  title.textContent = "Needs Initial Setup";
  text.textContent = "Start with company details, then follow the company-specific checklist below.";
}

function getReadyText(operationType) {
  if (operationType === "broker_3pl") return "This 3PL workspace has customers, carriers, loads, and tendering records ready for live brokerage operations.";
  if (operationType === "dispatcher") return "This dispatcher workspace has customers and loads ready for dispatch coordination.";
  if (operationType === "hybrid") return "This hybrid workspace has both fleet and brokerage records ready for daily operations.";
  return "This carrier workspace has drivers, trucks, customers, and loads ready for dispatch operations.";
}

function renderQuickStartActions(steps) {
  const container = document.getElementById("quickStartActions");
  const incomplete = [
    ...steps.filter(item => item.required && !item.complete),
    ...steps.filter(item => !item.required && !item.complete)
  ].slice(0, 3);
  const actions = incomplete.length ? incomplete : [
    step("Open Dashboard", "Review live operational health and recent movement.", true, "", "Dashboard", "dashboard.html"),
    step("Dispatch Board", "Manage active loads and operating work.", true, "", "Dispatch", "dispatch.html"),
    step("Reports", "Export and review company performance.", true, "", "Reports", "reports.html")
  ];

  container.innerHTML = actions.map(action => `
    <a class="quick-start-card" href="${escapeHtml(action.href)}">
      <strong>${escapeHtml(action.title)}</strong>
      <span>${escapeHtml(action.description)}</span>
      <small>${escapeHtml(action.action)}</small>
    </a>
  `).join("");
}

function getSetupStage(percent) {
  if (percent >= 100) return "Operational";
  if (percent >= 70) return "Almost Ready";
  if (percent >= 35) return "In Progress";
  return "Getting Started";
}

function formatPhase(value) {
  if (value === "foundation") return "Foundation";
  if (value === "golive") return "Go-Live";
  return "Workflow";
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

function formatPlanName(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

initOnboarding().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading onboarding checklist.";
  msg.style.color = "#ef4444";
});
