const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let currentVehicle = null;

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

function getVehicleId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("truck_id");
}

async function loadVehicleDetails() {
  const id = getVehicleId();
  if (!id) {
    document.getElementById("vehicleTitle").textContent = "No vehicle ID provided.";
    renderDocuments([]);
    return;
  }

  try {
    await window.CompanyContext?.ready();

    const res = await fetch(
      `${BASE_URL}/rest/v1/trucks?id=eq.${id}&select=*`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const [truck] = await res.json();

    if (!truck) {
      document.querySelector("main").innerHTML = "<p class='message'>Truck not found.</p>";
      return;
    }

    currentVehicle = truck;
    document.getElementById("vehicleTitle").textContent = truck.truck_number || "Truck Details";
    document.getElementById("truckNumber").textContent = truck.truck_number || "N/A";
    document.getElementById("vehicleVin").textContent = truck.vin || "N/A";

    await Promise.all([
      loadMaintenanceForVehicle(id),
      loadAssignment(id),
      loadDocuments(id)
    ]);
  } catch (err) {
    console.error(err);
    document.querySelector("main").innerHTML =
      "<p class='message' style='color:#ef4444;'>Error loading truck.</p>";
  }
}

async function loadMaintenanceForVehicle(truckId) {
  const tableBody = document.getElementById("maintenanceHistory");

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("maintenance_logs", `truck_id=eq.${truckId}&select=*&order=created_at.desc`) ||
        `${BASE_URL}/rest/v1/maintenance_logs?truck_id=eq.${truckId}&select=*&order=created_at.desc`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const records = await res.json();

    if (!records.length) {
      tableBody.innerHTML = `<tr><td colspan="4">No maintenance records found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = "";
    records.forEach(record => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(record.maintenance_type || "-")}</td>
        <td>${record.created_at ? new Date(record.created_at).toLocaleDateString() : "-"}</td>
        <td>${record.mileage || "-"}</td>
        <td>${escapeHtml(record.notes || "-")}</td>
      `;
      tableBody.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    tableBody.innerHTML =
      `<tr><td colspan="4" style="color:#ef4444;">Error loading maintenance.</td></tr>`;
  }
}

async function loadAssignment(truckId) {
  const assignedDriverName = document.getElementById("assignedDriverName");
  const assignedStartDate = document.getElementById("assignedStartDate");

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("assignments", `truck_id=eq.${truckId}&status=eq.active&select=*,drivers(*)`) ||
        `${BASE_URL}/rest/v1/assignments?truck_id=eq.${truckId}&status=eq.active&select=*,drivers(*)`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const [assignment] = await res.json();

    if (!assignment) {
      assignedDriverName.textContent = "Unassigned";
      assignedStartDate.textContent = "";
      return;
    }

    const driver = assignment.drivers;
    assignedDriverName.textContent = driver
      ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim()
      : `Driver ${assignment.driver_id}`;
    assignedStartDate.textContent = assignment.created_at
      ? new Date(assignment.created_at).toLocaleDateString()
      : "";
  } catch (err) {
    console.error(err);
    assignedDriverName.textContent = "Error loading assignment";
    assignedStartDate.textContent = "";
  }
}

async function loadDocuments(vehicleId) {
  const tbody = document.getElementById("vehicleDocumentsTableBody");
  tbody.innerHTML = `<tr><td colspan="4">Loading documents...</td></tr>`;

  try {
    const res = await fetch(
      window.CompanyContext?.scopedUrl("documents", `entity_type=eq.truck&entity_id=eq.${vehicleId}&select=*&order=created_at.desc`) ||
        `${BASE_URL}/rest/v1/documents?entity_type=eq.truck&entity_id=eq.${vehicleId}&select=*&order=created_at.desc`,
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
  const tbody = document.getElementById("vehicleDocumentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!documents.length) {
    tbody.innerHTML = `<tr><td colspan="4">No vehicle documents attached.</td></tr>`;
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
    button.addEventListener("click", () => openVehicleDocument(button.dataset.openDocument));
  });

  tbody.querySelectorAll("[data-delete-document]").forEach(button => {
    button.addEventListener("click", () => deleteVehicleDocument(button.dataset.deleteDocument));
  });
}

async function saveVehicleDocument(event) {
  event.preventDefault();

  const vehicleId = getVehicleId();
  const msg = document.getElementById("vehicleDocumentMessage");
  const form = event.target;
  const formData = Object.fromEntries(new FormData(form).entries());
  const file = document.getElementById("documentFile").files[0];

  if (!vehicleId || !currentVehicle) {
    msg.textContent = "Vehicle is not loaded yet.";
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
    const filePath = await uploadVehicleDocumentFile(vehicleId, formData.document_type, file);
    const baseDocumentData = {
      entity_type: "truck",
      entity_id: String(vehicleId),
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
    msg.textContent = "Vehicle document saved.";
    msg.style.color = "#047857";
    await loadDocuments(vehicleId);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving document: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function uploadVehicleDocumentFile(vehicleId, documentType, file) {
  const path = buildStoragePath(vehicleId, documentType, file.name);
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

function buildStoragePath(vehicleId, documentType, fileName) {
  const companyId = window.CompanyContext?.getCompanyId() || "company";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeType = sanitizePathPart(documentType || "document");
  const safeName = sanitizeFileName(fileName || "document");
  return `${companyId}/truck/${vehicleId}/${safeType}/${timestamp}-${safeName}`;
}

async function openVehicleDocument(documentId) {
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

async function deleteVehicleDocument(documentId) {
  if (!confirm("Delete this document?")) return;

  const vehicleId = getVehicleId();

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
    await loadDocuments(vehicleId);
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

document.getElementById("vehicleDocumentForm").addEventListener("submit", saveVehicleDocument);
loadVehicleDetails();
