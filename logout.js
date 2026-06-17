import { supabase } from "./supabaseClient.js";

const message = document.getElementById("logoutMessage");

async function logout() {
  try {
    await supabase.auth.signOut();
    localStorage.removeItem("hyperroute_active_company_id");

    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        localStorage.removeItem(key);
      }
    });

    message.textContent = "Logged out. Redirecting...";
  } catch (error) {
    console.error("Logout failed:", error);
    message.textContent = "Logout failed, clearing local session and redirecting...";
    message.style.color = "#ef4444";
  } finally {
    setTimeout(() => {
      window.location.href = "login.html";
    }, 500);
  }
}

logout();
