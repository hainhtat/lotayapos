import { useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";

function isChunkLoadError(error: unknown) {
  return error instanceof Error && /failed to fetch dynamically imported module|loading chunk|importing a module script failed/i.test(error.message);
}

export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation();
  const chunkFailure = isChunkLoadError(error);

  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900 dark:bg-[#121416] dark:text-white">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <h1 className="font-display text-2xl font-bold">{t(chunkFailure ? "pageRefreshNeeded" : "pageLoadFailed")}</h1>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t(chunkFailure ? "pageRefreshNeededDescription" : "pageLoadFailedDescription")}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1598ef]">{t("reloadPage")}</button>
    </div>
  </main>;
}
