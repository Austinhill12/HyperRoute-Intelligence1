const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const reportDefinitions = {
  loads: {
    title: "Loads Report",
    dateField: "pickup_date",
    statuses: ["booked", "assigned", "dispatched", "picked_up", "in_transit", "delivered", "invoiced", "paid", "cancelled"],
    columns: [
      ["load_number", "Load #"],
      ["customer", "Customer"],
      ["lane", "Lane"],
      ["pickup_date", "Pickup"],
      ["delivery_date", "Delivery"],
      ["driver", "Driver"],
      ["truck", "Truck"],
      ["status", "Status"],
      ["rate", "Rate"]
    ]
  },
  profitability: {
    title: "Profitability Report",
    dateField: "pickup_date",
    statuses: ["profitable", "low_margin", "loss", "claim_risk"],
    columns: [
      ["load_number", "Load #"],
      ["customer", "Customer"],
      ["lane", "Lane"],
      ["pickup_date", "Pickup"],
      ["revenue", "Revenue"],
      ["carrier_cost", "Carrier Cost"],
      ["claim_exposure", "Claim Exposure"],
      ["gross_margin", "Gross Margin"],
      ["margin_percent", "Margin %"],
      ["status", "Risk"]
    ]
  },
  invoices: {
    title: "Invoice Report",
    dateField: "invoice_date",
    statuses: ["draft", "sent", "paid", "overdue", "void"],
    columns: [
      ["invoice_number", "Invoice #"],
      ["load_number", "Load"],
      ["customer_name", "Customer"],
      ["status", "Status"],
      ["invoice_date", "Invoice Date"],
      ["due_date", "Due Date"],
      ["paid_date", "Paid Date"],
      ["total_amount", "Total"]
    ]
  },
  quotes: {
    title: "Quote Pipeline Report",
    dateField: "pickup_date",
    statuses: ["draft", "sent", "accepted", "rejected", "expired"],
    columns: [
      ["quote_number", "Quote #"],
      ["customer_name", "Customer"],
      ["lane", "Lane"],
      ["pickup_date", "Pickup"],
      ["expiration_date", "Expires"],
      ["equipment_type", "Equipment"],
      ["status", "Status"],
      ["quoted_rate", "Rate"],
      ["converted", "Converted"]
    ]
  },
  compliance: {
    title: "Compliance Report",
    dateField: "",
    statuses: ["compliant", "expiring_soon", "expired", "missing_information"],
    columns: [
      ["driver", "Driver"],
      ["status", "Status"],
      ["cdl_expiration", "CDL Exp"],
      ["medical_card_expiration", "Medical Exp"],
      ["dot_physical_expiration", "DOT Exp"],
      ["twic_expiration", "TWIC Exp"],
      ["hazmat_expiration", "Hazmat Exp"],
      ["phone", "Phone"],
      ["email", "Email"]
    ]
  },
  maintenance: {
    title: "Maintenance Report",
    dateField: "created_at",
    statuses: [],
    columns: [
      ["truck", "Truck"],
      ["maintenance_type", "Type"],
      ["created_at", "Date"],
      ["mileage", "Mileage"],
      ["notes", "Notes"]
    ]
  }
};

let reportData = {
  drivers: [],
  driverCompliance: [],
  loads: [],
  assignments: [],
  trucks: [],
  invoices: [],
  quotes: [],
  maintenance: [],
  loadIssues: []
};
let visibleRows = [];

