const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let loads = [];
let drivers = new Map();
let assignments = new Map();
let settlements = [];

async function initSettlements() {
  const msg = document.getElementById("settlementMessage");
  msg.textContent = "Loading settlements...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    const [loadRows, driverRows, assignmentRows, settlementRows] = await Promise.all([
      fetchRows("loads", "select=*&order=created_at.desc"),
      fetchRows("drivers", "select=id,first_name,last_name"),
      fetchRowsOptional("assignments", "select=id,load_id,driver_id,truck_id,status"),
      fetchRowsOptional("settlements", "select=*&order=created_at.desc")
    ]);

    loads = loadRows;
    drivers = new Map(driverRows.map(driver => [driver.id, getDriverName(driver)]));
    assignments = buildAssignmentMap(assignmentRows);
    settlements = settlementRows;

    fillLoadSelect();
    renderSettlements();
    updateKpis();
    setDefaultDate();
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = getSettlementTableMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

async function fetchRows(table, query) {
  const url = window.CompanyContext?.scopedUrl(table, query) || `${BASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchRowsOptional(table, query) {
  try {
    return await fetchRows(table, query);
  } catch (err) {
    console.warn(`Optional table unavailable: ${table}`, err);
    return [];
  }
}

function buildAssignmentMap(rows) {
  const map = new Map();
  rows
    .filter(row => (row.status || "active") === "active")
    .forEach(row => {
      if (row.load_id && !map.has(row.load_id)) map.set(row.load_id, row);
    });
  return map;
}

function fillLoadSelect() {
  const select = document.getElementById("loadSelect");
  const settledLoadIds = new Set(settlements.filter(row => row.load_id).map(row => row.load_id));
  select.innerHTML = `<option value="">Select load</option>`;

  loads
    .filter(load => !settledLoadIds.has(load.id) || ["delivered", "invoiced", "paid"].includes(normalizeStatus(load.status)))
    .forEach(load => {
      const option = document.createElement("option");
      option.value = load.id;
      option.textContent = `${load.load_number || `Load ${load.id}`} - ${load.customer_name || load.customer || "Customer"} - ${formatCurrency(load.rate)}`;
      select.appendChild(option);
    });
}

function setDefaultDate() {
  const input = document.getElementById("settlementDate");
  if (!input.value) input.value = getToday();
}

function fillSettlementDefaults() {
  const load = getSelectedLoad();
  if (!load) return;

  const gross = Number(load.rate || 0);
  const driverPay = Math.round(gross * 0.3 * 100) / 100;
  const deductions = Number(document.getElementById("deductions").value || 0);

  document.getElementById("settlementNumber").value = load.load_number ? `SET-${load.load_number}` : `SET-${load.id}`;
  document.getElementById("grossRevenue").value = gross;
  document.getElementById("driverPay").value = driverPay;
  document.getElementById("netProfit").value = calculateNet(gross, driverPay, deductions);
}

function recalculateNet() {
  const gross = Number(document.getElementById("grossRevenue").value || 0);
  const driverPay = Number(document.getElementById("driverPay").value || 0);
  const deductions = Number(document.getElementById("deductions").value || 0);
  document.getElementById("netProfit").value = calculateNet(gross, driverPay, deductions);
}

function calculateNet(gross, driverPay, deductions) {
  return Math.round((Number(gross || 0) - Number(driverPay || 0) - Number(deductions || 0)) * 100) / 100;
}

async function saveSettlement(e) {
  e.preventDefault();
  const msg = document.getElementById("settlementMessage");
  const data = Object.fromEntries(new FormData(e.target).entries());
  const load = loads.find(row => String(row.id) === String(data.load_id));
  const assignment = assignments.get(Number(data.load_id));

  if (!load) {
    msg.textContent = "Select a load first.";
    msg.style.color = "#ef4444";
    return;
  }

  const settlement = window.CompanyContext?.withCompanyId({
    settlement_date: data.settlement_date || null,
    load_id: Number(data.load_id),
    driver_id: load.driver_id || assignment?.driver_id || null,
    settlement_number: data.settlement_number || null,
    status: data.status || "draft",
    gross_revenue: Number(data.gross_revenue || 0),
    driver_pay: Number(data.driver_pay || 0),
    deductions: Number(data.deductions || 0),
    net_profit: calculateNet(data.gross_revenue, data.driver_pay, data.deductions),
    notes: data.notes || null
  }) || {
    settlement_date: data.settlement_date || null,
    load_id: Number(data.load_id),
    driver_id: load.driver_id || assignment?.driver_id || null,
    settlement_number: data.settlement_number || null,
    status: data.status || "draft",
    gross_revenue: Number(data.gross_revenue || 0),
    driver_pay: Number(data.driver_pay || 0),
    deductions: Number(data.deductions || 0),
    net_profit: calculateNet(data.gross_revenue, data.driver_pay, data.deductions),
    notes: data.notes || null
  };

  msg.textContent = "Saving settlement...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/settlements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Authorization: "Bearer " + API_KEY,
        Prefer: "return=representation"
      },
      body: JSON.stringify(settlement)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    msg.textContent = "Settlement saved.";
    msg.style.color = "#047857";
    e.target.reset();
    setDefaultDate();
    await initSettlements();
  } catch (err) {
    console.error(err);
    msg.textContent = getSettlementTableMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

function renderSettlements() {
  const tbody = document.getElementById("settlementsTableBody");
  tbody.innerHTML = "";

  if (!settlements.length) {
    tbody.innerHTML = `<tr><td colspan="10">No settlements found.</td></tr>`;
    return;
  }

  settlements.forEach(row => {
    const load = loads.find(loadRow => loadRow.id === row.load_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.settlement_number || row.id}</td>
      <td>${formatDate(row.settlement_date || row.created_at)}</td>
      <td>${load?.load_number || row.load_id || "N/A"}</td>
      <td>${drivers.get(row.driver_id) || "Unassigned"}</td>
      <td>${formatStatus(row.status)}</td>
      <td>${formatCurrency(row.gross_revenue)}</td>
      <td>${formatCurrency(row.driver_pay)}</td>
      <td>${formatCurrency(row.deductions)}</td>
      <td>${formatCurrency(row.net_profit)}</td>
      <td><button class="delete" data-delete="${row.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () => deleteSettlement(button.dataset.delete));
  });
}

async function deleteSettlement(id) {
  if (!confirm("Delete this settlement?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/settlements?id=eq.${id}`, {
      method: "DELETE",
      headers
    });

    if (!res.ok) throw new Error(await res.text());
    await initSettlements();
  } catch (err) {
    console.error(err);
    alert(getSettlementTableMessage(err.message));
  }
}

