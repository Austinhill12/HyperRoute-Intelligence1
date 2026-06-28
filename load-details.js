const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };
const statusByEvent = {
  dispatched: "dispatched",
  arrived_pickup: "dispatched",
  loaded: "picked_up",
  departed_pickup: "in_transit",
  in_transit: "in_transit",
  arrived_delivery: "in_transit",
  delivered: "delivered",
  delay: "in_transit",
  issue: "in_transit",
  pod_received: "pod_received",
  invoiced: "invoiced",
  paid: "paid"
};
const requiredLoadDocuments = [
  { type: "rate_confirmation", label: "Rate Con", required: true },
  { type: "bol", label: "BOL", required: true },
  { type: "pod", label: "POD", required: true },
  { type: "invoice", label: "Invoice", required: false },
  { type: "lumper_receipt", label: "Lumper", required: false },
  { type: "accessorial_receipt", label: "Accessorial", required: false },
  { type: "scale_ticket", label: "Scale Ticket", required: false }
];
let currentLoad = null;
let companySettings = null;
let loadTenderCarriers = new Map();
let currentLoadDocuments = [];
let currentLoadInvoices = [];
let currentLoadExpenses = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || headers),
    ...extra
  };
}

function getLoadId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function loadDetails() {
  const id = getLoadId();
  const msg = document.getElementById("loadDetailsMessage");

  if (!id) {
    document.getElementById("loadTitle").textContent = "No load ID provided.";
    return;
  }

  try {
    await window.CompanyContext?.ready();
    const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${id}&select=*`, { headers: getHeaders() });

    if (!res.ok) throw new Error(await res.text());

    const [load] = await res.json();
    if (!load) {
      document.getElementById("loadTitle").textContent = "Load not found.";
      return;
    }

    currentLoad = load;
    populateTripCostForm(load);
    populateRoutePlannerForm(load);
    document.getElementById("loadTitle").textContent = `Load ${load.load_number || load.id}`;
    document.getElementById("loadStatus").textContent = formatStatus(load.status);
    document.getElementById("customerName").textContent = load.customer_name || load.customer || "N/A";
    document.getElementById("loadLane").textContent = `${getRouteOrigin(load) || "-"} to ${getRouteDestination(load) || "-"}`;
    document.getElementById("pickupInfo").textContent = formatDateTime(load.pickup_date, load.pickup_time);
    document.getElementById("deliveryInfo").textContent = formatDateTime(load.delivery_date || load.dropoff_date, load.delivery_time);
    document.getElementById("commodity").textContent = load.commodity || "N/A";
    document.getElementById("weight").textContent = load.weight ? Number(load.weight).toLocaleString() : "N/A";
    document.getElementById("rate").textContent = load.rate ? `$${Number(load.rate).toLocaleString()}` : "N/A";
    renderProfitSummary(load);
    renderRouteSummary(load);
    document.getElementById("driverName").textContent = await getDriverName(load.driver_id);
    const assignment = await getLoadAssignment(load.id);
    document.getElementById("truckName").textContent = await getTruckName(assignment?.truck_id);
    document.getElementById("trackingCode").textContent = load.tracking_code || "Run customer tracking SQL to generate tracking codes";
    document.getElementById("notes").textContent = load.notes || "N/A";
    renderLoadWorkflow();
    document.getElementById("editLoadLink").href = `edit-load.html?id=${load.id}`;
    document.getElementById("tenderLoadLink").href = `tender-load.html?id=${load.id}`;
    document.getElementById("createTenderLink").href = `tender-load.html?id=${load.id}`;
    document.getElementById("dispatchPacketLink").href = `dispatch-packet.html?id=${load.id}`;
    document.getElementById("rateConfirmationLink").href = `rate-confirmation.html?id=${load.id}`;
    setupDispatchPacketActions(load);
    setupTrackingActions(load);
    await loadTenders(load.id);
    await loadCommunications(load.id);
    await loadIssues(load.id);
    await loadEvents(load.id);
    await loadDocuments(load.id);
    await loadExpenses(load.id);
    companySettings = await fetchCompanySettings();
    await loadInvoices(load.id);
    setupInvoiceDefaults(load);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading load: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderProfitSummary(load) {
  const totals = calculateLoadProfit(load, currentLoadExpenses);
  const loadedMiles = toNumber(load.loaded_miles);
  const emptyMiles = toNumber(load.empty_miles);

  setText("estimatedProfit", `${formatCurrency(totals.profit)}${totals.totalMiles ? ` (${formatCurrency(totals.netPerMile)}/mi)` : ""}`);
  setText("loadMiles", totals.totalMiles ? `${loadedMiles.toLocaleString()} loaded / ${emptyMiles.toLocaleString()} empty` : "N/A");
  setText("costBreakdown", [
    `Carrier ${formatCurrency(totals.carrierCost)}`,
    `Fuel ${formatCurrency(totals.fuelCost)}`,
    `Tolls ${formatCurrency(totals.tollCost)}`,
    `Other ${formatCurrency(totals.otherCost)}`
  ].join(" | "));
  renderLoadProfitSnapshot(load, currentLoadExpenses);
}

function renderLoadProfitSnapshot(load = currentLoad, expenses = currentLoadExpenses) {
  const container = document.getElementById("loadProfitSnapshot");
  const health = document.getElementById("loadProfitHealth");
  if (!container || !health || !load) return;

  const totals = calculateLoadProfit(load, expenses);
  const warnings = buildProfitWarnings(load, totals);
  const marginClass = totals.marginPercent >= 20 ? "success" : totals.marginPercent >= 10 ? "caution" : "warning";

  health.textContent = warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Healthy";
  health.className = `status-pill ${warnings.length ? "warning" : "success"}`;

  container.innerHTML = `
    <div class="load-profit-grid">
      ${profitMetric("Revenue", formatCurrency(totals.revenue), "Linehaul plus billed accessorials.")}
      ${profitMetric("Total Cost", formatCurrency(totals.totalCost), "Carrier/driver cost plus trip expenses.")}
      ${profitMetric("Profit", formatCurrency(totals.profit), `${totals.marginPercent}% margin`, marginClass)}
      ${profitMetric("Net / Mile", totals.totalMiles ? formatCurrency(totals.netPerMile) : "N/A", `${totals.totalMiles || 0} total miles`)}
    </div>
    <div class="load-profit-breakdown">
      <div><span>Carrier / Driver</span><strong>${formatCurrency(totals.carrierCost)}</strong></div>
      <div><span>Fuel</span><strong>${formatCurrency(totals.fuelCost)}</strong></div>
      <div><span>Tolls</span><strong>${formatCurrency(totals.tollCost)}</strong></div>
      <div><span>Other Expenses</span><strong>${formatCurrency(totals.otherCost)}</strong></div>
    </div>
    <div class="load-profit-warnings">
      ${warnings.length
        ? warnings.map(warning => `<p><strong>!</strong> ${escapeHtml(warning)}</p>`).join("")
        : `<p class="success-note"><strong>OK</strong> No major profit inputs are missing.</p>`}
    </div>
  `;
}

function renderRouteSummary(load = currentLoad) {
  const container = document.getElementById("routeSummary");
  const confidence = document.getElementById("routeConfidence");
  if (!container || !confidence || !load) return;

  const origin = getRouteOrigin(load);
  const destination = getRouteDestination(load);
  const loadedMiles = toNumber(load.loaded_miles);
  const emptyMiles = toNumber(load.empty_miles);
  const totalMiles = loadedMiles + emptyMiles;
  const fuelCost = toNumber(load.fuel_cost);
  const tollCost = toNumber(load.toll_cost);
  const estimatedDriveHours = totalMiles ? totalMiles / 55 : 0;
  const routeComplete = Boolean(origin && destination && totalMiles);

  confidence.textContent = routeComplete ? "Ready" : "Needs miles";
  confidence.className = `status-pill ${routeComplete ? "success" : "warning"}`;

  container.innerHTML = `
    <article>
      <span>Origin</span>
      <strong>${escapeHtml(origin || "Pickup TBD")}</strong>
    </article>
    <article>
      <span>Destination</span>
      <strong>${escapeHtml(destination || "Delivery TBD")}</strong>
    </article>
    <article>
      <span>Total Miles</span>
      <strong>${totalMiles ? totalMiles.toLocaleString() : "N/A"}</strong>
      <small>${loadedMiles.toLocaleString()} loaded / ${emptyMiles.toLocaleString()} deadhead</small>
    </article>
    <article>
      <span>Est. Drive Time</span>
      <strong>${estimatedDriveHours ? `${estimatedDriveHours.toFixed(1)} hrs` : "N/A"}</strong>
      <small>Calculated at 55 mph average.</small>
    </article>
    <article>
      <span>Fuel Estimate</span>
      <strong>${formatCurrency(fuelCost)}</strong>
      <small>Feeds profit snapshot.</small>
    </article>
    <article>
      <span>Toll Estimate</span>
      <strong>${formatCurrency(tollCost)}</strong>
      <small>Feeds profit snapshot.</small>
    </article>
  `;
}

function getRouteOrigin(load = {}) {
  return firstPresent(
    load.pickup_location,
    load.pickup_address,
    load.origin,
    load.origin_location,
    load.shipper_address,
    load.shipper_location,
    joinLocationParts(load.pickup_city, load.pickup_state, load.pickup_zip),
    joinLocationParts(load.origin_city, load.origin_state, load.origin_zip),
    addressLike(load.shipper_name)
  );
}

function getRouteDestination(load = {}) {
  return firstPresent(
    load.delivery_location,
    load.dropoff_location,
    load.delivery_address,
    load.dropoff_address,
    load.destination,
    load.destination_location,
    load.consignee_address,
    load.consignee_location,
    joinLocationParts(load.delivery_city, load.delivery_state, load.delivery_zip),
    joinLocationParts(load.dropoff_city, load.dropoff_state, load.dropoff_zip),
    joinLocationParts(load.destination_city, load.destination_state, load.destination_zip),
    addressLike(load.consignee_name)
  );
}

function firstPresent(...values) {
  return values.find(value => String(value || "").trim()) || "";
}

function joinLocationParts(...parts) {
  const value = parts.filter(part => String(part || "").trim()).join(", ");
  return value || "";
}

function addressLike(value) {
  const text = String(value || "").trim();
  return /\d/.test(text) && /,/.test(text) ? text : "";
}

function populateTripCostForm(load = currentLoad) {
  const form = document.getElementById("tripCostForm");
  if (!form || !load) return;

  [
    "carrier_rate",
    "loaded_miles",
    "empty_miles",
    "fuel_cost",
    "toll_cost",
    "lumper_cost",
    "detention_paid",
    "other_costs"
  ].forEach(field => {
    const input = form.elements[field];
    if (input) input.value = load[field] ?? "";
  });
}

function populateRoutePlannerForm(load = currentLoad) {
  const form = document.getElementById("routePlannerForm");
  if (!form || !load) return;

  ["loaded_miles", "empty_miles", "toll_cost"].forEach(field => {
    const input = form.elements[field];
    if (input) input.value = load[field] ?? "";
  });

  if (form.elements.fuel_mpg && !form.elements.fuel_mpg.value) form.elements.fuel_mpg.value = "6.5";
  if (form.elements.fuel_price && !form.elements.fuel_price.value) form.elements.fuel_price.value = "3.85";
  if (form.elements.drive_hours) {
    const totalMiles = toNumber(load.loaded_miles) + toNumber(load.empty_miles);
    form.elements.drive_hours.value = totalMiles ? (totalMiles / 55).toFixed(1) : "";
  }
}

function profitMetric(label, value, detail, className = "") {
  return `
    <article class="load-profit-metric ${escapeHtml(className)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail || "")}</small>
    </article>
  `;
}

function calculateLoadProfit(load, expenses = []) {
  const activeExpenses = expenses.filter(expense => normalizeStatus(expense.status || "unreviewed") !== "rejected");
  const revenue = toNumber(load.rate) + toNumber(load.detention_billed) + toNumber(load.accessorial_billed);
  const carrierCost = toNumber(load.carrier_rate);
  const loadFuel = toNumber(load.fuel_cost);
  const loadTolls = toNumber(load.toll_cost);
  const loadOther = toNumber(load.detention_paid) + toNumber(load.lumper_cost) + toNumber(load.other_costs);
  const expenseFuel = sumExpenses(activeExpenses, ["fuel"]);
  const expenseTolls = sumExpenses(activeExpenses, ["toll", "tolls"]);
  const expenseOther = activeExpenses.reduce((sum, expense) => {
    const category = normalizeStatus(expense.category);
    return ["fuel", "toll", "tolls"].includes(category) ? sum : sum + toNumber(expense.amount);
  }, 0);
  const fuelCost = loadFuel + expenseFuel;
  const tollCost = loadTolls + expenseTolls;
  const otherCost = loadOther + expenseOther;
  const totalCost = carrierCost + fuelCost + tollCost + otherCost;
  const profit = revenue - totalCost;
  const totalMiles = toNumber(load.loaded_miles) + toNumber(load.empty_miles);
  const marginPercent = revenue ? Math.round((profit / revenue) * 100) : 0;

  return {
    revenue,
    carrierCost,
    fuelCost,
    tollCost,
    otherCost,
    totalCost,
    profit,
    totalMiles,
    marginPercent,
    netPerMile: totalMiles ? profit / totalMiles : 0
  };
}

function sumExpenses(expenses, categories) {
  const normalized = new Set(categories.map(normalizeStatus));
  return expenses.reduce((sum, expense) => (
    normalized.has(normalizeStatus(expense.category)) ? sum + toNumber(expense.amount) : sum
  ), 0);
}

function buildProfitWarnings(load, totals) {
  const warnings = [];
  if (!totals.revenue) warnings.push("Missing revenue/rate. Profit cannot be trusted.");
  if (!totals.carrierCost) warnings.push("Missing carrier or driver cost.");
  if (!totals.totalMiles) warnings.push("Missing loaded/empty miles for net-per-mile.");
  if (!totals.fuelCost) warnings.push("No fuel cost or fuel receipt recorded.");
  if (totals.revenue && totals.marginPercent < 10) warnings.push(`Low margin: ${totals.marginPercent}%. Review pricing or trip costs.`);
  return warnings;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadCommunications(loadId) {
  const tbody = document.getElementById("communicationsTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Loading communications...</td></tr>`;

  try {
    const query = `load_id=eq.${loadId}&select=*&order=created_at.desc`;
    const res = await fetch(
      window.CompanyContext?.scopedUrl("load_communications", query) || `${BASE_URL}/rest/v1/load_communications?${query}`,
      { headers: getHeaders() }
    );

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Run load-communications.sql in Supabase first.</td></tr>`;
      return;
    }

    renderCommunications(await res.json());
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6">Error loading communications.</td></tr>`;
  }
}

function renderCommunications(rows) {
  const tbody = document.getElementById("communicationsTableBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No communication records yet.</td></tr>`;
    return;
  }

  rows.forEach(rowData => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(formatStatus(rowData.contact_type))}</strong>
        <span class="muted-line">${escapeHtml([rowData.contact_name, rowData.contact_detail].filter(Boolean).join(" / ") || "N/A")}</span>
      </td>
      <td>${escapeHtml(formatStatus(rowData.direction))} ${escapeHtml(formatStatus(rowData.channel))}<span class="muted-line">${formatTimestamp(rowData.created_at)}</span></td>
      <td>${escapeHtml(rowData.subject || "N/A")}<span class="muted-line">${escapeHtml(rowData.summary)}</span></td>
      <td>${formatTimestamp(rowData.next_follow_up_at)}</td>
      <td><span class="status-pill ${getCommunicationStatusClass(rowData)}">${escapeHtml(formatStatus(rowData.status))}</span></td>
      <td>
        ${rowData.status === "open" ? `<button class="view" type="button" data-complete-communication="${escapeHtml(rowData.id)}">Complete</button>` : ""}
        <button class="delete" type="button" data-delete-communication="${escapeHtml(rowData.id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-complete-communication]").forEach(button => {
    button.addEventListener("click", () => completeCommunication(button.dataset.completeCommunication));
  });
  tbody.querySelectorAll("[data-delete-communication]").forEach(button => {
    button.addEventListener("click", () => deleteCommunication(button.dataset.deleteCommunication));
  });
}

