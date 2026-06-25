const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

const DASHBOARD_PROFILES = {
  carrier: {
    label: "Fleet / Carrier",
    title: "Fleet Operations Intelligence",
    summaryFocus: "loads, invoices, driver compliance, maintenance, and equipment availability",
    demoScript: [
      "1. Start on Fleet Operations Intelligence: show active loads, equipment availability, compliance risk, maintenance due, and receivables.",
      "2. Open Needs Action: explain how expired driver documents, maintenance due, missing PODs, and overdue invoices are surfaced automatically.",
      "3. Open Loads: show dispatch status, customer tracking, documents, invoicing, and rate confirmation.",
      "4. Open Vehicles and Maintenance: show preventive maintenance visibility before downtime hurts operations.",
      "5. Open Driver Compliance: show how the system prevents expired credentials from getting missed."
    ],
    hiddenKpis: ["kpiOpenQuotes", "kpiQuoteWinRate", "kpiQuotedValue", "kpiQuotesExpiring"],
    hiddenSections: ["quotes"]
  },
  broker_3pl: {
    label: "Broker / 3PL",
    title: "Brokerage Operations Intelligence",
    summaryFocus: "loads, quotes, carrier coverage, margins, customer tracking, invoices, and documents",
    demoScript: [
      "1. Start on Brokerage Operations Intelligence: show active loads, open quoted value, gross margin, claim exposure, and receivables.",
      "2. Open Needs Action: explain how low-margin loads, expiring quotes, missing PODs, overdue invoices, and load issues are surfaced automatically.",
      "3. Open Quotes: show sales pipeline, accepted quotes, and converting opportunities into booked loads.",
      "4. Open Carriers and Tender Load: show carrier directory, insurance/compliance tracking, and tender history.",
      "5. Open Load Details: show customer tracking, communications, issues, documents, invoice flow, and profitability."
    ],
    hiddenKpis: ["kpiComplianceRisk", "kpiMaintenanceDue", "kpiAvailableTrucks"]
  },
  dispatcher: {
    label: "Dispatcher",
    title: "Dispatch Operations Intelligence",
    summaryFocus: "loads, dispatch board activity, drivers, trucks, customer updates, and documents",
    demoScript: [
      "1. Start on Dispatch Operations Intelligence: show active loads, dispatch status, available trucks, and documents.",
      "2. Open Dispatch Board: show the daily operating view for drivers, trucks, and load movement.",
      "3. Open Loads: show pickup, delivery, status updates, and customer tracking.",
      "4. Open Drivers and Vehicles: show the operating roster used to assign work.",
      "5. Open Documents: show how proof of delivery and load paperwork stay attached to the work."
    ],
    hiddenKpis: ["kpiOpenQuotes", "kpiQuoteWinRate", "kpiQuotedValue", "kpiQuotesExpiring", "kpiGrossMargin", "kpiMarginPercent", "kpiProfitRisks", "kpiClaimExposure"],
    hiddenSections: ["quotes"]
  },
  hybrid: {
    label: "Hybrid",
    title: "Transportation Operations Intelligence",
    summaryFocus: "loads, quotes, drivers, equipment, compliance, maintenance, margins, invoices, and customer tracking",
    demoScript: [
      "1. Start on Transportation Operations Intelligence: show how carrier, broker, billing, and compliance work are visible in one place.",
      "2. Open Needs Action: explain how HyperRoute turns scattered work into one action list.",
      "3. Open Loads: show lifecycle, documents, tracking, issues, invoice flow, and profitability.",
      "4. Open Quotes and Carriers: show brokerage workflow.",
      "5. Open Drivers, Vehicles, Compliance, and Maintenance: show fleet workflow."
    ]
  }
};

