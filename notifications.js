import { supabase } from "./supabaseClient.js";

const msg = document.getElementById("notificationsMessage");
const list = document.getElementById("notificationsList");
const statusFilter = document.getElementById("notificationStatusFilter");
const priorityFilter = document.getElementById("notificationPriorityFilter");

let notifications = [];
let businessScanBound = false;
let businessScanInProgress = false;

async function initNotifications() {
  msg.textContent = "Loading notifications...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    msg.textContent = "Redirecting to login...";
    msg.style.color = "#ef4444";
    window.location.href = "login.html?next=notifications.html";
    return;
  }

  await window.CompanyContext?.ready();
  const company = window.CompanyContext?.getCompany();
  document.getElementById("notificationsCompanyName").textContent =
    window.CompanyContext?.isPlatformAdmin?.()
      ? "Platform-wide notifications and customer activity."
      : `${company?.company_name || "Selected company"} notifications.`;

  bindEvents();
  await loadNotifications();
}

function bindEvents() {
  statusFilter?.addEventListener("change", renderFilteredNotifications);
  priorityFilter?.addEventListener("change", renderFilteredNotifications);
  document.getElementById("refreshNotificationsBtn")?.addEventListener("click", loadNotifications);
  document.getElementById("markAllNotificationsReadBtn")?.addEventListener("click", markAllRead);
  bindBusinessScanButton();
}

function bindBusinessScanButton() {
  const scanButton = document.getElementById("scanBusinessNotificationsBtn");
  if (!scanButton || businessScanBound) return;

  scanButton.addEventListener("click", scanBusinessEvents);
  businessScanBound = true;
}

async function loadNotifications() {
  const companyId = window.CompanyContext?.getCompanyId();
  let query = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!window.CompanyContext?.isPlatformAdmin?.()) {
    query = query.eq("company_id", companyId).eq("audience", "company");
  }

  const { data, error } = await query;

  if (error) {
    msg.textContent = error.code === "42P01"
      ? "Run notifications.sql in Supabase first, then reload this page."
      : error.message;
    msg.style.color = "#ef4444";
    notifications = [];
    renderNotifications([]);
    return;
  }

  notifications = data || [];
  renderFilteredNotifications();
  msg.textContent = "";
}

async function scanBusinessEvents() {
  if (businessScanInProgress) return;
  businessScanInProgress = true;

  const scanButton = document.getElementById("scanBusinessNotificationsBtn");
  if (scanButton) {
    scanButton.disabled = true;
    scanButton.textContent = "Scanning...";
  }

  const companyId = window.CompanyContext?.getCompanyId?.();
  if (!companyId) {
    msg.textContent = "No company selected. Select a company before scanning business events.";
    msg.style.color = "#ef4444";
    if (scanButton) {
      scanButton.disabled = false;
      scanButton.textContent = "Scan Business Events";
    }
    businessScanInProgress = false;
    return;
  }

  msg.textContent = "Scanning business events...";
  msg.style.color = "";

  try {
    const data = await loadBusinessEventData(companyId);
    const events = buildBusinessEventNotifications(companyId, data);

    if (events.length) {
      await saveBusinessNotifications(events);
    }

    const skippedMessage = data.skippedTables?.length
      ? ` Skipped unavailable tables: ${data.skippedTables.join(", ")}.`
      : "";
    msg.textContent = events.length
      ? `${events.length} business notification${events.length === 1 ? "" : "s"} refreshed.${skippedMessage}`
      : `No business events need notifications right now.${skippedMessage}`;
    msg.style.color = events.length ? "#047857" : data.skippedTables?.length ? "#92400e" : "#64748b";
    await loadNotifications();
  } catch (error) {
    console.error(error);
    msg.textContent = error.code === "42P01"
      ? "Run the latest notifications SQL first, then scan again."
      : error.message;
    msg.style.color = "#ef4444";
  } finally {
    if (scanButton) {
      scanButton.disabled = false;
      scanButton.textContent = "Scan Business Events";
    }
    businessScanInProgress = false;
  }
}

async function saveBusinessNotifications(events) {
  for (const event of events) {
    const { data: existingRows, error: findError } = await supabase
      .from("notifications")
      .select("id")
      .eq("notification_key", event.notification_key)
      .limit(1);

    if (findError) throw findError;

    const existingId = existingRows?.[0]?.id;
    if (existingId) {
      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          priority: event.priority,
          title: event.title,
          message: event.message,
          target_url: event.target_url,
          metadata: event.metadata,
          read_at: null
        })
        .eq("id", existingId);

      if (updateError) throw updateError;
      continue;
    }

    const { error: insertError } = await supabase
      .from("notifications")
      .insert(event);

    if (insertError) throw insertError;
  }
}