function getCommunicationStatusClass(rowData) {
  if (rowData.status !== "open") return "success";
  const due = rowData.next_follow_up_at ? new Date(rowData.next_follow_up_at) : null;
  if (due && due < new Date()) return "warning";
  return "caution";
}

async function loadIssues(loadId) {
  const tbody = document.getElementById("issuesTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Loading issues...</td></tr>`;

  try {
    const query = `load_id=eq.${loadId}&select=*&order=created_at.desc`;
    const res = await fetch(
      window.CompanyContext?.scopedUrl("load_issues", query) || `${BASE_URL}/rest/v1/load_issues?${query}`,
      { headers: getHeaders() }
    );

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Run load-issues.sql in Supabase first.</td></tr>`;
      return;
    }

    renderIssues(await res.json());
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6">Error loading issues.</td></tr>`;
  }
}

function renderIssues(rows) {
  const tbody = document.getElementById("issuesTableBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No issues or claims recorded.</td></tr>`;
    return;
  }

  rows.forEach(issue => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(issue.title)}</strong>
        <span class="muted-line">${escapeHtml(formatStatus(issue.issue_type))}${issue.due_at ? ` • Due ${escapeHtml(formatTimestamp(issue.due_at))}` : ""}</span>
        ${issue.description ? `<span class="muted-line">${escapeHtml(issue.description)}</span>` : ""}
      </td>
      <td><span class="status-pill ${getIssueSeverityClass(issue.severity)}">${escapeHtml(formatStatus(issue.severity))}</span></td>
      <td>${escapeHtml(formatStatus(issue.responsible_party))}</td>
      <td>${formatCurrency(issue.claim_amount)}</td>
      <td><span class="status-pill ${getIssueStatusClass(issue.status)}">${escapeHtml(formatStatus(issue.status))}</span></td>
      <td>
        ${["open", "in_progress"].includes(issue.status) ? `<button class="view" type="button" data-resolve-issue="${escapeHtml(issue.id)}">Resolve</button>` : ""}
        <button class="delete" type="button" data-delete-issue="${escapeHtml(issue.id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-resolve-issue]").forEach(button => {
    button.addEventListener("click", () => resolveIssue(button.dataset.resolveIssue));
  });
  tbody.querySelectorAll("[data-delete-issue]").forEach(button => {
    button.addEventListener("click", () => deleteIssue(button.dataset.deleteIssue));
  });
}

