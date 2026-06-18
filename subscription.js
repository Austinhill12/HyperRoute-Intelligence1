const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const planCatalog = {
  dispatcher: {
    small: { price: 49, limits: { drivers: 25, trucks: 0, loads: 25, documents: 150, users: 2 } },
    medium: { price: 99, limits: { drivers: 75, trucks: 0, loads: 75, documents: 500, users: 5 } },
    large: { price: 149, limits: { drivers: 200, trucks: 0, loads: 200, documents: 1500, users: 10 } },
    unlimited: { price: 249, limits: { drivers: null, trucks: 0, loads: null, documents: null, users: 25 } }
  },
  carrier: {
    small: { price: 99, limits: { drivers: 10, trucks: 5, loads: 100, documents: 500, users: 5 } },
    medium: { price: 199, limits: { drivers: 30, trucks: 15, loads: 300, documents: 1500, users: 12 } },
    large: { price: 349, limits: { drivers: 100, trucks: 50, loads: 1000, documents: 5000, users: 30 } },
    unlimited: { price: 599, limits: { drivers: null, trucks: null, loads: null, documents: null, users: 75 } }
  },
  broker_3pl: {
    small: { price: 99, limits: { drivers: 0, trucks: 0, loads: 50, documents: 500, users: 5 } },
    medium: { price: 249, limits: { drivers: 0, trucks: 0, loads: 150, documents: 2000, users: 15 } },
    large: { price: 499, limits: { drivers: 0, trucks: 0, loads: 500, documents: 7500, users: 40 } },
    unlimited: { price: 799, limits: { drivers: 0, trucks: 0, loads: null, documents: null, users: 100 } }
  },
  hybrid: {
    small: { price: 149, limits: { drivers: 10, trucks: 5, loads: 50, documents: 750, users: 6 } },
    medium: { price: 299, limits: { drivers: 30, trucks: 15, loads: 150, documents: 2500, users: 18 } },
    large: { price: 599, limits: { drivers: 100, trucks: 50, loads: 500, documents: 10000, users: 50 } },
    unlimited: { price: 999, limits: { drivers: null, trucks: null, loads: null, documents: null, users: 125 } }
  }
};

const operationLabels = {
  dispatcher: "Dispatcher",
  carrier: "Fleet / Carrier",
  broker_3pl: "3PL / Broker",
  hybrid: "Hybrid"
};

const sizeDescriptions = {
  small: "For lean teams getting organized.",
  medium: "For growing teams with steady volume.",
  large: "For established operations with heavier usage.",
  unlimited: "For companies that want room to scale without monthly limits."
};

function buildPlans(operationType = "carrier") {
  const normalizedType = planCatalog[operationType] ? operationType : "carrier";
  return Object.fromEntries(Object.entries(planCatalog[normalizedType]).map(([size, plan]) => {
    const label = `${operationLabels[normalizedType]} ${capitalize(size)}`;
    return [`${normalizedType}_${size}`, {
      label,
      price: plan.price,
      description: sizeDescriptions[size],
      limits: plan.limits,
      features: getPlanFeatures(normalizedType, size)
    }];
  }));
}

let subscription = null;
let usage = {};
let plans = buildPlans("carrier");
let currentOperationType = "carrier";

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initSubscription() {
  const msg = document.getElementById("subscriptionMessage");
  msg.textContent = "Loading subscription...";
  msg.style.color = "";
  const checkoutStatus = new URLSearchParams(window.location.search).get("checkout");

  try {
    await window.CompanyContext?.ready();

    if (!window.CompanyContext?.getCompanyId()) {
      msg.textContent = "No company selected. Select or create a company first.";
      msg.style.color = "#ef4444";
      return;
    }

    currentOperationType = await loadCurrentOperationType();
    plans = buildPlans(currentOperationType);
    await ensureSubscription();
    await syncTrialPlanToCompanyType();
    await loadUsage();
    renderPlans();
    renderSummary();
    renderUsage();
    if (checkoutStatus === "success") {
      msg.textContent = "Payment received. Stripe is confirming your subscription now.";
      msg.style.color = "#047857";
    } else if (checkoutStatus === "cancel") {
      msg.textContent = "Checkout was canceled. Your current plan was not changed.";
      msg.style.color = "#334155";
    } else {
      msg.textContent = "";
    }
  } catch (err) {
    console.error(err);
    msg.textContent = getSubscriptionError(err.message);
    msg.style.color = "#ef4444";
  }
}

