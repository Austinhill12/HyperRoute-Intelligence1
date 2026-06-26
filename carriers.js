const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("carrierForm");
const msg = document.getElementById("carrierMessage");
const tbody = document.getElementById("carriersTableBody");
const cancelEditButton = document.getElementById("cancelEditCarrier");
const formTitle = document.getElementById("carrierFormTitle");
const saveButton = document.getElementById("saveCarrierButton");
const searchInput = document.getElementById("carrierSearch");
const statusFilter = document.getElementById("carrierStatusFilter");
const complianceFilter = document.getElementById("carrierComplianceFilter");
const fmcsaMessage = document.getElementById("carrierFmcsaMessage");

let carriers = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initCarriers() {
  await window.CompanyContext?.ready();
  bindEvents();
  await loadCarriers();
}

function bindEvents() {
  form.addEventListener("submit", saveCarrier);
  cancelEditButton?.addEventListener("click", resetForm);
  searchInput?.addEventListener("input", renderCarriers);
  statusFilter?.addEventListener("change", renderCarriers);
  complianceFilter?.addEventListener("change", renderCarriers);
}

async function saveCarrier(event) {
  event.preventDefault();
  msg.textContent = "Saving carrier...";
  msg.style.color = "";

  const data = normalizeCarrierData(Object.fromEntries(new FormData(form).entries()));
  const id = data.id;
  delete data.id;

  const method = id ? "PATCH" : "POST";
  const url = id
    ? `${BASE_URL}/rest/v1/carriers?id=eq.${encodeURIComponent(id)}`
    : `${BASE_URL}/rest/v1/carriers`;
  const payload = id ? data : (window.CompanyContext?.withCompanyId(data) || data);

  try {
    const res = await fetch(url, {
      method,
      headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    msg.textContent = id ? "Carrier updated." : "Carrier saved.";
    msg.style.color = "#047857";
    resetForm();
    await loadCarriers();
  } catch (err) {
    msg.textContent = err.message.includes("carriers")
      ? "Run carrier-management.sql in Supabase first, then try again."
      : `Error saving carrier: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function normalizeCarrierData(data) {
  Object.keys(data).forEach(key => {
    if (typeof data[key] === "string") data[key] = data[key].trim();
    if (data[key] === "") data[key] = null;
  });

  if (data.state) data.state = String(data.state).toUpperCase();
  if (data.insurance_limit) data.insurance_limit = Number(data.insurance_limit);
  return data;
}

async function loadCarriers() {
  tbody.innerHTML = `<tr><td colspan="9">Loading carriers...</td></tr>`;

  const url = window.CompanyContext?.scopedUrl("carriers", "select=*&order=carrier_name.asc") || `${BASE_URL}/rest/v1/carriers?select=*&order=carrier_name.asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">Run carrier-management.sql in Supabase first.</td></tr>`;
    return;
  }

  carriers = await res.json();
  renderCarriers();
}

function renderCarriers() {
  const filtered = getFilteredCarriers();
  updateKpis();

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9">No carriers found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(carrier => {
    const readiness = getCarrierReadiness(carrier);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(carrier.carrier_name)}</strong>
          <span class="muted-line">${escapeHtml([carrier.preferred_lanes, carrier.service_types].filter(Boolean).join(" • ") || carrier.notes || "")}</span>
        </td>
        <td>
          ${escapeHtml([carrier.mc_number && `MC ${carrier.mc_number}`, carrier.dot_number && `DOT ${carrier.dot_number}`].filter(Boolean).join(" / ") || "Missing")}
          <span class="muted-line">${escapeHtml(formatStatus(carrier.safety_rating || "not reviewed"))}</span>
        </td>
        <td>
          ${formatFmcsaStatus(carrier)}
          <span class="muted-line">${carrier.fmcsa_checked_at ? `Checked ${escapeHtml(formatDate(carrier.fmcsa_checked_at))}` : "Not checked"}</span>
        </td>
        <td>
          ${escapeHtml([carrier.contact_name, carrier.phone].filter(Boolean).join(" / ") || "N/A")}
          <span class="muted-line">${escapeHtml(carrier.email || "")}</span>
        </td>
        <td>
          ${formatInsurance(carrier)}
          <span class="muted-line">${escapeHtml([carrier.insurance_provider, carrier.insurance_policy_number].filter(Boolean).join(" / "))}</span>
        </td>
        <td>${formatW9(carrier)}</td>
        <td>
          ${escapeHtml(carrier.payment_terms || "N/A")}
          <span class="muted-line">${escapeHtml(carrier.factoring_company || "")}</span>
        </td>
        <td>
          <span class="status-pill ${readiness.className}">${escapeHtml(readiness.label)}</span>
          <span class="muted-line">${escapeHtml(readiness.reason)}</span>
        </td>
        <td>
          <button class="view secondary-action" type="button" data-fmcsa-carrier="${escapeHtml(carrier.id)}">Check FMCSA</button>
          <button class="view" type="button" data-edit-carrier="${escapeHtml(carrier.id)}">Edit</button>
          ${carrier.status === "blocked"
            ? `<button class="view secondary-action" type="button" data-status-carrier="${escapeHtml(carrier.id)}" data-status="active">Unblock</button>`
            : `<button class="delete" type="button" data-status-carrier="${escapeHtml(carrier.id)}" data-status="blocked">Block</button>`}
          ${carrier.status === "inactive"
            ? `<button class="view secondary-action" type="button" data-status-carrier="${escapeHtml(carrier.id)}" data-status="active">Restore</button>`
            : `<button class="view secondary-action" type="button" data-status-carrier="${escapeHtml(carrier.id)}" data-status="inactive">Archive</button>`}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-edit-carrier]").forEach(button => {
    button.addEventListener("click", () => editCarrier(button.dataset.editCarrier));
  });
  tbody.querySelectorAll("[data-fmcsa-carrier]").forEach(button => {
    button.addEventListener("click", () => checkFmcsaCarrier(button.dataset.fmcsaCarrier));
  });
  tbody.querySelectorAll("[data-status-carrier]").forEach(button => {
    button.addEventListener("click", () => updateCarrierStatus(button.dataset.statusCarrier, button.dataset.status));
  });
}