function getIssueSeverityClass(severity) {
  if (["critical", "high"].includes(severity)) return "warning";
  if (severity === "medium") return "caution";
  return "success";
}

function getIssueStatusClass(status) {
  if (["resolved", "closed"].includes(status)) return "success";
  if (status === "in_progress") return "caution";
  return "warning";
}

async function loadTenders(loadId) {
  const tbody = document.getElementById("loadTendersTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">Loading tenders...</td></tr>`;

  try {
    const query = `load_id=eq.${loadId}&select=*&order=created_at.desc`;
    const res = await fetch(
      window.CompanyContext?.scopedUrl("load_tenders", query) || `${BASE_URL}/rest/v1/load_tenders?${query}`,
      { headers: getHeaders() }
    );

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="5">Run carrier-tenders.sql in Supabase first.</td></tr>`;
      return;
    }

    const tenders = await res.json();
    await hydrateTenderCarriers(tenders);
    renderLoadTenders(tenders);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5">Error loading tenders.</td></tr>`;
  }
}

async function hydrateTenderCarriers(tenders) {
  const ids = [...new Set(tenders.map(tender => tender.carrier_id).filter(Boolean))];
  loadTenderCarriers = new Map();
  if (!ids.length) return;

  const res = await fetch(
    window.CompanyContext?.scopedUrl("carriers", `id=in.(${ids.join(",")})&select=id,carrier_name,mc_number,dot_number`) || `${BASE_URL}/rest/v1/carriers?id=in.(${ids.join(",")})&select=id,carrier_name,mc_number,dot_number`,
    { headers: getHeaders() }
  );
  if (!res.ok) return;
  const carriers = await res.json();
  carriers.forEach(carrier => loadTenderCarriers.set(String(carrier.id), carrier));
}

function renderLoadTenders(tenders) {
  const tbody = document.getElementById("loadTendersTableBody");
  tbody.innerHTML = "";

  if (!tenders.length) {
    tbody.innerHTML = `<tr><td colspan="5">No carrier tenders created.</td></tr>`;
    return;
  }

  tenders.forEach(tender => {
    const carrier = loadTenderCarriers.get(String(tender.carrier_id));
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(carrier?.carrier_name || "Carrier")}</strong><span class="muted-line">${escapeHtml(tender.tender_number || "")}</span></td>
      <td><span class="status-pill ${getTenderStatusClass(tender.status)}">${formatStatus(tender.status)}</span></td>
      <td>${formatCurrency(tender.carrier_rate)}</td>
      <td>${formatTimestamp(tender.expires_at)}</td>
      <td>
        <a class="view" href="tender-load.html?id=${currentLoad.id}">Manage</a>
        <a class="view secondary-action" href="rate-confirmation.html?id=${currentLoad.id}&tender_id=${tender.id}">Rate Conf</a>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function getTenderStatusClass(status) {
  if (status === "accepted") return "success";
  if (["rejected", "cancelled"].includes(status)) return "warning";
  if (status === "sent") return "caution";
  return "success";
}

function setupInvoiceDefaults(load) {
  const today = new Date();
  const dueDate = new Date();
  const termsDays = Number(companySettings?.payment_terms_days || 30);
  dueDate.setDate(today.getDate() + termsDays);

  document.getElementById("invoiceDate").value = today.toISOString().slice(0, 10);
  document.getElementById("dueDate").value = dueDate.toISOString().slice(0, 10);
  document.getElementById("linehaulAmount").value = load.rate || 0;
  document.getElementById("invoiceNumber").value = generateInvoiceNumber(load);
  document.getElementById("invoiceNotes").value = companySettings?.default_invoice_notes || "";
}

function setupTrackingActions(load) {
  const openButton = document.getElementById("openTrackingLink");
  const copyButton = document.getElementById("copyTrackingLink");
  const copyMessageButton = document.getElementById("copyTrackingMessage");
  const emailButton = document.getElementById("emailTrackingLink");
  const smsButton = document.getElementById("smsTrackingLink");
  const msg = document.getElementById("trackingLinkMessage");
  const trackingUrl = buildTrackingUrl(load);
  const customerMessage = buildCustomerTrackingMessage(load, trackingUrl);
  const emailAddress = getEmailFromLoad(load);
  const phoneNumber = getPhoneFromLoad(load);

  openButton.disabled = !trackingUrl;
  copyButton.disabled = !trackingUrl;
  copyMessageButton.disabled = !trackingUrl;
  emailButton.disabled = !trackingUrl;
  smsButton.disabled = !trackingUrl;

  openButton.onclick = () => {
    if (!trackingUrl) return showTrackingMessage("Tracking code is missing. Run the customer tracking SQL first.", true);
    window.open(trackingUrl, "_blank");
  };

  copyButton.onclick = async () => {
    if (!trackingUrl) return showTrackingMessage("Tracking code is missing. Run the customer tracking SQL first.", true);
    await copyText(trackingUrl);
    showTrackingMessage("Tracking link copied.");
    await recordTrackingSentEvent("Tracking link copied for customer.");
  };

  copyMessageButton.onclick = async () => {
    if (!trackingUrl) return showTrackingMessage("Tracking code is missing. Run the customer tracking SQL first.", true);
    await copyText(customerMessage);
    showTrackingMessage("Customer tracking message copied.");
    await recordTrackingSentEvent("Customer tracking message copied.");
  };

  emailButton.onclick = async () => {
    if (!trackingUrl) return showTrackingMessage("Tracking code is missing. Run the customer tracking SQL first.", true);
    const subject = encodeURIComponent(`Tracking for Load ${load.load_number || load.id}`);
    const body = encodeURIComponent(customerMessage);
    window.location.href = `mailto:${encodeURIComponent(emailAddress || "")}?subject=${subject}&body=${body}`;
    showTrackingMessage(emailAddress ? "Email message opened." : "Email message opened. Add the customer email before sending.");
    await recordTrackingSentEvent(emailAddress ? `Tracking email opened for ${emailAddress}.` : "Tracking email opened.");
  };

  smsButton.onclick = async () => {
    if (!trackingUrl) return showTrackingMessage("Tracking code is missing. Run the customer tracking SQL first.", true);
    const smsBody = encodeURIComponent(customerMessage);
    window.location.href = phoneNumber ? `sms:${phoneNumber}?&body=${smsBody}` : `sms:?&body=${smsBody}`;
    showTrackingMessage(phoneNumber ? "SMS message opened." : "SMS message opened. Add the customer phone before sending.");
    await recordTrackingSentEvent(phoneNumber ? `Tracking SMS opened for ${phoneNumber}.` : "Tracking SMS opened.");
  };
}

function setupDispatchPacketActions(load) {
  const copyButton = document.getElementById("copyDispatchPacketLink");
  if (!copyButton) return;

  const packetUrl = new URL(`dispatch-packet.html?id=${load.id}`, window.location.href).href;
  copyButton.onclick = async () => {
    await copyText(packetUrl);
    showTrackingMessage("Dispatch packet link copied.");
  };
}

function buildTrackingUrl(load) {
  const lookupValue = load?.tracking_code || load?.load_number || load?.id;
  if (!lookupValue) return "";
  const url = new URL("track-load.html", window.location.href);
  url.searchParams.set("q", lookupValue);
  return url.href;
}

function showTrackingMessage(text, isError = false) {
  const msg = document.getElementById("trackingLinkMessage");
  msg.textContent = text;
  msg.style.color = isError ? "#ef4444" : "#047857";
}

function buildCustomerTrackingMessage(load, trackingUrl) {
  const companyName = window.CompanyContext?.getCompany?.()?.company_name || "your carrier";
  const loadLabel = load.load_number || load.id;
  const pickup = getRouteOrigin(load) || "pickup";
  const delivery = getRouteDestination(load) || "delivery";

  return [
    `Hello, your shipment for Load ${loadLabel} is now trackable.`,
    ``,
    `Lane: ${pickup} to ${delivery}`,
    `Status: ${formatStatus(load.status)}`,
    ``,
    `Track it here:`,
    trackingUrl,
    ``,
    `Powered by HyperRoute Intelligence`,
    `${companyName}`
  ].join("\n");
}

function getEmailFromLoad(load) {
  return [load.shipper_contact, load.consignee_contact, load.customer_email, load.email]
    .map(value => String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0])
    .find(Boolean) || "";
}

function getPhoneFromLoad(load) {
  const raw = [load.shipper_contact, load.consignee_contact, load.customer_phone, load.phone]
    .map(value => String(value || "").match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0])
    .find(Boolean) || "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

async function recordTrackingSentEvent(notes) {
  if (!currentLoad?.id) return;

  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(currentLoad.id),
    event_type: "tracking_sent",
    event_time: new Date().toISOString(),
    location: null,
    notes
  }) || {
    load_id: Number(currentLoad.id),
    event_type: "tracking_sent",
    event_time: new Date().toISOString(),
    location: null,
    notes
  };

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(eventData)
    });

    if (!res.ok) throw new Error(await res.text());
    await loadEvents(currentLoad.id);
  } catch (err) {
    console.warn("Unable to record tracking sent event:", err.message);
  }
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