async function ensureSubscription() {
  const companyId = window.CompanyContext.getCompanyId();
  const res = await fetch(window.CompanyContext.scopedUrl("company_subscriptions", "select=*&limit=1"), {
    headers: getHeaders()
  });

  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  subscription = rows[0] || null;

  if (subscription) return;

  const defaultSubscription = {
    company_id: companyId,
    plan_name: getDefaultPlanName(),
    monthly_price: plans[getDefaultPlanName()].price,
    billing_status: "trial",
    trial_ends_at: addDays(new Date(), 14),
    renews_at: addDays(new Date(), 14)
  };

  const createRes = await fetch(`${BASE_URL}/rest/v1/company_subscriptions`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(defaultSubscription)
  });

  const result = await createRes.json();
  if (!createRes.ok) throw new Error(JSON.stringify(result));
  subscription = Array.isArray(result) ? result[0] : result;
}

async function loadCurrentOperationType() {
  const companyId = window.CompanyContext.getCompanyId();

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/companies?id=eq.${companyId}&select=operation_type&limit=1`, {
      headers: getHeaders()
    });

    if (res.ok) {
      const rows = await res.json();
      const operationType = rows[0]?.operation_type;
      if (planCatalog[operationType]) return operationType;
    }
  } catch (err) {
    console.warn("Company operation type unavailable:", err);
  }

  const contextOperationType = window.CompanyContext?.getOperationType?.() || "carrier";
  return planCatalog[contextOperationType] ? contextOperationType : "carrier";
}

async function syncTrialPlanToCompanyType() {
  if (!subscription) return;

  const normalizedPlanName = normalizePlanName(subscription.plan_name);
  if (normalizedPlanName === subscription.plan_name) return;

  const plan = plans[normalizedPlanName];
  if (!plan) return;

  subscription.plan_name = normalizedPlanName;
  subscription.monthly_price = plan.price;

  if (!["trial", "not_started", "pending"].includes(String(subscription.billing_status || "").toLowerCase())) {
    return;
  }

  try {
    const res = await fetch(window.CompanyContext.scopedUrl("company_subscriptions", "select=id&limit=1"), {
      headers: getHeaders()
    });
    if (!res.ok) return;
    const rows = await res.json();
    const subscriptionId = rows[0]?.id;
    if (!subscriptionId) return;

    await fetch(`${BASE_URL}/rest/v1/company_subscriptions?id=eq.${subscriptionId}`, {
      method: "PATCH",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({
        plan_name: normalizedPlanName,
        monthly_price: plan.price
      })
    });
  } catch (err) {
    console.warn("Trial plan sync skipped:", err);
  }
}

async function loadUsage() {
  const [drivers, trucks, loads, documents, users] = await Promise.all([
    countRows("drivers"),
    countRows("trucks"),
    countRows("loads"),
    countRows("documents"),
    countRows("company_users")
  ]);

  usage = { drivers, trucks, loads, documents, users };
}

async function countRows(table) {
  const res = await fetch(window.CompanyContext.scopedUrl(table, "select=id"), {
    headers: getHeaders()
  });
  if (!res.ok) return 0;
  const rows = await res.json();
  return rows.length;
}

function renderPlans() {
  const grid = document.getElementById("planGrid");
  const currentPlan = normalizePlanName(subscription?.plan_name);
  const billingStatus = subscription?.billing_status || "trial";
  grid.innerHTML = "";

  Object.entries(plans).forEach(([key, plan]) => {
    const isCurrent = key === currentPlan;
    const card = document.createElement("section");
    card.className = `subscription-plan ${isCurrent ? "active" : ""}`;
    card.innerHTML = `
      <div>
        <span class="plan-badge">${isCurrent ? formatStatus(billingStatus) : "Available"}</span>
        <h2>${plan.label}</h2>
        <p>${plan.description}</p>
      </div>
      <strong>${plan.price ? `$${plan.price}` : "Custom"}<span>${plan.price ? "/mo" : ""}</span></strong>
      <ul>
        ${plan.features.map(feature => `<li>${feature}</li>`).join("")}
      </ul>
      <button class="view" type="button" data-select-plan="${key}" ${isCurrent && billingStatus === "active" ? "disabled" : ""}>
        ${isCurrent && billingStatus === "active" ? "Active Plan" : "Start Checkout"}
      </button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll("[data-select-plan]").forEach(button => {
    button.addEventListener("click", () => updatePlan(button.dataset.selectPlan));
  });
}

