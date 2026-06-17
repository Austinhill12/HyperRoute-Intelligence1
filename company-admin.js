const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let companies = [];
let currentCompany = null;
let companyUsers = [];
let userInvites = [];
let isCreatingCompany = false;

async function initCompanyAdmin() {
  const msg = document.getElementById("companyAdminMessage");
  msg.textContent = "Loading company admin...";
  msg.style.color = "";

  try {
    await window.CompanyContext?.ready();
    await loadCompanies();

    if (!companies.length) {
      startNewCompany();
      msg.textContent = "No company found. Create the first company or run the multi-company SQL.";
      msg.style.color = "#ef4444";
      return;
    }

    const activeCompanyId = window.CompanyContext?.getCompanyId();
    selectCompany(activeCompanyId || companies[0].id);
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = getCompanyAdminMessage(err.message);
    msg.style.color = "#ef4444";
    updateKpis();
  }
}

async function loadCompanies(selectedId = null) {
  companies = await fetchRows("companies", "select=*&order=company_name.asc");
  fillCompanySelect(selectedId);
  renderCompaniesTable();
  updateKpis();
}

async function fetchRows(table, query) {
  const res = await fetch(`${BASE_URL}/rest/v1/${table}?${query}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || headers),
    ...extra
  };
}

function fillCompanySelect(selectedId = null) {
  const select = document.getElementById("companySelect");
  select.innerHTML = "";

  if (!companies.length) {
    select.innerHTML = `<option value="">No companies saved</option>`;
    return;
  }

  companies.forEach(company => {
    const option = document.createElement("option");
    option.value = company.id;
    option.textContent = `${company.company_name} (${company.status || "active"})`;
    option.selected = String(company.id) === String(selectedId);
    select.appendChild(option);
  });
}

function renderCompaniesTable() {
  const tbody = document.getElementById("companiesTableBody");
  tbody.innerHTML = "";

  if (!companies.length) {
    tbody.innerHTML = `<tr><td colspan="6">No companies found.</td></tr>`;
    return;
  }

  companies.forEach(company => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(company.company_name)}</td>
      <td>${escapeHtml(company.legal_name || "N/A")}</td>
      <td>${escapeHtml(company.phone || "N/A")}</td>
      <td>${escapeHtml(company.email || "N/A")}</td>
      <td>${formatStatus(company.status)}</td>
      <td><button class="view" type="button" data-edit-company="${escapeHtml(company.id)}">Edit</button></td>
    `;
    tbody.appendChild(row);
  });

  tbody.onclick = (event) => {
    const button = event.target.closest("[data-edit-company]");
    if (!button) return;
    selectCompany(button.dataset.editCompany);
  };
}

async function selectCompany(companyId) {
  const company = companies.find(row => String(row.id) === String(companyId)) || null;
  currentCompany = company;
  isCreatingCompany = false;

  if (!currentCompany) {
    const msg = document.getElementById("companyAdminMessage");
    msg.textContent = "That company could not be loaded. Refresh the page and try again.";
    msg.style.color = "#ef4444";
    return;
  }

  document.getElementById("companySelect").value = currentCompany.id;
  document.getElementById("companyFormTitle").textContent = "Company Profile";
  document.getElementById("companyModeText").textContent = `Editing: ${currentCompany.company_name}`;
  fillCompanyForm(currentCompany);
  document.getElementById("companyAdminMessage").textContent = `${currentCompany.company_name} loaded for editing.`;
  document.getElementById("companyAdminMessage").style.color = "#047857";
  window.CompanyContext?.setCompanyId(currentCompany.id);
  document.getElementById("companyFormTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  await loadCompanyUsers();
}

function startNewCompany() {
  currentCompany = null;
  companyUsers = [];
  userInvites = [];
  isCreatingCompany = true;

  document.getElementById("companyFormTitle").textContent = "New Company";
  document.getElementById("companyModeText").textContent = "Creating a new company. Saving will add another company, not overwrite the selected one.";
  document.getElementById("companySelect").selectedIndex = -1;
  document.getElementById("companyForm").reset();
  document.getElementById("companyId").value = "";
  document.getElementById("companyStatus").value = "active";
  document.getElementById("companyUsersTableBody").innerHTML = `<tr><td colspan="5">Save the company before adding users.</td></tr>`;
  document.getElementById("userInvitesTableBody").innerHTML = `<tr><td colspan="5">Save the company before inviting users.</td></tr>`;
  updateKpis();
}

async function loadCompanyUsers() {
  if (!currentCompany) return;

  companyUsers = await fetchRows(
    "company_users",
    `company_id=eq.${currentCompany.id}&select=*&order=created_at.desc`
  );
  await loadUserInvites();
  renderCompanyUsers();
  updateKpis();
}

async function loadUserInvites() {
  if (!currentCompany) return;

  try {
    userInvites = await fetchRows(
      "user_invites",
      `company_id=eq.${currentCompany.id}&select=*&order=created_at.desc`
    );
  } catch (err) {
    console.warn("User invites unavailable:", err);
    userInvites = [];
  }

  renderUserInvites();
}

function fillCompanyForm(company) {
  const form = document.getElementById("companyForm");
  form.reset();
  Object.entries(company).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
  });
}