function updateKpis() {
  const gross = settlements.reduce((sum, row) => sum + Number(row.gross_revenue || 0), 0);
  const driverPay = settlements.reduce((sum, row) => sum + Number(row.driver_pay || 0), 0);
  const net = settlements.reduce((sum, row) => sum + Number(row.net_profit || 0), 0);

  document.getElementById("kpiSettlementCount").textContent = settlements.length;
  document.getElementById("kpiGrossRevenue").textContent = formatCurrency(gross);
  document.getElementById("kpiDriverPay").textContent = formatCurrency(driverPay);
  document.getElementById("kpiNetProfit").textContent = formatCurrency(net);
}

function exportSettlementsCsv() {
  if (!settlements.length) {
    document.getElementById("settlementMessage").textContent = "No settlements to export.";
    return;
  }

  const header = ["Settlement #", "Date", "Load", "Driver", "Status", "Gross Revenue", "Driver Pay", "Deductions", "Net Profit", "Notes"];
  const rows = settlements.map(row => {
    const load = loads.find(loadRow => loadRow.id === row.load_id);
    return [
      row.settlement_number || row.id,
      row.settlement_date || "",
      load?.load_number || row.load_id || "",
      drivers.get(row.driver_id) || "",
      row.status || "",
      row.gross_revenue || 0,
      row.driver_pay || 0,
      row.deductions || 0,
      row.net_profit || 0,
      row.notes || ""
    ];
  });

  const csv = [header, ...rows].map(row => row.map(formatCsvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `settlements-${getToday()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getSelectedLoad() {
  const loadId = document.getElementById("loadSelect").value;
  return loads.find(load => String(load.id) === String(loadId));
}

function getDriverName(driver) {
  return `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${driver.id}`;
}

function getSettlementTableMessage(message) {
  if (message.includes("settlements")) {
    return "Settlements table is not ready. Run the settlements SQL first, then reload this page.";
  }
  return message;
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function formatStatus(value) {
  return normalizeStatus(value).replaceAll("_", " ") || "N/A";
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "N/A";
  return new Date(String(value).slice(0, 10) + "T00:00:00").toLocaleDateString();
}

function formatCsvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function getToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

document.getElementById("settlementForm").addEventListener("submit", saveSettlement);
document.getElementById("loadSelect").addEventListener("change", fillSettlementDefaults);
document.getElementById("grossRevenue").addEventListener("input", recalculateNet);
document.getElementById("driverPay").addEventListener("input", recalculateNet);
document.getElementById("deductions").addEventListener("input", recalculateNet);
document.getElementById("exportSettlementsBtn").addEventListener("click", exportSettlementsCsv);

initSettlements();