function getFilteredCarriers() {
  const search = (searchInput?.value || "").trim().toLowerCase();
  const status = statusFilter?.value || "";
  const compliance = complianceFilter?.value || "";

  return carriers.filter(carrier => {
    const readiness = getCarrierReadiness(carrier).key;
    const haystack = [
      carrier.carrier_name,
      carrier.mc_number,
      carrier.dot_number,
      carrier.contact_name,
      carrier.phone,
      carrier.email,
      carrier.preferred_lanes,
      carrier.service_types,
      carrier.notes
    ].join(" ").toLowerCase();

    return (!search || haystack.includes(search)) &&
      (!status || carrier.status === status) &&
      (!compliance || readiness === compliance);
  });
}

function updateKpis() {
  const readiness = carriers.map(getCarrierReadiness);
  setText("carrierTotal", carriers.length);
  setText("carrierReady", readiness.filter(item => item.key === "ready").length);
  setText("carrierReview", readiness.filter(item => item.key === "review").length);
  setText("carrierBlocked", readiness.filter(item => item.key === "blocked").length);
  setText("carrierFmcsaVerified", carriers.filter(item => normalizeStatus(item.fmcsa_verification_status) === "verified").length);
}

function editCarrier(id) {
  const carrier = carriers.find(item => String(item.id) === String(id));
  if (!carrier) return;

  Array.from(form.elements).forEach(input => {
    if (!input.name) return;
    input.value = carrier[input.name] ?? "";
  });

  formTitle.textContent = "Edit Carrier";
  saveButton.textContent = "Update Carrier";
  cancelEditButton.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  form.reset();
  document.getElementById("carrierId").value = "";
  formTitle.textContent = "Add Carrier";
  saveButton.textContent = "Save Carrier";
  cancelEditButton.classList.add("hidden");
}