async function fetchCompanySettings() {
  try {
    const url = window.CompanyContext?.scopedUrl("company_settings", "id=eq.1&select=*") || `${BASE_URL}/rest/v1/company_settings?id=eq.1&select=*`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return null;
    const [settings] = await res.json();
    return settings || null;
  } catch (err) {
    console.warn("Company settings unavailable:", err);
    return null;
  }
}

function generateInvoiceNumber(load) {
  const prefix = companySettings?.invoice_prefix || "INV-";
  const reference = load.load_number || load.id || Date.now();
  return `${prefix}${reference}`;
}

async function loadInvoices(loadId) {
  const tbody = document.getElementById("loadInvoicesTableBody");
  tbody.innerHTML = `<tr><td colspan="5">Loading invoices...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("invoices", `load_id=eq.${loadId}&select=*&order=created_at.desc`) || `${BASE_URL}/rest/v1/invoices?load_id=eq.${loadId}&select=*&order=created_at.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const invoices = await res.json();
    renderLoadInvoices(invoices);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5">Error loading invoices.</td></tr>`;
  }
}

function renderLoadInvoices(invoices) {
  currentLoadInvoices = invoices || [];
  renderCloseoutChecklist();
  const tbody = document.getElementById("loadInvoicesTableBody");
  tbody.innerHTML = "";

  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="5">No invoices created.</td></tr>`;
    return;
  }

  invoices.forEach(invoice => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${invoice.invoice_number || invoice.id}</td>
      <td>${formatStatus(invoice.status)}</td>
      <td>${invoice.due_date || "N/A"}</td>
      <td>${formatCurrency(invoice.total_amount)}</td>
      <td>
        <a class="view" href="invoice-details.html?id=${invoice.id}">View</a>
        <a class="view" href="edit-invoice.html?id=${invoice.id}">Edit</a>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadDocuments(loadId) {
  const tbody = document.getElementById("loadDocumentsTableBody");
  tbody.innerHTML = `<tr><td colspan="4">Loading documents...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("documents", `entity_type=eq.load&entity_id=eq.${loadId}&select=*&order=created_at.desc`) || `${BASE_URL}/rest/v1/documents?entity_type=eq.load&entity_id=eq.${loadId}&select=*&order=created_at.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const documents = await res.json();
    currentLoadDocuments = documents || [];
    renderDocuments(documents);
    renderDocumentChecklist(documents);
    renderCloseoutChecklist();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4">Error loading documents.</td></tr>`;
    currentLoadDocuments = [];
    renderDocumentChecklist([]);
    renderCloseoutChecklist();
  }
}

async function loadExpenses(loadId) {
  const tbody = document.getElementById("loadExpensesTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Loading expenses...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("load_expenses", `load_id=eq.${loadId}&select=*&order=created_at.desc`) || `${BASE_URL}/rest/v1/load_expenses?load_id=eq.${loadId}&select=*&order=created_at.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6">Run Profit Intelligence v2 SQL to enable expense review.</td></tr>`;
      currentLoadExpenses = [];
      renderLoadProfitSnapshot();
      return;
    }

    currentLoadExpenses = await res.json();
    renderExpenses(currentLoadExpenses);
    renderLoadProfitSnapshot();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6">Error loading expenses.</td></tr>`;
    currentLoadExpenses = [];
    renderLoadProfitSnapshot();
  }
}

function renderExpenses(expenses) {
  const tbody = document.getElementById("loadExpensesTableBody");
  tbody.innerHTML = "";

  if (!expenses.length) {
    tbody.innerHTML = `<tr><td colspan="6">No driver expenses submitted.</td></tr>`;
    return;
  }

  expenses.forEach(expense => {
    const status = normalizeStatus(expense.status || "unreviewed");
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(formatStatus(expense.category))}</strong>
        <span class="muted-line">${escapeHtml(expense.notes || "")}</span>
      </td>
      <td>${formatCurrency(expense.amount)}</td>
      <td><span class="status-pill ${getExpenseStatusClass(status)}">${escapeHtml(formatStatus(status))}</span></td>
      <td>${formatTimestamp(expense.created_at)}</td>
      <td>${expense.receipt_url ? `<a class="view secondary-action" href="${escapeHtml(expense.receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : "N/A"}</td>
      <td>
        ${status !== "approved" ? `<button class="view" type="button" data-expense-action="approved" data-expense-id="${escapeHtml(expense.id)}">Approve</button>` : ""}
        ${status !== "rejected" ? `<button class="delete" type="button" data-expense-action="rejected" data-expense-id="${escapeHtml(expense.id)}">Reject</button>` : ""}
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-expense-action]").forEach(button => {
    button.addEventListener("click", () => updateExpenseStatus(button.dataset.expenseId, button.dataset.expenseAction));
  });
}

function getExpenseStatusClass(status) {
  if (status === "approved") return "success";
  if (status === "rejected") return "warning";
  return "caution";
}

async function updateExpenseStatus(expenseId, status) {
  const loadId = getLoadId();
  const res = await fetch(`${BASE_URL}/rest/v1/load_expenses?id=eq.${expenseId}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ status })
  });

  if (!res.ok) {
    alert(`Error updating expense: ${await res.text()}`);
    return;
  }

  await loadExpenses(loadId);
  await loadEvents(loadId);
}