const ROLE_DASHBOARD_PROFILES = {
  platform_admin: {
    label: "Platform Admin",
    title: "Platform Operations Intelligence"
  },
  owner: {
    label: "Owner",
    titleSuffix: "Executive View"
  },
  company_owner: {
    label: "Owner",
    titleSuffix: "Executive View"
  },
  admin: {
    label: "Admin",
    titleSuffix: "Admin View"
  },
  company_admin: {
    label: "Admin",
    titleSuffix: "Admin View"
  },
  dispatcher: {
    label: "Dispatcher",
    titleSuffix: "Dispatch View",
    summaryFocus: "load movement, dispatch activity, customer updates, documents, and open risks",
    hiddenKpis: ["kpiGrossMargin", "kpiMarginPercent", "kpiProfitRisks", "kpiClaimExposure", "kpiOpenReceivables", "kpiOverdueInvoices", "kpiQuoteWinRate", "kpiQuotedValue"],
    hiddenSections: ["quotes", "revenue", "owner"],
    hiddenMiniStats: ["revenue"]
  },
  accounting: {
    label: "Accounting",
    title: "Billing Intelligence",
    summaryFocus: "invoices, settlements, receivables, delivered loads, customer billing, and documents",
    hiddenKpis: ["kpiAvailableTrucks", "kpiComplianceRisk", "kpiMaintenanceDue", "kpiOpenQuotes", "kpiQuoteWinRate", "kpiQuotedValue", "kpiQuotesExpiring"],
    hiddenSections: ["quotes", "owner"]
  },
  maintenance: {
    label: "Maintenance",
    title: "Maintenance Intelligence",
    summaryFocus: "vehicle status, maintenance due, compliance exposure, documents, and service activity",
    hiddenKpis: ["kpiGrossMargin", "kpiMarginPercent", "kpiProfitRisks", "kpiClaimExposure", "kpiOpenReceivables", "kpiOverdueInvoices", "kpiOpenQuotes", "kpiQuoteWinRate", "kpiQuotedValue", "kpiQuotesExpiring"],
    hiddenSections: ["quotes", "revenue", "owner"],
    hiddenMiniStats: ["revenue"]
  }
};

async function loadDashboard() {
  const msg = document.getElementById("dashboardMessage");
  msg.textContent = "Loading dashboard...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const company = window.CompanyContext?.getCompany();
    const headers = window.CompanyContext?.getHeaders?.() || {
      apikey: API_KEY,
      Authorization: `Bearer ${API_KEY}`
    };

    if (!window.CompanyContext?.getCompanyId?.()) {
      msg.textContent = "No company selected. Create or select a company first.";
      msg.style.color = "#ef4444";
      return;
    }

    document.getElementById("dashboardSubtitle").textContent =
      `${company?.company_name || "Selected Company"} command center`;
    applyDashboardProfile(company);
    renderDemoMode(company);

    const [
      drivers,
      trucks,
      loads,
      invoices,
      documents,
      quotes,
      maintenanceLogs,
      maintenanceSchedules,
      assignments,
      loadIssues,
      loadExpenses,
      activityLogs
    ] = await Promise.all([
      fetchRows("drivers", "select=*", headers),
      fetchRows("trucks", "select=*", headers),
      fetchRows("loads", "select=*", headers),
      fetchRows("invoices", "select=*", headers),
      fetchRows("documents", "select=*", headers),
      fetchRows("quotes", "select=*", headers),
      fetchRows("maintenance_logs", "select=*", headers),
      fetchRows("maintenance_schedules", "select=*", headers),
      fetchRows("assignments", "select=*", headers),
      fetchRows("load_issues", "select=*", headers),
      fetchRows("load_expenses", "select=*", headers),
      fetchRows("activity_logs", "select=*&order=created_at.desc&limit=8", headers)
    ]);

    const metrics = calculateMetrics({
      drivers,
      trucks,
      loads,
      invoices,
      documents,
      quotes,
      maintenanceLogs,
      maintenanceSchedules,
      assignments,
      loadIssues,
      loadExpenses
    });

    renderKpis(metrics);
    renderOwnerCommandCenter(metrics);
    renderHealth(metrics);
    renderAttention(metrics);
    renderQuotePipeline(metrics);
    renderActivity(activityLogs, loads, invoices, maintenanceLogs);
    renderCharts(metrics);
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = err.message || "Error loading dashboard.";
    msg.style.color = "#ef4444";
  }
}

