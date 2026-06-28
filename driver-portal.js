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
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || headers),
    ...extra
  };
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

  list.querySelectorAll("[data-expense-form]").forEach(form => {
    form.addEventListener("submit", saveDriverExpense);
    setupExpenseTypeButtons(form);
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

    <div class="driver-packet-actions">
      <a class="view driver-packet-link" href="dispatch-packet.html?id=${load.id}">Open Dispatch Packet</a>
    </div>

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

    <form class="form driver-expense-form" data-expense-form data-load-id="${load.id}">
      <div class="driver-expense-header">
        <strong>Submit Trip Expense</strong>
        <span>Choose what happened, add the amount or miles, then submit.</span>
      </div>
      <input name="category" type="hidden" value="fuel" />
      <div class="driver-expense-types" role="group" aria-label="Expense type">
        <button class="driver-expense-type active" type="button" data-expense-type="fuel">Fuel</button>
        <button class="driver-expense-type" type="button" data-expense-type="miles">Miles</button>
        <button class="driver-expense-type" type="button" data-expense-type="toll">Tolls</button>
        <button class="driver-expense-type" type="button" data-expense-type="other">Other</button>
      </div>
      <div class="driver-expense-money-fields">
        <div class="field"><label data-amount-label>Fuel Amount</label><input name="amount" type="number" step="0.01" min="0" placeholder="0.00" required /></div>
        <div class="field"><label>Receipt</label><input name="receipt_file" type="file" /></div>
      </div>
      <div class="driver-expense-mile-fields" hidden>
        <div class="field"><label>Loaded Miles</label><input name="loaded_miles" type="number" step="0.1" min="0" placeholder="Loaded miles" /></div>
        <div class="field"><label>Empty Miles</label><input name="empty_miles" type="number" step="0.1" min="0" placeholder="Empty miles" /></div>
      </div>
      <div class="field"><label data-notes-label>Notes</label><textarea name="notes" placeholder="Fuel stop, toll road, mileage note, or other details"></textarea></div>
      <button type="submit" class="btn">Submit Expense</button>
    </form>
  `;

  return card;
}

function setupExpenseTypeButtons(form) {
  form.querySelectorAll("[data-expense-type]").forEach(button => {
    button.addEventListener("click", () => setExpenseType(form, button.dataset.expenseType));
  });
  setExpenseType(form, form.querySelector('input[name="category"]')?.value || "fuel");
}

function setExpenseType(form, type) {
  const categoryInput = form.querySelector('input[name="category"]');
  const amountInput = form.querySelector('input[name="amount"]');
  const amountLabel = form.querySelector("[data-amount-label]");
  const notesLabel = form.querySelector("[data-notes-label]");
  const moneyFields = form.querySelector(".driver-expense-money-fields");
  const mileFields = form.querySelector(".driver-expense-mile-fields");

  if (categoryInput) categoryInput.value = type;

  form.querySelectorAll("[data-expense-type]").forEach(button => {
    button.classList.toggle("active", button.dataset.expenseType === type);
  });

  const isMiles = type === "miles";
  if (moneyFields) moneyFields.hidden = isMiles;
  if (mileFields) mileFields.hidden = !isMiles;
  if (amountInput) amountInput.required = !isMiles;

  const labels = {
    fuel: ["Fuel Amount", "Fuel Notes"],
    toll: ["Toll Amount", "Toll Notes"],
    other: ["Expense Amount", "Expense Notes"],
    miles: ["Amount", "Mileage Notes"]
  };
  const [amountText, notesText] = labels[type] || labels.other;
  if (amountLabel) amountLabel.textContent = amountText;
  if (notesLabel) notesLabel.textContent = notesText;
}

async function saveDriverExpense(e) {
  e.preventDefault();
  const loadId = e.target.dataset.loadId;
  const formData = new FormData(e.target);
  const category = formData.get("category");
  const amount = Number(formData.get("amount"));
  const notes = formData.get("notes");
  const file = formData.get("receipt_file");

  if (category === "miles") {
    await saveDriverMiles(e.target, loadId, formData);
    return;
  }

  if (!amount || amount < 0) {
    msg.textContent = "Enter a valid expense amount.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Submitting expense...";
  msg.style.color = "";

  try {
    let receiptUrl = null;
    if (file && file.name) {
      receiptUrl = await uploadDriverDocument(loadId, `expense-${category}`, file);
      await saveLoadDocument(loadId, `expense_${category}`, receiptUrl, notes || `Driver submitted ${category} receipt.`);
    }

    await saveLoadExpense(loadId, {
      category,
      amount,
      receipt_url: receiptUrl,
      notes: notes || null,
      paid_by: "driver",
      status: "unreviewed"
    });

    await saveLoadEvent(loadId, "expense_submitted", null, `Driver submitted ${formatCurrency(amount)} ${category} expense.`);
    e.target.reset();
    setExpenseType(e.target, "fuel");
    msg.textContent = "Expense submitted for review.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error submitting expense: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function saveDriverMiles(form, loadId, formData) {
  const loadedMiles = Number(formData.get("loaded_miles"));
  const emptyMiles = Number(formData.get("empty_miles"));
  const notes = formData.get("notes");

  if ((!loadedMiles && !emptyMiles) || loadedMiles < 0 || emptyMiles < 0) {
    msg.textContent = "Enter loaded miles, empty miles, or both.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Saving miles...";
  msg.style.color = "";

  try {
    await updateLoadMiles(loadId, {
      loaded_miles: Number.isFinite(loadedMiles) ? loadedMiles : null,
      empty_miles: Number.isFinite(emptyMiles) ? emptyMiles : null
    });

    const mileText = [
      Number.isFinite(loadedMiles) && loadedMiles > 0 ? `${loadedMiles} loaded miles` : "",
      Number.isFinite(emptyMiles) && emptyMiles > 0 ? `${emptyMiles} empty miles` : ""
    ].filter(Boolean).join(" / ");

    await saveLoadEvent(loadId, "miles_submitted", null, notes || `Driver submitted ${mileText}.`);
    form.reset();
    setExpenseType(form, "fuel");
    msg.textContent = "Miles saved.";
    msg.style.color = "#047857";
    await loadDriverAssignments();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving miles: ${err.message}`;
    msg.style.color = "#ef4444";
  }
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
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) throw new Error(await res.text());
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

