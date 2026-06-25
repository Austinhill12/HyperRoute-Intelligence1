import { supabase } from "./supabaseClient.js";

const messageEl = document.getElementById("integrationsMessage");
const tableBody = document.getElementById("integrationsTableBody");
const eventsBody = document.getElementById("integrationEventsBody");
const form = document.getElementById("integrationForm");

let connections = [];
let events = [];

document.addEventListener("DOMContentLoaded", initIntegrations);

async function initIntegrations() {
  setMessage("Loading integrations...");

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html?next=integrations.html";
    return;
  }

  await window.CompanyContext?.ready();
  const company = window.CompanyContext?.getCompany?.();
  document.getElementById("integrationsCompanyName").textContent =
    window.CompanyContext?.isPlatformAdmin?.()
      ? "Platform integration visibility across customer companies."
      : `${company?.company_name || "Selected company"} integration center.`;

  bindEvents();
  await loadIntegrationData();
}

function bindEvents() {
  form?.addEventListener("submit", saveIntegration);
  document.getElementById("refreshIntegrationsBtn")?.addEventListener("click", loadIntegrationData);
}

async function loadIntegrationData() {
  const companyId = window.CompanyContext?.getCompanyId?.();
  if (!companyId && !window.CompanyContext?.isPlatformAdmin?.()) {
    setMessage("No company selected. Select or create a company first.", true);
    renderConnections([]);
    renderEvents([]);
    return;
  }

  const connectionsQuery = buildCompanyQuery(
    supabase.from("api_connections").select("*").order("created_at", { ascending: false })
  );
  const eventsQuery = buildCompanyQuery(
    supabase.from("integration_events").select("*").order("created_at", { ascending: false }).limit(30)
  );

  const [connectionsResult, eventsResult] = await Promise.all([connectionsQuery, eventsQuery]);

  if (connectionsResult.error || eventsResult.error) {
    const error = connectionsResult.error || eventsResult.error;
    setMessage(
      error.code === "42P01"
        ? "Run integrations-foundation.sql in Supabase first, then reload this page."
        : error.message,
      true
    );
    connections = [];
    events = [];
    renderConnections(connections);
    renderEvents(events);
    renderKpis();
    return;
  }

  connections = connectionsResult.data || [];
  events = eventsResult.data || [];
  renderConnections(connections);
  renderEvents(events);
  renderKpis();
  setMessage("");
}

function buildCompanyQuery(query) {
  if (!window.CompanyContext?.isPlatformAdmin?.()) {
    const companyId = window.CompanyContext?.getCompanyId?.();
    return query.eq("company_id", companyId);
  }
  return query;
}

async function saveIntegration(event) {
  event.preventDefault();
  const companyId = window.CompanyContext?.getCompanyId?.();
  if (!companyId) {
    setMessage("No active company selected. Select a company before saving integrations.", true);
    return;
  }

  const payload = {
    company_id: companyId,
    provider: getValue("provider"),
    display_name: getValue("displayName"),
    category: getValue("category"),
    sync_direction: getValue("syncDirection"),
    base_url: getValue("baseUrl") || null,
    external_account_id: getValue("externalAccountId") || null,
    notes: getValue("notes") || null,
    status: "not_connected"
  };

  setMessage("Saving integration...");
  const { data, error } = await supabase
    .from("api_connections")
    .insert(payload)
    .select()
    .single();

  if (error) {
    setMessage(error.message, true);
    return;
  }

  await logIntegrationEvent({
    connection_id: data.id,
    company_id: companyId,
    provider: payload.provider,
    event_type: "created",
    status: "info",
    direction: payload.sync_direction,
    message: `${payload.display_name} was registered.`
  });

  form.reset();
  setMessage("Integration saved.");
  await loadIntegrationData();
}