async function fetchRows(table, query, headers) {
  const url = window.CompanyContext?.scopedUrl?.(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`Dashboard skipped ${table}: ${await res.text()}`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.warn(`Dashboard skipped ${table}:`, err.message);
    return [];
  }
}

function calculateMetrics(data) {
  const today = startOfDay(new Date());
  const soon = addDays(today, 30);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const loadStatus = countByStatus(data.loads);
  const invoiceStatus = countByStatus(data.invoices);
  const quoteStatus = countByStatus(data.quotes || []);

  const pipelineStatuses = ["booked", "assigned", "dispatched", "picked_up", "in_transit"];
  const activeLoads = data.loads.filter(load => pipelineStatuses.includes(normalizeStatus(load.status)));
  const deliveredThisMonth = data.loads.filter(load =>
    normalizeStatus(load.status) === "delivered" &&
    dateOnOrAfter(load.delivery_date || load.dropoff_date || load.updated_at || load.created_at, firstOfMonth)
  );

  const openReceivables = data.invoices
    .filter(invoice => !["paid", "void", "cancelled"].includes(normalizeStatus(invoice.status)))
    .reduce((sum, invoice) => sum + Number(invoice.total_amount || invoice.total || 0), 0);

  const monthRevenue = data.invoices
    .filter(invoice => normalizeStatus(invoice.status) === "paid" && dateOnOrAfter(invoice.updated_at || invoice.invoice_date || invoice.created_at, firstOfMonth))
    .reduce((sum, invoice) => sum + Number(invoice.total_amount || invoice.total || 0), 0);

  const overdueInvoices = data.invoices.filter(invoice =>
    normalizeStatus(invoice.status) !== "paid" &&
    invoice.due_date &&
    startOfDay(new Date(invoice.due_date)) < today
  );

  const openQuotes = (data.quotes || []).filter(quote => ["draft", "sent"].includes(normalizeStatus(quote.status)));
  const acceptedQuotes = (data.quotes || []).filter(quote => normalizeStatus(quote.status) === "accepted");
  const rejectedQuotes = (data.quotes || []).filter(quote => normalizeStatus(quote.status) === "rejected");
  const decidedQuotes = acceptedQuotes.length + rejectedQuotes.length;
  const quoteWinRate = decidedQuotes ? Math.round((acceptedQuotes.length / decidedQuotes) * 100) : 0;
  const openQuotedValue = openQuotes.reduce((sum, quote) => sum + Number(quote.quoted_rate || 0), 0);
  const acceptedQuoteValue = acceptedQuotes.reduce((sum, quote) => sum + Number(quote.quoted_rate || 0), 0);
  const quotesExpiring = openQuotes.filter(quote => isExpired(quote.expiration_date, today) || isExpiringSoon(quote.expiration_date, today, soon));
  const convertedQuotes = (data.quotes || []).filter(quote => quote.load_id || quote.converted_at);

  const complianceRisk = data.drivers.filter(driver =>
    isExpired(driver.license_expiration || driver.cdl_expiration, today) ||
    isExpired(driver.medical_card_expiration, today) ||
    isExpired(driver.drug_test_expiration, today) ||
    isExpired(driver.safety_training_expiration, today) ||
    isExpiringSoon(driver.license_expiration || driver.cdl_expiration, today, soon) ||
    isExpiringSoon(driver.medical_card_expiration, today, soon) ||
    isExpiringSoon(driver.drug_test_expiration, today, soon) ||
    isExpiringSoon(driver.safety_training_expiration, today, soon)
  );

  const maintenanceDue = data.maintenanceSchedules.filter(schedule =>
    isExpired(schedule.next_due_date, today) || isExpiringSoon(schedule.next_due_date, today, soon)
  );

  const assignedTruckIds = new Set(data.assignments
    .filter(row => normalizeStatus(row.status) === "active")
    .map(row => row.truck_id));
  const unavailableTruckStatuses = ["in_shop", "in shop", "retired", "out_of_service", "out of service"];
  const availableTrucks = data.trucks.filter(truck =>
    !assignedTruckIds.has(truck.id) &&
    !unavailableTruckStatuses.includes(normalizeStatus(truck.status))
  );

  const deliveredLoadIds = new Set(data.loads
    .filter(load => normalizeStatus(load.status) === "delivered")
    .map(load => load.id));
  const invoicedLoadIds = new Set(data.invoices.map(invoice => invoice.load_id).filter(Boolean));
  const deliveredNotInvoiced = [...deliveredLoadIds].filter(loadId => !invoicedLoadIds.has(loadId));

  const podLoadIds = new Set(data.documents
    .filter(doc => normalizeStatus(doc.document_type) === "pod" && doc.entity_type === "load")
    .map(doc => doc.entity_id));
  const deliveredMissingPod = [...deliveredLoadIds].filter(loadId => !podLoadIds.has(loadId));
  const openIssues = (data.loadIssues || []).filter(issue => !["resolved", "closed"].includes(normalizeStatus(issue.status)));
  const issueExposureByLoad = new Map();
  openIssues.forEach(issue => {
    issueExposureByLoad.set(issue.load_id, (issueExposureByLoad.get(issue.load_id) || 0) + Number(issue.claim_amount || 0));
  });

  const approvedExpenses = (data.loadExpenses || []).filter(expense => ["approved", "reviewed"].includes(normalizeStatus(expense.status)));
  const pendingExpenses = (data.loadExpenses || []).filter(expense => normalizeStatus(expense.status) === "unreviewed");
  const expenseByLoad = new Map();
  approvedExpenses.forEach(expense => {
    const loadId = String(expense.load_id || "");
    if (!loadId) return;
    expenseByLoad.set(loadId, (expenseByLoad.get(loadId) || 0) + Number(expense.amount || 0));
  });

  const profitabilityRows = data.loads.map(load => {
    const revenue = getLoadRevenue(load);
    const carrierCost = getLoadCost(load, expenseByLoad);
    const claimExposure = issueExposureByLoad.get(load.id) || 0;
    const grossMargin = revenue - carrierCost - claimExposure;
    const marginPercent = revenue ? (grossMargin / revenue) * 100 : 0;
    const totalMiles = Number(load.loaded_miles || 0) + Number(load.empty_miles || 0);
    return { load, revenue, carrierCost, claimExposure, grossMargin, marginPercent, totalMiles };
  });
  const grossRevenue = profitabilityRows.reduce((sum, row) => sum + row.revenue, 0);
  const carrierCost = profitabilityRows.reduce((sum, row) => sum + row.carrierCost, 0);
  const claimExposure = profitabilityRows.reduce((sum, row) => sum + row.claimExposure, 0);
  const grossMargin = profitabilityRows.reduce((sum, row) => sum + row.grossMargin, 0);
  const marginPercent = grossRevenue ? Math.round((grossMargin / grossRevenue) * 100) : 0;
  const totalMiles = profitabilityRows.reduce((sum, row) => sum + row.totalMiles, 0);
  const profitPerMile = totalMiles ? grossMargin / totalMiles : 0;
  const pendingExpenseAmount = pendingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const deliveredNotInvoicedValue = data.loads
    .filter(load => deliveredNotInvoiced.map(String).includes(String(load.id)))
    .reduce((sum, load) => sum + getLoadRevenue(load), 0);
  const customerProfitability = buildCustomerProfitability(profitabilityRows);
  const profitRisks = profitabilityRows.filter(row =>
    row.claimExposure > 0 ||
    (row.revenue > 0 && row.grossMargin < 0) ||
    (row.revenue > 0 && row.marginPercent < 12)
  );

  const openRisks = overdueInvoices.length + complianceRisk.length + maintenanceDue.length + deliveredNotInvoiced.length + deliveredMissingPod.length + quotesExpiring.length + profitRisks.length;
  const healthScore = Math.max(0, Math.min(100, 100 - (openRisks * 8)));

  return {
    ...data,
    loadStatus,
    invoiceStatus,
    quoteStatus,
    activeLoads,
    deliveredThisMonth,
    openReceivables,
    monthRevenue,
    overdueInvoices,
    openQuotes,
    acceptedQuotes,
    rejectedQuotes,
    quoteWinRate,
    openQuotedValue,
    acceptedQuoteValue,
    quotesExpiring,
    convertedQuotes,
    complianceRisk,
    maintenanceDue,
    availableTrucks,
    deliveredNotInvoiced,
    deliveredMissingPod,
    openIssues,
    approvedExpenses,
    pendingExpenses,
    pendingExpenseAmount,
    deliveredNotInvoicedValue,
    grossRevenue,
    carrierCost,
    claimExposure,
    grossMargin,
    marginPercent,
    profitPerMile,
    customerProfitability,
    profitRisks,
    openRisks,
    healthScore
  };
}

