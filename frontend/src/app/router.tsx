import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/pages/dashboard";
import { OperationsPage } from "@/pages/operations-page";
import { BatchesPage } from "@/pages/batches-page";
import { FinancePage } from "@/pages/finance-page";
import { SettingsPage } from "@/pages/settings-page";
import { ReportsPage } from "@/pages/reports-page";
import { ProfilePage } from "@/pages/profile-page";
import { AuthPage } from "@/pages/auth-page";
import { BatchDetailPage } from "@/pages/batch-detail-page";
import { RiderAppPage } from "@/pages/rider-app-page";
import { useAuth } from "./auth";
import { useTranslation } from "react-i18next";

function Protected() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">{t("loading")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "RIDER" && location.pathname !== "/rider-app") {
    return <Navigate to="/rider-app" replace />;
  }
  return <Outlet />;
}

function OperationsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/operations/dispatch${search}`} replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <AuthPage /> },
  {
    element: <Protected />,
    children: [
      { path: "rider-app", element: <RiderAppPage /> },
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "batches/:id", element: <BatchDetailPage /> },
          { path: "operations", element: <OperationsRedirect /> },
          { path: "operations/batches", element: <BatchesPage /> },
          { path: "operations/dispatch", element: <OperationsPage /> },
          { path: "finance", element: <FinancePage /> },
          { path: "reports", element: <ReportsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "profile", element: <ProfilePage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