function renderDocuments(documents) {
  const tbody = document.getElementById("loadDocumentsTableBody");
  tbody.innerHTML = "";

  if (!documents.length) {
    tbody.innerHTML = `<tr><td colspan="4">No documents attached.</td></tr>`;
    return;
  }

  documents.forEach(documentRow => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatStatus(documentRow.document_type)}</td>
      <td>${formatTimestamp(documentRow.created_at)}</td>
      <td>
        ${escapeHtml(documentRow.file_name || "Document")}
        ${documentRow.notes ? `<span class="muted-line">${escapeHtml(documentRow.notes)}</span>` : ""}
      </td>
      <td>
        <button class="view" type="button" data-open-document="${documentRow.id}">Open</button>
        <button class="delete" data-delete-document="${documentRow.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-open-document]").forEach(btn => {
    btn.addEventListener("click", () => openLoadDocument(btn.dataset.openDocument));
  });

  tbody.querySelectorAll("[data-delete-document]").forEach(btn => {
    btn.addEventListener("click", () => deleteLoadDocument(btn.dataset.deleteDocument));
  });
}

function renderDocumentChecklist(documents = []) {
  const container = document.getElementById("loadDocumentChecklist");
  if (!container) return;

  const types = new Set(documents.map(doc => normalizeDocumentType(doc.document_type)));
  container.innerHTML = requiredLoadDocuments.map(item => {
    const complete = types.has(item.type);
    return `
      <div class="load-document-check ${complete ? "complete" : item.required ? "missing" : "optional"}">
        <span>${complete ? "OK" : item.required ? "!" : "?"}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${complete ? "Attached" : item.required ? "Needed" : "Optional"}</small>
      </div>
    `;
  }).join("");
}

function renderLoadWorkflow() {
  const bar = document.getElementById("loadWorkflowBar");
  const action = document.getElementById("loadNextAction");
  if (!bar || !action || !currentLoad) return;

  const status = normalizeStatus(currentLoad.status);
  const docTypes = new Set(currentLoadDocuments.map(doc => normalizeDocumentType(doc.document_type)));
  const invoiceStatuses = currentLoadInvoices.map(invoice => normalizeStatus(invoice.status || "draft"));
  const hasPod = docTypes.has("pod");
  const hasBol = docTypes.has("bol");
  const hasInvoice = currentLoadInvoices.length > 0 || docTypes.has("invoice");
  const invoiceSent = invoiceStatuses.some(invoiceStatus => ["sent", "paid", "overdue"].includes(invoiceStatus));
  const paid = invoiceStatuses.some(invoiceStatus => invoiceStatus === "paid") || status === "paid";
  const closed = status === "closed";

  const steps = [
    { key: "booked", label: "Booked", ok: isAtOrPastLoadStep(status, "booked") },
    { key: "dispatched", label: "Dispatched", ok: isAtOrPastLoadStep(status, "dispatched") },
    { key: "picked_up", label: "Picked Up", ok: isAtOrPastLoadStep(status, "picked_up") },
    { key: "in_transit", label: "In Transit", ok: isAtOrPastLoadStep(status, "in_transit") },
    { key: "delivered", label: "Delivered", ok: isAtOrPastLoadStep(status, "delivered") },
    { key: "pod_received", label: "POD", ok: hasPod || isAtOrPastLoadStep(status, "pod_received") },
    { key: "invoiced", label: "Invoiced", ok: hasInvoice || isAtOrPastLoadStep(status, "invoiced") },
    { key: "closed", label: "Closed", ok: closed }
  ];

  bar.innerHTML = steps.map(step => `
    <div class="load-workflow-step ${step.ok ? "complete" : step.key === status ? "active" : ""}">
      <span>${step.ok ? "OK" : ""}</span>
      <strong>${escapeHtml(step.label)}</strong>
    </div>
  `).join("");

  const nextAction = getNextLoadAction({ status, hasPod, hasBol, hasInvoice, invoiceSent, paid, closed });
  action.innerHTML = `
    <div>
      <span>Next Best Action</span>
      <strong>${escapeHtml(nextAction.title)}</strong>
      <p>${escapeHtml(nextAction.detail)}</p>
    </div>
    <div class="load-next-action-buttons">
      ${nextAction.links.map(link => `<a class="view ${link.secondary ? "secondary-action" : ""}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}
    </div>
  `;
}

function isAtOrPastLoadStep(status, step) {
  const order = ["booked", "dispatched", "picked_up", "in_transit", "delivered", "pod_received", "invoiced", "paid", "closed"];
  const normalizedStatus = status === "loaded" ? "picked_up" : status;
  const currentIndex = order.indexOf(normalizedStatus);
  const stepIndex = order.indexOf(step);
  if (currentIndex === -1 || stepIndex === -1) return step === "booked";
  return currentIndex >= stepIndex;
}

function getNextLoadAction(state) {
  const loadId = currentLoad.id;
  if (!isAtOrPastLoadStep(state.status, "dispatched")) {
    return {
      title: "Dispatch the load",
      detail: "Open the dispatch packet, assign the driver or carrier, then move the load into active dispatch.",
      links: [
        { label: "Dispatch Packet", href: `dispatch-packet.html?id=${loadId}` },
        { label: "Assign Vehicle", href: "assign-vehicle.html", secondary: true }
      ]
    };
  }

  if (!isAtOrPastLoadStep(state.status, "delivered")) {
    return {
      title: "Track movement",
      detail: "Keep status updates current so dispatch, customer tracking, and billing stay aligned.",
      links: [
        { label: "Dispatch Packet", href: `dispatch-packet.html?id=${loadId}` },
        { label: "Customer Tracking", href: buildTrackingUrl(currentLoad), secondary: true }
      ]
    };
  }

  if (!state.hasPod) {
    return {
      title: "Collect POD",
      detail: "Delivery is complete or close to complete. Upload the POD before billing or closeout.",
      links: [
        { label: "Upload POD", href: "#loadDocumentForm" },
        { label: "Dispatch Packet", href: `dispatch-packet.html?id=${loadId}`, secondary: true }
      ]
    };
  }

  if (!state.hasBol) {
    return {
      title: "Attach BOL if required",
      detail: "POD is present. Add the BOL or continue to invoice if the BOL is not required for this load.",
      links: [
        { label: "Upload BOL", href: "#loadDocumentForm" },
        { label: "Create Invoice", href: "#invoiceForm", secondary: true }
      ]
    };
  }

  if (!state.hasInvoice) {
    return {
      title: "Create invoice",
      detail: "Paperwork is ready. Create the invoice so receivables do not sit idle.",
      links: [
        { label: "Create Invoice", href: "#invoiceForm" },
        { label: "Documents", href: "#loadDocumentsTableBody", secondary: true }
      ]
    };
  }

  if (!state.invoiceSent) {
    return {
      title: "Send invoice",
      detail: "Invoice exists but has not been marked sent. Send it or update the invoice status.",
      links: [
        { label: "Review Invoices", href: "#loadInvoicesTableBody" },
        { label: "Load Closeout", href: "#loadCloseoutChecklist", secondary: true }
      ]
    };
  }

  if (!state.paid) {
    return {
      title: "Watch payment",
      detail: "Invoice is out. Monitor payment and mark paid once received.",
      links: [
        { label: "Review Invoices", href: "#loadInvoicesTableBody" },
        { label: "Closeout", href: "#loadCloseoutChecklist", secondary: true }
      ]
    };
  }

  if (!state.closed) {
    return {
      title: "Close the load",
      detail: "Payment and required paperwork are complete. Mark this load closed.",
      links: [
        { label: "Closeout", href: "#loadCloseoutChecklist" }
      ]
    };
  }

  return {
    title: "Load complete",
    detail: "This load is closed. Keep records available for reporting, billing, and customer history.",
    links: [
      { label: "All Loads", href: "loads.html" }
    ]
  };
}

function normalizeDocumentType(value) {
  const type = String(value || "").toLowerCase();
  if (["proof_of_delivery", "delivery_receipt"].includes(type)) return "pod";
  if (["bill_of_lading"].includes(type)) return "bol";
  if (["rate_con", "ratecon"].includes(type)) return "rate_confirmation";
  if (["lumper", "lumper_receipts"].includes(type)) return "lumper_receipt";
  if (["accessorial", "accessorial_receipts"].includes(type)) return "accessorial_receipt";
  if (["scale", "scale_tickets"].includes(type)) return "scale_ticket";
  return type;
}

function renderCloseoutChecklist() {
  const container = document.getElementById("loadCloseoutChecklist");
  const closeButton = document.getElementById("markLoadClosedButton");
  if (!container || !currentLoad) return;

  const docTypes = new Set(currentLoadDocuments.map(doc => normalizeDocumentType(doc.document_type)));
  const invoiceStatuses = currentLoadInvoices.map(invoice => normalizeStatus(invoice.status || "draft"));
  const delivered = ["delivered", "pod_received", "invoiced", "paid", "closed"].includes(normalizeStatus(currentLoad.status));
  const hasPod = docTypes.has("pod");
  const hasBol = docTypes.has("bol");
  const hasInvoice = currentLoadInvoices.length > 0 || docTypes.has("invoice");
  const invoiceSent = invoiceStatuses.some(status => ["sent", "paid", "overdue"].includes(status));
  const paid = invoiceStatuses.some(status => status === "paid") || normalizeStatus(currentLoad.status) === "paid";
  const closed = normalizeStatus(currentLoad.status) === "closed";

  const steps = [
    { label: "Delivered", ok: delivered, detail: delivered ? "Load marked delivered or beyond." : "Mark delivered from timeline when complete." },
    { label: "POD Attached", ok: hasPod, detail: hasPod ? "Proof of delivery attached." : "Upload POD before billing closeout." },
    { label: "BOL Attached", ok: hasBol, detail: hasBol ? "BOL attached." : "Attach BOL when required." },
    { label: "Invoice Created", ok: hasInvoice, detail: hasInvoice ? "Invoice record or document exists." : "Create invoice for this load." },
    { label: "Invoice Sent", ok: invoiceSent, detail: invoiceSent ? "Invoice is sent/paid/overdue." : "Send invoice or update invoice status." },
    { label: "Payment Complete", ok: paid, detail: paid ? "Payment marked complete." : "Mark invoice paid when received." },
    { label: "Closed", ok: closed, detail: closed ? "Load is closed." : "Close when all required steps are complete." }
  ];

  container.innerHTML = steps.map(step => `
    <div class="load-closeout-step ${step.ok ? "complete" : "open"}">
      <span>${step.ok ? "OK" : "!"}</span>
      <strong>${escapeHtml(step.label)}</strong>
      <small>${escapeHtml(step.detail)}</small>
    </div>
  `).join("");

  if (closeButton) {
    const canClose = delivered && hasPod && hasInvoice;
    closeButton.disabled = closed || !canClose;
    closeButton.textContent = closed ? "Closed" : "Mark Closed";
    closeButton.title = canClose ? "Close this load" : "Requires Delivered, POD Attached, and Invoice Created";
  }
  renderLoadWorkflow();
}

async function loadEvents(loadId) {
  const tbody = document.getElementById("loadEventsTableBody");
  tbody.innerHTML = `<tr><td colspan="4">Loading timeline...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("load_events", `load_id=eq.${loadId}&select=*&order=event_time.desc`) || `${BASE_URL}/rest/v1/load_events?load_id=eq.${loadId}&select=*&order=event_time.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const events = await res.json();
    renderEvents(events);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4">Error loading timeline.</td></tr>`;
  }
}

