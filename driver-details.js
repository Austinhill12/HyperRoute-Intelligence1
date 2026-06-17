const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let currentDriver = null;

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

function getDriverId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function loadDriver() {
  const id = getDriverId();
  const messageTarget = document.getElementById("driverName");

  if (!id) {
    messageTarget.textContent = "No driver ID provided.";
    renderDocuments([]);
    return;
  }

  messageTarget.textContent = "Loading...";

  try {
    await window.CompanyContext?.ready();

    const res = await fetch(
      `${BASE_URL}/rest/v1/drivers?id=eq.${id}&select=*`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const [driver] = await res.json();

    if (!driver) {
      messageTarget.textContent = "Driver not found.";
      renderDocuments([]);
      return;
    }

    currentDriver = driver;
    renderDriver(driver);
    await loadDocuments(id);
  } catch (err) {
    console.error(err);
    messageTarget.textContent = "Error loading driver.";
    renderDocuments([]);
  }
}

function renderDriver(driver) {
  const name = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "Unnamed Driver";
  document.getElementById("driverName").textContent = name;
  document.getElementById("driverPhone").textContent = driver.phone || "N/A";
  document.getElementById("driverEmail").textContent = driver.email || "N/A";
  document.getElementById("driverLicense").textContent = driver.license_number || "N/A";
  document.getElementById("driverExpiration").textContent =
    driver.license_expiration ||
    driver.cdl_expiration ||
    driver.medical_card_expiration ||
    "N/A";
  document.getElementById("driverStatus").textContent = driver.status || "N/A";

  const photo = document.getElementById("driverPhoto");
  photo.src = driver.photo_url || "https://via.placeholder.com/150";
  photo.alt = `${name} photo`;

  const fileLink = document.getElementById("driverFile");
  const documentUrl = driver.file_url || driver.document_url;
  if (documentUrl) {
    fileLink.href = documentUrl;
    fileLink.textContent = "View File";
    fileLink.style.display = "";
  } else {
    fileLink.removeAttribute("href");
    fileLink.textContent = "No file uploaded";
  }
}

async function loadDocuments(driverId) {
  const tbody = document.getElementById("driverDocumentsTableBody");
  tbody.innerHTML = `<tr><td colspan="4">Loading documents...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("documents", `entity_type=eq.driver&entity_id=eq.${driverId}&select=*&order=created_at.desc`) ||
        `${BASE_URL}/rest/v1/documents?entity_type=eq.driver&entity_id=eq.${driverId}&select=*&order=created_at.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const documents = await res.json();
    renderDocuments(documents);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4">Error loading documents.</td></tr>`;
  }
}

function renderDocuments(documents) {
  const tbody = document.getElementById("driverDocumentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!documents.length) {
    tbody.innerHTML = `<tr><td colspan="4">No driver documents attached.</td></tr>`;
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
        <button class="view" type="button" data-open-document="${escapeHtml(documentRow.id)}">Open</button>
        <button class="delete" type="button" data-delete-document="${escapeHtml(documentRow.id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-open-document]").forEach(button => {
    button.addEventListener("click", () => openDriverDocument(button.dataset.openDocument));
  });

  tbody.querySelectorAll("[data-delete-document]").forEach(button => {
    button.addEventListener("click", () => deleteDriverDocument(button.dataset.deleteDocument));
  });
}

async function saveDriverDocument(event) {
  event.preventDefault();

  const driverId = getDriverId();
  const msg = document.getElementById("driverDocumentMessage");
  const form = event.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  const file = document.getElementById("documentFile").files[0];

  if (!driverId || !currentDriver) {
    msg.textContent = "Driver is not loaded yet.";
    msg.style.color = "#ef4444";
    return;
  }

  if (!file) {
    msg.textContent = "Upload a file before saving the document.";
    msg.style.color = "#ef4444";
    return;
  }

  msg.textContent = "Uploading document...";
  msg.style.color = "";

  try {
    const filePath = await uploadDriverDocumentFile(driverId, formData.document_type, file);
    const baseDocumentData = {
      entity_type: "driver",
      entity_id: String(driverId),
      document_type: formData.document_type,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      notes: formData.notes || null
    };
    const documentData = window.CompanyContext?.withCompanyId(baseDocumentData) || baseDocumentData;

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

    form.reset();
    msg.textContent = "Driver document saved.";
    msg.style.color = "#047857";
    await loadDocuments(driverId);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving document: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function uploadDriverDocumentFile(driverId, documentType, file) {
  const path = buildStoragePath(driverId, documentType, file.name);
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
      throw new Error("Document storage is not ready. Run the document SQL first, then try again.");
    }
    throw new Error(errorText);
  }

  return path;
}

function buildStoragePath(driverId, documentType, fileName) {
  const companyId = window.CompanyContext?.getCompanyId() || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeType = sanitizePathPart(documentType || "document");
  const safeName = sanitizeFileName(fileName || "document");
  return `${companyId}/driver/${driverId}/${safeType}/${timestamp}-${safeName}`;
}

async function openDriverDocument(documentId) {
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

async function deleteDriverDocument(documentId) {
  if (!confirm("Delete this document?")) return;

  const driverId = getDriverId();

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
    await loadDocuments(driverId);
  } catch (err) {
    console.error(err);
    alert(`Error deleting document: ${err.message}`);
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

function sanitizePathPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function sanitizeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : "N/A";
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

document.getElementById("driverDocumentForm").addEventListener("submit", saveDriverDocument);
loadDriver();
