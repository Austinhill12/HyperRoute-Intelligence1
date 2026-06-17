import { supabase } from "./supabaseClient.js";

const msg = document.getElementById("activityMessage");
const tbody = document.getElementById("activityTableBody");
const actionFilter = document.getElementById("activityActionFilter");
const entityFilter = document.getElementById("activityEntityFilter");

async function initActivity() {
  msg.textContent = "Loading activity...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    msg.textContent = "Redirecting to login...";
    msg.style.color = "#ef4444";
    window.location.href = "login.html?next=activity.html";
    return;
  }

  await window.CompanyContext?.ready();
  const company = window.CompanyContext?.getCompany();
  document.getElementById("activityCompanyName").textContent =
    `${company?.company_name || "Selected company"} activity history`;

  await loadActivity();
}

async function loadActivity() {
  const companyId = window.CompanyContext?.getCompanyId();
  const isPlatformAdmin = window.CompanyContext?.isPlatformAdmin();
  let query = supabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!isPlatformAdmin && companyId) {
    query = query.eq("company_id", companyId);
  }

  if (actionFilter.value) query = query.eq("action", actionFilter.value);
  if (entityFilter.value) query = query.eq("entity_type", entityFilter.value);

  const { data, error } = await query;

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run activity-logs.sql in Supabase first, then reload this page."
      : error.message;
    msg.style.color = "#ef4444";
    renderActivity([]);
    return;
  }

  renderActivity(data || []);
  msg.textContent = "";
}

function renderActivity(rows) {
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No activity found.</td></tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(row.created_at)}</td>
      <td>${formatStatus(row.action)}</td>
      <td>${formatStatus(row.entity_type)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>
        ${escapeHtml(row.actor_role || "N/A")}
        <span class="muted-line">${escapeHtml(row.actor_user_id || "")}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "N/A";
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
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

actionFilter.addEventListener("change", loadActivity);
entityFilter.addEventListener("change", loadActivity);
document.getElementById("refreshActivityBtn").addEventListener("click", loadActivity);

initActivity().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading activity.";
  msg.style.color = "#ef4444";
});