function renderEvents(events) {
  const tbody = document.getElementById("loadEventsTableBody");
  tbody.innerHTML = "";

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="4">No updates yet.</td></tr>`;
    return;
  }

  events.forEach(event => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatStatus(event.event_type)}</td>
      <td>${formatTimestamp(event.event_time || event.created_at)}</td>
      <td>${event.location || "N/A"}</td>
      <td>${event.notes || ""}</td>
    `;
    tbody.appendChild(row);
  });
}

async function getLoadAssignment(loadId) {
  const res = await fetch(
    window.CompanyContext?.scopedUrl("assignments", `load_id=eq.${loadId}&status=eq.active&select=truck_id`) || `${BASE_URL}/rest/v1/assignments?load_id=eq.${loadId}&status=eq.active&select=truck_id`,
    { headers: getHeaders() }
  );

  if (!res.ok) return null;

  const [assignment] = await res.json();
  return assignment || null;
}

async function getDriverName(id) {
  if (!id) return "Unassigned";
  const res = await fetch(`${BASE_URL}/rest/v1/drivers?id=eq.${id}&select=first_name,last_name`, { headers: getHeaders() });
  if (!res.ok) return `Driver ${id}`;
  const [driver] = await res.json();
  return driver ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim() : `Driver ${id}`;
}

async function getTruckName(id) {
  if (!id) return "Unassigned";
  const res = await fetch(`${BASE_URL}/rest/v1/trucks?id=eq.${id}&select=truck_number,vin`, { headers: getHeaders() });
  if (!res.ok) return `Truck ${id}`;
  const [truck] = await res.json();
  return truck ? truck.truck_number || truck.vin || `Truck ${id}` : `Truck ${id}`;
}

function formatDateTime(date, time) {
  if (!date && !time) return "N/A";
  return `${date || ""}${time ? ` ${time}` : ""}`.trim();
}

function formatStatus(value) {
  return (value || "unknown").replaceAll("_", " ");
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "$0";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function getLocalDateTimeValue() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

async function saveLoadEvent(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("loadEventMessage");
  const form = e.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  const eventType = formData.event_type;

  msg.textContent = "Saving update...";
  msg.style.color = "";

  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    event_type: eventType,
    event_time: formData.event_time ? new Date(formData.event_time).toISOString() : new Date().toISOString(),
    location: formData.location || null,
    notes: formData.notes || null
  }) || {
    load_id: Number(loadId),
    event_type: eventType,
    event_time: formData.event_time ? new Date(formData.event_time).toISOString() : new Date().toISOString(),
    location: formData.location || null,
    notes: formData.notes || null
  };

  try {
    const eventRes = await fetch(`${BASE_URL}/rest/v1/load_events`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(eventData)
    });

    const eventResult = await eventRes.json();
    if (!eventRes.ok) throw new Error(JSON.stringify(eventResult));

    const nextStatus = statusByEvent[eventType];
    if (nextStatus) {
      await updateLoadStatus(loadId, nextStatus);
      document.getElementById("loadStatus").textContent = formatStatus(nextStatus);
    }

    msg.textContent = "Update saved.";
    msg.style.color = "#047857";
    form.reset();
    document.getElementById("eventTime").value = getLocalDateTimeValue();
    await loadEvents(loadId);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving update: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function saveCommunication(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("communicationMessage");
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.next_follow_up_at) data.next_follow_up_at = new Date(data.next_follow_up_at).toISOString();

  const payload = window.CompanyContext?.withCompanyId({
    ...data,
    load_id: Number(loadId),
    created_by: window.CompanyContext?.getUserId?.() || null
  }) || {
    ...data,
    load_id: Number(loadId)
  };

  msg.textContent = "Saving communication...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/load_communications`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    await recordCommunicationEvent(result[0] || payload);
    msg.textContent = "Communication saved.";
    msg.style.color = "#047857";
    form.reset();
    await loadCommunications(loadId);
    await loadEvents(loadId);
  } catch (err) {
    console.error(err);
    msg.textContent = err.message.includes("load_communications")
      ? "Run load-communications.sql in Supabase first, then try again."
      : `Error saving communication: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function completeCommunication(id) {
  const loadId = getLoadId();
  const res = await fetch(`${BASE_URL}/rest/v1/load_communications?id=eq.${id}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify({ status: "completed", next_follow_up_at: null })
  });

  if (!res.ok) {
    alert(`Error completing communication: ${await res.text()}`);
    return;
  }

  await loadCommunications(loadId);
}

