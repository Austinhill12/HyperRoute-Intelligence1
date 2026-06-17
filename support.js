import { supabase } from "./supabaseClient.js";

const msg = document.getElementById("supportMessage");
const tbody = document.getElementById("supportTicketsTableBody");
const form = document.getElementById("supportTicketForm");
const statusFilter = document.getElementById("supportStatusFilter");
const priorityFilter = document.getElementById("supportPriorityFilter");
const conversationPanel = document.getElementById("supportConversationPanel");
const conversationTitle = document.getElementById("supportConversationTitle");
const conversationMessages = document.getElementById("supportConversationMessages");
const replyForm = document.getElementById("supportReplyForm");
const replyMessage = document.getElementById("supportReplyMessage");

let tickets = [];
let selectedTicket = null;

async function initSupport() {
  msg.textContent = "Loading support tickets...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    msg.textContent = "Redirecting to login...";
    msg.style.color = "#ef4444";
    window.location.href = "login.html?next=support.html";
    return;
  }

  await window.CompanyContext?.ready();
  const company = window.CompanyContext?.getCompany();
  const companyId = window.CompanyContext?.getCompanyId();
  document.getElementById("supportCompanyName").textContent =
    `${company?.company_name || "Selected company"} support requests`;

  if (!companyId) {
    msg.textContent = "No company selected. Create or select a company first.";
    msg.style.color = "#ef4444";
    renderTickets([]);
    return;
  }

  bindEvents();
  await loadTickets();
}

function bindEvents() {
  form.addEventListener("submit", createTicket);
  statusFilter.addEventListener("change", renderFilteredTickets);
  priorityFilter.addEventListener("change", renderFilteredTickets);
  document.getElementById("refreshSupportBtn").addEventListener("click", loadTickets);
  document.getElementById("closeSupportConversationBtn").addEventListener("click", closeConversation);
  replyForm.addEventListener("submit", sendReply);
}

async function loadTickets() {
  const companyId = window.CompanyContext?.getCompanyId();
  let query = supabase
    .from("support_tickets")
    .select("*")
    .order("updated_at", { ascending: false });

  if (!window.CompanyContext?.isPlatformAdmin()) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run support-tickets.sql in Supabase first, then reload this page."
      : error.message;
    msg.style.color = "#ef4444";
    tickets = [];
    renderTickets([]);
    return;
  }

  tickets = data || [];
  renderFilteredTickets();
  msg.textContent = "";
}

async function createTicket(event) {
  event.preventDefault();
  const companyId = window.CompanyContext?.getCompanyId();
  const { data: userData } = await supabase.auth.getUser();
  const data = Object.fromEntries(new FormData(form).entries());

  if (!companyId) {
    msg.textContent = "No company selected. Create or select a company first.";
    msg.style.color = "#ef4444";
    return;
  }

  const payload = {
    company_id: companyId,
    created_by: userData.user?.id || null,
    subject: data.subject.trim(),
    description: data.description.trim(),
    category: data.category,
    priority: data.priority,
    status: "open"
  };

  msg.textContent = "Creating support ticket...";
  msg.style.color = "";

  const { error } = await supabase.from("support_tickets").insert(payload);

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run support-tickets.sql in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await logActivity({
    company_id: companyId,
    action: "create",
    entity_type: "support_ticket",
    entity_id: payload.subject,
    description: `Created support ticket: ${payload.subject}.`,
    metadata: { category: payload.category, priority: payload.priority }
  });

  await createNotification({
    company_id: companyId,
    audience: "platform",
    notification_type: "support",
    priority: payload.priority,
    title: "New support ticket",
    message: payload.subject,
    target_url: "platform-admin.html",
    notification_key: `${companyId}:support_ticket:${payload.subject}:${Date.now()}`
  });

  form.reset();
  msg.textContent = "Support ticket created.";
  msg.style.color = "#047857";
  await loadTickets();
}

function renderFilteredTickets() {
  const status = statusFilter.value;
  const priority = priorityFilter.value;
  const filtered = tickets.filter(ticket => (
    (!status || ticket.status === status) &&
    (!priority || ticket.priority === priority)
  ));
  renderTickets(filtered);
  updateKpis();
}

