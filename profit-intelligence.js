(function () {
  const OPTIONAL_TABLES = new Set([
    "documents",
    "driver_compliance",
    "invoices",
    "load_expenses",
    "load_issues",
    "maintenance_schedules"
  ]);

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("refreshProfitBtn")?.addEventListener("click", loadProfitIntelligence);
    loadProfitIntelligence();
  });

  async function loadProfitIntelligence() {
    setMessage("Loading profit intelligence...");

    try {
      const context = await window.CompanyContext.ready();
      if (!context.companyId) {
        setMessage("No company selected. Create or select a company first.");
        clearTables();
        return;
      }

      document.getElementById("profitSubtitle").textContent =
        `${context.company?.company_name || "Current company"} profit leak analysis`;

      const [loads, invoices, documents, maintenanceSchedules, driverCompliance, drivers, loadIssues, loadExpenses] = await Promise.all([
        fetchRows("loads"),
        fetchRows("invoices"),
        fetchRows("documents"),
        fetchRows("maintenance_schedules"),
        fetchRows("driver_compliance"),
        fetchRows("drivers"),
        fetchRows("load_issues"),
        fetchRows("load_expenses")
      ]);

      const intelligence = buildProfitIntelligence({
        loads,
        invoices,
        documents,
        maintenanceSchedules,
        driverCompliance,
        drivers,
        loadIssues,
        loadExpenses
      });

      renderKpis(intelligence);
      renderLeakCards(intelligence.leaks);
      renderRecommendations(intelligence.recommendations);
      renderCustomerProfitability(intelligence.customerProfitability);
      renderLeakDetails(intelligence.leaks);
      setMessage(intelligence.summary);
    } catch (err) {
      console.error("Profit intelligence error:", err);
      setMessage(err.message || "Unable to load profit intelligence.");
      clearTables();
    }
  }

  async function fetchRows(table) {
    try {
      const url = window.CompanyContext.scopedUrl(table, "select=*");
      const res = await fetch(url, { headers: window.CompanyContext.getHeaders() });

      if (!res.ok) {
        if (OPTIONAL_TABLES.has(table) && (res.status === 404 || res.status === 400)) return [];
        const body = await res.text();
        throw new Error(`Could not load ${table}: ${body}`);
      }

      return await res.json();
    } catch (err) {
      if (OPTIONAL_TABLES.has(table)) {
        console.warn(`Optional table unavailable: ${table}`, err);
        return [];
      }
      throw err;
    }
  }

  function buildProfitIntelligence(data) {
    const today = startOfDay(new Date());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const loads = data.loads || [];
    const invoices = data.invoices || [];
    const documents = data.documents || [];
    const maintenanceSchedules = data.maintenanceSchedules || [];
    const driverCompliance = data.driverCompliance || [];
    const drivers = data.drivers || [];
    const loadIssues = data.loadIssues || [];
    const loadExpenses = data.loadExpenses || [];
    const expenseByLoad = groupExpensesByLoad(loadExpenses);

    const monthLoads = loads.filter(load => {
      const date = parseDate(load.pickup_date || load.created_at);
      return date && date >= monthStart;
    });

    const deliveredLoads = loads.filter(load => normalize(load.status).includes("delivered") || normalize(load.status).includes("invoiced"));
    const invoiceLoadIds = new Set(invoices.map(invoice => String(invoice.load_id || "")).filter(Boolean));
    const documentLoadIds = new Set(documents.map(document => String(document.load_id || "")).filter(Boolean));

    const deliveredNotInvoiced = deliveredLoads.filter(load => !invoiceLoadIds.has(String(load.id)));
    const missingPodLoads = deliveredLoads.filter(load => !documentLoadIds.has(String(load.id)));
    const openInvoices = invoices.filter(invoice => !["paid", "void", "canceled", "cancelled"].includes(normalize(invoice.status)));
    const overdueInvoices = openInvoices.filter(invoice => {
      const dueDate = parseDate(invoice.due_date);
      return dueDate && dueDate < today;
    });

    const missingRateLoads = loads.filter(load => totalLoadRevenue(load) <= 0);
    const lowMarginLoads = loads.filter(load => {
      const revenue = totalLoadRevenue(load);
      const cost = totalLoadCost(load, expenseByLoad);
      if (!revenue || !cost) return false;
      return ((revenue - cost) / revenue) < 0.12;
    });

    const highDeadheadLoads = loads.filter(load => {
      const loadedMiles = toNumber(load.loaded_miles);
      const emptyMiles = toNumber(load.empty_miles);
      if (!loadedMiles || !emptyMiles) return false;
      return emptyMiles / (loadedMiles + emptyMiles) > 0.2;
    });

    const unrecoveredExpenseLoads = loads.filter(load => {
      const cost = toNumber(load.fuel_cost) + toNumber(load.toll_cost) + toNumber(load.lumper_cost) + toNumber(load.other_costs) + toNumber(expenseByLoad.get(String(load.id)));
      const recovery = toNumber(load.accessorial_billed);
      return cost > 0 && recovery < cost * 0.25;
    });

    const detentionLeakLoads = loads.filter(load => {
      const paid = toNumber(load.detention_paid);
      const billed = toNumber(load.detention_billed);
      return paid > billed;
    });

    const maintenanceDue = maintenanceSchedules.filter(item => {
      const dueDate = parseDate(item.next_due_date);
      return dueDate && dueDate <= addDays(today, 14);
    });

    const complianceRisks = [
      ...driverCompliance.filter(item => {
        const status = normalize(item.status);
        return status.includes("expired") || status.includes("expiring") || status.includes("missing");
      }),
      ...drivers.filter(driver => {
        return ["cdl_expiration", "medical_card_expiration", "hazmat_expiration", "drug_test_expiration", "safety_training_expiration"]
          .some(field => {
            const date = parseDate(driver[field]);
            return date && date <= addDays(today, 30);
          });
      })
    ];

    const issueImpact = sum(loadIssues, issue => toNumber(issue.claim_amount || issue.estimated_cost || issue.cost));
    const lowMarginGap = lowMarginLoads.reduce((total, load) => {
      const revenue = totalLoadRevenue(load);
      const cost = totalLoadCost(load, expenseByLoad);
      const targetRevenue = cost / 0.88;
      return total + Math.max(0, targetRevenue - revenue);
    }, 0);

    const leaks = [
      {
        area: "Delivered Not Invoiced",
        count: deliveredNotInvoiced.length,
        impact: sum(deliveredNotInvoiced, totalLoadRevenue),
        severity: "critical",
        fix: "Create invoices for delivered loads so revenue does not sit unbilled."
      },
      {
        area: "Missing POD / Documents",
        count: missingPodLoads.length,
        impact: sum(missingPodLoads, totalLoadRevenue),
        severity: "warning",
        fix: "Attach POD or delivery documents before collection problems start."
      },
      {
        area: "Overdue Receivables",
        count: overdueInvoices.length,
        impact: sum(overdueInvoices, invoiceTotal),
        severity: "critical",
        fix: "Follow up with customers and update paid invoices."
      },
      {
        area: "Missing Rates",
        count: missingRateLoads.length,
        impact: 0,
        severity: "warning",
        fix: "Add load rates so revenue, margin, and reports are accurate."
      },
      {
        area: "Low Margin Loads",
        count: lowMarginLoads.length,
        impact: lowMarginGap,
        severity: "warning",
        fix: "Review pricing on loads below a 12% target margin."
      },
      {
        area: "High Deadhead Miles",
        count: highDeadheadLoads.length,
        impact: sum(highDeadheadLoads, load => {
          const totalMiles = toNumber(load.loaded_miles) + toNumber(load.empty_miles);
          const costPerMile = totalMiles ? totalLoadCost(load, expenseByLoad) / totalMiles : 0;
          return toNumber(load.empty_miles) * costPerMile;
        }),
        severity: "warning",
        fix: "Reduce unpaid empty miles or price lanes to cover deadhead."
      },
      {
        area: "Unrecovered Expenses",
        count: unrecoveredExpenseLoads.length,
        impact: sum(unrecoveredExpenseLoads, load => {
          const cost = toNumber(load.fuel_cost) + toNumber(load.toll_cost) + toNumber(load.lumper_cost) + toNumber(load.other_costs) + toNumber(expenseByLoad.get(String(load.id)));
          return Math.max(0, cost - toNumber(load.accessorial_billed));
        }),
        severity: "warning",
        fix: "Review fuel, toll, lumper, and receipt costs that are not being recovered."
      },
      {
        area: "Detention Not Recovered",
        count: detentionLeakLoads.length,
        impact: sum(detentionLeakLoads, load => Math.max(0, toNumber(load.detention_paid) - toNumber(load.detention_billed))),
        severity: "warning",
        fix: "Bill detention or adjust customer terms when detention paid is higher than detention billed."
      },
      {
        area: "Maintenance Due",
        count: maintenanceDue.length,
        impact: 0,
        severity: "info",
        fix: "Schedule service before equipment downtime affects revenue."
      },
      {
        area: "Compliance Risk",
        count: complianceRisks.length,
        impact: 0,
        severity: "warning",
        fix: "Update expiring or missing driver compliance records."
      },
      {
        area: "Load Issues / Claims",
        count: loadIssues.length,
        impact: issueImpact,
        severity: issueImpact > 0 ? "critical" : "info",
        fix: "Resolve open load issues and recover claimable costs."
      }
    ];

    const actionableLeaks = leaks.filter(leak => leak.count > 0 || leak.impact > 0);
    const leakEstimate = actionableLeaks.reduce((total, leak) => total + toNumber(leak.impact), 0);
    const revenue = sum(monthLoads, totalLoadRevenue);
    const receivables = sum(openInvoices, invoiceTotal);
    const customerProfitability = buildCustomerProfitability(loads);

    return {
      revenue,
      receivables,
      leakEstimate,
      actionCount: actionableLeaks.length,
      leaks,
      recommendations: actionableLeaks
        .slice()
        .sort((a, b) => (severityRank(b.severity) - severityRank(a.severity)) || (b.impact - a.impact))
        .slice(0, 5),
      customerProfitability: buildCustomerProfitability(loads, expenseByLoad),
      summary: actionableLeaks.length
        ? `${actionableLeaks.length} profit leak areas need attention. Estimated revenue or cash at risk: ${formatCurrency(leakEstimate)}.`
        : "No major profit leaks found from current company data."
    };
  }

  function buildCustomerProfitability(loads, expenseByLoad) {
    const map = new Map();

    loads.forEach(load => {
      const customer = load.customer_name || load.customer || "Unassigned Customer";
      const current = map.get(customer) || { customer, revenue: 0, cost: 0, loads: 0 };
      current.revenue += totalLoadRevenue(load);
      current.cost += totalLoadCost(load, expenseByLoad);
      current.loads += 1;
      map.set(customer, current);
    });

    return Array.from(map.values())
      .map(row => ({
        ...row,
        margin: row.revenue - row.cost,
        marginPercent: row.revenue ? ((row.revenue - row.cost) / row.revenue) * 100 : 0
      }))
      .sort((a, b) => a.marginPercent - b.marginPercent)
      .slice(0, 6);
  }

  function renderKpis(intelligence) {
    setText("profitRevenue", formatCurrency(intelligence.revenue));
    setText("profitReceivables", formatCurrency(intelligence.receivables));
    setText("profitLeakEstimate", formatCurrency(intelligence.leakEstimate));
    setText("profitActionCount", String(intelligence.actionCount));
  }

  function renderLeakCards(leaks) {
    const grid = document.getElementById("leakGrid");
    if (!grid) return;

    grid.innerHTML = leaks.map(leak => `
      <article class="quick-start-card">
        <strong>${escapeHtml(leak.area)}</strong>
        <span>${escapeHtml(leak.fix)}</span>
        <small>${leak.count} item${leak.count === 1 ? "" : "s"} | ${formatCurrency(leak.impact)}</small>
      </article>
    `).join("");
  }

  function renderRecommendations(recommendations) {
    const list = document.getElementById("recommendationsList");
    if (!list) return;

    if (!recommendations.length) {
      list.innerHTML = `<div class="empty-state">No urgent recommendations right now.</div>`;
      return;
    }

    list.innerHTML = recommendations.map((item, index) => `
      <div class="dashboard-list-item">
        <span class="status-count">${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.area)}</strong>
          <small>${escapeHtml(item.fix)} ${item.impact ? `Impact: ${formatCurrency(item.impact)}.` : ""}</small>
        </div>
      </div>
    `).join("");
  }

  function renderCustomerProfitability(rows) {
    const body = document.getElementById("customerProfitRows");
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4">No customer load data yet.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.customer)}</td>
        <td>${formatCurrency(row.revenue)}</td>
        <td>${formatCurrency(row.cost)}</td>
        <td>${formatCurrency(row.margin)} (${formatPercent(row.marginPercent)})</td>
      </tr>
    `).join("");
  }

  function renderLeakDetails(leaks) {
    const body = document.getElementById("leakDetailsRows");
    if (!body) return;

    body.innerHTML = leaks.map(leak => `
      <tr>
        <td>${escapeHtml(leak.area)}</td>
        <td>${leak.count}</td>
        <td>${formatCurrency(leak.impact)}</td>
        <td>${escapeHtml(leak.fix)}</td>
      </tr>
    `).join("");
  }

  function clearTables() {
    setText("profitRevenue", "$0");
    setText("profitReceivables", "$0");
    setText("profitLeakEstimate", "$0");
    setText("profitActionCount", "0");
    const leakGrid = document.getElementById("leakGrid");
    if (leakGrid) leakGrid.innerHTML = "";
    const recommendations = document.getElementById("recommendationsList");
    if (recommendations) recommendations.innerHTML = "";
    const customerRows = document.getElementById("customerProfitRows");
    if (customerRows) customerRows.innerHTML = `<tr><td colspan="4">No data available.</td></tr>`;
    const leakRows = document.getElementById("leakDetailsRows");
    if (leakRows) leakRows.innerHTML = `<tr><td colspan="4">No data available.</td></tr>`;
  }

  function invoiceTotal(invoice) {
    if (invoice.total_amount !== undefined && invoice.total_amount !== null) return toNumber(invoice.total_amount);
    if (invoice.amount !== undefined && invoice.amount !== null) return toNumber(invoice.amount);
    if (invoice.invoice_total !== undefined && invoice.invoice_total !== null) return toNumber(invoice.invoice_total);
    return toNumber(invoice.linehaul_amount) + toNumber(invoice.accessorial_amount);
  }

  function totalLoadRevenue(load) {
    return toNumber(load.rate) + toNumber(load.detention_billed) + toNumber(load.accessorial_billed);
  }

  function totalLoadCost(load, expenseByLoad = new Map()) {
    return toNumber(load.carrier_rate) +
      toNumber(load.fuel_cost) +
      toNumber(load.toll_cost) +
      toNumber(load.detention_paid) +
      toNumber(load.lumper_cost) +
      toNumber(load.other_costs) +
      toNumber(expenseByLoad.get(String(load.id)));
  }

  function groupExpensesByLoad(expenses) {
    const map = new Map();
    expenses.forEach(expense => {
      const status = normalize(expense.status || "unreviewed");
      if (!["approved", "reviewed"].includes(status)) return;
      const key = String(expense.load_id || "");
      if (!key) return;
      map.set(key, toNumber(map.get(key)) + toNumber(expense.amount));
    });
    return map;
  }

  function sum(rows, selector) {
    return rows.reduce((total, row) => total + toNumber(selector(row)), 0);
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function severityRank(severity) {
    return { critical: 3, warning: 2, info: 1 }[severity] || 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(toNumber(value));
  }

  function formatPercent(value) {
    return `${toNumber(value).toFixed(1)}%`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setMessage(message) {
    const el = document.getElementById("profitMessage");
    if (el) el.textContent = message;
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