async function loadBusinessEventData(companyId) {
  const skippedTables = [];
  const [
    drivers,
    compliance,
    invoices,
    loads,
    documents,
    maintenanceSchedules,
    trucks
  ] = await Promise.all([
    fetchCompanyRows("drivers", companyId, skippedTables),
    fetchCompanyRows("driver_compliance", companyId, skippedTables),
    fetchCompanyRows("invoices", companyId, skippedTables),
    fetchCompanyRows("loads", companyId, skippedTables),
    fetchCompanyRows("documents", companyId, skippedTables),
    fetchCompanyRows("maintenance_schedules", companyId, skippedTables),
    fetchCompanyRows("trucks", companyId, skippedTables)
  ]);

  return { drivers, compliance, invoices, loads, documents, maintenanceSchedules, trucks, skippedTables };
}

async function fetchCompanyRows(table, companyId, skippedTables = []) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("company_id", companyId);

  if (error) {
    console.warn(`Business notification scan skipped ${table}:`, error.message);
    skippedTables.push(table);
    return [];
  }

  return data || [];
}

function buildBusinessEventNotifications(companyId, data) {
  const today = startOfDay(new Date());
  const soon = addDays(today, 30);
  const notificationsToCreate = [];
  const driverMap = new Map(data.drivers.map(driver => [driver.id, driver]));
  const truckMap = new Map(data.trucks.map(truck => [truck.id, truck]));

  data.invoices.forEach(invoice => {
    const status = normalizeStatus(invoice.status);
    const dueDate = parseDate(invoice.due_date);
    if (["paid", "void", "cancelled"].includes(status) || !dueDate || dueDate >= today) return;

    notificationsToCreate.push(buildBusinessNotification(companyId, {
      key: `invoice_overdue:${invoice.id}`,
      type: "invoice_overdue",
      priority: "high",
      title: `Invoice ${invoice.invoice_number || invoice.id} is overdue`,
      message: `Due date was ${formatDate(dueDate)}. Follow up and update payment status.`,
      target_url: `invoice-details.html?id=${invoice.id}`
    }));
  });

  data.drivers.forEach(driver => {
    [
      [driver.license_expiration || driver.cdl_expiration, "CDL/license"],
      [driver.medical_card_expiration, "medical card"],
      [driver.hazmat_expiration, "hazmat"],
      [driver.drug_test_expiration, "drug test"],
      [driver.safety_training_expiration, "safety training"]
    ].forEach(([dateValue, label]) => {
      addDateNotification(notificationsToCreate, companyId, {
        key: `driver:${driver.id}:${normalizeStatus(label)}`,
        dateValue,
        today,
        soon,
        entity: getDriverName(driver),
        label,
        target_url: `driver-details.html?id=${driver.id}`,
        type: "compliance"
      });
    });
  });

  data.compliance.forEach(row => {
    const driver = driverMap.get(row.driver_id);
    [
      ["cdl_expiration", "CDL"],
      ["medical_card_expiration", "medical card"],
      ["dot_physical_expiration", "DOT physical"],
      ["twic_expiration", "TWIC"],
      ["hazmat_expiration", "hazmat"]
    ].forEach(([field, label]) => {
      addDateNotification(notificationsToCreate, companyId, {
        key: `driver_compliance:${row.driver_id}:${field}`,
        dateValue: row[field],
        today,
        soon,
        entity: driver ? getDriverName(driver) : `Driver ${row.driver_id}`,
        label,
        target_url: `driver-details.html?id=${row.driver_id}`,
        type: "compliance"
      });
    });
  });

  data.maintenanceSchedules.forEach(schedule => {
    const dueDate = parseDate(schedule.next_due_date);
    if (!dueDate || dueDate > soon) return;

    const overdue = dueDate < today;
    const truck = truckMap.get(schedule.truck_id);
    notificationsToCreate.push(buildBusinessNotification(companyId, {
      key: `maintenance:${schedule.id}`,
      type: overdue ? "maintenance_overdue" : "maintenance_due",
      priority: overdue ? "urgent" : "high",
      title: `${formatStatus(schedule.maintenance_type)} is ${overdue ? "overdue" : "due soon"}`,
      message: `${truck?.truck_number || `Truck ${schedule.truck_id}`} has maintenance due ${formatDate(dueDate)}.`,
      target_url: `vehicle-details.html?id=${schedule.truck_id}`
    }));
  });

  const podLoadIds = new Set(data.documents
    .filter(documentRow => normalizeStatus(documentRow.document_type) === "pod" && normalizeStatus(documentRow.entity_type) === "load")
    .map(documentRow => Number(documentRow.entity_id)));

  data.loads.forEach(load => {
    if (normalizeStatus(load.status) !== "delivered" || podLoadIds.has(Number(load.id))) return;

    notificationsToCreate.push(buildBusinessNotification(companyId, {
      key: `load_missing_pod:${load.id}`,
      type: "missing_pod",
      priority: "high",
      title: `Load ${load.load_number || load.id} is missing POD`,
      message: "Delivered load needs proof of delivery uploaded before billing is complete.",
      target_url: `load-details.html?id=${load.id}`
    }));
  });

  return notificationsToCreate;
}

