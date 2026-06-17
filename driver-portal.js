const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "documents";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const driverSelect = document.getElementById("driverSelect");
const msg = document.getElementById("driverPortalMessage");
let drivers = [];
let trucks = new Map();
let currentLoads = [];

async function initDriverPortal() {
  msg.textContent = "Loading drivers...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const [driverRows, truckRows] = await Promise.all([
      fetchRows("drivers", "select=id,first_name,last_name,email,phone,status&order=last_name.asc"),
      fetchRows("trucks", "select=id,truck_number,vin")
    ]);

    drivers = driverRows;
    trucks = new Map(truckRows.map(truck => [
      truck.id,
      truck.truck_number || truck.vin || `Truck ${truck.id}`
    ]));
    fillDriverSelect(drivers);
    msg.textContent = "Select a driver to view assignments.";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading driver portal: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function fetchRows(table, query) {
  const url = window.CompanyContext?.scopedUrl(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function fillDriverSelect(driverRows) {
  driverSelect.innerHTML = `<option value="">Select driver</option>`;
  driverRows.forEach(driver => {
    const option = document.createElement("option");
    option.value = driver.id;
    option.textContent = getDriverName(driver);
    driverSelect.appendChild(option);
  });
}

async function loadDriverAssignments() {
  const driverId = driverSelect.value;
  if (!driverId) {
    msg.textContent = "Select a driver first.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Loading assigned loads...";
  msg.style.color = "";

  try {
    const assignments = await fetchRows(
      "assignments",
      `driver_id=eq.${driverId}&status=eq.active&select=id,load_id,truck_id,status`
    );
    const loadIds = assignments.map(assignment => assignment.load_id).filter(Boolean);

    if (!loadIds.length) {
      currentLoads = [];
      updateKpis([]);
      renderLoads([]);
      msg.textContent = "No active assigned loads.";
      return;
    }

    const loads = await fetchRows(
      "loads",
      `id=in.(${loadIds.join(",")})&select=*&order=pickup_date.asc`
    );
    const assignmentByLoad = new Map(assignments.map(assignment => [assignment.load_id, assignment]));
    currentLoads = loads
      .map(load => ({ ...load, assignment: assignmentByLoad.get(load.id) }))
      .filter(load => !["invoiced", "paid", "cancelled"].includes(normalizeStatus(load.status)));

    updateKpis(currentLoads);
    renderLoads(currentLoads);
    msg.textContent = currentLoads.length ? "" : "No active assigned loads.";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading assignments: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderLoads(loads) {
  const list = document.getElementById("driverLoadsList");
  list.innerHTML = "";

  if (!loads.length) {
    list.innerHTML = `<section class="card"><p>No active loads assigned.</p></section>`;
    return;
  }

  loads.forEach(load => list.appendChild(createDriverLoadCard(load)));

  list.querySelectorAll("[data-status-action]").forEach(button => {
    button.addEventListener("click", () => saveDriverStatus(button.dataset.loadId, button.dataset.statusAction));
  });

  list.querySelectorAll("[data-checkcall-form]").forEach(form => {
    form.addEventListener("submit", saveCheckCall);
  });

  list.querySelectorAll("[data-pod-form]").forEach(form => {
    form.addEventListener("submit", savePodUpload);
  });
}

function createDriverLoadCard(load) {
  const card = document.createElement("section");
  card.className = `card driver-load-card ${isLateLoad(load) ? "at-risk" : ""}`;
  const truckName = trucks.get(load.assignment?.truck_id) || "Unassigned";

  card.innerHTML = `
    <div class="driver-load-header">
      <div>
        <h2>${escapeHtml(load.load_number || `Load ${load.id}`)}</h2>
        <p>${escapeHtml(load.customer_name || load.customer || "No customer")}</p>
      </div>
      <span class="status-pill">${formatStatus(load.status)}</span>
    </div>

    <div class="dispatch-lane">${escapeHtml(load.pickup_location || "-")} <span>to</span> ${escapeHtml(load.delivery_location || load.dropoff_location || "-")}</div>

    <dl class="dispatch-meta driver-load-meta">
      <div><dt>Pickup</dt><dd>${formatDateTime(load.pickup_date, load.pickup_time)}</dd></div>
      <div><dt>Delivery</dt><dd>${formatDateTime(load.delivery_date || load.dropoff_date, load.delivery_time)}</dd></div>
      <div><dt>Truck</dt><dd>${escapeHtml(truckName)}</dd></div>
      <div><dt>Commodity</dt><dd>${escapeHtml(load.commodity || "N/A")}</dd></div>
      <div><dt>Notes</dt><dd>${escapeHtml(load.notes || "N/A")}</dd></div>
    </dl>

    <div class="driver-status-actions">
      <button class="view" type="button" data-load-id="${load.id}" data-status-action="dispatched">Dispatched</button>
      <button class="view" type="button" data-load-id="${load.id}" data-status-action="arrived_pickup">Arrived Pickup</button>
      <button class="view" type="button" data-load-id="${load.id}" data-status-action="loaded">Loaded</button>
      <button class="view" type="button" data-load-id="${load.id}" data-status-action="in_transit">In Transit</button>
      <button class="view" type="button" data-load-id="${load.id}" data-status-action="delivered">Delivered</button>
    </div>

    <form class="form driver-checkcall-form" data-checkcall-form data-load-id="${load.id}">
      <div class="field"><label>Location</label><input name="location" placeholder="City, ST" /></div>
      <div class="field"><label>Check Call Notes</label><textarea name="notes" placeholder="Status, delay, or delivery notes"></textarea></div>
      <button type="submit" class="btn">Send Check Call</button>
    </form>

    <form class="form driver-pod-form" data-pod-form data-load-id="${load.id}">
      <div class="field"><label>Upload POD / BOL</label><input name="pod_file" type="file" required /></div>
      <div class="field"><label>Document Notes</label><textarea name="notes" placeholder="Optional document notes"></textarea></div>
      <button type="submit" class="btn">Upload POD</button>
    </form>
  `;

  return card;
}

async function saveDriverStatus(loadId, eventType) {
  msg.textContent = "Saving status update...";
  msg.style.color = "";

  const nextStatus = getStatusForEvent(eventType);

  try {
    await saveLoadEvent(loadId, eventType, null, `Driver updated status to ${formatStatus(eventType)}.`);
    if (nextStatus) await updateLoadStatus(loadId, nextStatus);
    msg.textContent = "Status updated.";
    msg.style.color = "#047857";
    await loadDriverAssignments();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving status: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function saveCheckCall(e) {
  e.preventDefault();
  const loadId = e.target.dataset.loadId;
  const data = Object.fromEntries(new FormData(e.target).entries());

  msg.textContent = "Sending check call...";
  msg.style.color = "";

  try {
    await saveLoadEvent(loadId, "in_transit", data.location || null, data.notes || "Driver check call.");
    await updateLoadStatus(loadId, "in_transit");
    e.target.reset();
    msg.textContent = "Check call saved.";
    msg.style.color = "#047857";
    await loadDriverAssignments();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error sending check call: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function savePodUpload(e) {
  e.preventDefault();
  const loadId = e.target.dataset.loadId;
  const formData = new FormData(e.target);
  const file = formData.get("pod_file");
  const notes = formData.get("notes");

  if (!file || !file.name) {
    msg.textContent = "Choose a POD or BOL file first.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Uploading POD...";
  msg.style.color = "";

  try {
    const url = await uploadDriverDocument(loadId, "pod", file);
    await saveLoadDocument(loadId, "pod", url, notes || "Uploaded from driver portal.");
    await saveLoadEvent(loadId, "pod_received", null, "POD uploaded from driver portal.");
    await updateLoadStatus(loadId, "delivered");
    e.target.reset();
    msg.textContent = "POD uploaded.";
    msg.style.color = "#047857";
    await loadDriverAssignments();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error uploading POD: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function saveLoadEvent(loadId, eventType, location, notes) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location,
    notes
  }) || {
    load_id: Number(loadId),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location,
    notes
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Authorization: "Bearer " + API_KEY,
      Prefer: "return=representation"
    },
    body: JSON.stringify(eventData)
  });

  if (!res.ok) throw new Error(await res.text());
}

async function updateLoadStatus(loadId, status) {
  const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${loadId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Authorization: "Bearer " + API_KEY,
      Prefer: "return=representation"
    },
    body: JSON.stringify({ status })
  });

  if (!res.ok) throw new Error(await res.text());
}

async function saveLoadDocument(loadId, documentType, documentUrl, notes) {
  const documentData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    document_type: documentType,
    document_url: documentUrl,
    notes: notes || null
  }) || {
    load_id: Number(loadId),
    document_type: documentType,
    document_url: documentUrl,
    notes: notes || null
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Authorization: "Bearer " + API_KEY,
      Prefer: "return=representation"
    },
    body: JSON.stringify(documentData)
  });

  if (!res.ok) throw new Error(await res.text());
}

async function uploadDriverDocument(loadId, documentType, file) {
  const path = buildStoragePath(loadId, documentType, file.name);
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: API_KEY,
      Authorization: "Bearer " + API_KEY,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    },
    body: file
  });

  if (!res.ok) {
    const errorText = await res.text();
    if (errorText.includes("Bucket not found") || errorText.includes("not found")) {
      throw new Error("Storage bucket is not ready. Run the document storage SQL first, then try again.");
    }
    throw new Error(errorText);
  }

  return `${BASE_URL}/storage/v1/object/public/${DOCUMENT_BUCKET}/${path}`;
}

