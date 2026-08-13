import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { useTranslation } from "react-i18next";
import { Download, LogOut, Smartphone } from "lucide-react";

const androidDownloadUrl = import.meta.env.VITE_RIDER_ANDROID_DOWNLOAD_URL as string | undefined;
const iosDownloadUrl = import.meta.env.VITE_RIDER_IOS_DOWNLOAD_URL as string | undefined;

export function RiderAppPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <main className="grid min-h-screen place-items-center bg-[#101318] px-6 py-10 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-slate-950 shadow-2xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1598ef] text-xl font-bold text-white">✦</div>
            <span className="font-display text-2xl font-bold">LOTAYA</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void logout().then(() => navigate("/login", { replace: true }));
            }}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            <LogOut size={16} />
            {t("logout")}
          </button>
        </div>

        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf6ff] text-[#0787df]">
          <Smartphone size={24} />
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold">{t("riderAppTitle")}</h1>
        <p className="mt-2 text-slate-500">{t("riderAppDescription", { name: user?.name ?? t("rider") })}</p>

        <div className="mt-6 space-y-3">
          {androidDownloadUrl ? (
            <a
              href={androidDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#1598ef] px-4 py-3 text-sm font-bold text-white"
            >
              <Download size={18} />
              {t("downloadAndroidApp")}
            </a>
          ) : (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{t("riderAppDevTitle")}</p>
              <p className="mt-2">{t("riderAppDevSteps")}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 font-mono text-xs text-slate-700">
                <li>cd mobile</li>
                <li>npx expo start</li>
                <li>{t("riderAppDevAndroid")}</li>
              </ol>
            </div>
          )}

          {iosDownloadUrl && (
            <a
              href={iosDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-[#1598ef] px-4 py-3 text-sm font-bold text-[#0787df]"
            >
              <Download size={18} />
              {t("downloadIosApp")}
            </a>
          )}
        </div>

        <p className="mt-6 text-xs text-slate-400">{t("riderApkInstallHint")}</p>
        <p className="mt-2 text-xs text-slate-400">{t("riderAppWebBlocked")}</p>
      </div>
    </main>
  );
}