function getLoadRevenue(load) {
  return Number(load.rate || 0) +
    Number(load.detention_billed || 0) +
    Number(load.accessorial_billed || 0);
}

function getLoadCost(load, expenseByLoad = new Map()) {
  return Number(load.carrier_rate || 0) +
    Number(load.fuel_cost || 0) +
    Number(load.toll_cost || 0) +
    Number(load.detention_paid || 0) +
    Number(load.lumper_cost || 0) +
    Number(load.other_costs || 0) +
    Number(expenseByLoad.get(String(load.id)) || 0);
}

function buildCustomerProfitability(rows) {
  const map = new Map();

  rows.forEach(row => {
    const customer = row.load.customer_name || row.load.customer || "Unassigned Customer";
    const current = map.get(customer) || { customer, revenue: 0, cost: 0, margin: 0, loads: 0 };
    current.revenue += row.revenue;
    current.cost += row.carrierCost;
    current.margin += row.grossMargin;
    current.loads += 1;
    map.set(customer, current);
  });

  return Array.from(map.values())
    .map(row => ({
      ...row,
      marginPercent: row.revenue ? (row.margin / row.revenue) * 100 : 0
    }))
    .sort((a, b) => a.marginPercent - b.marginPercent);
}

function renderKpis(metrics) {
  setText("activeLoads", metrics.activeLoads.length);
  setText("openRisks", metrics.openRisks);
  setText("monthlyRevenue", formatCurrency(metrics.monthRevenue));
  setText("kpiLoadPipeline", metrics.activeLoads.length);
  setText("kpiDeliveredMonth", metrics.deliveredThisMonth.length);
  setText("kpiGrossMargin", formatCurrency(metrics.grossMargin));
  setText("kpiMarginPercent", `${metrics.marginPercent}%`);
  setText("kpiProfitRisks", metrics.profitRisks.length);
  setText("kpiClaimExposure", formatCurrency(metrics.claimExposure));
  setText("kpiOpenReceivables", formatCurrency(metrics.openReceivables));
  setText("kpiOverdueInvoices", metrics.overdueInvoices.length);
  setText("kpiComplianceRisk", metrics.complianceRisk.length);
  setText("kpiMaintenanceDue", metrics.maintenanceDue.length);
  setText("kpiAvailableTrucks", metrics.availableTrucks.length);
  setText("kpiDocuments", metrics.documents.length);
  setText("kpiOpenQuotes", metrics.openQuotes.length);
  setText("kpiQuoteWinRate", `${metrics.quoteWinRate}%`);
  setText("kpiQuotedValue", formatCurrency(metrics.openQuotedValue));
  setText("kpiQuotesExpiring", metrics.quotesExpiring.length);
}

