const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let allAlerts = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function loadAlertsCenter() {
  const msg = document.getElementById("alertsMessage");
  const refreshButton = document.getElementById("refreshAlertsBtn");

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Scanning...";
  }

  msg.textContent = "Scanning company operations...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const company = window.CompanyContext?.getCompany?.();
    document.getElementById("alertsCompanyName").textContent =
      `${company?.company_name || "Selected company"} action center`;

    const data = await fetchAlertData();
    allAlerts = buildAlerts(data);

    populateCategoryFilter(allAlerts);
    renderFilteredAlerts();

    const skippedMessage = data.skippedTables.length
      ? ` Skipped unavailable tables: ${data.skippedTables.join(", ")}.`
      : "";
    msg.textContent = allAlerts.length
      ? `${allAlerts.length} action item${allAlerts.length === 1 ? "" : "s"} need attention.${skippedMessage}`
      : `No active operational alerts found.${skippedMessage}`;
    msg.style.color = allAlerts.length ? "#ef4444" : "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading alerts: ${err.message}`;
    msg.style.color = "#ef4444";
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh Scan";
    }
  }
}

async function fetchAlertData() {
  const skippedTables = [];
  const [
    drivers,
    compliance,
    trucks,
    assignments,
    maintenance,
    loads,
    documents,
    invoices,
    schedules,
    savedAlerts,
    notifications,
    supportTickets,
    carriers,
    loadTenders,
    loadCommunications,
    loadIssues
  ] = await Promise.all([
    fetchTable("drivers", skippedTables),
    fetchTable("driver_compliance", skippedTables),
    fetchTable("trucks", skippedTables),
    fetchTable("assignments", skippedTables),
    fetchTable("maintenance_logs", skippedTables),
    fetchTable("loads", skippedTables),
    fetchTable("documents", skippedTables),
    fetchTable("invoices", skippedTables),
    fetchTable("maintenance_schedules", skippedTables),
    fetchTable("alerts", skippedTables),
    fetchTable("notifications", skippedTables),
    fetchTable("support_tickets", skippedTables),
    fetchTable("carriers", skippedTables),
    fetchTable("load_tenders", skippedTables),
    fetchTable("load_communications", skippedTables),
    fetchTable("load_issues", skippedTables)
  ]);

  return {
    drivers,
    compliance,
    trucks,
    assignments,
    maintenance,
    loads,
    documents,
    invoices,
    schedules,
    savedAlerts,
    notifications,
    supportTickets,
    carriers,
    loadTenders,
    loadCommunications,
    loadIssues,
    skippedTables
  };
}

async function fetchTable(tableName, skippedTables) {
  const url = window.CompanyContext?.scopedUrl(tableName, "select=*") || `${BASE_URL}/rest/v1/${tableName}?select=*`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    console.warn(`Could not load ${tableName}:`, await res.text());
    skippedTables.push(tableName);
    return [];
  }
  return res.json();
}

