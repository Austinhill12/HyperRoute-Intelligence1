const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const statusColumns = [
  { key: "available", label: "Available" },
  { key: "assigned", label: "Assigned" },
  { key: "picked_up", label: "Picked Up" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" }
];

const activeStatuses = new Set(statusColumns.map(column => column.key));
let dispatchLoads = [];
let driverMap = new Map();
let truckMap = new Map();
let assignmentMap = new Map();
let invoiceMap = new Map();

const lifecycleEventByStatus = {
  available: "available",
  assigned: "assigned",
  picked_up: "loaded",
  in_transit: "in_transit",
  delivered: "delivered",
  invoiced: "invoiced",
  paid: "paid"
};

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function loadDispatchBoard() {
  const msg = document.getElementById("dispatchMessage");
  msg.textContent = "Loading dispatch board...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const [loads, drivers, trucks, assignments, invoices] = await Promise.all([
      fetchRows("loads", "select=*&order=pickup_date.asc"),
      fetchRows("drivers", "select=id,first_name,last_name"),
      fetchRows("trucks", "select=id,truck_number,vin"),
      fetchRows("assignments", "select=id,load_id,driver_id,truck_id,status&status=eq.active"),
      fetchRows("invoices", "select=id,load_id,status,total_amount")
    ]);

    dispatchLoads = loads;
    driverMap = new Map(drivers.map(driver => [
      driver.id,
      `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${driver.id}`
    ]));
    truckMap = new Map(trucks.map(truck => [
      truck.id,
      truck.truck_number || truck.vin || `Truck ${truck.id}`
    ]));
    assignmentMap = buildAssignmentMap(assignments);
    invoiceMap = buildInvoiceMap(invoices);

    msg.textContent = "";
    renderFilterOptions();
    renderDispatchBoard();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading dispatch board: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function fetchRows(table, query) {
  const url = window.CompanyContext?.scopedUrl(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function buildAssignmentMap(assignments) {
  const map = new Map();
  assignments.forEach(assignment => {
    if (assignment.load_id && !map.has(assignment.load_id)) {
      map.set(assignment.load_id, assignment);
    }
  });
  return map;
}

function buildInvoiceMap(invoices) {
  const map = new Map();
  invoices.forEach(invoice => {
    if (!invoice.load_id) return;
    if (!map.has(invoice.load_id)) map.set(invoice.load_id, []);
    map.get(invoice.load_id).push(invoice);
  });
  return map;
}

function renderDispatchBoard() {
  const board = document.getElementById("dispatchBoard");
  const filteredLoads = getFilteredLoads();
  const grouped = groupLoads(filteredLoads);

  updateKpis(filteredLoads);
  board.innerHTML = "";

  statusColumns.forEach(column => {
    const section = document.createElement("section");
    section.className = "dispatch-column";
    const loads = grouped.get(column.key) || [];

    section.innerHTML = `
      <div class="dispatch-column-header">
        <h2>${column.label}</h2>
        <span>${loads.length}</span>
      </div>
      <div class="dispatch-card-list"></div>
    `;

    const list = section.querySelector(".dispatch-card-list");
    if (!loads.length) {
      list.innerHTML = `<p class="empty-state">No loads</p>`;
    } else {
      loads.forEach(load => list.appendChild(createLoadCard(load)));
    }

    board.appendChild(section);
  });

  board.querySelectorAll("[data-status-load]").forEach(select => {
    select.addEventListener("change", () => updateLoadStatus(select.dataset.statusLoad, select.value));
  });
  board.querySelectorAll("[data-save-assignment]").forEach(button => {
    button.addEventListener("click", () => saveQuickAssignment(button.dataset.saveAssignment, button));
  });
}

function renderFilterOptions() {
  const driverFilter = document.getElementById("driverFilter");
  const truckFilter = document.getElementById("truckFilter");
  if (driverFilter) driverFilter.innerHTML = buildSelectOptions(driverMap, "", "All Drivers");
  if (truckFilter) truckFilter.innerHTML = buildSelectOptions(truckMap, "", "All Trucks");
}

function buildSelectOptions(map, selectedValue, placeholder) {
  const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
  map.forEach((label, id) => {
    options.push(`<option value="${escapeHtml(id)}" ${String(id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(label)}</option>`);
  });
  return options.join("");
}

function getFilteredLoads() {
  const status = document.getElementById("statusFilter").value;
  const pickupDate = document.getElementById("dateFilter").value;
  const driverFilter = document.getElementById("driverFilter")?.value || "";
  const truckFilter = document.getElementById("truckFilter")?.value || "";
  const search = document.getElementById("searchFilter").value.trim().toLowerCase();

  return dispatchLoads.filter(load => {
    const normalizedStatus = normalizeStatus(load.status);
    const assignment = assignmentMap.get(load.id);
    const driverId = load.driver_id || assignment?.driver_id || "";
    const truckId = load.vehicle_id || assignment?.truck_id || "";
    if (!activeStatuses.has(normalizedStatus)) return false;
    if (status && normalizedStatus !== status) return false;
    if (pickupDate && load.pickup_date !== pickupDate) return false;
    if (driverFilter && String(driverId) !== String(driverFilter)) return false;
    if (truckFilter && String(truckId) !== String(truckFilter)) return false;
    if (search && !getSearchText(load).includes(search)) return false;
    return true;
  });
}

function getSearchText(load) {
  const assignment = assignmentMap.get(load.id);
  const driverName = driverMap.get(load.driver_id || assignment?.driver_id) || "";
  const truckName = truckMap.get(load.vehicle_id || assignment?.truck_id) || "";

  return [
    load.load_number,
    load.customer_name,
    load.customer,
    load.pickup_location,
    load.delivery_location,
    load.dropoff_location,
    driverName,
    truckName,
    load.status
  ].join(" ").toLowerCase();
}

function groupLoads(loads) {
  const grouped = new Map(statusColumns.map(column => [column.key, []]));
  loads.forEach(load => {
    const status = normalizeStatus(load.status);
    if (!grouped.has(status)) grouped.set(status, []);
    grouped.get(status).push(load);
  });
  return grouped;
}

function createLoadCard(load) {
  const card = document.createElement("article");
  card.className = `dispatch-load-card ${isLateLoad(load) ? "at-risk" : ""}`;

  const assignment = assignmentMap.get(load.id);
  const driverName = driverMap.get(load.driver_id || assignment?.driver_id) || "Unassigned";
  const truckName = truckMap.get(load.vehicle_id || assignment?.truck_id) || "Unassigned";
  const invoices = invoiceMap.get(load.id) || [];
  const invoiceLabel = getInvoiceLabel(invoices);
  const pickup = formatDateTime(load.pickup_date, load.pickup_time);
  const delivery = formatDateTime(load.delivery_date || load.dropoff_date, load.delivery_time);
  const status = normalizeStatus(load.status);
  const selectedDriverId = load.driver_id || assignment?.driver_id || "";
  const selectedTruckId = load.vehicle_id || assignment?.truck_id || "";

  card.innerHTML = `
    <div class="dispatch-load-top">
      <div>
        <h3>${escapeHtml(load.load_number || `Load ${load.id}`)}</h3>
        <p>${escapeHtml(load.customer_name || load.customer || "No customer")}</p>
      </div>
      <span class="status-pill">${formatStatus(status)}</span>
    </div>

    <div class="dispatch-lane">${escapeHtml(load.pickup_location || "-")} <span>to</span> ${escapeHtml(load.delivery_location || load.dropoff_location || "-")}</div>

    <dl class="dispatch-meta">
      <div><dt>Pickup</dt><dd>${pickup}</dd></div>
      <div><dt>Delivery</dt><dd>${delivery}</dd></div>
      <div><dt>Driver</dt><dd>${escapeHtml(driverName)}</dd></div>
      <div><dt>Truck</dt><dd>${escapeHtml(truckName)}</dd></div>
      <div><dt>Rate</dt><dd>${formatCurrency(load.rate)}</dd></div>
      <div><dt>Invoice</dt><dd>${invoiceLabel}</dd></div>
    </dl>

    <label class="dispatch-status-control">
      Status
      <select data-status-load="${load.id}">
        ${statusColumns.map(column => `<option value="${column.key}" ${column.key === status ? "selected" : ""}>${column.label}</option>`).join("")}
      </select>
    </label>

    <div class="dispatch-quick-assign">
      <label>
        Driver
        <select data-driver-load="${load.id}">
          ${buildSelectOptions(driverMap, selectedDriverId, "Select driver")}
        </select>
      </label>
      <label>
        Truck
        <select data-truck-load="${load.id}">
          ${buildSelectOptions(truckMap, selectedTruckId, "Select truck")}
        </select>
      </label>
      <button class="view secondary-action" type="button" data-save-assignment="${load.id}">Save</button>
    </div>

    <div class="dispatch-actions">
      <a class="view" href="load-details.html?id=${load.id}">Open</a>
      <a class="view" href="edit-load.html?id=${load.id}">Edit</a>
      <a class="view" href="load-details.html?id=${load.id}#invoiceForm">Invoice</a>
    </div>
  `;

  return card;
}

async function updateLoadStatus(loadId, status) {
  const msg = document.getElementById("dispatchMessage");
  msg.textContent = "Updating load status...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${loadId}`, {
      method: "PATCH",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({ status })
    });

    if (!res.ok) throw new Error(await res.text());
    await createLoadLifecycleEvent(loadId, status);

    dispatchLoads = dispatchLoads.map(load => (
      String(load.id) === String(loadId) ? { ...load, status } : load
    ));
    msg.textContent = "Load status updated.";
    msg.style.color = "#047857";
    renderDispatchBoard();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error updating status: ${err.message}`;
    msg.style.color = "#ef4444";
    renderDispatchBoard();
  }
}

async function saveQuickAssignment(loadId, button) {
  const card = button.closest(".dispatch-load-card");
  const driverId = card?.querySelector(`[data-driver-load="${String(loadId)}"]`)?.value || "";
  const truckId = card?.querySelector(`[data-truck-load="${String(loadId)}"]`)?.value || "";
  const msg = document.getElementById("dispatchMessage");

  if (!driverId && !truckId) {
    msg.textContent = "Choose a driver or truck before saving assignment.";
    msg.style.color = "#ef4444";
    return;
  }

  const conflict = findAssignmentConflict(loadId, driverId, truckId);
  if (conflict) {
    msg.textContent = conflict;
    msg.style.color = "#ef4444";
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  msg.textContent = "Saving assignment...";
  msg.style.color = "";

  try {
    await upsertAssignment(loadId, driverId, truckId);
    await patchLoadAssignment(loadId, driverId, truckId);
    await createLoadLifecycleEvent(loadId, "assigned");
    msg.textContent = "Assignment saved.";
    msg.style.color = "#047857";
    await loadDispatchBoard();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving assignment: ${friendlyError(err.message)}`;
    msg.style.color = "#ef4444";
    renderDispatchBoard();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function findAssignmentConflict(loadId, driverId, truckId) {
  for (const assignment of assignmentMap.values()) {
    if (String(assignment.load_id) === String(loadId)) continue;
    const loadLabel = dispatchLoads.find(load => String(load.id) === String(assignment.load_id))?.load_number || `Load ${assignment.load_id}`;
    if (driverId && String(assignment.driver_id) === String(driverId)) {
      return `${driverMap.get(Number(driverId)) || "This driver"} is already assigned to ${loadLabel}.`;
    }
    if (truckId && String(assignment.truck_id) === String(truckId)) {
      return `${truckMap.get(Number(truckId)) || "This truck"} is already assigned to ${loadLabel}.`;
    }
  }
  return "";
}

async function upsertAssignment(loadId, driverId, truckId) {
  const existing = assignmentMap.get(Number(loadId)) || assignmentMap.get(loadId);
  const payload = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    driver_id: driverId ? Number(driverId) : null,
    truck_id: truckId ? Number(truckId) : null,
    status: "active"
  }) || {
    load_id: Number(loadId),
    driver_id: driverId ? Number(driverId) : null,
    truck_id: truckId ? Number(truckId) : null,
    status: "active"
  };

  const url = existing?.id
    ? `${BASE_URL}/rest/v1/assignments?id=eq.${existing.id}`
    : `${BASE_URL}/rest/v1/assignments`;
  const method = existing?.id ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  const assignment = Array.isArray(result) ? result[0] : result;
  assignmentMap.set(Number(loadId), assignment);
  return assignment;
}

