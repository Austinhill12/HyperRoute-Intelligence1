const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const eventStatusMap = {
  accepted: "dispatched",
  arrived_pickup: "dispatched",
  loaded: "picked_up",
  in_transit: "in_transit",
  arrived_delivery: "in_transit",
  delivered: "delivered",
  pod_received: "pod_received"
};
const requiredPacketDocuments = [
  { type: "rate_confirmation", label: "Rate Con", required: true },
  { type: "bol", label: "BOL", required: true },
  { type: "pod", label: "POD", required: true },
  { type: "lumper_receipt", label: "Lumper", required: false },
  { type: "scale_ticket", label: "Scale Ticket", required: false },
  { type: "accessorial_receipt", label: "Accessorial", required: false }
];

let currentLoad = null;
let currentDocuments = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || headers),
    ...extra
  };
}

function getLoadId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function initDispatchPacket() {
  const loadId = getLoadId();
  const msg = document.getElementById("dispatchPacketMessage");

  if (!loadId) {
    setText("packetLoadTitle", "No load ID provided.");
    return;
  }

  try {
    await window.CompanyContext?.ready();
    document.getElementById("loadDetailsLink").href = `load-details.html?id=${loadId}`;
    await loadPacket(loadId);
    bindPacketActions();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading dispatch packet: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function loadPacket(loadId) {
  const [load] = await fetchRows("loads", `id=eq.${loadId}&select=*&limit=1`);
  if (!load) {
    setText("packetLoadTitle", "Load not found.");
    return;
  }

  currentLoad = load;
  renderLoad(load);

  const [assignment, documents] = await Promise.all([
    getAssignment(load.id),
    fetchRows("documents", `entity_type=eq.load&entity_id=eq.${load.id}&select=*&order=created_at.desc`).catch(() => [])
  ]);

  currentDocuments = documents || [];
  await renderAssignment(load, assignment);
  renderDocuments(currentDocuments);
  renderDocumentChecklist(currentDocuments);
  renderInstructions(load);
}

async function fetchRows(table, query) {
  const url = window.CompanyContext?.scopedUrl(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderLoad(load) {
  const pickupLocation = load.pickup_location || "N/A";
  const deliveryLocation = load.delivery_location || load.dropoff_location || "N/A";

  setText("packetLoadTitle", `Load ${load.load_number || load.id}`);
  setText("packetLane", `${pickupLocation} to ${deliveryLocation}`);
  setText("packetStatus", formatStatus(load.status));
  document.getElementById("packetStatus").className = `status-pill ${getStatusClass(load.status)}`;
  setText("pickupLocation", pickupLocation);
  setText("deliveryLocation", deliveryLocation);
  setText("pickupDateTime", formatDateTime(load.pickup_date, load.pickup_time));
  setText("deliveryDateTime", formatDateTime(load.delivery_date || load.dropoff_date, load.delivery_time));
  setText("shipperInfo", [load.shipper_name, load.shipper_contact].filter(Boolean).join(" | ") || "N/A");
  setText("consigneeInfo", [load.consignee_name, load.consignee_contact].filter(Boolean).join(" | ") || "N/A");
  setText("packetCommodity", load.commodity || "N/A");
  setText("packetWeight", load.weight ? `${Number(load.weight).toLocaleString()} lbs` : "N/A");
  setText("packetTrailer", [load.trailer_length, load.trailer_type].filter(Boolean).join(" ") || load.equipment_requirements || "N/A");
  setText("packetTemperature", load.temperature || load.temperature_requirements || "N/A");
  setText("packetTracking", load.tracking_code || "N/A");
  setText("packetRate", formatCurrency(load.rate));
}

async function getAssignment(loadId) {
  const rows = await fetchRows("assignments", `load_id=eq.${loadId}&status=eq.active&select=*&limit=1`).catch(() => []);
  return rows[0] || null;
}

async function renderAssignment(load, assignment) {
  const driverId = assignment?.driver_id || load.driver_id;
  const truckId = assignment?.truck_id || load.truck_id || load.vehicle_id;
  const [driverName, truckName] = await Promise.all([
    getDriverName(driverId),
    getTruckName(truckId)
  ]);

  setText("packetDriver", driverName);
  setText("packetTruck", truckName);
}

async function getDriverName(id) {
  if (!id) return "Unassigned";
  const rows = await fetchRows("drivers", `id=eq.${id}&select=first_name,last_name,phone,email&limit=1`).catch(() => []);
  const driver = rows[0];
  if (!driver) return `Driver ${id}`;
  const name = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${id}`;
  const contact = [driver.phone, driver.email].filter(Boolean).join(" | ");
  return contact ? `${name} - ${contact}` : name;
}

async function getTruckName(id) {
  if (!id) return "Unassigned";
  const rows = await fetchRows("trucks", `id=eq.${id}&select=truck_number,vin&limit=1`).catch(() => []);
  const truck = rows[0];
  return truck ? truck.truck_number || truck.vin || `Truck ${id}` : `Truck ${id}`;
}

function renderInstructions(load) {
  const items = [
    ["Equipment", load.equipment_requirements || [load.trailer_length, load.trailer_type].filter(Boolean).join(" ")],
    ["Hazmat", load.hazmat || load.hazmat_status],
    ["Temperature", load.temperature || load.temperature_requirements],
    ["Required Documents", load.required_documents],
    ["Tracking Requirements", load.tracking_requirements || (load.tracking_required ? "Tracking required" : "")],
    ["Driver Instructions", load.driver_instructions],
    ["Special Instructions", load.special_instructions],
    ["Notes", load.notes]
  ].filter(([, value]) => value);

  const container = document.getElementById("packetInstructions");
  if (!items.length) {
    container.innerHTML = `<p class="muted-line">No special instructions saved on this load.</p>`;
    return;
  }

  container.innerHTML = items.map(([label, value]) => `
    <div class="dispatch-instruction-item">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function renderDocuments(documents) {
  const container = document.getElementById("packetDocuments");

  if (!documents.length) {
    container.innerHTML = `<p class="muted-line">No documents attached yet.</p>`;
    return;
  }

  container.innerHTML = documents.map(documentRow => `
    <div class="dispatch-doc-item">
      <div>
        <strong>${escapeHtml(formatStatus(documentRow.document_type))}</strong>
        <span>${escapeHtml(documentRow.file_name || "Document")}</span>
      </div>
      <button class="view secondary-action" type="button" data-open-document="${escapeHtml(documentRow.id)}">Open</button>
    </div>
  `).join("");

  container.querySelectorAll("[data-open-document]").forEach(button => {
    button.addEventListener("click", () => openDocument(button.dataset.openDocument));
  });
}

function bindPacketActions() {
  document.querySelectorAll("[data-packet-event]").forEach(button => {
    button.addEventListener("click", () => savePacketEvent(button.dataset.packetEvent));
  });

  document.getElementById("packetDocumentForm").addEventListener("submit", savePacketDocument);
  document.getElementById("packetPrintButton")?.addEventListener("click", () => window.print());
  document.getElementById("copyDriverPacketMessage")?.addEventListener("click", copyDriverMessage);
}

async function copyDriverMessage() {
  if (!currentLoad) return;
  const msg = document.getElementById("packetActionMessage");
  const packetUrl = new URL(`dispatch-packet.html?id=${currentLoad.id}`, window.location.href).href;
  const text = [
    `Dispatch packet for Load ${currentLoad.load_number || currentLoad.id}`,
    `${currentLoad.pickup_location || "Pickup TBD"} to ${currentLoad.delivery_location || currentLoad.dropoff_location || "Delivery TBD"}`,
    `Pickup: ${formatDateTime(currentLoad.pickup_date, currentLoad.pickup_time)}`,
    `Delivery: ${formatDateTime(currentLoad.delivery_date || currentLoad.dropoff_date, currentLoad.delivery_time)}`,
    `Open packet: ${packetUrl}`
  ].join("\n");

  try {
    await copyText(text);
    msg.textContent = "Driver dispatch message copied.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Could not copy driver message: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function savePacketEvent(eventType) {
  if (!currentLoad) return;
  const msg = document.getElementById("packetActionMessage");
  const status = eventStatusMap[eventType] || currentLoad.status;

  try {
    msg.textContent = "Saving status update...";
    msg.style.color = "";
    await recordLoadEvent(eventType, status);
    if (status && status !== currentLoad.status) {
      await updateLoadStatus(currentLoad.id, status);
      currentLoad.status = status;
      setText("packetStatus", formatStatus(status));
      document.getElementById("packetStatus").className = `status-pill ${getStatusClass(status)}`;
    }
    msg.textContent = `${formatStatus(eventType)} saved.`;
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving update: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function recordLoadEvent(eventType, status) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(currentLoad.id),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: getEventLocation(eventType),
    notes: `Driver dispatch packet update: ${formatStatus(eventType)}${status ? ` / load status ${formatStatus(status)}` : ""}.`
  }) || {
    load_id: Number(currentLoad.id),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: getEventLocation(eventType),
    notes: `Driver dispatch packet update: ${formatStatus(eventType)}.`
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
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

function getEventLocation(eventType) {
  if (eventType.includes("pickup") || eventType === "loaded") return currentLoad.pickup_location || null;
  if (eventType.includes("delivery") || eventType === "delivered" || eventType === "pod_received") {
    return currentLoad.delivery_location || currentLoad.dropoff_location || null;
  }
  return null;
}

async function savePacketDocument(e) {
  e.preventDefault();
  if (!currentLoad) return;

  const msg = document.getElementById("packetDocumentMessage");
  const form = e.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  const file = document.getElementById("packetDocumentFile").files[0];

  if (!file) {
    msg.textContent = "Choose a file before uploading.";
    msg.style.color = "#ef4444";
    return;
  }

  try {
    msg.textContent = "Uploading document...";
    msg.style.color = "";
    const filePath = await uploadDocumentFile(currentLoad.id, formData.document_type, file);
    const documentData = window.CompanyContext?.withCompanyId({
      entity_type: "load",
      entity_id: String(currentLoad.id),
      document_type: formData.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: formData.notes || null
    }) || {
      entity_type: "load",
      entity_id: String(currentLoad.id),
      document_type: formData.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: formData.notes || null
    };

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

    currentDocuments = [result[0], ...currentDocuments].filter(Boolean);
    renderDocuments(currentDocuments);
    renderDocumentChecklist(currentDocuments);
    await recordLoadEvent(formData.document_type === "pod" ? "pod_received" : "document_uploaded", currentLoad.status).catch(console.warn);
    form.reset();
    msg.textContent = "Document uploaded.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error uploading document: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderDocumentChecklist(documents = []) {
  const container = document.getElementById("packetDocumentChecklist");
  if (!container) return;

  const types = new Set(documents.map(documentRow => normalizeDocumentType(documentRow.document_type)));
  container.innerHTML = requiredPacketDocuments.map(item => {
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

function normalizeDocumentType(value) {
  const type = String(value || "").toLowerCase();
  if (["proof_of_delivery", "delivery_receipt"].includes(type)) return "pod";
  if (["bill_of_lading"].includes(type)) return "bol";
  if (["rate_con", "signed_rate_confirmation"].includes(type)) return "rate_confirmation";
  if (["lumper", "lumper_fee"].includes(type)) return "lumper_receipt";
  if (["scale", "scale_receipt"].includes(type)) return "scale_ticket";
  if (["accessorial", "receipt"].includes(type)) return "accessorial_receipt";
  return type;
}

async function uploadDocumentFile(loadId, documentType, file) {
  const path = buildStoragePath(loadId, documentType, file.name);
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${path}`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    }),
    body: file
  });

  if (!res.ok) throw new Error(await res.text());
  return path;
}

function buildStoragePath(loadId, documentType, fileName) {
  const companyId = window.CompanyContext?.getCompanyId?.() || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${companyId}/load/${loadId}/${sanitizePathPart(documentType)}/${timestamp}-${sanitizeFileName(fileName)}`;
}

async function openDocument(documentId) {
  const documentRow = currentDocuments.find(row => String(row.id) === String(documentId));
  if (!documentRow?.file_path) return;

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
  if (!res.ok) {
    alert(`Error opening document: ${JSON.stringify(result)}`);
    return;
  }

  window.open(`${BASE_URL}/storage/v1${result.signedURL}`, "_blank");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDateTime(date, time) {
  if (!date && !time) return "N/A";
  return `${date || ""}${time ? ` ${time}` : ""}`.trim();
}

function formatStatus(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount ? `$${amount.toLocaleString()}` : "N/A";
}

function getStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["delivered", "pod_received", "invoiced", "paid", "closed"].includes(normalized)) return "success";
  if (["cancelled", "issue", "late"].includes(normalized)) return "warning";
  return "caution";
}

function sanitizePathPart(value) {
  return String(value || "document").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function sanitizeFileName(value) {
  return String(value || "document").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
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

initDispatchPacket();