function buildAlerts(data) {
  const alerts = [];
  const today = startOfDay(new Date());
  const soon = addDays(today, 30);
  const driverMap = new Map(data.drivers.map(driver => [driver.id, driver]));
  const truckMap = new Map(data.trucks.map(truck => [truck.id, truck]));
  const activeAssignments = data.assignments.filter(row => normalize(row.status) === "active");
  const assignedTruckIds = new Set(activeAssignments.map(row => row.truck_id));
  const assignedLoadIds = new Set(activeAssignments.map(row => row.load_id));
  const podLoadIds = new Set(data.documents
    .filter(doc => normalize(doc.document_type) === "pod" && normalize(doc.entity_type) === "load")
    .map(doc => Number(doc.entity_id)));
  const invoicedLoadIds = new Set(data.invoices
    .filter(invoice => !["void", "cancelled"].includes(normalize(invoice.status)))
    .map(invoice => invoice.load_id));
  const claimExposureByLoad = new Map();
  data.loadIssues
    .filter(issue => !["resolved", "closed"].includes(normalize(issue.status)))
    .forEach(issue => {
      claimExposureByLoad.set(issue.load_id, (claimExposureByLoad.get(issue.load_id) || 0) + Number(issue.claim_amount || 0));
    });

  data.notifications
    .filter(notification => !notification.read_at)
    .forEach(notification => {
      addAlert(alerts, {
        severity: ["urgent", "high"].includes(notification.priority) ? "warning" : "info",
        category: "Notification",
        title: notification.title,
        action: notification.message,
        link: notification.target_url || "notifications.html",
        date: notification.created_at
      });
    });

  data.supportTickets
    .filter(ticket => !["resolved", "closed"].includes(normalize(ticket.status)))
    .forEach(ticket => {
      addAlert(alerts, {
        severity: ticket.priority === "urgent" ? "critical" : ticket.priority === "high" ? "warning" : "info",
        category: "Support",
        title: ticket.subject,
        action: `Support ticket is ${formatStatus(ticket.status)}. Review and respond if needed.`,
        link: "support.html",
        date: ticket.updated_at || ticket.created_at
      });
    });

  data.carriers.forEach(carrier => {
    if (carrier.status === "blocked") {
      addAlert(alerts, {
        severity: "critical",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} is blocked`,
        action: "Do not tender loads to this carrier until the status is reviewed.",
        link: "carriers.html",
        date: carrier.created_at
      });
    }

    if (!carrier.mc_number && !carrier.dot_number) {
      addAlert(alerts, {
        severity: "warning",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} is missing MC/DOT authority`,
        action: "Add carrier authority details before assigning freight.",
        link: "carriers.html",
        date: carrier.created_at
      });
    }

    if ((carrier.w9_status || "missing") === "missing") {
      addAlert(alerts, {
        severity: "warning",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} is missing W-9`,
        action: "Collect W-9 or carrier packet before payment processing.",
        link: "carriers.html",
        date: carrier.created_at
      });
    }

    if (carrier.safety_rating === "unsatisfactory") {
      addAlert(alerts, {
        severity: "critical",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} has unsatisfactory safety rating`,
        action: "Block this carrier or review authority before tendering freight.",
        link: "carriers.html",
        date: carrier.updated_at || carrier.created_at
      });
    } else if (carrier.safety_rating === "conditional") {
      addAlert(alerts, {
        severity: "warning",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} has conditional safety rating`,
        action: "Review carrier packet before assigning higher-risk freight.",
        link: "carriers.html",
        date: carrier.updated_at || carrier.created_at
      });
    }

    if (!carrier.last_reviewed_at) {
      addAlert(alerts, {
        severity: "warning",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} packet has not been reviewed`,
        action: "Review authority, insurance, W-9, and payment setup before tendering.",
        link: "carriers.html",
        date: carrier.created_at
      });
    }

    if (!carrier.insurance_expiration) {
      addAlert(alerts, {
        severity: "warning",
        category: "Carrier Compliance",
        title: `${carrier.carrier_name} is missing insurance expiration`,
        action: "Add insurance expiration before assigning freight to this carrier.",
        link: "carriers.html",
        date: carrier.created_at
      });
    } else {
      addDateAlert(alerts, {
        dateValue: carrier.insurance_expiration,
        today,
        soon,
        category: "Carrier Compliance",
        entity: carrier.carrier_name,
        label: "insurance",
        link: "carriers.html"
      });
    }
  });

  data.loadTenders
    .filter(tender => tender.status === "sent")
    .forEach(tender => {
      const expiresAt = tender.expires_at ? new Date(tender.expires_at) : null;
      if (expiresAt && expiresAt < new Date()) {
        addAlert(alerts, {
          severity: "warning",
          category: "Carrier Tender",
          title: `Tender ${tender.tender_number || tender.id} expired without response`,
          action: "Follow up with the carrier or tender this load to another carrier.",
          link: `tender-load.html?id=${tender.load_id}`,
          date: tender.expires_at
        });
      } else {
        addAlert(alerts, {
          severity: "info",
          category: "Carrier Tender",
          title: `Tender ${tender.tender_number || tender.id} is awaiting response`,
          action: "Monitor carrier response before dispatching the load.",
          link: `tender-load.html?id=${tender.load_id}`,
          date: tender.expires_at || tender.sent_at || tender.created_at
        });
      }
    });

  data.loadCommunications
    .filter(item => item.status === "open" && item.next_follow_up_at)
    .forEach(item => {
      const followUp = new Date(item.next_follow_up_at);
      const overdue = followUp < new Date();
      addAlert(alerts, {
        severity: overdue ? "warning" : "info",
        category: "Communication",
        title: `${overdue ? "Overdue" : "Upcoming"} follow-up for Load ${item.load_id}`,
        action: `${formatStatus(item.contact_type)} ${formatStatus(item.channel)} follow-up: ${item.subject || item.summary}`,
        link: `load-details.html?id=${item.load_id}`,
        date: item.next_follow_up_at
      });
    });

  data.loadIssues
    .filter(issue => !["resolved", "closed"].includes(normalize(issue.status)))
    .forEach(issue => {
      const due = issue.due_at ? new Date(issue.due_at) : null;
      const overdue = due && due < new Date();
      const severe = ["critical", "high"].includes(issue.severity);
      addAlert(alerts, {
        severity: overdue || issue.severity === "critical" ? "critical" : severe ? "warning" : "info",
        category: "Issue / Claim",
        title: `${formatStatus(issue.issue_type)} on Load ${issue.load_id}`,
        action: `${issue.title}${issue.claim_amount ? ` - claim exposure ${formatCurrency(issue.claim_amount)}` : ""}`,
        link: `load-details.html?id=${issue.load_id}`,
        date: issue.due_at || issue.created_at
      });
    });

  data.drivers.forEach(driver => {
    [
      [driver.license_expiration || driver.cdl_expiration, "CDL/license"],
      [driver.medical_card_expiration, "medical card"],
      [driver.hazmat_expiration, "hazmat"],
      [driver.drug_test_expiration, "drug test"],
      [driver.safety_training_expiration, "safety training"]
    ].forEach(([dateValue, label]) => {
      addDateAlert(alerts, {
        dateValue,
        today,
        soon,
        category: "Compliance",
        entity: driverName(driver),
        label,
        link: `driver-details.html?id=${driver.id}`
      });
    });
  });

  data.compliance.forEach(row => {
    const driver = driverMap.get(row.driver_id);
    const entity = driver ? driverName(driver) : `Driver ${row.driver_id}`;
    [
      ["cdl_expiration", "CDL"],
      ["medical_card_expiration", "medical card"],
      ["dot_physical_expiration", "DOT physical"],
      ["twic_expiration", "TWIC"],
      ["hazmat_expiration", "hazmat"]
    ].forEach(([field, label]) => {
      addDateAlert(alerts, {
        dateValue: row[field],
        today,
        soon,
        category: "Compliance",
        entity,
        label,
        link: `driver-details.html?id=${row.driver_id}`
      });
    });
  });

  data.trucks.forEach(truck => {
    if (["retired", "out_of_service"].includes(normalize(truck.status))) return;
    if (!assignedTruckIds.has(truck.id)) {
      addAlert(alerts, {
        severity: "info",
        category: "Fleet",
        title: `${truck.truck_number || truck.vin || `Truck ${truck.id}`} is unassigned`,
        action: "Assign the truck to an active driver/load or mark it unavailable.",
        link: `vehicle-details.html?id=${truck.id}`
      });
    }
  });

  data.loads.forEach(load => {
    const status = normalize(load.status);
    const revenue = Number(load.rate || 0);
    const carrierCost = Number(load.carrier_rate || 0);
    const claimExposure = claimExposureByLoad.get(load.id) || 0;
    const margin = revenue - carrierCost - claimExposure;
    const marginPercent = revenue ? (margin / revenue) * 100 : 0;
    const delivered = ["delivered", "pod_received"].includes(status);
    const podReceived = status === "pod_received" || podLoadIds.has(Number(load.id));
    const active = ["booked", "dispatched", "picked_up", "in_transit"].includes(status);

    if (active && (!load.driver_id || !assignedLoadIds.has(load.id))) {
      addAlert(alerts, {
        severity: "warning",
        category: "Dispatch",
        title: `Load ${load.load_number || load.id} needs an active assignment`,
        action: "Assign a driver and truck before dispatch continues.",
        link: `load-details.html?id=${load.id}`,
        date: load.pickup_date
      });
    }

    if (delivered && !podReceived) {
      addAlert(alerts, {
        severity: "critical",
        category: "Documents",
        title: `Load ${load.load_number || load.id} is delivered but missing POD`,
        action: "Upload or link the POD before billing is complete.",
        link: `load-details.html?id=${load.id}`,
        date: load.delivery_date || load.dropoff_date
      });
    }

    if (podReceived && !invoicedLoadIds.has(load.id)) {
      addAlert(alerts, {
        severity: "warning",
        category: "Billing",
        title: `Load ${load.load_number || load.id} has POD but is not invoiced`,
        action: "Create an invoice from the load details page.",
        link: `load-details.html?id=${load.id}`
      });
    }

    if (revenue > 0 && margin < 0) {
      addAlert(alerts, {
        severity: "critical",
        category: "Profitability",
        title: `Load ${load.load_number || load.id} is projected at a loss`,
        action: `Revenue ${formatCurrency(revenue)}, cost/exposure ${formatCurrency(carrierCost + claimExposure)}.`,
        link: `load-details.html?id=${load.id}`
      });
    } else if (revenue > 0 && marginPercent < 12) {
      addAlert(alerts, {
        severity: "warning",
        category: "Profitability",
        title: `Load ${load.load_number || load.id} has low margin`,
        action: `Projected margin is ${Math.round(marginPercent)}%. Review carrier cost, accessorials, or claim exposure.`,
        link: `load-details.html?id=${load.id}`
      });
    }

    addDateAlert(alerts, {
      dateValue: load.pickup_date,
      today,
      soon: today,
      category: "Dispatch",
      entity: `Load ${load.load_number || load.id}`,
      label: "pickup appointment",
      link: `load-details.html?id=${load.id}`,
      onlyExpired: true,
      skip: ["delivered", "invoiced", "paid", "cancelled"].includes(status)
    });
  });

  data.invoices.forEach(invoice => {
    const status = normalize(invoice.status);
    const dueDate = parseDate(invoice.due_date);
    if (!["paid", "void", "cancelled"].includes(status) && dueDate && dueDate < today) {
      addAlert(alerts, {
        severity: "critical",
        category: "Billing",
        title: `Invoice ${invoice.invoice_number || invoice.id} is overdue`,
        action: "Follow up with the customer and update invoice status.",
        link: `invoice-details.html?id=${invoice.id}`,
        date: invoice.due_date
      });
    } else if (status === "sent") {
      addAlert(alerts, {
        severity: "info",
        category: "Billing",
        title: `Invoice ${invoice.invoice_number || invoice.id} is sent and unpaid`,
        action: "Monitor payment status or follow up near the due date.",
        link: `invoice-details.html?id=${invoice.id}`,
        date: invoice.due_date
      });
    }
  });

  data.schedules.forEach(schedule => {
    const status = getMaintenanceScheduleStatus(schedule, today);
    if (!["critical", "warning"].includes(status.severity)) return;
    const truck = truckMap.get(schedule.truck_id);
    addAlert(alerts, {
      severity: status.severity,
      category: "Maintenance",
      title: `${formatStatus(schedule.maintenance_type)} for ${truck?.truck_number || `Truck ${schedule.truck_id}`} is ${status.label.toLowerCase()}`,
      action: status.severity === "critical"
        ? "Log service immediately or remove the truck from active work."
        : "Schedule service before the due date.",
      link: `vehicle-details.html?id=${schedule.truck_id}`,
      date: schedule.next_due_date
    });
  });

  data.savedAlerts
    .filter(alert => !alert.resolved)
    .forEach(alert => {
      addAlert(alerts, {
        severity: alert.alert_type === "maintenance_overdue" ? "critical" : alert.alert_type === "maintenance_due" ? "warning" : "info",
        category: "Saved Alert",
        title: alert.message || formatStatus(alert.alert_type),
        action: "Review and resolve this operational alert.",
        link: alert.truck_id ? `vehicle-details.html?id=${alert.truck_id}` : "alerts.html",
        date: alert.created_at
      });
    });

  data.maintenance.forEach(record => {
    if (!record.mileage && !record.notes) {
      addAlert(alerts, {
        severity: "info",
        category: "Maintenance",
        title: `Maintenance record ${record.id} is missing detail`,
        action: "Add mileage or notes so maintenance history is useful.",
        link: "maintenance.html",
        date: record.created_at
      });
    }
  });

  return sortAlerts(dedupeAlerts(alerts));
}

