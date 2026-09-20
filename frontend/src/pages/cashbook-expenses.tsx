import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { hubBusinessDate } from "@/lib/business-date";
import { notifyError, notifySuccess } from "@/lib/notifications";

type Category = { id: string; code: string; nameEn: string; nameMy: string; active: boolean };
type Expense = { id: string; amount: number; description: string; wallet: string; category: Category };
type Hub = { id: string; name: string };

export function CashbookExpenses({ hubs = [] }: { hubs?: Hub[] }) {
  const { t, i18n } = useTranslation();
  const user = useAuth()?.user;
  const idempotencyKey = useRef("");
  const queryClient = useQueryClient();
  const requiresHub = user?.role === "SUPERADMIN";
  const [entry, setEntry] = useState({ businessDate: hubBusinessDate(), hubId: "", categoryId: "", wallet: "CASH", amount: "", description: "" });
  const [category, setCategory] = useState({ code: "", nameEn: "", nameMy: "" });
  const categories = useQuery({ queryKey: ["expense-categories"], queryFn: () => api<Category[]>("/finance/expense-categories").then((response) => response.data) });
  const expenseQuery = new URLSearchParams({ businessDate: entry.businessDate, ...(entry.hubId ? { hubId: entry.hubId } : {}) }).toString();
  const expenses = useQuery({ queryKey: ["expenses", expenseQuery], queryFn: () => api<Expense[]>(`/finance/expenses?${expenseQuery}`).then((response) => response.data), enabled: !requiresHub || Boolean(entry.hubId) });
  const post = useMutation({
    mutationFn: () => api("/finance/expenses", { method: "POST", body: JSON.stringify({ businessDate: entry.businessDate, ...(entry.hubId ? { hubId: entry.hubId } : {}), categoryId: entry.categoryId, wallet: entry.wallet, amount: Number(entry.amount), description: entry.description, idempotencyKey: idempotencyKey.current }) }),
    onSuccess: async () => {
      idempotencyKey.current = "";
      notifySuccess(t("expenseSaved"));
      setEntry((value) => ({ ...value, amount: "", description: "" }));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["expenses"] }), queryClient.invalidateQueries({ queryKey: ["ledger"] })]);
    },
    onError: notifyError,
  });
  const createCategory = useMutation({
    mutationFn: () => api("/finance/expense-categories", { method: "POST", body: JSON.stringify(category) }),
    onSuccess: async () => {
      setCategory({ code: "", nameEn: "", nameMy: "" });
      await queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
    },
    onError: notifyError,
  });
  const localizedCategory = (value: Category) => i18n.resolvedLanguage === "my" ? value.nameMy : value.nameEn;
  const walletLabel = (wallet: string) => t(wallet === "KBZ_PAY" ? "kbzPay" : wallet === "WAVE_PAY" ? "wavePay" : "cash");

  return (
    <Card className="mt-6">
      <h2 className="font-display text-lg font-bold">{t("cashbookExpenses")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("cashbookExpensesDescription")}</p>
      <form onSubmit={(event) => { event.preventDefault(); if (requiresHub && !entry.hubId) return; if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID(); post.mutate(); }} className="mt-5 grid gap-3 md:grid-cols-6">
        <Input aria-label={t("businessDate")} type="date" value={entry.businessDate} onChange={(event) => setEntry((value) => ({ ...value, businessDate: event.target.value }))} />
        {requiresHub && <Select aria-label={t("expenseHub")} required value={entry.hubId} onChange={(event) => setEntry((value) => ({ ...value, hubId: event.target.value }))}>
          <option value="">{t("selectHub")}</option>
          {hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}
        </Select>}
        <Select aria-label={t("expenseCategory")} required value={entry.categoryId} onChange={(event) => setEntry((value) => ({ ...value, categoryId: event.target.value }))}>
          <option value="">{t("selectExpenseCategory")}</option>
          {(categories.data ?? []).filter((value) => value.active).map((value) => <option key={value.id} value={value.id}>{localizedCategory(value)}</option>)}
        </Select>
        <Select aria-label={t("expenseWallet")} value={entry.wallet} onChange={(event) => setEntry((value) => ({ ...value, wallet: event.target.value }))}>
          <option value="CASH">{t("cash")}</option><option value="KBZ_PAY">{t("kbzPay")}</option><option value="WAVE_PAY">{t("wavePay")}</option>
        </Select>
        <Input aria-label={t("amount")} required type="number" min="1" value={entry.amount} onChange={(event) => setEntry((value) => ({ ...value, amount: event.target.value }))} placeholder={t("amount")} />
        <Input aria-label={t("description")} required minLength={2} value={entry.description} onChange={(event) => setEntry((value) => ({ ...value, description: event.target.value }))} placeholder={t("description")} />
        <Button disabled={post.isPending || (requiresHub && !entry.hubId)} className={`bg-[#1598ef] text-white ${requiresHub ? "md:col-start-6" : "md:col-start-5"}`}>{t("recordExpense")}</Button>
      </form>
      {user?.role === "SUPERADMIN" && <details className="mt-5"><summary className="cursor-pointer text-sm font-bold text-[#0787df]">{t("manageExpenseCategories")}</summary>
        <form onSubmit={(event) => { event.preventDefault(); createCategory.mutate(); }} className="mt-3 grid gap-2 md:grid-cols-4">
          <Input aria-label={t("categoryCode")} value={category.code} onChange={(event) => setCategory((value) => ({ ...value, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_") }))} />
          <Input aria-label={t("reasonLabelEnglish")} value={category.nameEn} onChange={(event) => setCategory((value) => ({ ...value, nameEn: event.target.value }))} />
          <Input aria-label={t("reasonLabelMyanmar")} value={category.nameMy} onChange={(event) => setCategory((value) => ({ ...value, nameMy: event.target.value }))} />
          <Button disabled={category.code.length < 2 || category.nameEn.length < 2 || !category.nameMy} className="border">{t("addCategory")}</Button>
        </form>
      </details>}
      <ul className="mt-5 divide-y dark:divide-white/10">{(expenses.data ?? []).map((expense) => <li key={expense.id} className="flex justify-between py-3 text-sm"><span><b>{localizedCategory(expense.category)}</b><span className="ml-2 text-slate-500">{expense.description} · {walletLabel(expense.wallet)}</span></span><b>{expense.amount.toLocaleString()} MMK</b></li>)}</ul>
    </Card>
  );
}
