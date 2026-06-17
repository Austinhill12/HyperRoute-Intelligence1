const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

async function loadCustomers() {
  const msg = document.getElementById("customersMessage");
  msg.textContent = "Loading customers...";

  try {
    await window.CompanyContext?.ready();
    const url = window.CompanyContext?.scopedUrl("customers", "select=*&order=company_name.asc") || `${BASE_URL}/rest/v1/customers?select=*&order=company_name.asc`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await res.text());

    const customers = await res.json();
    msg.textContent = "";
    renderCustomers(customers);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading customers: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderCustomers(customers) {
  const tbody = document.getElementById("customersTableBody");
  tbody.innerHTML = "";

  if (!customers.length) {
    tbody.innerHTML = `<tr><td colspan="7">No customers found.</td></tr>`;
    return;
  }

  customers.forEach(customer => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${customer.company_name}</td>
      <td>${formatStatus(customer.customer_type)}</td>
      <td>${customer.contact_name || "N/A"}</td>
      <td>${customer.phone || "N/A"}</td>
      <td>${customer.email || "N/A"}</td>
      <td>${formatStatus(customer.status)}</td>
      <td>
        <a class="view" href="customer-details.html?id=${customer.id}">View</a>
        <a class="view" href="edit-customer.html?id=${customer.id}">Edit</a>
        <button class="delete" data-delete="${customer.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteCustomer(btn.dataset.delete));
  });
}

async function deleteCustomer(id) {
  if (!confirm("Delete this customer? Existing loads and invoices will keep the customer name.")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/customers?id=eq.${id}`, {
      method: "DELETE",
      headers
    });

    if (!res.ok) throw new Error(await res.text());
    loadCustomers();
  } catch (err) {
    console.error(err);
    alert(`Error deleting customer: ${err.message}`);
  }
}

function formatStatus(value) {
  return (value || "N/A").replaceAll("_", " ");
}

loadCustomers();