async function updateLoadMiles(loadId, miles) {
  const payload = {};
  if (miles.loaded_miles !== null) payload.loaded_miles = miles.loaded_miles;
  if (miles.empty_miles !== null) payload.empty_miles = miles.empty_miles;

  const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${loadId}`, {
    method: "PATCH",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(payload)
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
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(documentData)
  });

  if (!res.ok) throw new Error(await res.text());
}

async function saveLoadExpense(loadId, expense) {
  const expenseData = window.CompanyContext?.withCompanyId({
    load_id: Number(loadId),
    expense_date: getToday(),
    category: expense.category || "other",
    amount: Number(expense.amount) || 0,
    billable: ["toll", "lumper", "detention", "scale", "parking"].includes(expense.category),
    reimbursable: true,
    paid_by: expense.paid_by || "driver",
    receipt_url: expense.receipt_url || null,
    status: expense.status || "unreviewed",
    notes: expense.notes || null
  }) || {
    load_id: Number(loadId),
    expense_date: getToday(),
    category: expense.category || "other",
    amount: Number(expense.amount) || 0,
    billable: ["toll", "lumper", "detention", "scale", "parking"].includes(expense.category),
    reimbursable: true,
    paid_by: expense.paid_by || "driver",
    receipt_url: expense.receipt_url || null,
    status: expense.status || "unreviewed",
    notes: expense.notes || null
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_expenses`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(expenseData)
  });

  if (!res.ok) {
    const text = await res.text();
    if (text.includes("load_expenses")) {
      throw new Error("Run the Profit Intelligence v2 SQL first so load expenses can be saved.");
    }
    throw new Error(text);
  }
}

async function uploadDriverDocument(loadId, documentType, file) {
  const path = buildStoragePath(loadId, documentType, file.name);
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...getHeaders(),
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

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
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
