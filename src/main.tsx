import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/Auth";
import { SiteProvider } from "./context/Site";
import { envMissing } from "./lib/supabase";
import "./index.css";

// New visitors always get the normal light theme (the device's dark setting is ignored).
// Dark mode only turns on if the person chose it with the moon button.
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    /* storage blocked: stay light */
  }
  document.documentElement.classList.toggle("dark", saved === "dark");
}

if (envMissing) {
  document.getElementById("root")!.innerHTML =
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:24px;line-height:1.5">' +
    "<h2>Setup missing</h2>" +
    "<p>VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set for this build.</p>" +
    "<p>Vercel: Project, Settings, Environment Variables. Add both for Production, Preview and Development, then Redeploy.</p></div>";
} else
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SiteProvider>
          <App />
        </SiteProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);