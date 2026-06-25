(function () {
  const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
  let expenses = [];
  let loadMap = new Map();

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("refreshExpensesBtn")?.addEventListener("click", loadExpenseReview);
    document.getElementById("expenseStatusFilter")?.addEventListener("change", renderExpenseReview);
    document.getElementById("expenseTypeFilter")?.addEventListener("change", renderExpenseReview);
    document.getElementById("expenseSearch")?.addEventListener("input", renderExpenseReview);
    document.getElementById("clearExpenseFiltersBtn")?.addEventListener("click", clearFilters);
    loadExpenseReview();
  });

  async function loadExpenseReview() {
    setMessage("Loading driver expenses...");

    try {
      const context = await window.CompanyContext.ready();
      if (!context.companyId) {
        setMessage("No company selected. Create or select a company first.");
        expenses = [];
        renderExpenseReview();
        return;
      }

      document.getElementById("expenseReviewSubtitle").textContent =
        `${context.company?.company_name || "Current company"} expense review`;

      const [expenseRows, loads] = await Promise.all([
        fetchRows("load_expenses", "select=*&order=created_at.desc"),
        fetchRows("loads", "select=id,load_number,customer_name,customer,pickup_location,delivery_location,dropoff_location&order=created_at.desc")
      ]);

      expenses = expenseRows;
      loadMap = new Map(loads.map(load => [String(load.id), load]));
      renderKpis();
      renderExpenseReview();
      setMessage(expenses.length ? "" : "No driver expenses submitted yet.");
    } catch (err) {
      console.error("Expense review error:", err);
      if (String(err.message || "").includes("load_expenses")) {
        setMessage("Run Profit Intelligence v2 SQL first so load expenses can be reviewed.");
      } else {
        setMessage(`Error loading expenses: ${err.message}`);
      }
      renderEmpty("Unable to load expenses.");
    }
  }

  async function fetchRows(table, query) {
    const res = await fetch(window.CompanyContext.scopedUrl(table, query), {
      headers: window.CompanyContext.getHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function renderKpis() {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const pending = expenses.filter(expense => normalizeStatus(expense.status) === "unreviewed");
    const approvedThisMonth = expenses.filter(expense => {
      const created = new Date(expense.created_at);
      return normalizeStatus(expense.status) === "approved" && !Number.isNaN(created.getTime()) && created >= monthStart;
    });
    const rejected = expenses.filter(expense => normalizeStatus(expense.status) === "rejected");

    setText("pendingExpenseCount", String(pending.length));
    setText("pendingExpenseAmount", formatCurrency(sum(pending)));
    setText("approvedExpenseAmount", formatCurrency(sum(approvedThisMonth)));
    setText("rejectedExpenseCount", String(rejected.length));
  }

  function renderExpenseReview() {
    const statusFilter = document.getElementById("expenseStatusFilter")?.value || "";
    const typeFilter = document.getElementById("expenseTypeFilter")?.value || "";
    const search = normalizeSearch(document.getElementById("expenseSearch")?.value || "");

    const filtered = expenses.filter(expense => {
      const status = normalizeStatus(expense.status);
      const category = normalizeStatus(expense.category);
      const load = loadMap.get(String(expense.load_id));
      const haystack = normalizeSearch([
        expense.category,
        expense.notes,
        expense.status,
        load?.load_number,
        load?.customer_name,
        load?.customer,
        load?.pickup_location,
        load?.delivery_location,
        load?.dropoff_location
      ].filter(Boolean).join(" "));

      return (!statusFilter || status === statusFilter) &&
        (!typeFilter || category === typeFilter) &&
        (!search || haystack.includes(search));
    });

    const tbody = document.getElementById("expenseReviewTableBody");
    if (!tbody) return;

    if (!filtered.length) {
      renderEmpty("No expenses match the current filters.");
      return;
    }

    tbody.innerHTML = filtered.map(expense => {
      const load = loadMap.get(String(expense.load_id));
      const status = normalizeStatus(expense.status);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(load?.load_number || `Load ${expense.load_id}`)}</strong>
            <span class="muted-line">${escapeHtml(load?.customer_name || load?.customer || "")}</span>
          </td>
          <td>
            <strong>${escapeHtml(formatStatus(expense.category))}</strong>
            <span class="muted-line">${escapeHtml(expense.notes || "")}</span>
          </td>
          <td>${formatCurrency(expense.amount)}</td>
          <td><span class="status-pill ${getStatusClass(status)}">${escapeHtml(formatStatus(status))}</span></td>
          <td>${formatDateTime(expense.created_at)}</td>
          <td>${expense.receipt_url ? `<a class="view secondary-action" href="${escapeHtml(expense.receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : "N/A"}</td>
          <td>
            <a class="view secondary-action" href="load-details.html?id=${encodeURIComponent(expense.load_id)}">Load</a>
            ${status !== "approved" ? `<button class="view" type="button" data-expense-action="approved" data-expense-id="${escapeHtml(expense.id)}">Approve</button>` : ""}
            ${status !== "rejected" ? `<button class="delete" type="button" data-expense-action="rejected" data-expense-id="${escapeHtml(expense.id)}">Reject</button>` : ""}
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("[data-expense-action]").forEach(button => {
      button.addEventListener("click", () => updateExpenseStatus(button.dataset.expenseId, button.dataset.expenseAction));
    });
  }

  async function updateExpenseStatus(expenseId, status) {
    setMessage(`${formatStatus(status)} expense...`);

    try {
      const res = await fetch(`${BASE_URL}/rest/v1/load_expenses?id=eq.${encodeURIComponent(expenseId)}`, {
        method: "PATCH",
        headers: {
          ...window.CompanyContext.getHeaders(),
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ status })
      });

      if (!res.ok) throw new Error(await res.text());

      expenses = expenses.map(expense => String(expense.id) === String(expenseId) ? { ...expense, status } : expense);
      renderKpis();
      renderExpenseReview();
      setMessage(`Expense ${formatStatus(status)}.`);
    } catch (err) {
      console.error("Expense status update failed:", err);
      setMessage(`Error updating expense: ${err.message}`);
    }
  }

  function clearFilters() {
    document.getElementById("expenseStatusFilter").value = "";
    document.getElementById("expenseTypeFilter").value = "";
    document.getElementById("expenseSearch").value = "";
    renderExpenseReview();
  }

  function renderEmpty(message) {
    const tbody = document.getElementById("expenseReviewTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(message)}</td></tr>`;
  }

  function sum(rows) {
    return rows.reduce((total, row) => total + toNumber(row.amount), 0);
  }

  function normalizeStatus(value) {
    return String(value || "unreviewed").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  }

  function normalizeSearch(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatStatus(value) {
    return normalizeStatus(value).replaceAll("_", " ");
  }

  function getStatusClass(status) {
    if (status === "approved") return "success";
    if (status === "rejected") return "warning";
    return "caution";
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(toNumber(value));
  }

  function formatDateTime(value) {
    return value ? new Date(value).toLocaleString() : "N/A";
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setMessage(value) {
    const el = document.getElementById("expenseReviewMessage");
    if (el) el.textContent = value;
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