function renderOwnerCommandCenter(metrics) {
  setText("ownerEstimatedProfit", formatCurrency(metrics.grossMargin));
  setText("ownerProfitPerMile", `${formatCurrency(metrics.profitPerMile)}/mi`);
  setText("ownerCashWaiting", formatCurrency(metrics.openReceivables));
  setText("ownerUnbilledWork", formatCurrency(metrics.deliveredNotInvoicedValue));
  setText("ownerPendingExpenses", formatCurrency(metrics.pendingExpenseAmount));
  setText("ownerPendingExpenseCount", `${metrics.pendingExpenses.length} waiting review`);

  renderOwnerActions(metrics);
  renderOwnerCustomers(metrics);
}

function renderOwnerActions(metrics) {
  const actions = [
    {
      title: "Review pending expenses",
      count: metrics.pendingExpenses.length,
      detail: `${formatCurrency(metrics.pendingExpenseAmount)} waiting for approval before profit is final.`,
      href: "expense-review.html"
    },
    {
      title: "Invoice delivered loads",
      count: metrics.deliveredNotInvoiced.length,
      detail: `${formatCurrency(metrics.deliveredNotInvoicedValue)} delivered but not invoiced.`,
      href: "invoices.html"
    },
    {
      title: "Collect overdue invoices",
      count: metrics.overdueInvoices.length,
      detail: `${metrics.overdueInvoices.length} invoice${metrics.overdueInvoices.length === 1 ? "" : "s"} past due.`,
      href: "invoices.html"
    },
    {
      title: "Fix low-margin loads",
      count: metrics.profitRisks.length,
      detail: "Loads below margin target or exposed to claims need review.",
      href: "profit-intelligence.html"
    },
    {
      title: "Attach missing PODs",
      count: metrics.deliveredMissingPod.length,
      detail: "Missing delivery paperwork slows invoicing and collections.",
      href: "documents.html"
    }
  ].filter(action => action.count > 0);

  const list = document.getElementById("ownerActionList");
  if (!list) return;
  if (!actions.length) {
    list.innerHTML = `<div class="empty-state">No owner-level action items found.</div>`;
    return;
  }

  list.innerHTML = actions.slice(0, 5).map(action => `
    <a class="dashboard-list-item" href="${action.href}">
      <span class="status-count">${action.count}</span>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.detail)}</small>
      </span>
    </a>
  `).join("");
}