function addAlert(alerts, alert) {
  alerts.push({
    ...alert,
    dueLabel: alert.date ? formatDate(alert.date) : "N/A",
    searchText: `${alert.severity} ${alert.category} ${alert.title} ${alert.action}`.toLowerCase()
  });
}

function addDateAlert(alerts, options) {
  if (options.skip || !options.dateValue) return;

  const date = parseDate(options.dateValue);
  if (!date) return;

  if (date < options.today) {
    addAlert(alerts, {
      severity: "critical",
      category: options.category,
      title: `${options.entity} ${options.label} is expired`,
      action: `Update ${options.label} expiration immediately.`,
      link: options.link,
      date: options.dateValue
    });
    return;
  }

  if (!options.onlyExpired && date <= options.soon) {
    addAlert(alerts, {
      severity: "warning",
      category: options.category,
      title: `${options.entity} ${options.label} expires soon`,
      action: `Renew or verify ${options.label} before ${formatDate(date)}.`,
      link: options.link,
      date: options.dateValue
    });
  }
}

function renderFilteredAlerts() {
  const severity = document.getElementById("alertSeverityFilter").value;
  const category = document.getElementById("alertCategoryFilter").value;
  const search = document.getElementById("alertSearchInput").value.trim().toLowerCase();

  const filtered = allAlerts.filter(alert => (
    (!severity || alert.severity === severity) &&
    (!category || alert.category === category) &&
    (!search || alert.searchText.includes(search))
  ));

  updateKpis(filtered);
  renderPriorityAlerts(filtered);
  renderAlertsTable(filtered);
}