function renderSummary() {
  const plan = plans[normalizePlanName(subscription?.plan_name)] || plans[getDefaultPlanName()];
  document.getElementById("currentPlan").textContent = plan.label;
  document.getElementById("billingStatus").textContent = formatStatus(subscription?.billing_status || "trial");
  document.getElementById("monthlyPrice").textContent = plan.price ? `$${plan.price}` : "Custom";
  document.getElementById("renewsAt").textContent = subscription?.renews_at || subscription?.trial_ends_at || "-";
}

function renderUsage() {
  const tbody = document.getElementById("usageTableBody");
  const plan = plans[normalizePlanName(subscription?.plan_name)] || plans[getDefaultPlanName()];
  const labels = {
    drivers: "Drivers",
    trucks: "Vehicles",
    loads: "Loads",
    documents: "Documents",
    users: "Users"
  };

  tbody.innerHTML = "";
  Object.keys(labels).forEach(key => {
    const used = usage[key] || 0;
    const limit = plan.limits[key];
    const nearLimit = limit !== null && used >= limit * 0.8;
    const overLimit = limit !== null && used > limit;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${labels[key]}</td>
      <td>${used.toLocaleString()}</td>
      <td>${limit === null ? "Unlimited" : limit.toLocaleString()}</td>
      <td>${overLimit ? "Over Limit" : nearLimit ? "Near Limit" : "OK"}</td>
    `;
    tbody.appendChild(row);
  });
}

async function updatePlan(planName) {
  const plan = plans[planName];
  if (!plan || !subscription) return;

  const msg = document.getElementById("subscriptionMessage");
  msg.textContent = "Opening secure Stripe Checkout...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        company_id: window.CompanyContext.getCompanyId(),
        plan_name: planName
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));
    if (!result.url) throw new Error("Stripe Checkout did not return a redirect URL.");

    window.location.href = result.url;
  } catch (err) {
    console.error(err);
    msg.textContent = getSubscriptionError(err.message);
    msg.style.color = "#ef4444";
  }
}

function getDefaultPlanName() {
  const operationType = currentOperationType || window.CompanyContext?.getOperationType?.() || "carrier";
  const normalizedType = planCatalog[operationType] ? operationType : "carrier";
  return `${normalizedType}_small`;
}

function normalizePlanName(planName) {
  if (plans[planName]) return planName;
  const size = getPlanSize(planName);
  const operationType = currentOperationType || window.CompanyContext?.getOperationType?.() || "carrier";
  const normalizedType = planCatalog[operationType] ? operationType : "carrier";
  const sameTierPlan = `${normalizedType}_${size}`;
  if (plans[sameTierPlan]) return sameTierPlan;

  const legacyMap = {
    starter: `${normalizedType}_small`,
    professional: `${normalizedType}_medium`,
    business: `${normalizedType}_large`,
    enterprise: `${normalizedType}_unlimited`
  };

  return plans[legacyMap[planName]] ? legacyMap[planName] : getDefaultPlanName();
}

function getPlanSize(planName) {
  const text = String(planName || "").toLowerCase();
  if (text.includes("unlimited") || text === "enterprise") return "unlimited";
  if (text.includes("large") || text === "business") return "large";
  if (text.includes("medium") || text === "professional") return "medium";
  return "small";
}

function getPlanFeatures(operationType, size) {
  const base = {
    dispatcher: ["Dispatch board", "Customer and load records", "Documents", "Basic reports"],
    carrier: ["Drivers and vehicles", "Maintenance and compliance", "Loads and documents", "Dashboard reporting"],
    broker_3pl: ["Customers and carriers", "Quotes and tenders", "Load tracking", "Invoices and documents"],
    hybrid: ["Fleet tools", "Brokerage tools", "Billing workflows", "Operational reporting"]
  };

  const tierFeature = {
    small: "Small team limits",
    medium: "Higher monthly capacity",
    large: "Expanded users and documents",
    unlimited: "Unlimited core usage"
  };

  return [...(base[operationType] || base.carrier), tierFeature[size]];
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString().slice(0, 10);
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function getSubscriptionError(message) {
  if (message.includes("company_subscriptions") || message.includes("schema cache")) {
    return "Subscription tables are not ready. Run the subscription SQL, then refresh.";
  }
  if (message.includes("row-level security")) {
    return "Supabase blocked subscription access. Run the subscription SQL and confirm this user is a company admin.";
  }
  return message || "Unknown subscription error.";
}

initSubscription();