function renderOwnerCustomers(metrics) {
  const list = document.getElementById("ownerCustomerList");
  if (!list) return;
  const rows = metrics.customerProfitability.filter(row => row.revenue > 0).slice(0, 5);

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">No customer profitability data yet.</div>`;
    return;
  }

  list.innerHTML = rows.map(row => `
    <a class="dashboard-list-item" href="customer-profitability.html?customer=${encodeURIComponent(row.customer)}">
      <span class="status-count">${Math.round(row.marginPercent)}%</span>
      <span>
        <strong>${escapeHtml(row.customer)}</strong>
        <small>${formatCurrency(row.margin)} margin on ${formatCurrency(row.revenue)} revenue.</small>
      </span>
    </a>
  `).join("");
}

function applyDashboardProfile(company) {
  const profile = getDashboardProfile();
  const title = document.querySelector(".page-header h1");
  if (title) title.textContent = profile.title;

  const subtitle = document.getElementById("dashboardSubtitle");
  if (subtitle) {
    subtitle.textContent = `${company?.company_name || "Selected Company"} ${profile.label.toLowerCase()} command center`;
  }

  document.querySelectorAll("[data-dashboard-section]").forEach(section => {
    const sectionName = section.dataset.dashboardSection;
    section.hidden = Boolean(profile.hiddenSections?.includes(sectionName));
  });

  document.querySelectorAll(".kpi-card").forEach(card => {
    const metric = card.querySelector("h3")?.id;
    card.hidden = Boolean(metric && profile.hiddenKpis?.includes(metric));
  });

  document.querySelectorAll("[data-dashboard-mini]").forEach(item => {
    item.hidden = Boolean(profile.hiddenMiniStats?.includes(item.dataset.dashboardMini));
  });

  document.querySelectorAll(".dashboard-two-column").forEach(row => {
    const cards = Array.from(row.querySelectorAll(":scope > .card"));
    row.hidden = cards.length > 0 && cards.every(card => card.hidden);
  });
}

function renderDemoMode(company) {
  const banner = document.getElementById("demoModeBanner");
  const copyButton = document.getElementById("copyDemoScript");
  if (!banner || !copyButton) return;

  const isDemo = (company?.account_type || "").toLowerCase() === "demo" ||
    String(company?.company_name || "").toLowerCase().includes("demo");

  banner.hidden = !isDemo;
  if (!isDemo) return;

  copyButton.onclick = async () => {
    await copyText(buildDemoScript(company));
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy Demo Script";
    }, 1400);
  };
}

