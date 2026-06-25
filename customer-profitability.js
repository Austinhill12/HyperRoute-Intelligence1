(function () {
  let rows = [];

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("customerSearch")?.addEventListener("input", renderCustomerProfitability);
    document.getElementById("recommendationFilter")?.addEventListener("change", renderCustomerProfitability);
    document.getElementById("clearCustomerProfitFiltersBtn")?.addEventListener("click", clearFilters);

    const selectedCustomer = new URLSearchParams(window.location.search).get("customer");
    if (selectedCustomer) document.getElementById("customerSearch").value = selectedCustomer;

    loadCustomerProfitability();
  });

  async function loadCustomerProfitability() {
    setMessage("Loading customer profitability...");

    try {
      const context = await window.CompanyContext.ready();
      if (!context.companyId) {
        setMessage("No company selected. Create or select a company first.");
        renderEmpty("No company selected.");
        return;
      }

      document.getElementById("customerProfitSubtitle").textContent =
        `${context.company?.company_name || "Current company"} customer margin review`;

      const [loads, invoices, loadExpenses, loadIssues] = await Promise.all([
        fetchRows("loads", "select=*"),
        fetchRows("invoices", "select=*"),
        fetchRows("load_expenses", "select=*"),
        fetchRows("load_issues", "select=*")
      ]);

      rows = buildCustomerRows({ loads, invoices, loadExpenses, loadIssues });
      renderKpis(rows);
      renderCustomerProfitability();
      setMessage(rows.length ? "" : "No customer load data yet.");
    } catch (err) {
      console.error("Customer profitability error:", err);
      setMessage(`Error loading customer profitability: ${err.message}`);
      renderEmpty("Unable to load customer profitability.");
    }
  }

  async function fetchRows(table, query) {
    const res = await fetch(window.CompanyContext.scopedUrl(table, query), {
      headers: window.CompanyContext.getHeaders()
    });
    if (!res.ok) {
      if (["load_expenses", "load_issues"].includes(table)) return [];
      throw new Error(await res.text());
    }
    return res.json();
  }

  function buildCustomerRows(data) {
    const expenseByLoad = new Map();
    (data.loadExpenses || []).forEach(expense => {
      const status = normalize(expense.status);
      if (!["approved", "reviewed"].includes(status)) return;
      const loadId = String(expense.load_id || "");
      if (!loadId) return;
      expenseByLoad.set(loadId, toNumber(expenseByLoad.get(loadId)) + toNumber(expense.amount));
    });

    const issueByLoad = new Map();
    (data.loadIssues || []).forEach(issue => {
      if (["resolved", "closed"].includes(normalize(issue.status))) return;
      const loadId = String(issue.load_id || "");
      if (!loadId) return;
      const current = issueByLoad.get(loadId) || { count: 0, amount: 0 };
      current.count += 1;
      current.amount += toNumber(issue.claim_amount || issue.estimated_cost || issue.cost);
      issueByLoad.set(loadId, current);
    });

    const invoiceByCustomer = new Map();
    (data.invoices || []).forEach(invoice => {
      const customer = getCustomerName(invoice);
      if (!customer) return;
      const current = invoiceByCustomer.get(customer) || { receivables: 0, overdue: 0 };
      if (!["paid", "void", "cancelled", "canceled"].includes(normalize(invoice.status))) {
        current.receivables += invoiceTotal(invoice);
        if (invoice.due_date && new Date(`${invoice.due_date}T00:00:00`) < startOfDay(new Date())) current.overdue += 1;
      }
      invoiceByCustomer.set(customer, current);
    });

    const map = new Map();
    (data.loads || []).forEach(load => {
      const customer = getCustomerName(load) || "Unassigned Customer";
      const current = map.get(customer) || {
        customer,
        loads: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        issues: 0,
        issueExposure: 0,
        receivables: 0,
        overdueInvoices: 0
      };
      const revenue = loadRevenue(load);
      const issue = issueByLoad.get(String(load.id)) || { count: 0, amount: 0 };
      const cost = loadCost(load, expenseByLoad) + issue.amount;
      current.loads += 1;
      current.revenue += revenue;
      current.cost += cost;
      current.profit += revenue - cost;
      current.issues += issue.count;
      current.issueExposure += issue.amount;
      map.set(customer, current);
    });

    invoiceByCustomer.forEach((invoiceData, customer) => {
      const current = map.get(customer) || {
        customer,
        loads: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        issues: 0,
        issueExposure: 0,
        receivables: 0,
        overdueInvoices: 0
      };
      current.receivables += invoiceData.receivables;
      current.overdueInvoices += invoiceData.overdue;
      map.set(customer, current);
    });

    return Array.from(map.values())
      .map(row => {
        const marginPercent = row.revenue ? (row.profit / row.revenue) * 100 : 0;
        return {
          ...row,
          marginPercent,
          recommendation: getRecommendation({ ...row, marginPercent })
        };
      })
      .sort((a, b) => a.marginPercent - b.marginPercent);
  }

  function renderKpis(allRows) {
    const revenue = allRows.reduce((total, row) => total + row.revenue, 0);
    const profit = allRows.reduce((total, row) => total + row.profit, 0);
    const margin = revenue ? (profit / revenue) * 100 : 0;
    const atRisk = allRows.filter(row => ["raise_rates", "watch", "stop_servicing"].includes(row.recommendation.key));

    setText("customerRevenueTotal", formatCurrency(revenue));
    setText("customerProfitTotal", formatCurrency(profit));
    setText("customerMarginAverage", `${margin.toFixed(1)}%`);
    setText("customerAtRiskCount", String(atRisk.length));
  }

  function renderCustomerProfitability() {
    const search = normalize(document.getElementById("customerSearch")?.value || "");
    const recommendation = document.getElementById("recommendationFilter")?.value || "";
    const filtered = rows.filter(row =>
      (!search || normalize(row.customer).includes(search)) &&
      (!recommendation || row.recommendation.key === recommendation)
    );

    const tbody = document.getElementById("customerProfitabilityTableBody");
    if (!tbody) return;

    if (!filtered.length) {
      renderEmpty("No customers match the current filters.");
      return;
    }

    tbody.innerHTML = filtered.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.customer)}</strong></td>
        <td>${row.loads}</td>
        <td>${formatCurrency(row.revenue)}</td>
        <td>${formatCurrency(row.cost)}</td>
        <td>${formatCurrency(row.profit)}</td>
        <td>${row.marginPercent.toFixed(1)}%</td>
        <td>${formatCurrency(row.receivables)}</td>
        <td>${row.issues}</td>
        <td><span class="status-pill ${row.recommendation.className}">${escapeHtml(row.recommendation.label)}</span></td>
      </tr>
    `).join("");
  }

  function getRecommendation(row) {
    if (row.loads > 0 && (row.profit < 0 || row.marginPercent < 3)) {
      return { key: "stop_servicing", label: "Stop / Reprice", className: "warning" };
    }
    if (row.loads > 0 && row.marginPercent < 12) {
      return { key: "raise_rates", label: "Raise Rates", className: "caution" };
    }
    if (row.issues > 0 || row.overdueInvoices > 0 || row.receivables > row.revenue * 0.35) {
      return { key: "watch", label: "Watch Closely", className: "caution" };
    }
    return { key: "keep", label: "Keep", className: "success" };
  }

  function loadRevenue(load) {
    return toNumber(load.rate) + toNumber(load.detention_billed) + toNumber(load.accessorial_billed);
  }

  function loadCost(load, expenseByLoad) {
    return toNumber(load.carrier_rate) +
      toNumber(load.fuel_cost) +
      toNumber(load.toll_cost) +
      toNumber(load.detention_paid) +
      toNumber(load.lumper_cost) +
      toNumber(load.other_costs) +
      toNumber(expenseByLoad.get(String(load.id)));
  }

  function invoiceTotal(invoice) {
    if (invoice.total_amount !== undefined && invoice.total_amount !== null) return toNumber(invoice.total_amount);
    return toNumber(invoice.amount) + toNumber(invoice.linehaul_amount) + toNumber(invoice.accessorial_amount);
  }

  function getCustomerName(row) {
    return row.customer_name || row.customer || row.company_name || "";
  }

  function clearFilters() {
    document.getElementById("customerSearch").value = "";
    document.getElementById("recommendationFilter").value = "";
    renderCustomerProfitability();
  }

  function renderEmpty(message) {
    const tbody = document.getElementById("customerProfitabilityTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(message)}</td></tr>`;
  }

  function setMessage(value) {
    const el = document.getElementById("customerProfitabilityMessage");
    if (el) el.textContent = value;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(toNumber(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