function addDateNotification(list, companyId, options) {
  const date = parseDate(options.dateValue);
  if (!date) return;

  if (date < options.today) {
    list.push(buildBusinessNotification(companyId, {
      key: `${options.key}:expired`,
      type: options.type,
      priority: "urgent",
      title: `${options.entity} ${options.label} is expired`,
      message: `Expiration date was ${formatDate(date)}. Update this record immediately.`,
      target_url: options.target_url
    }));
    return;
  }

  if (date <= options.soon) {
    list.push(buildBusinessNotification(companyId, {
      key: `${options.key}:expiring`,
      type: options.type,
      priority: "high",
      title: `${options.entity} ${options.label} expires soon`,
      message: `Expiration date is ${formatDate(date)}. Renew or verify before it expires.`,
      target_url: options.target_url
    }));
  }
}

function buildBusinessNotification(companyId, options) {
  return {
    company_id: companyId,
    audience: "company",
    notification_type: options.type,
    priority: options.priority,
    title: options.title,
    message: options.message,
    target_url: options.target_url,
    notification_key: `${companyId}:${options.key}`,
    metadata: { source: "business_event_scan" }
  };
}

function renderFilteredNotifications() {
  const status = statusFilter.value;
  const priority = priorityFilter.value;
  const filtered = notifications.filter(notification => {
    const read = Boolean(notification.read_at);
    return (
      (!status || (status === "read" ? read : !read)) &&
      (!priority || notification.priority === priority)
    );
  });

  renderNotifications(filtered);
  updateKpis();
}

function renderNotifications(rows) {
  list.innerHTML = "";

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">No notifications found.</div>`;
    updateKpis();
    return;
  }

  rows.forEach(notification => {
    const item = document.createElement("article");
    item.className = `notification-item ${notification.read_at ? "read" : "unread"}`;
    item.innerHTML = `
      <div class="notification-main">
        <span class="status-pill ${getPriorityClass(notification.priority)}">${formatStatus(notification.priority)}</span>
        <div>
          <h2>${escapeHtml(notification.title)}</h2>
          <p>${escapeHtml(notification.message)}</p>
          <small>${formatStatus(notification.notification_type)} • ${formatDateTime(notification.created_at)}</small>
        </div>
      </div>
      <div class="notification-actions">
        ${notification.target_url ? `<a class="view secondary-action" href="${escapeHtml(notification.target_url)}">Open</a>` : ""}
        ${notification.read_at ? "" : `<button class="view" type="button" data-mark-notification="${escapeHtml(notification.id)}">Mark Read</button>`}
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll("[data-mark-notification]").forEach(button => {
    button.addEventListener("click", () => markRead(button.dataset.markNotification));
  });
}

async function markRead(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await loadNotifications();
}

async function markAllRead() {
  const unreadIds = notifications.filter(notification => !notification.read_at).map(notification => notification.id);
  if (!unreadIds.length) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", unreadIds);

  if (error) {
    msg.textContent = error.message;
    msg.style.color = "#ef4444";
    return;
  }

  await loadNotifications();
}

function updateKpis() {
  const unread = notifications.filter(notification => !notification.read_at).length;
  document.getElementById("notificationTotalCount").textContent = notifications.length;
  document.getElementById("notificationUnreadCount").textContent = unread;
  document.getElementById("notificationUrgentCount").textContent = notifications.filter(notification => ["urgent", "high"].includes(notification.priority)).length;
  document.getElementById("notificationReadCount").textContent = notifications.length - unread;
}

function getPriorityClass(priority) {
  if (priority === "urgent" || priority === "high") return "warning";
  if (priority === "normal") return "caution";
  return "success";
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function getDriverName(driver) {
  return `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${driver.id}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? date.toLocaleDateString() : "N/A";
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

window.scanBusinessEventsFromButton = scanBusinessEvents;
bindBusinessScanButton();

initNotifications().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading notifications.";
  msg.style.color = "#ef4444";
  bindBusinessScanButton();
});