function buildStoragePath(loadId, documentType, fileName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeType = sanitizePathPart(documentType || "document");
  const safeName = sanitizeFileName(fileName || "document");
  return `loads/${loadId}/${safeType}/${timestamp}-${safeName}`;
}

function updateKpis(loads) {
  const today = getToday();
  document.getElementById("driverLoadCount").textContent = loads.length;
  document.getElementById("driverPickupToday").textContent = loads.filter(load => load.pickup_date === today).length;
  document.getElementById("driverAtRisk").textContent = loads.filter(isLateLoad).length;
}

function getStatusForEvent(eventType) {
  return {
    dispatched: "dispatched",
    arrived_pickup: "dispatched",
    loaded: "picked_up",
    in_transit: "in_transit",
    delivered: "delivered",
    pod_received: "delivered"
  }[eventType];
}

function isLateLoad(load) {
  const status = normalizeStatus(load.status);
  if (["delivered", "invoiced", "paid"].includes(status)) return false;
  const deliveryDate = load.delivery_date || load.dropoff_date;
  return Boolean(deliveryDate && deliveryDate < getToday());
}

function getDriverName(driver) {
  return `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || driver.email || driver.phone || `Driver ${driver.id}`;
}

function normalizeStatus(value) {
  return (value || "booked").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
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

function getToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function sanitizePathPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function sanitizeFileName(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "document";
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

document.getElementById("loadDriverLoadsBtn").addEventListener("click", loadDriverAssignments);
driverSelect.addEventListener("change", loadDriverAssignments);
initDriverPortal();
