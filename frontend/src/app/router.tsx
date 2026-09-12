import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthPage } from "@/pages/auth-page";
import { useAuth } from "./auth";
import { useTranslation } from "react-i18next";
import { canAccessRoute, roleHome } from "@/lib/role-access";

const AppShell = lazy(() => import("@/components/app-shell").then((module) => ({ default: module.AppShell })));
const Dashboard = lazy(() => import("@/pages/dashboard").then((module) => ({ default: module.Dashboard })));
const OperationsPage = lazy(() => import("@/pages/operations-page").then((module) => ({ default: module.OperationsPage })));
const BatchesPage = lazy(() => import("@/pages/batches-page").then((module) => ({ default: module.BatchesPage })));
const FinancePage = lazy(() => import("@/pages/finance-page").then((module) => ({ default: module.FinancePage })));
const SettingsPage = lazy(() => import("@/pages/settings-page").then((module) => ({ default: module.SettingsPage })));
const ReportsPage = lazy(() => import("@/pages/reports-page").then((module) => ({ default: module.ReportsPage })));
const ProfilePage = lazy(() => import("@/pages/profile-page").then((module) => ({ default: module.ProfilePage })));
const BatchDetailPage = lazy(() => import("@/pages/batch-detail-page").then((module) => ({ default: module.BatchDetailPage })));
const RiderAppPage = lazy(() => import("@/pages/rider-app-page").then((module) => ({ default: module.RiderAppPage })));

function RouteLoading() {
  const { t } = useTranslation();
  return <div role="status" className="grid min-h-screen place-items-center text-sm text-slate-500">{t("loading")}</div>;
}

function lazyElement(element: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

function Protected() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">{t("loading")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "RIDER" && location.pathname !== "/rider-app") {
    return <Navigate to="/rider-app" replace />;
  }
  if (user.role !== "RIDER" && location.pathname !== "/rider-app" && !canAccessRoute(user.role, location.pathname)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return <Outlet />;
}

function OperationsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/operations/dispatch${search}`} replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <AuthPage /> },
  { path: "/app", element: lazyElement(<RiderAppPage />) },
  {
    element: <Protected />,
    children: [
      { path: "rider-app", element: lazyElement(<RiderAppPage />) },
      {
        path: "/",
        element: lazyElement(<AppShell />),
        children: [
          { index: true, element: lazyElement(<Dashboard />) },
          { path: "batches/:id", element: lazyElement(<BatchDetailPage />) },
          { path: "operations", element: <OperationsRedirect /> },
          { path: "operations/batches", element: lazyElement(<BatchesPage />) },
          { path: "operations/dispatch", element: lazyElement(<OperationsPage />) },
          { path: "finance", element: lazyElement(<FinancePage />) },
          { path: "reports", element: lazyElement(<ReportsPage />) },
          { path: "settings", element: lazyElement(<SettingsPage />) },
          { path: "profile", element: lazyElement(<ProfilePage />) },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
