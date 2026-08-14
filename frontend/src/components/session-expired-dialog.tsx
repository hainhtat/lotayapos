import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function SessionExpiredDialog({
  identifier,
  open,
  error,
  pending,
  onSubmit,
}: {
  identifier: string;
  open: boolean;
  error: string;
  pending: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setPassword("");
      input.current?.focus();
    }
  }, [open]);
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(password);
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" role="presentation">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-950 shadow-2xl dark:bg-[#181a1d] dark:text-white" aria-labelledby="session-expired-title">
        <h2 id="session-expired-title" className="text-xl font-bold">{t("sessionExpiredTitle")}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("sessionExpiredHelp")}</p>
        {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
        <p className="mt-4 text-sm font-semibold">{identifier}</p>
        <label className="mt-4 block text-sm font-semibold">
          {t("password")}
          <input
            ref={input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#111315] dark:text-white"
          />
        </label>
        <Button type="submit" disabled={pending || !password} className="mt-6 w-full bg-[#1598ef] text-white">
          {pending ? t("loading") : t("continueSession")}
        </Button>
      </form>
    </div>
  );
}
