import { supabase } from "./supabaseClient.js";

const messageEl = document.getElementById("integrationsMessage");
const tableBody = document.getElementById("integrationsTableBody");
const eventsBody = document.getElementById("integrationEventsBody");
const providerGrid = document.getElementById("providerGrid");
const providerSelect = document.getElementById("provider");
const form = document.getElementById("integrationForm");

const defaultProviders = [
  {
    provider_key: "fmcsa",
    display_name: "FMCSA Carrier Verification",
    category: "compliance",
    description: "Authority, safety rating, DOT/MC status, and carrier risk checks.",
    setup_status: "ready",
    recommended_order: 1
  },
  {
    provider_key: "here_truck_routing",
    display_name: "HERE Truck Routing",
    category: "routing",
    description: "Truck-legal route, ETA, distance, tolls, and restrictions.",
    setup_status: "planned",
    recommended_order: 2
  },
  {
    provider_key: "trimble_maps",
    display_name: "PC*Miler / Trimble Maps",
    category: "routing",
    description: "Commercial routing, mileage, tolls, and truck restrictions.",
    setup_status: "planned",
    recommended_order: 3
  },
  {
    provider_key: "fuel_optimization",
    display_name: "Fuel Optimization",
    category: "fuel",
    description: "Fuel price, discounts, distance from route, and recommended stops.",
    setup_status: "planned",
    recommended_order: 4
  },
  {
    provider_key: "samsara",
    display_name: "Samsara",
    category: "telematics",
    description: "GPS, HOS, driver status, vehicle health, and fault codes.",
    setup_status: "planned",
    recommended_order: 5
  },
  {
    provider_key: "motive",
    display_name: "Motive",
    category: "telematics",
    description: "ELD, live GPS, driver hours, vehicle diagnostics, and safety data.",
    setup_status: "planned",
    recommended_order: 6
  },
  {
    provider_key: "dat",
    display_name: "DAT Load Board",
    category: "load_board",
    description: "Load opportunities, market rates, broker details, and lane intelligence.",
    setup_status: "planned",
    recommended_order: 7
  },
  {
    provider_key: "weather_risk",
    display_name: "Weather & Route Risk",
    category: "weather",
    description: "Storm, wind, road closure, and route risk warnings.",
    setup_status: "planned",
    recommended_order: 8
  }
];

let providers = [];
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
  providerSelect?.addEventListener("change", applySelectedProviderDefaults);
  document.getElementById("refreshIntegrationsBtn")?.addEventListener("click", loadIntegrationData);
}

async function loadIntegrationData() {
  const companyId = window.CompanyContext?.getCompanyId?.();
  if (!companyId && !window.CompanyContext?.isPlatformAdmin?.()) {
    setMessage("No company selected. Select or create a company first.", true);
    renderProviders(defaultProviders);
    renderConnections([]);
    renderEvents([]);
    return;
  }

  const providersQuery = supabase
    .from("integration_providers")
    .select("*")
    .order("recommended_order", { ascending: true });

  const connectionsQuery = buildCompanyQuery(
    supabase.from("company_integrations").select("*").order("created_at", { ascending: false })
  );
  const legacyConnectionsQuery = buildCompanyQuery(
    supabase.from("api_connections").select("*").order("created_at", { ascending: false })
  );
  const eventsQuery = buildCompanyQuery(
    supabase.from("integration_events").select("*").order("created_at", { ascending: false }).limit(30)
  );

  const [providersResult, connectionsResult, legacyConnectionsResult, eventsResult] = await Promise.all([
    providersQuery,
    connectionsQuery,
    legacyConnectionsQuery,
    eventsQuery
  ]);

  if (providersResult.error && providersResult.error.code !== "42P01") {
    setMessage(providersResult.error.message, true);
  }

  if (connectionsResult.error && connectionsResult.error.code !== "42P01") {
    setMessage(connectionsResult.error.message, true);
  }

  if (eventsResult.error && eventsResult.error.code !== "42P01") {
    setMessage(eventsResult.error.message, true);
  }

  providers = providersResult.data?.length ? providersResult.data : defaultProviders;
  connections = connectionsResult.data || legacyConnectionsResult.data || [];
  events = eventsResult.data || [];

  if (providersResult.error?.code === "42P01" || connectionsResult.error?.code === "42P01") {
    setMessage("Run integrations-foundation.sql in Supabase to enable the full Integration Hub.", true);
  } else {
    setMessage("");
  }

  renderProviders(providers);
  renderConnections(connections);
  renderEvents(events);
  renderKpis();
}

function buildCompanyQuery(query) {
  if (!window.CompanyContext?.isPlatformAdmin?.()) {
    const companyId = window.CompanyContext?.getCompanyId?.();
    return query.eq("company_id", companyId);
  }
  return query;
}

