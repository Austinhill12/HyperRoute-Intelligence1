const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let trucks = [];
let schedules = [];
let records = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initMaintenance() {
  const msg = document.getElementById("maintenanceMessage");
  msg.textContent = "Loading maintenance...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();

    if (!window.CompanyContext?.getCompanyId()) {
      msg.textContent = "No company selected. Select or create a company first.";
      msg.style.color = "#ef4444";
      return;
    }

    document.getElementById("scheduleForm").addEventListener("submit", saveSchedule);
    document.getElementById("scanMaintenanceBtn").addEventListener("click", scanMaintenanceAlerts);
    await loadTrucks();
    await Promise.all([loadSchedules(), loadMaintenanceLogs()]);
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = getMaintenanceError(err.message);
    msg.style.color = "#ef4444";
  }
}

async function loadTrucks() {
  const res = await fetch(
    window.CompanyContext.scopedUrl("trucks", "select=id,truck_number,vin&order=truck_number.asc"),
    { headers: getHeaders() }
  );

  if (!res.ok) throw new Error(await res.text());
  trucks = await res.json();
  fillTruckSelect();
}

function fillTruckSelect() {
  const select = document.getElementById("scheduleTruckSelect");
  select.innerHTML = "";

  if (!trucks.length) {
    select.innerHTML = `<option value="">No trucks available</option>`;
    return;
  }

  trucks.forEach(truck => {
    const option = document.createElement("option");
    option.value = truck.id;
    option.textContent = truck.truck_number || truck.vin || `Truck ${truck.id}`;
    select.appendChild(option);
  });
}

async function loadSchedules() {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = `<tr><td colspan="6">Loading schedules...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext.scopedUrl("maintenance_schedules", "select=*,trucks(*)&order=next_due_date.asc"),
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());
    schedules = await res.json();
    renderSchedules();
    updateKpis();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6">Error loading maintenance schedules. Run the maintenance automation SQL.</td></tr>`;
    schedules = [];
    updateKpis();
  }
}

function renderSchedules() {
  const tbody = document.getElementById("scheduleTableBody");
  tbody.innerHTML = "";

  if (!schedules.length) {
    tbody.innerHTML = `<tr><td colspan="6">No maintenance schedules found.</td></tr>`;
    return;
  }

  schedules.forEach(schedule => {
    const status = getScheduleStatus(schedule);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(schedule.trucks?.truck_number || schedule.truck_id || "N/A")}</td>
      <td>${escapeHtml(schedule.maintenance_type || "N/A")}</td>
      <td>${formatDue(schedule)}</td>
      <td>${formatInterval(schedule)}</td>
      <td>${formatStatusPill(status)}</td>
      <td>
        <a class="view" href="create-maintenance.html?truck_id=${schedule.truck_id}&schedule_id=${schedule.id}">Log Service</a>
        <button class="view" type="button" data-alert-schedule="${schedule.id}">Create Alert</button>
        <button class="delete" type="button" data-delete-schedule="${schedule.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-delete-schedule]").forEach(button => {
    button.addEventListener("click", () => deleteSchedule(button.dataset.deleteSchedule));
  });

  tbody.querySelectorAll("[data-alert-schedule]").forEach(button => {
    button.addEventListener("click", () => createMaintenanceAlert(button.dataset.alertSchedule));
  });
}

async function scanMaintenanceAlerts() {
  const msg = document.getElementById("scheduleMessage");
  msg.textContent = "Scanning maintenance schedules...";
  msg.style.color = "";

  try {
    const created = await createMaintenanceAlertsForSchedules();
    msg.textContent = created
      ? `${created} maintenance alert${created === 1 ? "" : "s"} created.`
      : "No new maintenance alerts needed.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = getMaintenanceError(err.message);
    msg.style.color = "#ef4444";
  }
}

async function loadMaintenanceLogs() {
  const tbody = document.getElementById("maintenanceTableBody");
  tbody.innerHTML = `<tr><td colspan="7">Loading maintenance records...</td></tr>`;

  const res = await fetch(
    window.CompanyContext.scopedUrl("maintenance_logs", "select=*,trucks(*)&order=created_at.desc"),
    { headers: getHeaders() }
  );

  if (!res.ok) throw new Error(await res.text());
  records = await res.json();
  renderMaintenance(records);
  updateKpis();
}

