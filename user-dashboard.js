import { supabase } from "./supabaseClient.js";

// Clear stale sessions on login load
await supabase.auth.signOut();
localStorage.clear();
sessionStorage.clear();

const form = document.getElementById("loginForm");
const message = document.getElementById("loginMessage");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  message.textContent = "Logging in...";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (loginError) {
    message.textContent = "❌ " + loginError.message;
    return;
  }

  const user = loginData.user;

  // Fetch role
  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!roleData) {
    message.textContent = "❌ No role assigned.";
    return;
  }

  if (roleData.role === "admin") {
    window.location.href = "admin-dashboard.html";
  } else {
    window.location.href = "user-dashboard.html";
  }
});
