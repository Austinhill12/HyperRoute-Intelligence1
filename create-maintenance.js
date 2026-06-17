const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("maintenanceForm");
const msg = document.getElementById("maintenanceMessage");
const truckSelect = document.getElementById("truckSelect");

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getVehicleId() {
  return getQueryParam("truck_id") || getQueryParam("vehicle_id");
}

function getScheduleId() {
  return getQueryParam("schedule_id");
}

async function loadTrucks() {
  await window.CompanyContext?.ready();

  const url = window.CompanyContext.scopedUrl("trucks", "select=id,truck_number,vin&order=truck_number.asc");
  const res = await fetch(url, { headers: getHeaders() });

  if (!res.ok) throw new Error(await res.text());

  const trucks = await res.json();
  const selectedTruckId = getVehicleId();
  truckSelect.innerHTML = "";

  if (!trucks.length) {
    truckSelect.innerHTML = `<option value="">No trucks available</option>`;
    return;
  }

  trucks.forEach(truck => {
    const option = document.createElement("option");
    option.value = truck.id;
    option.textContent = truck.truck_number || truck.vin || `Truck ${truck.id}`;
    option.selected = String(truck.id) === String(selectedTruckId);
    truckSelect.appendChild(option);
  });

  if (getScheduleId()) await prefillSchedule(getScheduleId());
}

async function prefillSchedule(scheduleId) {
  const res = await fetch(
    window.CompanyContext.scopedUrl("maintenance_schedules", `id=eq.${scheduleId}&select=*&limit=1`),
    { headers: getHeaders() }
  );

  if (!res.ok) return;
  const [schedule] = await res.json();
  if (!schedule) return;

  form.truck_id.value = schedule.truck_id;
  form.maintenance_type.value = schedule.maintenance_type || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Saving maintenance...";
  msg.style.color = "";

  await window.CompanyContext?.ready();

  if (!window.CompanyContext?.getCompanyId()) {
    msg.textContent = "No company selected. Select or create a company first.";
    msg.style.color = "#ef4444";
    return;
  }

  const data = normalizeMaintenanceData(Object.fromEntries(new FormData(form).entries()));

  try {
    const maintenanceData = window.CompanyContext.withCompanyId(data);
    const res = await fetch(`${BASE_URL}/rest/v1/maintenance_logs`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(maintenanceData)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    const savedRecord = Array.isArray(result) ? result[0] : result;
    await advanceScheduleIfNeeded(savedRecord);
    await resolveMaintenanceAlerts(savedRecord);

    msg.textContent = savedRecord?.id
      ? `Maintenance saved. Log ID: ${savedRecord.id}`
      : "Maintenance saved.";
    msg.style.color = "#047857";
    form.reset();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving maintenance: ${getMaintenanceError(err.message)}`;
    msg.style.color = "#ef4444";
  }
});

function normalizeMaintenanceData(data) {
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.truck_id) data.truck_id = Number(data.truck_id);
  if (data.mileage) data.mileage = Number(data.mileage);
  if (data.cost) data.cost = Number(data.cost);
  return data;
}

async function advanceScheduleIfNeeded(savedRecord) {
  const scheduleId = getScheduleId();
  if (!scheduleId || !savedRecord) return;

  const scheduleRes = await fetch(
    window.CompanyContext.scopedUrl("maintenance_schedules", `id=eq.${scheduleId}&select=*&limit=1`),
    { headers: getHeaders() }
  );

  if (!scheduleRes.ok) return;
  const [schedule] = await scheduleRes.json();
  if (!schedule) return;

  const updates = {
    last_completed_at: new Date().toISOString(),
    last_maintenance_log_id: savedRecord.id,
    updated_at: new Date().toISOString()
  };

  if (schedule.interval_miles && savedRecord.mileage) {
    updates.next_due_mileage = Number(savedRecord.mileage) + Number(schedule.interval_miles);
  }

  if (schedule.interval_days) {
    const baseDate = savedRecord.service_date ? new Date(`${savedRecord.service_date}T00:00:00`) : new Date();
    baseDate.setDate(baseDate.getDate() + Number(schedule.interval_days));
    updates.next_due_date = baseDate.toISOString().slice(0, 10);
  }

  const updateRes = await fetch(`${BASE_URL}/rest/v1/maintenance_schedules?id=eq.${scheduleId}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(updates)
  });

  if (!updateRes.ok) throw new Error(await updateRes.text());
}

async function resolveMaintenanceAlerts(savedRecord) {
  if (!savedRecord?.truck_id) return;

  const res = await fetch(
    window.CompanyContext.scopedUrl("alerts", `truck_id=eq.${savedRecord.truck_id}&resolved=eq.false&alert_type=in.(maintenance_due,maintenance_overdue)&select=id`),
    { headers: getHeaders() }
  );

  if (!res.ok) return;
  const alerts = await res.json();
  if (!alerts.length) return;

  const ids = alerts.map(alert => alert.id).join(",");
  const updateRes = await fetch(`${BASE_URL}/rest/v1/alerts?id=in.(${ids})`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ resolved: true, resolved_at: new Date().toISOString() })
  });

  if (!updateRes.ok) throw new Error(await updateRes.text());
}

function getMaintenanceError(message) {
  if (message.includes("maintenance_schedules") || message.includes("schema cache")) {
    return "Maintenance scheduling is not ready. Run the maintenance automation SQL, then refresh.";
  }
  if (message.includes("row-level security")) {
    return "Supabase blocked this maintenance action. Run the maintenance automation SQL and confirm your user belongs to this company.";
  }
  return message || "Unknown Supabase error.";
}

loadTrucks().catch(err => {
  console.error(err);
  msg.textContent = getMaintenanceError(err.message);
  msg.style.color = "#ef4444";
});