async function updateIntegrationStatus(id, status) {
  const connection = connections.find(row => row.id === id);
  if (!connection) return;

  const updates = {
    status,
    updated_at: new Date().toISOString()
  };

  if (status === "connected") {
    updates.last_sync_at = new Date().toISOString();
    updates.last_error = null;
  }

  if (status === "needs_attention") {
    updates.last_error = "Manual review needed.";
  }

  const { error } = await supabase
    .from("api_connections")
    .update(updates)
    .eq("id", id);

  if (error) {
    setMessage(error.message, true);
    return;
  }

  await logIntegrationEvent({
    connection_id: id,
    company_id: connection.company_id,
    provider: connection.provider,
    event_type: "status_change",
    status: status === "needs_attention" ? "warning" : "success",
    direction: connection.sync_direction,
    message: `${connection.display_name} marked ${formatStatus(status)}.`
  });

  setMessage(`${connection.display_name} updated.`);
  await loadIntegrationData();
}

async function logIntegrationEvent(payload) {
  const { error } = await supabase.from("integration_events").insert(payload);
  if (error) console.warn("Integration event log skipped:", error.message);
}

function renderConnections(rows) {
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="7">No integrations registered yet.</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.display_name)}</strong>${row.last_error ? `<br><small class="danger-text">${escapeHtml(row.last_error)}</small>` : ""}</td>
      <td>${escapeHtml(formatProvider(row.provider))}</td>
      <td>${escapeHtml(formatStatus(row.category))}</td>
      <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(formatStatus(row.status))}</span></td>
      <td>${escapeHtml(formatStatus(row.sync_direction))}</td>
      <td>${formatDate(row.last_sync_at)}</td>
      <td>
        <button class="view" type="button" data-action="connected" data-id="${row.id}">Connected</button>
        <button class="edit" type="button" data-action="needs_attention" data-id="${row.id}">Review</button>
        <button class="delete" type="button" data-action="disabled" data-id="${row.id}">Disable</button>
      </td>
    </tr>
  `).join("");

  tableBody.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", () => updateIntegrationStatus(button.dataset.id, button.dataset.action));
  });
}

function renderEvents(rows) {
  if (!rows.length) {
    eventsBody.innerHTML = `<tr><td colspan="5">No webhook or sync events yet.</td></tr>`;
    return;
  }

  eventsBody.innerHTML = rows.map(row => `
    <tr>
      <td>${formatDate(row.created_at)}</td>
      <td>${escapeHtml(formatProvider(row.provider || "custom"))}</td>
      <td>${escapeHtml(formatStatus(row.event_type))}</td>
      <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(formatStatus(row.status))}</span></td>
      <td>${escapeHtml(row.message || "No message")}</td>
    </tr>
  `).join("");
}

function renderKpis() {
  const connected = connections.filter(row => row.status === "connected").length;
  const attention = connections.filter(row => ["needs_attention", "error", "disabled"].includes(row.status)).length;
  const syncDates = connections
    .map(row => row.last_sync_at)
    .filter(Boolean)
    .sort()
    .reverse();

  setText("connectedCount", connected);
  setText("attentionCount", attention);
  setText("lastSyncValue", syncDates[0] ? formatDate(syncDates[0]) : "None");
  setText("eventCount", events.length);
}

function statusClass(status = "") {
  const normalized = String(status).toLowerCase();
  if (["connected", "success"].includes(normalized)) return "success";
  if (["needs_attention", "warning", "disabled"].includes(normalized)) return "warning";
  if (["error", "failed"].includes(normalized)) return "danger";
  return "neutral";
}

function formatProvider(value = "") {
  const labels = {
    quickbooks: "QuickBooks",
    stripe: "Stripe",
    motive: "Motive",
    samsara: "Samsara",
    geotab: "Geotab",
    fuel_card: "Fuel Card",
    dat: "DAT",
    truckstop: "Truckstop",
    twilio: "Twilio",
    email: "Email",
    custom_api: "Custom API",
    webhook: "Webhook"
  };
  return labels[value] || formatStatus(value);
}

function formatStatus(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#ef4444" : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