function renderTickets(rows) {
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No support tickets found.</td></tr>`;
    updateKpis();
    return;
  }

  rows.forEach(ticket => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(ticket.subject)}</strong>
        <span class="muted-line">${escapeHtml(ticket.description)}</span>
      </td>
      <td>${formatStatus(ticket.category)}</td>
      <td><span class="status-pill ${getPriorityClass(ticket.priority)}">${formatStatus(ticket.priority)}</span></td>
      <td><span class="status-pill ${getStatusClass(ticket.status)}">${formatStatus(ticket.status)}</span></td>
      <td>${formatDateTime(ticket.updated_at || ticket.created_at)}</td>
      <td><button class="view" type="button" data-open-ticket="${escapeHtml(ticket.id)}">Open</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-open-ticket]").forEach(button => {
    button.addEventListener("click", () => openConversation(button.dataset.openTicket));
  });
}

function updateKpis() {
  document.getElementById("supportOpenCount").textContent = tickets.filter(ticket => ticket.status === "open").length;
  document.getElementById("supportInProgressCount").textContent = tickets.filter(ticket => ticket.status === "in_progress").length;
  document.getElementById("supportUrgentCount").textContent = tickets.filter(ticket => ["urgent", "high"].includes(ticket.priority)).length;
  document.getElementById("supportResolvedCount").textContent = tickets.filter(ticket => ["resolved", "closed"].includes(ticket.status)).length;
}

async function logActivity(entry) {
  const { data: sessionData } = await supabase.auth.getSession();
  const payload = {
    company_id: entry.company_id || null,
    actor_user_id: sessionData.session?.user?.id || null,
    actor_role: window.CompanyContext?.getRole?.() || null,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ? String(entry.entity_id) : null,
    description: entry.description,
    metadata: entry.metadata || {}
  };

  const { error } = await supabase.from("activity_logs").insert(payload);
  if (error) console.warn("Activity log skipped:", error.message);
}

async function openConversation(ticketId) {
  selectedTicket = tickets.find(ticket => String(ticket.id) === String(ticketId));
  if (!selectedTicket) return;

  conversationTitle.textContent = selectedTicket.subject;
  conversationPanel.classList.remove("hidden");
  conversationMessages.innerHTML = `<div class="empty-state">Loading ticket thread...</div>`;
  await loadConversationMessages(selectedTicket);
}

function closeConversation() {
  selectedTicket = null;
  conversationPanel.classList.add("hidden");
  conversationMessages.innerHTML = "";
  replyMessage.value = "";
}

async function loadConversationMessages(ticket) {
  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  if (error) {
    conversationMessages.innerHTML = `<div class="empty-state">Run the latest support SQL to enable ticket replies.</div>`;
    return;
  }

  renderConversationMessages(ticket, data || []);
}

function renderConversationMessages(ticket, messages) {
  const openingMessage = {
    id: "opening",
    created_at: ticket.created_at,
    author_role: "customer",
    message: ticket.description,
    internal_note: false
  };

  const rows = [openingMessage, ...messages];
  conversationMessages.innerHTML = rows.map(row => `
    <article class="support-message ${row.internal_note ? "internal" : ""}">
      <div>
        <strong>${row.internal_note ? "Internal Note" : formatStatus(row.author_role || "user")}</strong>
        <small>${formatDateTime(row.created_at)}</small>
      </div>
      <p>${escapeHtml(row.message)}</p>
    </article>
  `).join("");
}

async function sendReply(event) {
  event.preventDefault();
  if (!selectedTicket) return;

  const { data: userData } = await supabase.auth.getUser();
  const message = replyMessage.value.trim();
  if (!message) return;

  msg.textContent = "Sending reply...";
  msg.style.color = "";

  const payload = {
    ticket_id: selectedTicket.id,
    company_id: selectedTicket.company_id,
    created_by: userData.user?.id || null,
    author_role: window.CompanyContext?.getRole?.() || "user",
    message,
    internal_note: false
  };

  const { error } = await supabase.from("support_ticket_messages").insert(payload);

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run the latest support SQL in Supabase first, then try again."
      : error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await supabase
    .from("support_tickets")
    .update({ status: selectedTicket.status === "closed" ? "open" : selectedTicket.status })
    .eq("id", selectedTicket.id);

  await createNotification({
    company_id: selectedTicket.company_id,
    audience: "platform",
    notification_type: "support_reply",
    priority: selectedTicket.priority || "normal",
    title: "Customer replied to support ticket",
    message: selectedTicket.subject,
    target_url: "platform-admin.html",
    notification_key: `${selectedTicket.company_id}:support_reply:${selectedTicket.id}:${Date.now()}`
  });

  replyMessage.value = "";
  msg.textContent = "Reply sent.";
  msg.style.color = "#047857";
  await loadConversationMessages(selectedTicket);
  await loadTickets();
}

async function createNotification(payload) {
  const { data: userData } = await supabase.auth.getUser();
  const notification = {
    ...payload,
    created_by: userData.user?.id || null,
    notification_key: payload.notification_key || null,
    metadata: payload.metadata || {}
  };

  const { error } = await supabase.from("notifications").insert(notification);
  if (error) console.warn("Notification skipped:", error.message);
}

function getPriorityClass(priority) {
  if (priority === "urgent" || priority === "high") return "warning";
  if (priority === "normal") return "caution";
  return "success";
}

function getStatusClass(status) {
  if (status === "resolved" || status === "closed") return "success";
  if (status === "in_progress") return "caution";
  return "warning";
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

initSupport().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading support tickets.";
  msg.style.color = "#ef4444";
});
