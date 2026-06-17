import { supabase } from "../supabaseClient.js";

const createMessage = document.getElementById("createMessage");

async function requireSession() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error || !session?.user) {
    window.location.href = "../login.html";
    return null;
  }

  document.getElementById("welcome").textContent =
    "Welcome, " + session.user.email;

  return session;
}

// Wait for session
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session || !session.user) {
    window.location.href = "../login.html";
    return;
  }

  document.getElementById("welcome").textContent =
    "Welcome, " + session.user.email;

  loadUsers();
});

// Load all users
async function loadUsers() {
  const tableBody = document.querySelector("#usersTable tbody");
  tableBody.innerHTML = "";

  const session = await requireSession();
  if (!session) return;

  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .order("role", { ascending: true });

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
    return;
  }

  if (!roles?.length) {
    tableBody.innerHTML = `<tr><td colspan="4">No role records found.</td></tr>`;
    return;
  }

  for (const rowData of roles) {
    const role = rowData.role || "user";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${rowData.user_id}</td>
      <td>
        <select data-id="${rowData.user_id}" class="roleSelect">
          <option value="user" ${role === "user" ? "selected" : ""}>User</option>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td><button class="editBtn" data-id="${rowData.user_id}">Save</button></td>
      <td><button class="deleteBtn" data-id="${rowData.user_id}">Delete Role</button></td>
    `;
    tableBody.appendChild(row);
  }

  attachRoleEvents();
  attachDeleteEvents();
}

// Save role
function attachRoleEvents() {
  document.querySelectorAll(".editBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const select = document.querySelector(`select[data-id="${id}"]`);
      const newRole = select.value;

      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: id, role: newRole }, { onConflict: "user_id" });

      alert(error ? error.message : "Role updated");
    });
  });
}

// Delete user
function attachDeleteEvents() {
  document.querySelectorAll(".deleteBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;

      const { error } = await supabase.from("user_roles").delete().eq("user_id", id);

      if (error) {
        alert(error.message);
        return;
      }

      alert("Role deleted");
      loadUsers();
    });
  });
}

// Browser apps cannot call Supabase Admin user APIs with a public key.
document.getElementById("createUserBtn").addEventListener("click", async () => {
  createMessage.textContent =
    "User creation must run from a secure server or Supabase Edge Function, not from browser JavaScript.";
});

// Sidebar navigation
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".section").forEach(sec => sec.classList.add("hidden"));
    document.getElementById(`section-${btn.dataset.section}`).classList.remove("hidden");
  });
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "../login.html";
});

requireSession().then(session => {
  if (session) loadUsers();
});