async function deleteCommunication(id) {
  if (!confirm("Delete this communication record?")) return;
  const loadId = getLoadId();
  const res = await fetch(`${BASE_URL}/rest/v1/load_communications?id=eq.${id}`, {
    method: "DELETE",
    headers: getHeaders()
  });

  if (!res.ok) {
    alert(`Error deleting communication: ${await res.text()}`);
    return;
  }

  await loadCommunications(loadId);
}

async function recordCommunicationEvent(rowData) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(rowData.load_id || getLoadId()),
    event_type: "communication",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${formatStatus(rowData.contact_type)} ${formatStatus(rowData.channel)}: ${rowData.subject || rowData.summary || "Communication logged."}`
  }) || {
    load_id: Number(rowData.load_id || getLoadId()),
    event_type: "communication",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${formatStatus(rowData.contact_type)} ${formatStatus(rowData.channel)}: ${rowData.subject || rowData.summary || "Communication logged."}`
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) console.warn("Unable to record communication event:", await res.text());
}

async function saveIssue(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("issueMessage");
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.claim_amount) data.claim_amount = Number(data.claim_amount);
  if (data.due_at) data.due_at = new Date(data.due_at).toISOString();
  if (["resolved", "closed"].includes(data.status)) data.resolved_at = new Date().toISOString();

  const payload = window.CompanyContext?.withCompanyId({
    ...data,
    load_id: Number(loadId),
    created_by: window.CompanyContext?.getUserId?.() || null
  }) || {
    ...data,
    load_id: Number(loadId)
  };

  msg.textContent = "Saving issue...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/load_issues`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    await recordIssueEvent(result[0] || payload, "Issue opened");
    msg.textContent = "Issue saved.";
    msg.style.color = "#047857";
    form.reset();
    await loadIssues(loadId);
    await loadEvents(loadId);
  } catch (err) {
    console.error(err);
    msg.textContent = err.message.includes("load_issues")
      ? "Run load-issues.sql in Supabase first, then try again."
      : `Error saving issue: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function resolveIssue(id) {
  const resolution = prompt("Resolution note:", "Resolved and documented.");
  if (resolution === null) return;

  const loadId = getLoadId();
  const payload = {
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolution: resolution || "Resolved."
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_issues?id=eq.${id}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(payload)
  });
  const result = await res.json();

  if (!res.ok) {
    alert(`Error resolving issue: ${JSON.stringify(result)}`);
    return;
  }

  await recordIssueEvent(result[0] || { load_id: loadId, title: "Issue", ...payload }, "Issue resolved");
  await loadIssues(loadId);
  await loadEvents(loadId);
}

async function deleteIssue(id) {
  if (!confirm("Delete this issue or claim record?")) return;
  const loadId = getLoadId();
  const res = await fetch(`${BASE_URL}/rest/v1/load_issues?id=eq.${id}`, {
    method: "DELETE",
    headers: getHeaders()
  });

  if (!res.ok) {
    alert(`Error deleting issue: ${await res.text()}`);
    return;
  }

  await loadIssues(loadId);
}

async function recordIssueEvent(issue, eventLabel) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(issue.load_id || getLoadId()),
    event_type: "issue",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${eventLabel}: ${issue.title || "Issue"} (${formatStatus(issue.severity || "medium")}, ${formatStatus(issue.status || "open")}).`
  }) || {
    load_id: Number(issue.load_id || getLoadId()),
    event_type: "issue",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${eventLabel}: ${issue.title || "Issue"} (${formatStatus(issue.severity || "medium")}, ${formatStatus(issue.status || "open")}).`
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) console.warn("Unable to record issue event:", await res.text());
}

async function updateLoadStatus(loadId, status) {
  const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${loadId}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ status })
  });

  if (!res.ok) throw new Error(await res.text());
}

async function closeLoad() {
  const loadId = getLoadId();
  const msg = document.getElementById("loadCloseoutMessage");
  const button = document.getElementById("markLoadClosedButton");
  if (!loadId || !currentLoad) return;

  try {
    if (button) button.disabled = true;
    if (msg) {
      msg.textContent = "Closing load...";
      msg.style.color = "";
    }

    await updateLoadStatus(loadId, "closed");
    currentLoad.status = "closed";
    document.getElementById("loadStatus").textContent = formatStatus("closed");
    await recordCloseoutEvent(loadId);
    await loadEvents(loadId);
    renderCloseoutChecklist();

    if (msg) {
      msg.textContent = "Load closed.";
      msg.style.color = "#047857";
    }
  } catch (err) {
    console.error(err);
    if (msg) {
      msg.textContent = `Error closing load: ${err.message}`;
      msg.style.color = "#ef4444";
    }
    renderCloseoutChecklist();
  }
}

async function recordCloseoutEvent(loadId) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    event_type: "closed",
    event_time: new Date().toISOString(),
    location: currentLoad?.delivery_location || currentLoad?.dropoff_location || null,
    notes: "Load closed after document and invoice review."
  }) || {
    load_id: Number(loadId),
    event_type: "closed",
    event_time: new Date().toISOString(),
    location: currentLoad?.delivery_location || currentLoad?.dropoff_location || null,
    notes: "Load closed after document and invoice review."
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) console.warn("Unable to record closeout event:", await res.text());
}

async function saveLoadDocument(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("loadDocumentMessage");
  const form = e.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  const file = document.getElementById("documentFile").files[0];

  msg.textContent = file ? "Uploading document..." : "Saving document...";
  msg.style.color = "";

  if (!file) {
    msg.textContent = "Upload a file before saving the document.";
    msg.style.color = "#ef4444";
    return;
  }

  try {
    const filePath = await uploadLoadDocumentFile(loadId, formData.document_type, file);
    const documentData = window.CompanyContext?.withCompanyId({
      entity_type: "load",
      entity_id: String(loadId),
      document_type: formData.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: formData.notes || null
    }) || {
      entity_type: "load",
      entity_id: String(loadId),
      document_type: formData.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: formData.notes || null
    };

    msg.textContent = "Saving document record...";

    const res = await fetch(`${BASE_URL}/rest/v1/documents`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(documentData)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    msg.textContent = "Document saved.";
    msg.style.color = "#047857";
    form.reset();
    await loadDocuments(loadId);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving document: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function uploadLoadDocumentFile(loadId, documentType, file) {
  const path = buildStoragePath(loadId, documentType, file.name);
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${path}`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    }),
    body: file
  });

  if (!res.ok) {
    const errorText = await res.text();
    if (errorText.includes("Bucket not found") || errorText.includes("not found")) {
      throw new Error("Storage bucket is not ready. Run the document storage SQL first, then try again.");
    }
    throw new Error(errorText);
  }

  return path;
}

function buildStoragePath(loadId, documentType, fileName) {
  const companyId = window.CompanyContext?.getCompanyId() || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeType = sanitizePathPart(documentType || "document");
  const safeName = sanitizeFileName(fileName || "document");
  return `${companyId}/load/${loadId}/${safeType}/${timestamp}-${safeName}`;
}

function sanitizePathPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function sanitizeFileName(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "document";
}

function bindLoadDocumentDropzone() {
  const dropzone = document.getElementById("loadDocumentDropzone");
  const fileInput = document.getElementById("documentFile");
  if (!dropzone || !fileInput || dropzone.dataset.bound === "true") return;
  dropzone.dataset.bound = "true";

  ["dragenter", "dragover"].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });

  dropzone.addEventListener("drop", event => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    updateDropzoneFileName(file.name);
  });

  fileInput.addEventListener("change", () => {
    updateDropzoneFileName(fileInput.files?.[0]?.name);
  });
}

function updateDropzoneFileName(fileName) {
  const dropzone = document.getElementById("loadDocumentDropzone");
  const label = dropzone?.querySelector("span");
  if (label && fileName) label.textContent = fileName;
}

