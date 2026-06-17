const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let documents = [];

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

  const res = await fetch(
    window.CompanyContext.scopedUrl("documents", "select=*&order=created_at.desc"),
    { headers: getHeaders() }
  );

  if (!res.ok) throw new Error(await res.text());
  documents = await res.json();
  renderFilteredDocuments();
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
    const filePath = buildStoragePath(companyId, data.entity_type, data.entity_id, file.name);
    await uploadFile(filePath, file);

    const documentRecord = window.CompanyContext.withCompanyId({
      entity_type: data.entity_type,
      entity_id: data.entity_id || null,
      document_type: data.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: data.notes || null
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
  const type = formatStatus(documentRow.entity_type || "general");
  return documentRow.entity_id ? `${type} #${escapeHtml(documentRow.entity_id)}` : type;
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
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