function renderPriorityAlerts(alerts) {
  const container = document.getElementById("priorityAlertsList");
  const topAlerts = alerts.slice(0, 6);
  container.innerHTML = "";

  if (!topAlerts.length) {
    container.innerHTML = `<div class="empty-state">No priority actions found.</div>`;
    return;
  }

  topAlerts.forEach(alert => {
    const item = document.createElement("article");
    item.className = `action-center-item ${alert.severity}`;
    item.innerHTML = `
      <div>
        <span class="status-pill ${getSeverityClass(alert.severity)}">${formatSeverity(alert.severity)}</span>
        <h3>${escapeHtml(alert.title)}</h3>
        <p>${escapeHtml(alert.action)}</p>
        <small>${escapeHtml(alert.category)} • ${escapeHtml(alert.dueLabel)}</small>
      </div>
      <a class="view" href="${escapeHtml(alert.link)}">Open</a>
    `;
    container.appendChild(item);
  });
}

function renderAlertsTable(alerts) {
  const tbody = document.getElementById("alertsTableBody");
  tbody.innerHTML = "";

  if (!alerts.length) {
    tbody.innerHTML = `<tr><td colspan="6">No alerts found.</td></tr>`;
    return;
  }

  alerts.forEach(alert => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="status-pill ${getSeverityClass(alert.severity)}">${formatSeverity(alert.severity)}</span></td>
      <td>${escapeHtml(alert.category)}</td>
      <td>${escapeHtml(alert.title)}</td>
      <td>${escapeHtml(alert.action)}</td>
      <td>${escapeHtml(alert.dueLabel)}</td>
      <td><a class="view" href="${escapeHtml(alert.link)}">Open</a></td>
    `;
    tbody.appendChild(row);
  });
}

function populateCategoryFilter(alerts) {
  const select = document.getElementById("alertCategoryFilter");
  const selected = select.value;
  const categories = [...new Set(alerts.map(alert => alert.category))].sort();
  select.innerHTML = `<option value="">All Categories</option>${categories.map(category => (
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
  )).join("")}`;
  if (categories.includes(selected)) select.value = selected;
}

function updateKpis(alerts) {
  document.getElementById("totalAlerts").textContent = alerts.length;
  document.getElementById("criticalAlerts").textContent = alerts.filter(alert => alert.severity === "critical").length;
  document.getElementById("warningAlerts").textContent = alerts.filter(alert => alert.severity === "warning").length;
  document.getElementById("infoAlerts").textContent = alerts.filter(alert => alert.severity === "info").length;
}

function bindAlertsEvents() {
  document.getElementById("refreshAlertsBtn")?.addEventListener("click", loadAlertsCenter);
  document.getElementById("alertSeverityFilter")?.addEventListener("change", renderFilteredAlerts);
  document.getElementById("alertCategoryFilter")?.addEventListener("change", renderFilteredAlerts);
  document.getElementById("alertSearchInput")?.addEventListener("input", renderFilteredAlerts);
}

function getMaintenanceScheduleStatus(schedule, today) {
  const dueDate = parseDate(schedule.next_due_date);
  if (!dueDate) return { severity: "info", label: "Scheduled" };

  const daysUntilDue = Math.ceil((dueDate - today) / 86400000);
  if (daysUntilDue < 0) return { severity: "critical", label: "Overdue" };
  if (daysUntilDue <= 30) return { severity: "warning", label: "Due Soon" };
  return { severity: "info", label: "Scheduled" };
}

function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter(alert => {
    const key = `${alert.severity}:${alert.category}:${alert.title}:${alert.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortAlerts(alerts) {
  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => (
    rank[a.severity] - rank[b.severity] ||
    a.category.localeCompare(b.category) ||
    a.title.localeCompare(b.title)
  ));
}

function getSeverityClass(value) {
  if (value === "critical") return "warning";
  if (value === "warning") return "caution";
  return "success";
}

function formatSeverity(value) {
  if (value === "critical") return "Critical";
  if (value === "warning") return "Warning";
  return "Info";
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function driverName(driver) {
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

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

bindAlertsEvents();
loadAlertsCenter();