async function initReports() {
  const msg = document.getElementById("reportsMessage");
  msg.textContent = "Loading reports...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const [drivers, driverCompliance, loads, assignments, trucks, invoices, quotes, maintenance, loadIssues] = await Promise.all([
      fetchRows("drivers", "select=*"),
      fetchRowsOptional("driver_compliance", "select=*"),
      fetchRows("loads", "select=*"),
      fetchRowsOptional("assignments", "select=*"),
      fetchRows("trucks", "select=*"),
      fetchRowsOptional("invoices", "select=*"),
      fetchRowsOptional("quotes", "select=*"),
      fetchRows("maintenance_logs", "select=*"),
      fetchRowsOptional("load_issues", "select=*")
    ]);

    reportData = { drivers, driverCompliance, loads, assignments, trucks, invoices, quotes, maintenance, loadIssues };
    configureStatusFilter();
    renderReport();
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading reports: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function fetchRows(table, query) {
  const url = window.CompanyContext?.scopedUrl(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function getHeaders() {
  return window.CompanyContext?.getHeaders?.() || fallbackHeaders;
}

async function fetchRowsOptional(table, query) {
  try {
    return await fetchRows(table, query);
  } catch (err) {
    console.warn(`Optional report table unavailable: ${table}`, err);
    return [];
  }
}

function renderReport() {
  const type = document.getElementById("reportType").value;
  const def = reportDefinitions[type];
  const rows = getReportRows(type);
  visibleRows = filterRows(rows, def);

  document.getElementById("reportTitle").textContent = def.title;
  document.getElementById("reportCount").textContent = `${visibleRows.length} rows`;
  renderKpis(type, visibleRows);
  renderTable(def, visibleRows);
}

function getReportRows(type) {
  if (type === "loads") return getLoadRows();
  if (type === "profitability") return getProfitabilityRows();
  if (type === "invoices") return getInvoiceRows();
  if (type === "quotes") return getQuoteRows();
  if (type === "compliance") return getComplianceRows();
  if (type === "maintenance") return getMaintenanceRows();
  return [];
}

function getProfitabilityRows() {
  const issueExposureByLoad = new Map();
  reportData.loadIssues
    .filter(issue => !["resolved", "closed"].includes(normalizeStatus(issue.status)))
    .forEach(issue => {
      issueExposureByLoad.set(issue.load_id, (issueExposureByLoad.get(issue.load_id) || 0) + Number(issue.claim_amount || 0));
    });

  return reportData.loads.map(load => {
    const revenue = Number(load.rate || 0);
    const carrierCost = Number(load.carrier_rate || 0);
    const claimExposure = issueExposureByLoad.get(load.id) || 0;
    const grossMargin = revenue - carrierCost - claimExposure;
    const marginPercent = revenue ? (grossMargin / revenue) * 100 : 0;
    const riskStatus = getProfitabilityStatus(revenue, carrierCost, claimExposure, marginPercent);

    return {
      id: load.id,
      load_number: load.load_number || load.id,
      customer: load.customer_name || load.customer || "",
      lane: `${load.pickup_location || "-"} to ${load.delivery_location || load.dropoff_location || "-"}`,
      pickup_date: load.pickup_date || "",
      revenue,
      carrier_cost: carrierCost,
      claim_exposure: claimExposure,
      gross_margin: grossMargin,
      margin_percent: marginPercent,
      status: riskStatus,
      searchText: [
        load.load_number,
        load.customer_name,
        load.customer,
        load.pickup_location,
        load.delivery_location,
        load.dropoff_location,
        riskStatus
      ].join(" ").toLowerCase()
    };
  });
}

function getProfitabilityStatus(revenue, carrierCost, claimExposure, marginPercent) {
  if (claimExposure > 0) return "claim_risk";
  if (revenue > 0 && revenue - carrierCost - claimExposure < 0) return "loss";
  if (revenue > 0 && marginPercent < 12) return "low_margin";
  return "profitable";
}

function getLoadRows() {
  const driverMap = new Map(reportData.drivers.map(driver => [driver.id, getDriverName(driver)]));
  const truckMap = new Map(reportData.trucks.map(truck => [truck.id, truck.truck_number || truck.vin || `Truck ${truck.id}`]));
  const assignmentMap = new Map();
  reportData.assignments
    .filter(assignment => (assignment.status || "active") === "active")
    .forEach(assignment => {
      if (assignment.load_id && !assignmentMap.has(assignment.load_id)) assignmentMap.set(assignment.load_id, assignment);
    });

  return reportData.loads.map(load => {
    const assignment = assignmentMap.get(load.id);
    const driverId = load.driver_id || assignment?.driver_id;
    const truckId = assignment?.truck_id || load.vehicle_id;
    return {
      id: load.id,
      load_number: load.load_number || load.id,
      customer: load.customer_name || load.customer || "",
      lane: `${load.pickup_location || "-"} to ${load.delivery_location || load.dropoff_location || "-"}`,
      pickup_date: load.pickup_date || "",
      delivery_date: load.delivery_date || load.dropoff_date || "",
      driver: driverMap.get(driverId) || "Unassigned",
      truck: truckMap.get(truckId) || "Unassigned",
      status: normalizeStatus(load.status || "booked"),
      rate: Number(load.rate || 0),
      searchText: [
        load.load_number,
        load.customer_name,
        load.customer,
        load.pickup_location,
        load.delivery_location,
        load.dropoff_location,
        driverMap.get(driverId),
        truckMap.get(truckId),
        load.status
      ].join(" ").toLowerCase()
    };
  });
}

function getInvoiceRows() {
  const loadMap = new Map(reportData.loads.map(load => [load.id, load.load_number || `Load ${load.id}`]));
  return reportData.invoices.map(invoice => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number || invoice.id,
    load_number: loadMap.get(invoice.load_id) || invoice.load_id || "",
    customer_name: invoice.customer_name || "",
    status: normalizeStatus(invoice.status || "draft"),
    invoice_date: invoice.invoice_date || "",
    due_date: invoice.due_date || "",
    paid_date: invoice.paid_date || "",
    total_amount: Number(invoice.total_amount || 0),
    searchText: [
      invoice.invoice_number,
      loadMap.get(invoice.load_id),
      invoice.customer_name,
      invoice.status
    ].join(" ").toLowerCase()
  }));
}

