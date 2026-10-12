import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/Auth";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Domains = lazy(() => import("./pages/Domains"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Reports = lazy(() => import("./pages/Reports"));
const Tasks = lazy(() => import("./pages/Tasks"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const KeywordLab = lazy(() => import("./pages/KeywordLab"));
const Traffic = lazy(() => import("./pages/Traffic"));
const Competitors = lazy(() => import("./pages/Competitors"));
const Admin = lazy(() => import("./pages/Admin"));

// One place to start: the Dashboard takes the website address and runs every check (crawl, speed, SEO, rankings, traffic).
// The old /new, /audit and /research pages now lead here.
export default function App() {
  const { session, loading, isAdmin } = useAuth();
  if (loading)
    return (
      <div className="grid h-screen place-items-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (!session)
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );

  return (
    <Suspense
      fallback={
        <div className="grid h-[60vh] place-items-center">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/traffic" element={<Traffic />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/keywords" element={<KeywordLab />} />
          <Route path="/new" element={<Navigate to="/dashboard" replace />} />
          <Route path="/audit" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/research"
            element={<Navigate to="/dashboard" replace />}
          />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/settings" element={<SettingsPage />} />
          {isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}