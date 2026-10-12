import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/Auth";
import { SiteProvider } from "./context/Site";
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