function getQuoteRows() {
  return reportData.quotes.map(quote => ({
    id: quote.id,
    quote_number: quote.quote_number || quote.id,
    customer_name: quote.customer_name || "",
    lane: `${quote.pickup_location || "-"} to ${quote.delivery_location || "-"}`,
    pickup_date: quote.pickup_date || "",
    expiration_date: quote.expiration_date || "",
    equipment_type: quote.equipment_type || "",
    status: normalizeStatus(quote.status || "draft"),
    quoted_rate: Number(quote.quoted_rate || 0),
    converted: quote.load_id || quote.converted_at ? "Yes" : "No",
    searchText: [
      quote.quote_number,
      quote.customer_name,
      quote.pickup_location,
      quote.delivery_location,
      quote.equipment_type,
      quote.status
    ].join(" ").toLowerCase()
  }));
}

function getComplianceRows() {
  const complianceByDriver = new Map(reportData.driverCompliance.map(row => [row.driver_id, row]));

  return reportData.drivers.map(driver => {
    const compliance = complianceByDriver.get(driver.id) || {};
    const row = {
      driver: getDriverName(driver),
      phone: driver.phone || "",
      email: driver.email || "",
      cdl_expiration: compliance.cdl_expiration || driver.cdl_expiration || driver.license_expiration || "",
      medical_card_expiration: compliance.medical_card_expiration || driver.medical_card_expiration || "",
      dot_physical_expiration: compliance.dot_physical_expiration || "",
      twic_expiration: compliance.twic_expiration || "",
      hazmat_expiration: compliance.hazmat_expiration || driver.hazmat_expiration || "",
      searchText: [getDriverName(driver), driver.phone, driver.email, driver.status].join(" ").toLowerCase()
    };
    row.status = getComplianceStatus(row);
    return row;
  });
}

function getMaintenanceRows() {
  const truckMap = new Map(reportData.trucks.map(truck => [truck.id, truck.truck_number || truck.vin || `Truck ${truck.id}`]));
  return reportData.maintenance.map(record => ({
    id: record.id,
    truck: truckMap.get(record.truck_id) || record.truck_id || "N/A",
    maintenance_type: record.maintenance_type || "",
    created_at: record.created_at || "",
    mileage: record.mileage || "",
    notes: record.notes || "",
    searchText: [
      truckMap.get(record.truck_id),
      record.maintenance_type,
      record.notes
    ].join(" ").toLowerCase()
  }));
}

