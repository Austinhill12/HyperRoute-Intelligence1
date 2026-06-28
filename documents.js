const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let documents = [];
let documentLoads = [];
let documentInvoices = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initDocuments() {
  const msg = document.getElementById("documentMessage");
  msg.textContent = "Loading documents...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();

    if (!window.CompanyContext?.getCompanyId()) {
      msg.textContent = "No company selected. Select or create a company first.";
      msg.style.color = "#ef4444";
      renderDocuments([]);
      return;
    }

    bindEvents();
    await loadDocuments();
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = getDocumentError(err.message);
    msg.style.color = "#ef4444";
  }
}

function bindEvents() {
  document.getElementById("documentForm").addEventListener("submit", uploadDocument);
  document.getElementById("documentSearch").addEventListener("input", renderFilteredDocuments);
  document.getElementById("entityFilter").addEventListener("change", renderFilteredDocuments);
}

async function loadDocuments() {
  const tbody = document.getElementById("documentsTableBody");
  tbody.innerHTML = `<tr><td colspan="6">Loading documents...</td></tr>`;

  const [documentRes, loadRes, invoiceRes] = await Promise.all([
    fetch(window.CompanyContext.scopedUrl("documents", "select=*&order=created_at.desc"), { headers: getHeaders() }),
    fetch(window.CompanyContext.scopedUrl("loads", "select=id,load_number,customer_name,customer,status,pickup_location,delivery_location,dropoff_location,pickup_date,delivery_date,dropoff_date,rate,required_documents&order=delivery_date.asc"), { headers: getHeaders() }),
    fetch(window.CompanyContext.scopedUrl("invoices", "select=id,load_id,invoice_number,status,total_amount,due_date"), { headers: getHeaders() })
  ]);

  if (!documentRes.ok) throw new Error(await documentRes.text());
  if (!loadRes.ok) throw new Error(await loadRes.text());
  if (!invoiceRes.ok) throw new Error(await invoiceRes.text());

  documents = await documentRes.json();
  documentLoads = await loadRes.json();
  documentInvoices = await invoiceRes.json();
  renderFilteredDocuments();
  renderPaperworkQueue();
}

