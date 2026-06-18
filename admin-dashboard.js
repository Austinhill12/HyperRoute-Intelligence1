import { supabase } from "../supabaseClient.js";

// Wait for session to load
supabase.auth.onAuthStateChange(async (event, session) => {
  if (!session || !session.user) {
    window.location.href = "../login.html";
    return;
  }

  const user = session.user;

  document.getElementById("welcome").textContent =
    "Welcome, " + user.email;
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "../login.html";
});