function filterRows(rows, def) {
  const status = document.getElementById("statusFilter").value;
  const search = document.getElementById("searchFilter").value.trim().toLowerCase();
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  return rows.filter(row => {
    if (status && normalizeStatus(row.status) !== status) return false;
    if (search && !(row.searchText || Object.values(row).join(" ").toLowerCase()).includes(search)) return false;
    if (def.dateField && start && String(row[def.dateField] || "").slice(0, 10) < start) return false;
    if (def.dateField && end && String(row[def.dateField] || "").slice(0, 10) > end) return false;
    return true;
  });
}

function renderKpis(type, rows) {
  const kpis = document.getElementById("reportKpis");
  const items = getKpis(type, rows);
  kpis.innerHTML = items.map(item => `
    <div class="kpi-card ${item.className || ""}">
      <h3>${item.value}</h3>
      <p>${item.label}</p>
    </div>
  `).join("");
}

function getKpis(type, rows) {
  if (type === "loads") {
    return [
      { label: "Loads", value: rows.length },
      { label: "Delivered", value: rows.filter(row => row.status === "delivered").length, className: "success" },
      { label: "In Transit", value: rows.filter(row => ["dispatched", "picked_up", "in_transit"].includes(row.status)).length, className: "caution" },
      { label: "Revenue", value: formatCurrency(rows.reduce((sum, row) => sum + Number(row.rate || 0), 0)) }
    ];
  }

  if (type === "invoices") {
    const receivables = rows
      .filter(row => !["paid", "void"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    return [
      { label: "Invoices", value: rows.length },
      { label: "Paid", value: rows.filter(row => row.status === "paid").length, className: "success" },
      { label: "Overdue", value: rows.filter(isOverdueInvoice).length, className: "warning" },
      { label: "Receivables", value: formatCurrency(receivables), className: "caution" }
    ];
  }

  if (type === "profitability") {
    const revenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    const carrierCost = rows.reduce((sum, row) => sum + Number(row.carrier_cost || 0), 0);
    const claimExposure = rows.reduce((sum, row) => sum + Number(row.claim_exposure || 0), 0);
    const grossMargin = rows.reduce((sum, row) => sum + Number(row.gross_margin || 0), 0);
    const marginPercent = revenue ? Math.round((grossMargin / revenue) * 100) : 0;
    return [
      { label: "Revenue", value: formatCurrency(revenue) },
      { label: "Gross Margin", value: formatCurrency(grossMargin), className: grossMargin < 0 ? "warning" : "success" },
      { label: "Margin %", value: `${marginPercent}%`, className: marginPercent < 12 ? "caution" : "success" },
      { label: "Profit Risks", value: rows.filter(row => ["loss", "low_margin", "claim_risk"].includes(row.status)).length, className: "warning" },
      { label: "Carrier Cost", value: formatCurrency(carrierCost), className: "caution" },
      { label: "Claim Exposure", value: formatCurrency(claimExposure), className: claimExposure > 0 ? "warning" : "" }
    ];
  }

  if (type === "compliance") {
    return [
      { label: "Drivers", value: rows.length },
      { label: "Compliant", value: rows.filter(row => row.status === "compliant").length, className: "success" },
      { label: "Expiring Soon", value: rows.filter(row => row.status === "expiring_soon").length, className: "caution" },
      { label: "Expired/Missing", value: rows.filter(row => ["expired", "missing_information"].includes(row.status)).length, className: "warning" }
    ];
  }

  if (type === "quotes") {
    const accepted = rows.filter(row => row.status === "accepted").length;
    const rejected = rows.filter(row => row.status === "rejected").length;
    const decided = accepted + rejected;
    const winRate = decided ? Math.round((accepted / decided) * 100) : 0;
    return [
      { label: "Quotes", value: rows.length },
      { label: "Open Value", value: formatCurrency(rows.filter(row => ["draft", "sent"].includes(row.status)).reduce((sum, row) => sum + Number(row.quoted_rate || 0), 0)), className: "caution" },
      { label: "Accepted", value: accepted, className: "success" },
      { label: "Win Rate", value: `${winRate}%` }
    ];
  }

  return [
    { label: "Records", value: rows.length },
    { label: "Repairs", value: rows.filter(row => row.maintenance_type.toLowerCase().includes("repair")).length, className: "warning" },
    { label: "Services", value: rows.filter(row => row.maintenance_type.toLowerCase().includes("service")).length, className: "success" },
    { label: "This Month", value: rows.filter(isThisMonth).length, className: "caution" }
  ];
}

function renderTable(def, rows) {
  const thead = document.getElementById("reportTableHead");
  const tbody = document.getElementById("reportTableBody");

  thead.innerHTML = `<tr>${def.columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${def.columns.length}">No report rows found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      ${def.columns.map(([key]) => `<td>${formatCell(key, row[key])}</td>`).join("")}
    </tr>
  `).join("");
}

function configureStatusFilter() {
  const type = document.getElementById("reportType").value;
  const statuses = reportDefinitions[type].statuses;
  const select = document.getElementById("statusFilter");

  select.innerHTML = `<option value="">All Statuses</option>`;
  statuses.forEach(status => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = formatStatus(status);
    select.appendChild(option);
  });
  select.disabled = statuses.length === 0;
}

