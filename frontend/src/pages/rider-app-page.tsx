import {Download,ExternalLink,ShieldCheck,Smartphone} from "lucide-react";
import {useEffect,useMemo,useState} from "react";
import {useTranslation} from "react-i18next";
import {useNavigate} from "react-router-dom";
import {useAuth} from "@/app/auth";

const androidDownloadUrl = import.meta.env.VITE_RIDER_ANDROID_DOWNLOAD_URL as string | undefined;
const iosDownloadUrl = import.meta.env.VITE_RIDER_IOS_DOWNLOAD_URL as string | undefined;
const fallbackVersion = import.meta.env.VITE_RIDER_ANDROID_VERSION as string | undefined;

type ReleaseInfo = {
  version: string;
  apkUrl: string;
  sizeBytes?: number;
  sha256?: string;
};

export function RiderAppPage(){
  const {t}=useTranslation();
  const navigate=useNavigate();
  const {user,logout}=useAuth();
  const year=useMemo(()=>new Date().getFullYear(),[]);
  const [release,setRelease]=useState<ReleaseInfo | null>(null);

  useEffect(()=>{
    let active=true;
    void fetch("/app/version.json",{cache:"no-store"})
      .then(async(response)=>{
        if(!response.ok)throw new Error("version unavailable");
        return response.json();
      })
      .then((value:ReleaseInfo)=>{
        if(active&&value?.version&&value?.apkUrl)setRelease(value);
      })
      .catch(()=>{
        if(active)setRelease(null);
      });
    return()=>{active=false};
  },[]);

  const downloadUrl=release?.apkUrl ?? androidDownloadUrl ?? "/app/lotaya-rider.apk";
  const versionLabel=release?.version ?? fallbackVersion ?? "0.1.1";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(21,152,239,0.24),_transparent_34%),linear-gradient(180deg,#0b1220_0%,#0f172a_32%,#f8fafc_32%,#f8fafc_100%)] px-4 py-6">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="relative overflow-hidden rounded-[2rem] bg-[#0f172a] p-8 text-white shadow-[0_28px_100px_rgba(15,23,42,0.38)]">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500" />
          <div className="absolute -right-20 top-6 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute -bottom-20 left-8 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />

          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 text-lg font-black text-white shadow-lg shadow-cyan-500/30">✦</div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">{t("brand")}</p>
                <h1 className="font-display text-3xl font-black tracking-tight">{t("riderAppTitle")}</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={()=>void logout().then(()=>navigate("/login",{replace:true}))}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 backdrop-blur hover:bg-white/10"
            >
              {t("logout")}
            </button>
          </div>

          <p className="relative mt-8 max-w-md text-sm leading-6 text-slate-300">{t("riderAppDescription",{name:user?.name??t("rider")})}</p>

          <div className="relative mt-8 space-y-3">
            {[
              {icon:Smartphone,title:t("riderAppHighlightMobile"),body:t("riderAppHighlightMobileBody")},
              {icon:ShieldCheck,title:t("riderAppHighlightSecure"),body:t("riderAppHighlightSecureBody")},
            ].map(({icon:Icon,title,body})=>(
              <div key={title} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-400/15 text-cyan-200"><Icon size={20} /></div>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="relative mt-8 text-xs leading-6 text-slate-400">{t("riderAppSecurityNoteBody")}</p>
        </section>

        <section className="rounded-[2rem] bg-white p-8 shadow-[0_28px_100px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-white">
            <Download size={13} />
            {t("riderAppDownloadBadge")}
          </div>

          <h2 className="mt-5 max-w-xl font-display text-3xl font-black tracking-tight text-slate-950">{t("riderAppDownloadTitle")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{t("riderAppDownloadBody")}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href={downloadUrl} download className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1598ef] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#1598ef]/25 transition hover:-translate-y-0.5 hover:bg-[#0f8ae0]">
                <Download size={18} />
                {t("downloadAndroidApp")}
            </a>
            <a href="/" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              {t("goToDashboard")}
              <ExternalLink size={18} />
            </a>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("currentRelease")}</p>
              <p className="mt-2 text-lg font-black text-slate-950">{t("riderAppReleaseVersion",{version:versionLabel})}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{t("downloadTarget")}</p>
              <p className="mt-2 break-all text-sm font-semibold text-slate-700">{downloadUrl}</p>
            </div>
          </div>

          {iosDownloadUrl ? (
            <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">{t("downloadIosApp")}</p>
              <a href={iosDownloadUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-bold text-[#0787df] hover:underline">
                {iosDownloadUrl}
              </a>
            </div>
          ) : null}

          <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-900">{t("riderAppInstallTitle")}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("riderAppInstallHelp")}</p>
            <p className="mt-2 text-xs leading-6 text-slate-400">{t("riderApkInstallHint")} {year}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