async function updateCarrierStatus(id, status) {
  const label = status === "blocked" ? "block" : status === "inactive" ? "archive" : "restore";
  if (!confirm(`Are you sure you want to ${label} this carrier?`)) return;

  const payload = {
    status,
    archived_at: status === "inactive" ? new Date().toISOString() : null
  };

  const res = await fetch(`${BASE_URL}/rest/v1/carriers?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    alert(`Error updating carrier: ${await res.text()}`);
    return;
  }

  await loadCarriers();
}

async function checkFmcsaCarrier(id) {
  const carrier = carriers.find(item => String(item.id) === String(id));
  if (!carrier) return;

  if (!carrier.dot_number && !carrier.mc_number) {
    alert("Add a DOT number or MC number before recording an FMCSA verification check.");
    return;
  }

  setFmcsaMessage(`Checking ${carrier.carrier_name || "carrier"}...`, "");
  const snapshot = buildFmcsaSnapshot(carrier);
  const checkedAt = new Date().toISOString();

  try {
    const checkPayload = window.CompanyContext?.withCompanyId({
      carrier_id: carrier.id,
      dot_number: carrier.dot_number || null,
      mc_number: carrier.mc_number || null,
      verification_status: snapshot.verification_status,
      operating_status: snapshot.operating_status,
      authority_status: snapshot.authority_status,
      safety_rating: snapshot.safety_rating,
      source: "profile_review",
      notes: snapshot.notes,
      raw_response: snapshot
    }) || {};

    const logRes = await fetch(`${BASE_URL}/rest/v1/fmcsa_carrier_checks`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(checkPayload)
    });

    if (!logRes.ok) {
      const error = await logRes.text();
      throw new Error(error.includes("fmcsa_carrier_checks")
        ? "Run fmcsa-carrier-verification.sql in Supabase first."
        : error);
    }

    const carrierPatch = {
      fmcsa_verification_status: snapshot.verification_status,
      fmcsa_checked_at: checkedAt,
      fmcsa_operating_status: snapshot.operating_status,
      fmcsa_authority_status: snapshot.authority_status,
      fmcsa_safety_rating: snapshot.safety_rating,
      fmcsa_snapshot: snapshot
    };

    const patchRes = await fetch(`${BASE_URL}/rest/v1/carriers?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(carrierPatch)
    });

    if (!patchRes.ok) throw new Error(await patchRes.text());

    setFmcsaMessage("FMCSA verification recorded.", "#047857");
    await loadCarriers();
  } catch (err) {
    setFmcsaMessage(`FMCSA check failed: ${err.message}`, "#ef4444");
  }
}

function buildFmcsaSnapshot(carrier) {
  const status = normalizeStatus(carrier.status);
  const safety = normalizeStatus(carrier.safety_rating);
  let verificationStatus = "verified";
  let operatingStatus = "Active";
  let authorityStatus = "Active";
  let notes = "Profile-based FMCSA readiness recorded. Connect the live FMCSA API through a Supabase Edge Function for automatic authority lookup.";

  if (status === "blocked") {
    verificationStatus = "blocked";
    operatingStatus = "Do Not Use";
    authorityStatus = "Blocked internally";
    notes = "Carrier is blocked internally.";
  } else if (status === "inactive") {
    verificationStatus = "inactive";
    operatingStatus = "Inactive";
    authorityStatus = "Inactive internally";
    notes = "Carrier is archived or inactive internally.";
  } else if (safety === "unsatisfactory") {
    verificationStatus = "blocked";
    operatingStatus = "Do Not Use";
    authorityStatus = "Needs authority review";
    notes = "Carrier has an unsatisfactory safety rating.";
  } else if (safety === "conditional" || !safety) {
    verificationStatus = "needs_review";
    operatingStatus = "Needs Review";
    authorityStatus = "Review required";
    notes = safety === "conditional"
      ? "Carrier has a conditional safety rating."
      : "Safety rating has not been reviewed.";
  }

  return {
    checked_at: new Date().toISOString(),
    carrier_name: carrier.carrier_name || null,
    dot_number: carrier.dot_number || null,
    mc_number: carrier.mc_number || null,
    verification_status: verificationStatus,
    operating_status: operatingStatus,
    authority_status: authorityStatus,
    safety_rating: carrier.safety_rating || "not_reviewed",
    notes
  };
}