function exportVisibleCsv() {
  const type = document.getElementById("reportType").value;
  const def = reportDefinitions[type];
  if (!visibleRows.length) {
    document.getElementById("reportsMessage").textContent = "No rows to export.";
    return;
  }

  const headers = def.columns.map(([, label]) => label);
  const rows = visibleRows.map(row => def.columns.map(([key]) => row[key] ?? ""));
  const csv = [headers, ...rows]
    .map(row => row.map(formatCsvCell).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${type}-report-${getToday()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getComplianceStatus(row) {
  const dates = [
    row.cdl_expiration,
    row.medical_card_expiration,
    row.dot_physical_expiration,
    row.twic_expiration,
    row.hazmat_expiration
  ];
  if (dates.some(value => !value)) return "missing_information";
  if (dates.some(isExpired)) return "expired";
  if (dates.some(isExpiringSoon)) return "expiring_soon";
  return "compliant";
}

function isOverdueInvoice(row) {
  return row.status === "overdue" || (!["paid", "void"].includes(row.status) && row.due_date && row.due_date < getToday());
}

function isThisMonth(row) {
  const value = String(row.created_at || "").slice(0, 10);
  return Boolean(value && value >= getMonthStart() && value <= getToday());
}

function isExpired(value) {
  return Boolean(value && value < getToday());
}

function isExpiringSoon(value) {
  if (!value) return false;
  return value >= getToday() && value <= getFutureDate(30);
}

function formatCell(key, value) {
  if (key.includes("date") || key.includes("expiration") || key === "created_at" || key === "paid_date" || key === "due_date") {
    return formatDate(value);
  }
  if (["rate", "total_amount", "quoted_rate", "revenue", "carrier_cost", "claim_exposure", "gross_margin"].includes(key)) return formatCurrency(value);
  if (key === "margin_percent") return `${Math.round(Number(value || 0))}%`;
  if (key === "status") return formatStatus(value);
  return escapeHtml(value || "N/A");
}

function formatCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function formatStatus(value) {
  return normalizeStatus(value).replaceAll("_", " ") || "N/A";
}

function formatDate(value) {
  if (!value) return "N/A";
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString();
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getDriverName(driver) {
  return `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${driver.id}`;
}

function getToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function getFutureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
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

document.getElementById("reportType").addEventListener("change", () => {
  configureStatusFilter();
  renderReport();
});
document.getElementById("statusFilter").addEventListener("change", renderReport);
document.getElementById("startDate").addEventListener("change", renderReport);
document.getElementById("endDate").addEventListener("change", renderReport);
document.getElementById("searchFilter").addEventListener("input", renderReport);
document.getElementById("clearReportFiltersBtn").addEventListener("click", () => {
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  document.getElementById("statusFilter").value = "";
  document.getElementById("searchFilter").value = "";
  renderReport();
});
document.getElementById("printReportBtn").addEventListener("click", () => window.print());
document.getElementById("exportCsvBtn").addEventListener("click", exportVisibleCsv);

initReports();