function renderMaintenance(rows) {
  const tbody = document.getElementById("maintenanceTableBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">No maintenance records found.</td></tr>`;
    return;
  }

  rows.forEach(record => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(record.trucks?.truck_number || record.truck_id || "N/A")}</td>
      <td>${escapeHtml(record.maintenance_type || "N/A")}</td>
      <td>${record.created_at ? new Date(record.created_at).toLocaleDateString() : "N/A"}</td>
      <td>${record.mileage || "N/A"}</td>
      <td>${record.cost ? formatCurrency(record.cost) : "N/A"}</td>
      <td>${escapeHtml(record.notes || "")}</td>
      <td><button class="delete" type="button" data-delete-log="${record.id}">Delete</button></td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-delete-log]").forEach(button => {
    button.addEventListener("click", () => deleteMaintenance(button.dataset.deleteLog));
  });
}

async function saveSchedule(event) {
  event.preventDefault();

  const form = event.target;
  const msg = document.getElementById("scheduleMessage");
  const data = normalizeScheduleData(Object.fromEntries(new FormData(form).entries()));

  msg.textContent = "Saving schedule...";
  msg.style.color = "";

  try {
    const scheduleData = window.CompanyContext.withCompanyId(data);
    const res = await fetch(`${BASE_URL}/rest/v1/maintenance_schedules`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(scheduleData)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    form.reset();
    msg.textContent = "Maintenance schedule saved.";
    msg.style.color = "#047857";
    await loadSchedules();
  } catch (err) {
    console.error(err);
    msg.textContent = getMaintenanceError(err.message);
    msg.style.color = "#ef4444";
  }
}

function normalizeScheduleData(data) {
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  ["truck_id", "interval_miles", "interval_days", "next_due_mileage"].forEach(key => {
    if (data[key]) data[key] = Number(data[key]);
  });

  data.status = "active";
  return data;
}

async function deleteSchedule(id) {
  if (!confirm("Delete this maintenance schedule?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/maintenance_schedules?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadSchedules();
  } catch (err) {
    console.error(err);
    alert(getMaintenanceError(err.message));
  }
}

async function deleteMaintenance(id) {
  if (!confirm("Delete this maintenance record?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/maintenance_logs?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadMaintenanceLogs();
  } catch (err) {
    console.error(err);
    alert(getMaintenanceError(err.message));
  }
}

async function createMaintenanceAlert(scheduleId) {
  const schedule = schedules.find(row => String(row.id) === String(scheduleId));
  if (!schedule) return;

  try {
    const created = await createAlertForSchedule(schedule);
    alert(created ? "Maintenance alert created." : "An unresolved alert already exists for this schedule.");
  } catch (err) {
    console.error(err);
    alert(getMaintenanceError(err.message));
  }
}

async function createMaintenanceAlertsForSchedules() {
  let created = 0;

  for (const schedule of schedules) {
    const status = getScheduleStatus(schedule);
    if (!["overdue", "due_soon"].includes(status.level)) continue;
    const wasCreated = await createAlertForSchedule(schedule);
    if (wasCreated) created += 1;
  }

  return created;
}

async function createAlertForSchedule(schedule) {
  const status = getScheduleStatus(schedule);
  if (!["overdue", "due_soon"].includes(status.level)) return false;

  const message = `${formatStatus(schedule.maintenance_type)} for ${schedule.trucks?.truck_number || `truck ${schedule.truck_id}`} is ${status.label.toLowerCase()}.`;
  const alertType = status.level === "overdue" ? "maintenance_overdue" : "maintenance_due";

  if (await unresolvedAlertExists(alertType, schedule.truck_id, message)) return false;

  const alertData = window.CompanyContext.withCompanyId({
    alert_type: alertType,
    truck_id: schedule.truck_id,
    message,
    resolved: false
  });

  const res = await fetch(`${BASE_URL}/rest/v1/alerts`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(alertData)
  });

  if (!res.ok) throw new Error(await res.text());
  return true;
}

async function unresolvedAlertExists(alertType, truckId, message) {
  const query = `alert_type=eq.${encodeURIComponent(alertType)}&truck_id=eq.${truckId}&resolved=eq.false&message=eq.${encodeURIComponent(message)}&select=id&limit=1`;
  const res = await fetch(window.CompanyContext.scopedUrl("alerts", query), { headers: getHeaders() });
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

function getScheduleStatus(schedule) {
  const today = startOfDay(new Date());
  const dueDate = schedule.next_due_date ? startOfDay(new Date(`${schedule.next_due_date}T00:00:00`)) : null;
  const daysUntilDue = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;

  if (daysUntilDue !== null && daysUntilDue < 0) {
    return { level: "overdue", label: "Overdue" };
  }

  if (daysUntilDue !== null && daysUntilDue <= 30) {
    return { level: "due_soon", label: "Due Soon" };
  }

  return { level: "scheduled", label: "Scheduled" };
}

function updateKpis() {
  const statuses = schedules.map(getScheduleStatus);
  document.getElementById("scheduledCount").textContent = schedules.length;
  document.getElementById("dueSoonCount").textContent = statuses.filter(status => status.level === "due_soon").length;
  document.getElementById("overdueCount").textContent = statuses.filter(status => status.level === "overdue").length;
  document.getElementById("completedCount").textContent = records.length;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDue(schedule) {
  const parts = [];
  if (schedule.next_due_date) parts.push(schedule.next_due_date);
  if (schedule.next_due_mileage) parts.push(`${Number(schedule.next_due_mileage).toLocaleString()} mi`);
  return parts.length ? parts.join(" / ") : "Not set";
}

function formatInterval(schedule) {
  const parts = [];
  if (schedule.interval_days) parts.push(`${schedule.interval_days} days`);
  if (schedule.interval_miles) parts.push(`${Number(schedule.interval_miles).toLocaleString()} mi`);
  return parts.length ? parts.join(" / ") : "One-time";
}

function formatStatusPill(status) {
  const className = status.level === "overdue" ? "warning" : status.level === "due_soon" ? "caution" : "success";
  return `<span class="status-pill ${className}">${status.label}</span>`;
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function getMaintenanceError(message) {
  if (message.includes("maintenance_schedules") || message.includes("schema cache")) {
    return "Maintenance scheduling is not ready. Run the maintenance automation SQL, then refresh.";
  }
  if (message.includes("row-level security")) {
    return "Supabase blocked this maintenance action. Run the maintenance automation SQL and confirm your user belongs to this company.";
  }
  return message || "Unknown maintenance error.";
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

initMaintenance();