function buildDemoScript(company) {
  const profile = getDashboardProfile();
  return [
    `${company?.company_name || "HyperRoute Demo"} walkthrough`,
    "",
    ...profile.demoScript,
    "",
    "Positioning: HyperRoute helps transportation teams see what is moving, what is owed, what is risky, and what needs action today."
  ].join("\n");
}

function renderHealth(metrics) {
  const profile = getDashboardProfile();
  setText("healthScore", `${metrics.healthScore}%`);
  document.getElementById("healthMeterBar").style.width = `${metrics.healthScore}%`;

  const title = metrics.openRisks > 0 ? "Action required" : "Operations look steady";
  const summary = metrics.openRisks > 0
    ? `${metrics.openRisks} item${metrics.openRisks === 1 ? "" : "s"} need attention across ${profile.summaryFocus}.`
    : "No immediate operational risks found from the available records.";

  setText("todayFocusTitle", title);
  setText("todayFocusText", summary);
  setText("healthSummary", summary);
}

function renderAttention(metrics) {
  const enabledPages = window.CompanyContext?.getEnabledOperationPages?.() || new Set();
  const items = [
    {
      title: "Loads with profit risk",
      count: metrics.profitRisks.length,
      detail: "Review low margin, negative margin, or claim-exposed loads.",
      href: "reports.html"
    },
    {
      title: "Overdue invoices",
      count: metrics.overdueInvoices.length,
      detail: "Collect or update payment status.",
      href: "invoices.html"
    },
    {
      title: "Driver compliance risks",
      count: metrics.complianceRisk.length,
      detail: "Review expired or expiring driver records.",
      href: "compliance.html"
    },
    {
      title: "Maintenance due",
      count: metrics.maintenanceDue.length,
      detail: "Schedule service before equipment downtime.",
      href: "maintenance.html"
    },
    {
      title: "Delivered not invoiced",
      count: metrics.deliveredNotInvoiced.length,
      detail: "Convert delivered work into invoices.",
      href: "invoices.html"
    },
    {
      title: "Quotes expiring soon",
      count: metrics.quotesExpiring.length,
      detail: "Follow up before rate opportunities expire.",
      href: "quotes.html"
    },
    {
      title: "Delivered loads missing POD",
      count: metrics.deliveredMissingPod.length,
      detail: "Attach proof of delivery documents.",
      href: "documents.html"
    }
  ].filter(item => item.count > 0);
  const visibleItems = items.filter(item => enabledPages.has(item.href));

  const list = document.getElementById("attentionList");
  if (!visibleItems.length) {
    list.innerHTML = `<div class="empty-state">No urgent attention items found.</div>`;
    return;
  }

  list.innerHTML = visibleItems.map(item => `
    <a class="dashboard-list-item" href="${item.href}">
      <span class="status-count">${item.count}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </a>
  `).join("");
}

function renderQuotePipeline(metrics) {
  const list = document.getElementById("quotePipelineList");
  if (!list) return;

  const items = [
    {
      title: "Open quoted value",
      value: formatCurrency(metrics.openQuotedValue),
      detail: `${metrics.openQuotes.length} open quote${metrics.openQuotes.length === 1 ? "" : "s"} in draft or sent status.`
    },
    {
      title: "Accepted value",
      value: formatCurrency(metrics.acceptedQuoteValue),
      detail: `${metrics.acceptedQuotes.length} accepted quote${metrics.acceptedQuotes.length === 1 ? "" : "s"}.`
    },
    {
      title: "Converted to loads",
      value: metrics.convertedQuotes.length,
      detail: "Quotes already connected to load records."
    },
    {
      title: "Expiring soon",
      value: metrics.quotesExpiring.length,
      detail: "Quotes that are expired or within 30 days of expiration."
    }
  ];

  list.innerHTML = items.map(item => `
    <a class="dashboard-list-item" href="quotes.html">
      <span class="status-count quote-count">${item.value}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </span>
    </a>
  `).join("");
}