async function saveCompany(e) {
  e.preventDefault();
  const msg = document.getElementById("companyAdminMessage");
  const data = Object.fromEntries(new FormData(e.target).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  msg.textContent = "Saving selected company...";
  msg.style.color = "";

  try {
    const saved = await updateCompany(data);

    currentCompany = saved;
    isCreatingCompany = false;
    window.CompanyContext?.setCompanyId(saved.id);
    await loadCompanies(saved.id);
    document.getElementById("companyFormTitle").textContent = "Company Profile";
    document.getElementById("companyModeText").textContent = `Editing: ${saved.company_name}`;
    fillCompanyForm(saved);
    await loadCompanyUsers();

    msg.textContent = `Company saved. ${companies.length} compan${companies.length === 1 ? "y" : "ies"} now available.`;
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = getCompanyAdminMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

async function saveNewCompany(e) {
  e.preventDefault();
  const msg = document.getElementById("companyAdminMessage");
  const data = Object.fromEntries(new FormData(e.target).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });
  data.status = "active";

  msg.textContent = "Creating new company...";
  msg.style.color = "";

  try {
    const saved = await createCompany(data);
    e.target.reset();
    currentCompany = saved;
    isCreatingCompany = false;
    window.CompanyContext?.setCompanyId(saved.id);
    await loadCompanies(saved.id);
    document.getElementById("companyFormTitle").textContent = "Company Profile";
    document.getElementById("companyModeText").textContent = `Editing: ${saved.company_name}`;
    fillCompanyForm(saved);
    await loadCompanyUsers();
    msg.textContent = `New company created. ${companies.length} compan${companies.length === 1 ? "y" : "ies"} now available.`;
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = getCompanyAdminMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

async function createCompany(data) {
  const companyData = {
    company_name: data.company_name,
    legal_name: data.legal_name,
    phone: data.phone,
    email: data.email,
    website: data.website,
    address_line_1: data.address_line_1,
    address_line_2: data.address_line_2,
    city: data.city,
    state: data.state,
    zip: data.zip,
    mc_number: data.mc_number,
    dot_number: data.dot_number,
    status: data.status || "active"
  };

  const res = await fetch(`${BASE_URL}/rest/v1/companies`, {
    method: "POST",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(companyData)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

async function updateCompany(data) {
  if (!data.id) {
    throw new Error("No company selected. Click New Company to create one, or select a company to edit.");
  }

  data.updated_at = new Date().toISOString();

  const res = await fetch(`${BASE_URL}/rest/v1/companies?id=eq.${data.id}`, {
    method: "PATCH",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(data)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

async function addCompanyUser(e) {
  e.preventDefault();
  const msg = document.getElementById("companyAdminMessage");

  if (!currentCompany) {
    msg.textContent = "Save or select a company before adding users.";
    msg.style.color = "#ef4444";
    return;
  }

  const data = Object.fromEntries(new FormData(e.target).entries());
  const email = String(data.email || "").trim().toLowerCase();
  const userId = String(data.user_id || "").trim();

  if (!email) {
    msg.textContent = "Enter the user's email address.";
    msg.style.color = "#ef4444";
    return;
  }

  const invite = {
    company_id: currentCompany.id,
    email,
    role: data.role,
    status: userId ? "accepted" : "pending"
  };

  const user = {
    company_id: currentCompany.id,
    user_id: userId,
    role: data.role,
    status: data.status
  };

  msg.textContent = userId ? "Saving company user..." : "Saving invite...";
  msg.style.color = "";

  try {
    await upsertUserInvite(invite);

    if (!userId) {
      e.target.reset();
      document.getElementById("userRole").value = "company_owner";
      document.getElementById("userStatus").value = "active";
      msg.textContent = "Invite saved. Create the Supabase Auth user, then add their Auth User ID here to activate access.";
      msg.style.color = "#047857";
      await loadUserInvites();
      return;
    }

    const res = await fetch(`${BASE_URL}/rest/v1/company_users?on_conflict=company_id,user_id`, {
      method: "POST",
      headers: {
        ...getHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(user)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    e.target.reset();
    document.getElementById("userRole").value = "company_owner";
    document.getElementById("userStatus").value = "active";
    msg.textContent = "Company user saved.";
    msg.style.color = "#047857";
    await loadCompanyUsers();
  } catch (err) {
    console.error(err);
    msg.textContent = getCompanyAdminMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

async function upsertUserInvite(invite) {
  const res = await fetch(`${BASE_URL}/rest/v1/user_invites?on_conflict=company_id,email`, {
    method: "POST",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(invite)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

function renderCompanyUsers() {
  const tbody = document.getElementById("companyUsersTableBody");
  tbody.innerHTML = "";

  if (!companyUsers.length) {
    tbody.innerHTML = `<tr><td colspan="5">No company users found.</td></tr>`;
    return;
  }

  companyUsers.forEach(user => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user.user_id)}</td>
      <td>
        <select data-role="${user.id}">
          ${["company_owner", "company_admin", "dispatcher", "accounting", "maintenance", "driver"].map(role => (
            `<option value="${role}" ${role === user.role ? "selected" : ""}>${formatStatus(role)}</option>`
          )).join("")}
        </select>
      </td>
      <td>
        <select data-status="${user.id}">
          <option value="active" ${user.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${user.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </td>
      <td>${formatDate(user.created_at)}</td>
      <td><button class="delete" data-delete-user="${user.id}">Delete</button></td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-role]").forEach(select => {
    select.addEventListener("change", () => updateCompanyUser(select.dataset.role, { role: select.value }));
  });

  tbody.querySelectorAll("[data-status]").forEach(select => {
    select.addEventListener("change", () => updateCompanyUser(select.dataset.status, { status: select.value }));
  });

  tbody.querySelectorAll("[data-delete-user]").forEach(button => {
    button.addEventListener("click", () => deleteCompanyUser(button.dataset.deleteUser));
  });
}

function renderUserInvites() {
  const tbody = document.getElementById("userInvitesTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!userInvites.length) {
    tbody.innerHTML = `<tr><td colspan="5">No pending invites found.</td></tr>`;
    return;
  }

  userInvites.forEach(invite => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(invite.email)}</td>
      <td>${formatStatus(invite.role)}</td>
      <td>${formatStatus(invite.status)}</td>
      <td>${formatDate(invite.created_at)}</td>
      <td><button class="delete" data-delete-invite="${invite.id}">Delete</button></td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-delete-invite]").forEach(button => {
    button.addEventListener("click", () => deleteUserInvite(button.dataset.deleteInvite));
  });
}

async function updateCompanyUser(id, changes) {
  const msg = document.getElementById("companyAdminMessage");
  msg.textContent = "Updating user...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/company_users?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        ...getHeaders(),
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(changes)
    });

    if (!res.ok) throw new Error(await res.text());
    msg.textContent = "User updated.";
    msg.style.color = "#047857";
    await loadCompanyUsers();
  } catch (err) {
    console.error(err);
    msg.textContent = getCompanyAdminMessage(err.message);
    msg.style.color = "#ef4444";
  }
}

async function deleteCompanyUser(id) {
  if (!confirm("Delete this company user?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/company_users?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadCompanyUsers();
  } catch (err) {
    console.error(err);
    alert(getCompanyAdminMessage(err.message));
  }
}

async function deleteUserInvite(id) {
  if (!confirm("Delete this invite?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/user_invites?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadUserInvites();
  } catch (err) {
    console.error(err);
    alert(getCompanyAdminMessage(err.message));
  }
}

function updateKpis() {
  document.getElementById("companyCount").textContent = companies.length;
  document.getElementById("userCount").textContent = companyUsers.length;
  document.getElementById("activeUserCount").textContent = companyUsers.filter(user => user.status === "active").length;
  document.getElementById("adminUserCount").textContent = companyUsers.filter(user => ["owner", "admin", "company_owner", "company_admin"].includes(user.role)).length;
}

function getCompanyAdminMessage(message) {
  if (message.includes("companies") || message.includes("company_users") || message.includes("user_invites")) {
    return "Company admin tables are not ready. Run the company admin SQL first, then reload this page.";
  }
  return message;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "N/A";
}

function formatStatus(value) {
  return String(value || "").replaceAll("_", " ") || "N/A";
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

document.getElementById("companyForm").addEventListener("submit", saveCompany);
document.getElementById("createCompanyForm").addEventListener("submit", saveNewCompany);
document.getElementById("companyUserForm").addEventListener("submit", addCompanyUser);
document.getElementById("companySelect").addEventListener("change", (e) => selectCompany(e.target.value));
document.getElementById("newCompanyBtn").addEventListener("click", startNewCompany);
initCompanyAdmin();