async function deleteLoadDocument(documentId) {
  if (!confirm("Delete this document?")) return;

  const loadId = getLoadId();

  try {
    const documentRow = await getDocumentById(documentId);
    if (documentRow?.file_path && !documentRow.file_path.startsWith("http")) {
      await deleteStorageObject(documentRow.file_path);
    }

    const res = await fetch(`${BASE_URL}/rest/v1/documents?id=eq.${documentId}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadDocuments(loadId);
  } catch (err) {
    console.error(err);
    alert(`Error deleting document: ${err.message}`);
  }
}

async function openLoadDocument(documentId) {
  try {
    const documentRow = await getDocumentById(documentId);
    if (!documentRow?.file_path) throw new Error("Document file path is missing.");

    if (documentRow.file_path.startsWith("http")) {
      window.open(documentRow.file_path, "_blank");
      return;
    }

    const res = await fetch(`${BASE_URL}/storage/v1/object/sign/${DOCUMENT_BUCKET}/${documentRow.file_path}`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 300 })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));
    window.open(`${BASE_URL}/storage/v1${result.signedURL}`, "_blank");
  } catch (err) {
    console.error(err);
    alert(`Error opening document: ${err.message}`);
  }
}

async function getDocumentById(documentId) {
  const res = await fetch(`${BASE_URL}/rest/v1/documents?id=eq.${documentId}&select=*&limit=1`, {
    headers: getHeaders()
  });

  if (!res.ok) throw new Error(await res.text());
  const [documentRow] = await res.json();
  return documentRow || null;
}

async function deleteStorageObject(filePath) {
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}`, {
    method: "DELETE",
    headers: getHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [filePath] })
  });

  if (!res.ok) throw new Error(await res.text());
}

async function createInvoice(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("invoiceMessage");
  const data = Object.fromEntries(new FormData(e.target).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.linehaul_amount) data.linehaul_amount = Number(data.linehaul_amount);
  if (data.accessorial_amount) data.accessorial_amount = Number(data.accessorial_amount);

  const invoiceData = window.CompanyContext?.withCompanyId({
    ...data,
    load_id: Number(loadId),
    customer_name: currentLoad?.customer_name || currentLoad?.customer || null
  }) || {
    ...data,
    load_id: Number(loadId),
    customer_name: currentLoad?.customer_name || currentLoad?.customer || null
  };

  msg.textContent = "Creating invoice...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(invoiceData)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    await updateLoadStatus(loadId, "invoiced");
    if (currentLoad) currentLoad.status = "invoiced";
    document.getElementById("loadStatus").textContent = formatStatus("invoiced");
    msg.textContent = "Invoice created.";
    msg.style.color = "#047857";
    await loadInvoices(loadId);
    renderCloseoutChecklist();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error creating invoice: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function saveTripCostInputs(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("tripCostMessage");
  const form = e.target;

  if (!loadId || !currentLoad) return;

  const payload = {};
  [
    "carrier_rate",
    "loaded_miles",
    "empty_miles",
    "fuel_cost",
    "toll_cost",
    "lumper_cost",
    "detention_paid",
    "other_costs"
  ].forEach(field => {
    const value = form.elements[field]?.value;
    payload[field] = value === "" ? null : Number(value);
  });

  msg.textContent = "Saving...";
  msg.style.color = "";

  try {
    const query = `id=eq.${loadId}`;
    const res = await fetch(
      window.CompanyContext?.scopedUrl("loads", query) || `${BASE_URL}/rest/v1/loads?${query}`,
      {
        method: "PATCH",
        headers: getHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation"
        }),
        body: JSON.stringify(payload)
      }
    );

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    currentLoad = { ...currentLoad, ...(result[0] || payload) };
    populateTripCostForm(currentLoad);
    populateRoutePlannerForm(currentLoad);
    renderRouteSummary(currentLoad);
    renderProfitSummary(currentLoad);
    msg.textContent = "Saved.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving costs: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function calculateRouteEstimate() {
  const form = document.getElementById("routePlannerForm");
  const msg = document.getElementById("routePlannerMessage");
  if (!form) return;

  const loadedMiles = toNumber(form.elements.loaded_miles?.value);
  const emptyMiles = toNumber(form.elements.empty_miles?.value);
  const mpg = toNumber(form.elements.fuel_mpg?.value) || 6.5;
  const fuelPrice = toNumber(form.elements.fuel_price?.value) || 3.85;
  const totalMiles = loadedMiles + emptyMiles;
  const fuelEstimate = totalMiles && mpg ? (totalMiles / mpg) * fuelPrice : 0;
  const driveHours = totalMiles ? totalMiles / 55 : 0;

  const tripCostForm = document.getElementById("tripCostForm");
  if (tripCostForm) {
    if (tripCostForm.elements.loaded_miles) tripCostForm.elements.loaded_miles.value = loadedMiles || "";
    if (tripCostForm.elements.empty_miles) tripCostForm.elements.empty_miles.value = emptyMiles || "";
    if (tripCostForm.elements.fuel_cost) tripCostForm.elements.fuel_cost.value = fuelEstimate ? fuelEstimate.toFixed(2) : "";
    if (tripCostForm.elements.toll_cost && form.elements.toll_cost) tripCostForm.elements.toll_cost.value = form.elements.toll_cost.value;
  }

  if (form.elements.drive_hours) form.elements.drive_hours.value = driveHours ? driveHours.toFixed(1) : "";
  if (msg) {
    msg.textContent = fuelEstimate ? `Estimated fuel: ${formatCurrency(fuelEstimate)}` : "Add miles to estimate fuel.";
    msg.style.color = fuelEstimate ? "#047857" : "#ef4444";
  }
}

async function saveRoutePlanner(e) {
  e.preventDefault();

  const loadId = getLoadId();
  const msg = document.getElementById("routePlannerMessage");
  const form = e.target;
  if (!loadId || !currentLoad) return;

  const loadedMiles = toNumber(form.elements.loaded_miles?.value);
  const emptyMiles = toNumber(form.elements.empty_miles?.value);
  const mpg = toNumber(form.elements.fuel_mpg?.value) || 6.5;
  const fuelPrice = toNumber(form.elements.fuel_price?.value) || 3.85;
  const totalMiles = loadedMiles + emptyMiles;
  const fuelEstimate = totalMiles && mpg ? (totalMiles / mpg) * fuelPrice : 0;
  const tollCost = form.elements.toll_cost?.value === "" ? null : Number(form.elements.toll_cost?.value);

  const payload = {
    loaded_miles: form.elements.loaded_miles?.value === "" ? null : loadedMiles,
    empty_miles: form.elements.empty_miles?.value === "" ? null : emptyMiles,
    fuel_cost: fuelEstimate ? Number(fuelEstimate.toFixed(2)) : null,
    toll_cost: tollCost
  };

  msg.textContent = "Saving route...";
  msg.style.color = "";

  try {
    const query = `id=eq.${loadId}`;
    const res = await fetch(
      window.CompanyContext?.scopedUrl("loads", query) || `${BASE_URL}/rest/v1/loads?${query}`,
      {
        method: "PATCH",
        headers: getHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation"
        }),
        body: JSON.stringify(payload)
      }
    );

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    currentLoad = { ...currentLoad, ...(result[0] || payload) };
    populateTripCostForm(currentLoad);
    populateRoutePlannerForm(currentLoad);
    renderRouteSummary(currentLoad);
    renderProfitSummary(currentLoad);
    msg.textContent = "Route saved.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving route: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

document.getElementById("loadEventForm").addEventListener("submit", saveLoadEvent);
document.getElementById("communicationForm").addEventListener("submit", saveCommunication);
document.getElementById("issueForm").addEventListener("submit", saveIssue);
document.getElementById("loadDocumentForm").addEventListener("submit", saveLoadDocument);
document.getElementById("invoiceForm").addEventListener("submit", createInvoice);
document.getElementById("tripCostForm")?.addEventListener("submit", saveTripCostInputs);
document.getElementById("routePlannerForm")?.addEventListener("submit", saveRoutePlanner);
document.getElementById("calculateRouteEstimateButton")?.addEventListener("click", calculateRouteEstimate);
document.getElementById("markLoadClosedButton")?.addEventListener("click", closeLoad);
document.getElementById("eventTime").value = getLocalDateTimeValue();
bindLoadDocumentDropzone();
loadDetails();