function getCarrierReadiness(carrier) {
  if (carrier.status === "blocked") return { key: "blocked", label: "Blocked", className: "warning", reason: "Carrier is blocked." };
  if (carrier.status === "inactive") return { key: "blocked", label: "Inactive", className: "caution", reason: "Carrier is archived." };
  const fmcsaStatus = normalizeStatus(carrier.fmcsa_verification_status);
  if (["blocked", "out_of_service", "inactive"].includes(fmcsaStatus)) return { key: "blocked", label: "Do Not Tender", className: "warning", reason: "FMCSA status blocks tendering." };
  if (fmcsaStatus === "needs_review") return { key: "review", label: "Review", className: "caution", reason: "FMCSA verification needs review." };
  if ((carrier.mc_number || carrier.dot_number) && (!carrier.fmcsa_checked_at || fmcsaStatus === "not_checked")) return { key: "review", label: "Review", className: "caution", reason: "FMCSA verification needed." };
  if (carrier.safety_rating === "unsatisfactory") return { key: "blocked", label: "Blocked", className: "warning", reason: "Unsatisfactory safety rating." };
  if (!carrier.mc_number && !carrier.dot_number) return { key: "review", label: "Review", className: "caution", reason: "Missing MC/DOT authority." };
  if (isInsuranceExpired(carrier.insurance_expiration)) return { key: "blocked", label: "Do Not Tender", className: "warning", reason: "Insurance expired." };
  if (!carrier.insurance_expiration) return { key: "review", label: "Review", className: "caution", reason: "Missing insurance expiration." };
  if ((carrier.w9_status || "missing") === "missing") return { key: "review", label: "Review", className: "caution", reason: "Missing W-9." };
  if (!carrier.last_reviewed_at) return { key: "review", label: "Review", className: "caution", reason: "Carrier packet not reviewed." };
  return { key: "ready", label: "Ready", className: "success", reason: "Ready for tendering." };
}

function formatInsurance(carrier) {
  const date = parseDate(carrier.insurance_expiration);
  if (!date) return `<span class="status-pill warning">Missing</span>`;
  const today = startOfDay(new Date());
  const days = Math.ceil((date - today) / 86400000);
  const limit = carrier.insurance_limit ? ` • ${formatCurrency(carrier.insurance_limit)}` : "";
  if (days < 0) return `<span class="status-pill warning">Expired ${formatDate(carrier.insurance_expiration)}</span>`;
  if (days <= 30) return `<span class="status-pill caution">Expires ${formatDate(carrier.insurance_expiration)}</span>${escapeHtml(limit)}`;
  return `<span class="status-pill success">${formatDate(carrier.insurance_expiration)}</span>${escapeHtml(limit)}`;
}

function formatW9(carrier) {
  const status = carrier.w9_status || "missing";
  const label = formatStatus(status);
  const pillClass = status === "missing" ? "warning" : status === "received" ? "caution" : "success";
  const pill = `<span class="status-pill ${pillClass}">${escapeHtml(label)}</span>`;
  return carrier.document_url
    ? `${pill} <a class="view secondary-action" href="${escapeHtml(carrier.document_url)}" target="_blank" rel="noopener">Packet</a>`
    : pill;
}

function formatFmcsaStatus(carrier) {
  const status = normalizeStatus(carrier.fmcsa_verification_status || "not_checked");
  const labels = {
    verified: "Verified",
    needs_review: "Needs Review",
    blocked: "Do Not Use",
    inactive: "Inactive",
    out_of_service: "Out Of Service",
    not_checked: "Not Checked"
  };
  const className = status === "verified" ? "success" : ["blocked", "inactive", "out_of_service"].includes(status) ? "warning" : "caution";
  return `<span class="status-pill ${className}">${escapeHtml(labels[status] || formatStatus(status))}</span>`;
}

function isInsuranceExpired(value) {
  const date = parseDate(value);
  return Boolean(date && date < startOfDay(new Date()));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDate(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function setFmcsaMessage(text, color) {
  if (!fmcsaMessage) return;
  fmcsaMessage.textContent = text;
  fmcsaMessage.style.color = color || "";
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

initCarriers();
