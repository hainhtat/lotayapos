import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";

type LoginForm = { identifier: string; password: string; remember: boolean };
const rememberedIdentifierKey = "lotaya-remembered-identifier";

export function AuthPage() {
  const { t } = useTranslation();
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const rememberedIdentifier = localStorage.getItem(rememberedIdentifierKey) ?? "";
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<LoginForm>({ defaultValues: { identifier: rememberedIdentifier, password: "", remember: Boolean(rememberedIdentifier) } });
  if (loading) return <div className="grid min-h-screen place-items-center">{t("loading")}</div>;
  if (user?.role === "RIDER") return <Navigate to="/rider-app" replace />;
  if (user) return <Navigate to="/" replace />;
  return <main className="grid min-h-screen place-items-center bg-[#101318] px-6">
    <form onSubmit={handleSubmit(async values => {
      setError("");
      try {
        const loggedIn = await login(values.identifier, values.password, values.remember);
        if (values.remember) localStorage.setItem(rememberedIdentifierKey, values.identifier);
        else localStorage.removeItem(rememberedIdentifierKey);
        navigate(loggedIn.role === "RIDER" ? "/rider-app" : "/");
      } catch { setError(t("invalid")); }
    })} className="w-full max-w-md rounded-3xl bg-white p-8 text-slate-950 shadow-2xl">
      <div className="mb-8 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1598ef] text-xl font-bold text-white">✦</div><span className="font-display text-2xl font-bold">LOTAYA</span></div>
      <h1 className="font-display text-3xl font-bold">{t("login")}</h1><p className="mt-2 text-slate-500">{t("loginDescription")}</p>
      {error && <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-600">{error}</p>}
      <label className="mt-7 block text-sm font-semibold">{t("identifier")}<input {...register("identifier", { required: true })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none focus:border-[#1598ef]" autoComplete="username" aria-invalid={!!errors.identifier} /></label>
      {errors.identifier && <p className="mt-1 text-xs text-rose-500">{t("required")}</p>}
      <label className="mt-4 block text-sm font-semibold">{t("password")}<span className="relative mt-2 block"><input {...register("password", { required: true })} type={showPassword ? "text" : "password"} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-slate-950 outline-none focus:border-[#1598ef]" autoComplete="current-password" aria-invalid={!!errors.password} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={t(showPassword ? "hidePassword" : "showPassword")} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-slate-500">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
      {errors.password && <p className="mt-1 text-xs text-rose-500">{t("required")}</p>}
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" {...register("remember")} />{t("rememberMe")}</label>
      <Button type="submit" disabled={isSubmitting} className="mt-7 w-full bg-[#1598ef] text-white">{isSubmitting ? t("loading") : t("signIn")}</Button>
    </form>
  </main>;
}