function renderActivity(activityLogs, loads, invoices, maintenanceLogs) {
  const fallback = [
    ...loads.slice(-3).map(load => ({
      created_at: load.created_at,
      title: `Load ${load.load_number || load.id}`,
      detail: `Status: ${displayStatus(load.status)}`
    })),
    ...invoices.slice(-3).map(invoice => ({
      created_at: invoice.created_at,
      title: invoice.invoice_number || `Invoice ${invoice.id}`,
      detail: `${displayStatus(invoice.status)} - ${formatCurrency(invoice.total_amount || invoice.total || 0)}`
    })),
    ...maintenanceLogs.slice(-2).map(row => ({
      created_at: row.created_at,
      title: row.maintenance_type || "Maintenance record",
      detail: row.notes || "Service history updated"
    }))
  ];

  const activity = activityLogs.length
    ? activityLogs.map(row => ({
      created_at: row.created_at,
      title: row.action || row.event_type || "Activity",
      detail: row.description || row.details || "System activity recorded"
    }))
    : fallback.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 8);

  const list = document.getElementById("recentActivityList");
  if (!activity.length) {
    list.innerHTML = `<div class="empty-state">No recent activity yet.</div>`;
    return;
  }

  list.innerHTML = activity.map(item => `
    <div class="dashboard-list-item">
      <span class="activity-dot"></span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}${item.created_at ? ` • ${formatDate(item.created_at)}` : ""}</small>
      </span>
    </div>
  `).join("");
}

function renderCharts(metrics) {
  renderDoughnut("loadStatusChart", metrics.loadStatus, ["#0788e8", "#10b981", "#f59e0b", "#6366f1", "#ef4444"]);
  renderDoughnut("invoiceStatusChart", metrics.invoiceStatus, ["#10b981", "#0788e8", "#f59e0b", "#ef4444", "#64748b"]);
  if (!getDashboardProfile().hiddenSections?.includes("quotes")) {
    renderDoughnut("quoteStatusChart", metrics.quoteStatus, ["#0788e8", "#10b981", "#f59e0b", "#ef4444", "#64748b"]);
  }
}

function getDashboardProfile() {
  const operationType = window.CompanyContext?.getOperationType?.() || "carrier";
  const role = window.CompanyContext?.getRole?.() || "dispatcher";
  const operationProfile = DASHBOARD_PROFILES[operationType] || DASHBOARD_PROFILES.carrier;
  const roleProfile = ROLE_DASHBOARD_PROFILES[role] || {};
  const title = roleProfile.title || (roleProfile.titleSuffix ? `${operationProfile.title} - ${roleProfile.titleSuffix}` : operationProfile.title);

  return {
    ...operationProfile,
    ...roleProfile,
    title,
    label: roleProfile.label ? `${operationProfile.label} ${roleProfile.label}` : operationProfile.label,
    summaryFocus: roleProfile.summaryFocus || operationProfile.summaryFocus,
    demoScript: roleProfile.demoScript || operationProfile.demoScript,
    hiddenKpis: [...new Set([...(operationProfile.hiddenKpis || []), ...(roleProfile.hiddenKpis || [])])],
    hiddenSections: [...new Set([...(operationProfile.hiddenSections || []), ...(roleProfile.hiddenSections || [])])],
    hiddenMiniStats: [...new Set([...(operationProfile.hiddenMiniStats || []), ...(roleProfile.hiddenMiniStats || [])])]
  };
}

function renderDoughnut(canvasId, counts, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  const labels = Object.keys(counts);
  const values = Object.values(counts);
  if (!values.length) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#64748b";
    context.font = "14px Inter, sans-serif";
    context.fillText("No data yet", 16, 32);
    return;
  }

  new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors
      }]
    },
    options: {
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });
}

function countByStatus(rows) {
  return rows.reduce((counts, row) => {
    const label = displayStatus(row.status || "unknown");
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function displayStatus(value) {
  const normalized = normalizeStatus(value || "unknown");
  return normalized.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function isExpired(value, today) {
  if (!value) return false;
  const date = startOfDay(new Date(value));
  if (Number.isNaN(date.getTime())) return false;
  return date < today;
}

function isExpiringSoon(value, today, soon) {
  if (!value) return false;
  const date = startOfDay(new Date(value));
  if (Number.isNaN(date.getTime())) return false;
  return date >= today && date <= soon;
}

function dateOnOrAfter(value, minimumDate) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= minimumDate;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
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

loadDashboard();