async function uploadDocument(event) {
  event.preventDefault();

  const form = event.target;
  const msg = document.getElementById("documentMessage");
  const file = document.getElementById("documentFile").files[0];
  const data = Object.fromEntries(new FormData(form).entries());
  const companyId = window.CompanyContext?.getCompanyId();

  if (!companyId) {
    msg.textContent = "No company selected. Select or create a company first.";
    msg.style.color = "#ef4444";
    return;
  }

  if (!file) {
    msg.textContent = "Choose a file to upload.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Uploading document...";
  msg.style.color = "";

  try {
    const cleanFileName = buildDocumentFileName(data, file);
    const filePath = buildStoragePath(companyId, data.entity_type, data.entity_id, cleanFileName);
    await uploadFile(filePath, file);

    const documentRecord = window.CompanyContext.withCompanyId({
      entity_type: data.entity_type,
      entity_id: data.entity_id || null,
      document_type: data.document_type,
      file_name: cleanFileName,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: buildDocumentNotes(data.notes, file.name, cleanFileName)
    });

    msg.textContent = "Saving document record...";
    await insertDocumentRecord(documentRecord);

    form.reset();
    msg.textContent = "Document uploaded.";
    msg.style.color = "#047857";
    await loadDocuments();
  } catch (err) {
    console.error(err);
    msg.textContent = getDocumentError(err.message);
    msg.style.color = "#ef4444";
  }
}

function renderPaperworkQueue() {
  const queue = document.getElementById("paperworkQueue");
  const count = document.getElementById("paperworkQueueCount");
  if (!queue || !count) return;

  const items = buildPaperworkQueue();
  count.textContent = `${items.length} open`;

  if (!items.length) {
    queue.innerHTML = `<p class="empty-state">No missing paperwork found.</p>`;
    return;
  }

  queue.innerHTML = items.map(item => `
    <article class="paperwork-item ${escapeHtml(item.severity)}">
      <div>
        <span class="status-pill ${escapeHtml(item.severity)}">${escapeHtml(item.label)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.detail)}</p>
      </div>
      <div class="paperwork-actions">
        <a class="view" href="load-details.html?id=${encodeURIComponent(item.load.id)}">Open Load</a>
        <button class="view secondary-action" type="button" data-prepare-upload="${escapeHtml(item.load.id)}" data-document-type="${escapeHtml(item.documentType)}">Upload</button>
      </div>
    </article>
  `).join("");

  queue.querySelectorAll("[data-prepare-upload]").forEach(button => {
    button.addEventListener("click", () => prepareDocumentUpload(button.dataset.prepareUpload, button.dataset.documentType));
  });
}

function buildPaperworkQueue() {
  const byLoad = buildDocumentsByLoad();
  const invoiceByLoad = buildInvoicesByLoad();
  const items = [];

  documentLoads.forEach(load => {
    const status = normalizeStatus(load.status);
    const docs = byLoad.get(String(load.id)) || new Set();
    const invoices = invoiceByLoad.get(String(load.id)) || [];
    const loadLabel = load.load_number || `Load ${load.id}`;
    const customer = load.customer_name || load.customer || "No customer";

    if (!docs.has("rate_confirmation")) {
      items.push(queueItem(load, "rate_confirmation", "Rate Con", "warning", `${loadLabel} is missing the original rate confirmation.`, customer));
    }

    if (["picked_up", "in_transit", "delivered", "invoiced", "paid"].includes(status) && !docs.has("bol")) {
      items.push(queueItem(load, "bol", "BOL", "warning", `${loadLabel} is missing the bill of lading.`, customer));
    }

    if (["delivered", "invoiced", "paid"].includes(status) && !docs.has("pod")) {
      items.push(queueItem(load, "pod", "POD", "danger", `${loadLabel} is delivered but missing proof of delivery.`, customer));
    }

    const hasOpenInvoice = invoices.some(invoice => !["paid", "void", "cancelled", "canceled"].includes(normalizeStatus(invoice.status)));
    if (hasOpenInvoice && !docs.has("invoice_backup")) {
      items.push(queueItem(load, "invoice_backup", "Invoice Backup", "caution", `${loadLabel} has invoice activity but no invoice backup attached.`, customer));
    }
  });

  const priority = { danger: 0, warning: 1, caution: 2 };
  return items.sort((a, b) => {
    const severity = (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9);
    if (severity) return severity;
    return String(a.load.delivery_date || a.load.dropoff_date || a.load.pickup_date || "").localeCompare(String(b.load.delivery_date || b.load.dropoff_date || b.load.pickup_date || ""));
  }).slice(0, 12);
}

function queueItem(load, documentType, label, severity, title, customer) {
  return {
    load,
    documentType,
    label,
    severity,
    title,
    detail: `${customer} | ${formatStatus(load.status)} | Delivery ${formatDate(load.delivery_date || load.dropoff_date)}`
  };
}

function buildDocumentsByLoad() {
  const map = new Map();
  documents.forEach(row => {
    if (row.entity_type !== "load" || !row.entity_id) return;
    const key = String(row.entity_id);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(normalizeDocumentType(row.document_type));
  });
  return map;
}

function buildInvoicesByLoad() {
  const map = new Map();
  documentInvoices.forEach(invoice => {
    if (!invoice.load_id) return;
    const key = String(invoice.load_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(invoice);
  });
  return map;
}

function prepareDocumentUpload(loadId, documentType) {
  document.getElementById("entityType").value = "load";
  document.getElementById("entityId").value = loadId;
  document.getElementById("documentType").value = documentType;
  document.getElementById("documentFile").focus();
  document.getElementById("documentMessage").textContent = `Ready to upload ${formatStatus(documentType)} for Load ${loadId}.`;
  document.getElementById("documentMessage").style.color = "#075fa6";
}

async function uploadFile(filePath, file) {
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${filePath}`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true"
    }),
    body: file
  });

  if (!res.ok) throw new Error(await res.text());
}

async function insertDocumentRecord(documentRecord) {
  const res = await fetch(`${BASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(documentRecord)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

function renderFilteredDocuments() {
  const search = document.getElementById("documentSearch").value.trim().toLowerCase();
  const entityFilter = document.getElementById("entityFilter").value;

  const filtered = documents.filter(documentRow => {
    const matchesEntity = !entityFilter || documentRow.entity_type === entityFilter;
    const haystack = [
      documentRow.file_name,
      documentRow.document_type,
      documentRow.entity_type,
      documentRow.entity_id,
      documentRow.notes
    ].join(" ").toLowerCase();
    return matchesEntity && (!search || haystack.includes(search));
  });

  renderDocuments(filtered);
  updateKpis();
}

function renderDocuments(rows) {
  const tbody = document.getElementById("documentsTableBody");
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No documents found.</td></tr>`;
    updateKpis();
    return;
  }

  rows.forEach(documentRow => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(documentRow.file_name)}</strong>
        ${documentRow.notes ? `<span class="muted-line">${escapeHtml(documentRow.notes)}</span>` : ""}
      </td>
      <td>${formatStatus(documentRow.document_type)}</td>
      <td>${formatAttachedTo(documentRow)}</td>
      <td>${formatFileSize(documentRow.file_size)}</td>
      <td>${formatTimestamp(documentRow.created_at)}</td>
      <td>
        <button class="view" type="button" data-download-document="${escapeHtml(documentRow.id)}">Download</button>
        <button class="delete" type="button" data-delete-document="${escapeHtml(documentRow.id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-download-document]").forEach(button => {
    button.addEventListener("click", () => downloadDocument(button.dataset.downloadDocument));
  });

  tbody.querySelectorAll("[data-delete-document]").forEach(button => {
    button.addEventListener("click", () => deleteDocument(button.dataset.deleteDocument));
  });
}

function buildDocumentFileName(data, file) {
  const extension = getFileExtension(file.name);
  const documentType = normalizeDocumentType(data.document_type || "other").toUpperCase();
  const dateStamp = new Date().toISOString().slice(0, 10);

  if (data.entity_type === "load" && data.entity_id) {
    const load = findLoadById(data.entity_id);
    const loadLabel = sanitizeFileName(load?.load_number || `LD-${data.entity_id}`);
    return `${loadLabel}_${documentType}_${dateStamp}${extension}`;
  }

  const entityLabel = sanitizeFileName(data.entity_type || "GENERAL").toUpperCase();
  return `${entityLabel}_${documentType}_${dateStamp}${extension}`;
}

function buildDocumentNotes(notes, originalFileName, cleanFileName) {
  const parts = [];
  if (notes) parts.push(notes);
  if (originalFileName && originalFileName !== cleanFileName) {
    parts.push(`Original file: ${originalFileName}`);
  }
  return parts.length ? parts.join(" | ") : null;
}

function getFileExtension(fileName) {
  const match = String(fileName || "").match(/(\.[a-zA-Z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : "";
}

async function downloadDocument(documentId) {
  const documentRow = documents.find(row => String(row.id) === String(documentId));
  if (!documentRow) return;

  try {
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
    alert(getDocumentError(err.message));
  }
}

async function deleteDocument(documentId) {
  const documentRow = documents.find(row => String(row.id) === String(documentId));
  if (!documentRow || !confirm("Delete this document?")) return;

  try {
    await deleteStorageObject(documentRow.file_path);

    const res = await fetch(`${BASE_URL}/rest/v1/documents?id=eq.${documentId}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadDocuments();
  } catch (err) {
    console.error(err);
    alert(getDocumentError(err.message));
  }
}

async function deleteStorageObject(filePath) {
  const res = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}`, {
    method: "DELETE",
    headers: getHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [filePath] })
  });

  if (!res.ok) throw new Error(await res.text());
}

function updateKpis() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  document.getElementById("totalDocuments").textContent = documents.length;
  document.getElementById("loadDocuments").textContent = documents.filter(row => row.entity_type === "load").length;
  document.getElementById("complianceDocuments").textContent = documents.filter(row => ["cdl", "medical_card", "twic", "hazmat"].includes(row.document_type)).length;
  document.getElementById("recentDocuments").textContent = documents.filter(row => String(row.created_at || "").startsWith(thisMonth)).length;
}

function buildStoragePath(companyId, entityType, entityId, fileName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeEntity = sanitizePathPart(entityType || "general");
  const safeRecord = sanitizePathPart(entityId || "general");
  const safeName = sanitizeFileName(fileName || "document");
  return `${companyId}/${safeEntity}/${safeRecord}/${timestamp}-${safeName}`;
}

function sanitizePathPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "general";
}

function sanitizeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function formatAttachedTo(documentRow) {
  if (documentRow.entity_type === "load" && documentRow.entity_id) {
    const load = findLoadById(documentRow.entity_id);
    const label = load?.load_number || documentRow.entity_id;
    const lane = [load?.pickup_location, load?.delivery_location || load?.dropoff_location].filter(Boolean).join(" to ");
    return `Load ${escapeHtml(label)}${lane ? ` (${escapeHtml(lane)})` : ""}`;
  }

  const type = formatStatus(documentRow.entity_type || "general");
  return documentRow.entity_id ? `${type} #${escapeHtml(documentRow.entity_id)}` : type;
}

function findLoadById(loadId) {
  return documentLoads.find(load => String(load.id) === String(loadId)) || null;
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (status === "booked") return "available";
  if (status === "dispatched") return "assigned";
  if (status === "pod_received") return "delivered";
  return status;
}

function normalizeDocumentType(value) {
  const type = String(value || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (["rate_con", "ratecon", "rate_confirmation_pdf"].includes(type)) return "rate_confirmation";
  if (["proof_of_delivery", "signed_pod"].includes(type)) return "pod";
  if (["bill_of_lading", "bol_pdf"].includes(type)) return "bol";
  if (["invoice", "invoice_document"].includes(type)) return "invoice_backup";
  return type;
}

function formatDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "N/A";
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : "N/A";
}

function formatFileSize(bytes) {
  if (!bytes) return "N/A";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function getDocumentError(message) {
  if (message.includes("documents") || message.includes("company-documents") || message.includes("Bucket")) {
    return "Document storage is not ready. Run the document SQL in Supabase first, then reload this page.";
  }
  return message;
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

initDocuments();