function renderProviders(rows) {
  populateProviderSelect(rows);

  providerGrid.innerHTML = rows.map(provider => {
    const connected = connections.some(row => row.provider === provider.provider_key && row.status === "connected");
    const registered = connections.some(row => row.provider === provider.provider_key);
    const status = connected ? "connected" : registered ? "registered" : provider.setup_status || "planned";
    return `
      <article class="integration-provider-card">
        <div>
          <span class="status-pill ${statusClass(status)}">${escapeHtml(formatStatus(status))}</span>
          <h3>${escapeHtml(provider.display_name)}</h3>
          <p>${escapeHtml(provider.description || categoryDescription(provider.category))}</p>
        </div>
        <div class="integration-provider-meta">
          <span>${escapeHtml(formatStatus(provider.category))}</span>
          <button class="view secondary-action" type="button" data-provider="${escapeHtml(provider.provider_key)}">Use</button>
        </div>
      </article>
    `;
  }).join("");

  providerGrid.querySelectorAll("button[data-provider]").forEach(button => {
    button.addEventListener("click", () => {
      providerSelect.value = button.dataset.provider;
      applySelectedProviderDefaults();
      form?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

function populateProviderSelect(rows) {
  if (!providerSelect) return;
  providerSelect.innerHTML = rows.map(provider => (
    `<option value="${escapeHtml(provider.provider_key)}">${escapeHtml(provider.display_name)}</option>`
  )).join("");
  applySelectedProviderDefaults();
}

function applySelectedProviderDefaults() {
  const provider = providers.find(row => row.provider_key === providerSelect?.value);
  if (!provider) return;
  const displayName = document.getElementById("displayName");
  if (displayName && !displayName.value) displayName.value = provider.display_name;
}

async function saveIntegration(event) {
  event.preventDefault();
  const companyId = window.CompanyContext?.getCompanyId?.();
  if (!companyId) {
    setMessage("No active company selected. Select a company before saving integrations.", true);
    return;
  }

  const provider = providers.find(row => row.provider_key === getValue("provider")) || {};
  const payload = {
    company_id: companyId,
    provider: getValue("provider"),
    display_name: getValue("displayName") || provider.display_name || getValue("provider"),
    category: provider.category || "custom",
    status: provider.setup_status === "ready" ? "ready_to_connect" : "not_connected",
    sync_direction: getValue("syncDirection"),
    environment: getValue("environment") || "production",
    base_url: getValue("baseUrl") || null,
    external_account_id: getValue("externalAccountId") || null,
    notes: getValue("notes") || null,
    metadata: {
      provider_description: provider.description || null,
      recommended_order: provider.recommended_order || null
    }
  };

  setMessage("Saving integration...");
  const { data, error } = await supabase
    .from("company_integrations")
    .insert(payload)
    .select()
    .single();

  if (error) {
    setMessage(error.code === "42P01" ? "Run integrations-foundation.sql in Supabase first." : error.message, true);
    return;
  }

  await logIntegrationEvent({
    integration_id: data.id,
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
  const connection = connections.find(row => String(row.id) === String(id));
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
    updates.last_error = "Manual review needed before sync.";
  }

  const { error } = await supabase
    .from("company_integrations")
    .update(updates)
    .eq("id", id);

  if (error) {
    setMessage(error.message, true);
    return;
  }

  await logIntegrationEvent({
    integration_id: id,
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
      <td class="table-actions">
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

  setText("connectedCount", connected);
  setText("attentionCount", attention);
  setText("readyProviderCount", providers.length);
  setText("eventCount", events.length);
}

function statusClass(status = "") {
  const normalized = String(status).toLowerCase();
  if (["connected", "success", "ready", "active"].includes(normalized)) return "success";
  if (["registered", "ready_to_connect", "planned", "not_connected", "info"].includes(normalized)) return "caution";
  if (["needs_attention", "warning", "disabled"].includes(normalized)) return "warning";
  if (["error", "failed"].includes(normalized)) return "danger";
  return "neutral";
}

function formatProvider(value = "") {
  const match = providers.find(row => row.provider_key === value);
  if (match) return match.display_name;
  return formatStatus(value);
}

function categoryDescription(category = "") {
  const descriptions = {
    routing: "Truck-legal route, ETA, mileage, tolls, and restrictions.",
    fuel: "Fuel prices, discounts, route distance, and recommended stops.",
    telematics: "GPS, driver status, HOS, vehicle health, and engine alerts.",
    load_board: "Load opportunities, rates, broker details, and lane intelligence.",
    weather: "Weather warnings, road risks, and route disruption alerts.",
    diagnostics: "Fault codes, repair recommendations, and maintenance alerts.",
    compliance: "Authority, safety, HOS, violations, and compliance warnings."
  };
  return descriptions[category] || "External system connection for company operations.";
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