async function patchLoadAssignment(loadId, driverId, truckId) {
  const load = dispatchLoads.find(row => String(row.id) === String(loadId));
  const payload = {
    driver_id: driverId ? Number(driverId) : null,
    vehicle_id: truckId ? Number(truckId) : null
  };
  if (normalizeStatus(load?.status) === "available") payload.status = "assigned";

  const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${loadId}`, {
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());
}

async function createLoadLifecycleEvent(loadId, status) {
  const eventType = lifecycleEventByStatus[status];
  if (!eventType) return;

  const load = dispatchLoads.find(row => String(row.id) === String(loadId));
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: null,
    notes: `Status changed to ${formatStatus(status)} from Dispatch Board.`
  }) || {
    load_id: Number(loadId),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: null,
    notes: `Status changed to ${formatStatus(status)} from Dispatch Board.`
  };

  if (load?.pickup_location && ["available", "assigned"].includes(status)) {
    eventData.location = load.pickup_location;
  }

  if (load?.delivery_location && status === "delivered") {
    eventData.location = load.delivery_location;
  }

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) {
    console.warn("Could not create lifecycle event:", await res.text());
  }
}

function updateKpis(loads) {
  const today = getToday();
  const delivered = loads.filter(load => normalizeStatus(load.status) === "delivered").length;
  const pickupToday = loads.filter(load => load.pickup_date === today).length;
  const late = loads.filter(isLateLoad).length;

  document.getElementById("dispatchTotal").textContent = loads.length;
  document.getElementById("dispatchToday").textContent = pickupToday;
  document.getElementById("dispatchLate").textContent = late;
  document.getElementById("dispatchDelivered").textContent = delivered;
}

function isLateLoad(load) {
  const status = normalizeStatus(load.status);
  if (["delivered", "invoiced", "paid"].includes(status)) return false;
  const deliveryDate = load.delivery_date || load.dropoff_date;
  if (!deliveryDate) return false;
  return deliveryDate < getToday();
}

function getInvoiceLabel(invoices) {
  if (!invoices.length) return "Not created";
  const paid = invoices.some(invoice => normalizeStatus(invoice.status) === "paid");
  if (paid) return "Paid";
  return formatStatus(invoices[0].status || "created");
}

function normalizeStatus(value) {
  const status = (value || "available").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (status === "booked") return "available";
  if (status === "dispatched") return "assigned";
  if (status === "pod_received") return "delivered";
  return status;
}

function formatStatus(value) {
  return normalizeStatus(value).replaceAll("_", " ");
}

function formatDateTime(date, time) {
  if (!date && !time) return "N/A";
  return `${date ? formatDate(date) : ""}${time ? ` ${time.slice(0, 5)}` : ""}`.trim();
}

function formatDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "N/A";
}

function getToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
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

function friendlyError(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed.message || parsed.details || value;
  } catch {
    return value;
  }
}

document.getElementById("statusFilter").addEventListener("change", renderDispatchBoard);
document.getElementById("dateFilter").addEventListener("change", renderDispatchBoard);
document.getElementById("driverFilter")?.addEventListener("change", renderDispatchBoard);
document.getElementById("truckFilter")?.addEventListener("change", renderDispatchBoard);
document.getElementById("searchFilter").addEventListener("input", renderDispatchBoard);
document.getElementById("clearFiltersBtn").addEventListener("click", () => {
  document.getElementById("statusFilter").value = "";
  document.getElementById("dateFilter").value = "";
  if (document.getElementById("driverFilter")) document.getElementById("driverFilter").value = "";
  if (document.getElementById("truckFilter")) document.getElementById("truckFilter").value = "";
  document.getElementById("searchFilter").value = "";
  renderDispatchBoard();
});

loadDispatchBoard();
