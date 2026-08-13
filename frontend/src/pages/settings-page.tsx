import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { ReasonCodesSection } from "./reason-codes-section";
import { UserAdminSection } from "./user-admin-section";
import { useAuth } from "@/app/auth";

type Hub = { id: string; name: string };
type Shop = { id: string; name: string };
type Zone = { id: string; name: string; hubId: string };
type PayModel = "PERCENTAGE" | "SALARY" | "SALARY_PLUS_PERCENTAGE";
type Rider = {
  id: string;
  user: { name: string; email: string };
  hub?: { name: string } | null;
  payModel?: PayModel | null;
  commissionRateBps?: number | null;
  monthlySalary?: number | null;
};
type Data = { hubs: Hub[]; shops: Shop[]; zones: Zone[]; riders: Rider[] };
type RiderForm = {
  name: string;
  username: string;
  email: string;
  password: string;
  hubId: string;
  payModel: PayModel;
  commissionPercent: string;
  monthlySalary: string;
};
const emptyRider: RiderForm = {
  name: "",
  username: "",
  email: "",
  password: "",
  hubId: "",
  payModel: "PERCENTAGE",
  commissionPercent: "40",
  monthlySalary: "",
};
const PAY_MODELS: PayModel[] = ["PERCENTAGE", "SALARY", "SALARY_PLUS_PERCENTAGE"];
function needsCommission(model: PayModel) {
  return model === "PERCENTAGE" || model === "SALARY_PLUS_PERCENTAGE";
}
function needsSalary(model: PayModel) {
  return model === "SALARY" || model === "SALARY_PLUS_PERCENTAGE";
}
function payPayload(form: Pick<RiderForm, "payModel" | "commissionPercent" | "monthlySalary">) {
  return {
    payModel: form.payModel,
    commissionRateBps: needsCommission(form.payModel) ? Math.round(Number(form.commissionPercent) * 100) : 0,
    monthlySalary: needsSalary(form.payModel) ? Number(form.monthlySalary) : 0,
  };
}
function isValidPay(form: Pick<RiderForm, "payModel" | "commissionPercent" | "monthlySalary">) {
  if (needsCommission(form.payModel)) {
    const percent = Number(form.commissionPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return false;
  }
  if (needsSalary(form.payModel)) {
    if (!/^\d+$/.test(form.monthlySalary)) return false;
  }
  return true;
}
type Township = {
  id: string;
  nameEn: string;
  nameMy?: string | null;
  deliveryFee: number | null;
  district?: { nameEn: string; regionState?: { nameEn: string } };
};

const control =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["master-data"], queryFn: () => api<Data>("/master-data").then((r) => r.data) });
  const townships = useQuery({
    queryKey: ["locations", "townships", "all"],
    queryFn: () => api<Township[]>("/master-data/locations/townships").then((r) => r.data),
  });
  const [hub, setHub] = useState("");
  const [shop, setShop] = useState("");
  const [zone, setZone] = useState({ name: "", hubId: "", townshipId: "" });
  const [rider, setRider] = useState<RiderForm>(emptyRider);
  const [editingRiderId, setEditingRiderId] = useState<string | null>(null);
  const [editRider, setEditRider] = useState<Pick<RiderForm, "payModel" | "commissionPercent" | "monthlySalary">>({
    payModel: "PERCENTAGE",
    commissionPercent: "40",
    monthlySalary: "",
  });
  const [selectedTownships, setSelectedTownships] = useState<string[]>([]);
  const [feeSearch, setFeeSearch] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("3000");
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body: unknown; method?: "POST" | "PATCH" }) =>
      api(`/master-data/${path}`, { method, body: JSON.stringify(body) }),
    onSuccess: async () => {
      setMessage(t("saved", { defaultValue: "Saved" }));
      setEditingRiderId(null);
      await qc.invalidateQueries({ queryKey: ["master-data"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });
  const feeMutation = useMutation({
    mutationFn: () =>
      api("/master-data/locations/townships/delivery-fees", {
        method: "PATCH",
        body: JSON.stringify({ townshipIds: selectedTownships, deliveryFee: Number(deliveryFee) }),
      }),
    onSuccess: async () => {
      setMessage(t("deliveryFeesUpdated", { count: selectedTownships.length }));
      setSelectedTownships([]);
      await qc.invalidateQueries({ queryKey: ["locations", "townships"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });
  const filteredTownships = useMemo(() => {
    const needle = feeSearch.trim().toLocaleLowerCase();
    return (townships.data ?? []).filter((item) => {
      if (!needle) return true;
      return [item.nameEn, item.nameMy, item.district?.nameEn, item.district?.regionState?.nameEn]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle));
    });
  }, [feeSearch, townships.data]);
  const allFilteredSelected = filteredTownships.length > 0 && filteredTownships.every((item) => selectedTownships.includes(item.id));
  const toggleTownship = (id: string) =>
    setSelectedTownships((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  const townshipLabel = (item: Township) =>
    i18n.resolvedLanguage === "my" && item.nameMy
      ? item.nameMy
      : `${item.district?.regionState?.nameEn ? `${item.district.regionState.nameEn} · ` : ""}${item.district?.nameEn ? `${item.district.nameEn} · ` : ""}${item.nameEn}`;

  const payModelLabel = (model: PayModel) => {
    if (model === "SALARY") return t("payModelSalary");
    if (model === "SALARY_PLUS_PERCENTAGE") return t("payModelSalaryPlusPercentage");
    return t("payModelPercentage");
  };

  const riderPaySummary = (r: Rider) => {
    const model = r.payModel ?? "PERCENTAGE";
    const percent = r.commissionRateBps != null ? r.commissionRateBps / 100 : null;
    if (model === "PERCENTAGE") {
      return t("riderPaySummaryPercentage", { percent: percent ?? "—" });
    }
    if (model === "SALARY") {
      return t("riderPaySummarySalary", { amount: r.monthlySalary?.toLocaleString() ?? "—" });
    }
    return t("riderPaySummarySalaryPlus", {
      amount: r.monthlySalary?.toLocaleString() ?? "—",
      percent: percent ?? "—",
    });
  };

  const openEditRider = (r: Rider) => {
    setEditingRiderId(r.id);
    setEditRider({
      payModel: r.payModel ?? "PERCENTAGE",
      commissionPercent: r.commissionRateBps != null ? String(r.commissionRateBps / 100) : "40",
      monthlySalary: r.monthlySalary != null ? String(r.monthlySalary) : "",
    });
  };

  const riderCreateValid =
    Boolean(rider.name) &&
    /^[A-Za-z0-9._-]{3,50}$/.test(rider.username) &&
    Boolean(rider.email) &&
    rider.password.length >= 8 &&
    Boolean(rider.hubId) &&
    isValidPay(rider);

  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="font-display text-3xl font-bold">{t("settings")}</h1>
      <p className="mt-2 text-slate-500">{t("masterData", { defaultValue: "Operational master data" })}</p>
      {message && <p role="status" className="mt-4 rounded-xl bg-[#eaf6ff] p-3 text-sm font-semibold text-[#0787df]">{message}</p>}
      {query.isLoading ? (
        <p className="mt-6">{t("loading")}</p>
      ) : query.isError ? (
        <button className={`${control} mt-6`} onClick={() => void query.refetch()}>
          {t("retry")}
        </button>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
            <h2 className="font-display text-lg font-bold">{t("hubsAndZones", { defaultValue: "Hubs and zones" })}</h2>
            <div className="mt-4 flex gap-2">
              <input aria-label={t("newHubName")} value={hub} onChange={(e) => setHub(e.target.value)} className={`${control} flex-1`} placeholder={t("newHubName")} />
              <button
                disabled={hub.trim().length < 2}
                onClick={() => {
                  mutation.mutate({ path: "hubs", body: { name: hub } });
                  setHub("");
                }}
                className="rounded-xl bg-[#1598ef] px-4 text-sm font-bold text-white"
              >
                {t("createHub")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <input aria-label={t("zone")} value={zone.name} onChange={(e) => setZone((v) => ({ ...v, name: e.target.value }))} className={control} placeholder={t("zone")} />
              <select aria-label={t("hub")} value={zone.hubId} onChange={(e) => setZone((v) => ({ ...v, hubId: e.target.value }))} className={control}>
                <option value="">{t("selectHub")}</option>
                {query.data?.hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <select aria-label={t("township")} value={zone.townshipId} onChange={(e) => setZone((v) => ({ ...v, townshipId: e.target.value }))} className={control}>
                <option value="">{t("township")}</option>
                {townships.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {townshipLabel(item)}
                  </option>
                ))}
              </select>
              <button
                disabled={!zone.name || !zone.hubId || !zone.townshipId}
                onClick={() => {
                  mutation.mutate({ path: "zones", body: zone });
                  setZone({ name: "", hubId: "", townshipId: "" });
                }}
                className="rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"
              >
                +
              </button>
            </div>
            <ul className="mt-5 space-y-2 text-sm">
              {query.data?.hubs.map((h) => (
                <li key={h.id} className="rounded-lg bg-slate-50 p-3 dark:bg-white/5">
                  <b>{h.name}</b>
                  <span className="ml-2 text-slate-500">{query.data?.zones.filter((z) => z.hubId === h.id).map((z) => z.name).join(", ") || "—"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
            <h2 className="font-display text-lg font-bold">{t("onlineShops", { defaultValue: "Online shops" })}</h2>
            <div className="mt-4 flex gap-2">
              <input aria-label={t("shopName")} value={shop} onChange={(e) => setShop(e.target.value)} className={`${control} flex-1`} placeholder={t("shopName")} />
              <button
                disabled={shop.trim().length < 2}
                onClick={() => {
                  mutation.mutate({ path: "shops", body: { name: shop } });
                  setShop("");
                }}
                className="rounded-xl bg-[#1598ef] px-4 text-sm font-bold text-white"
              >
                +
              </button>
            </div>
            <ul className="mt-5 space-y-2 text-sm">
              {query.data?.shops.map((s) => (
                <li key={s.id} className="rounded-lg bg-slate-50 p-3 dark:bg-white/5">
                  {s.name}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d] lg:col-span-2">
            <h2 className="font-display text-lg font-bold">{t("riders", { defaultValue: "Riders" })}</h2>
            <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-4">
              <input aria-label={t("name", { defaultValue: "Name" })} value={rider.name} onChange={(e) => setRider((v) => ({ ...v, name: e.target.value }))} className={control} placeholder={t("name", { defaultValue: "Name" })} />
              <input aria-label={t("username")} value={rider.username} onChange={(e) => setRider((v) => ({ ...v, username: e.target.value }))} className={control} placeholder={t("username")} />
              <input aria-label={t("email")} value={rider.email} onChange={(e) => setRider((v) => ({ ...v, email: e.target.value }))} className={control} placeholder={t("email")} />
              <input aria-label={t("password")} type="password" value={rider.password} onChange={(e) => setRider((v) => ({ ...v, password: e.target.value }))} className={control} placeholder={t("password")} />
              <select aria-label={t("hub")} value={rider.hubId} onChange={(e) => setRider((v) => ({ ...v, hubId: e.target.value }))} className={control}>
                <option value="">{t("selectHub")}</option>
                {query.data?.hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("payModel")}
                value={rider.payModel}
                onChange={(e) => setRider((v) => ({ ...v, payModel: e.target.value as PayModel }))}
                className={control}
              >
                {PAY_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {payModelLabel(model)}
                  </option>
                ))}
              </select>
              {needsCommission(rider.payModel) && (
                <input
                  aria-label={t("commissionPercent")}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={rider.commissionPercent}
                  onChange={(e) => setRider((v) => ({ ...v, commissionPercent: e.target.value }))}
                  className={control}
                  placeholder={t("commissionPercent")}
                />
              )}
              {needsSalary(rider.payModel) && (
                <input
                  aria-label={t("monthlySalary")}
                  type="number"
                  min={0}
                  step={1}
                  value={rider.monthlySalary}
                  onChange={(e) => setRider((v) => ({ ...v, monthlySalary: e.target.value }))}
                  className={control}
                  placeholder={t("monthlySalary")}
                />
              )}
              <button
                disabled={!riderCreateValid || mutation.isPending}
                onClick={() => {
                  mutation.mutate({
                    path: "riders",
                    body: {
                      name: rider.name,
                      username: rider.username,
                      email: rider.email,
                      password: rider.password,
                      hubId: rider.hubId,
                      ...payPayload(rider),
                    },
                  });
                  setRider(emptyRider);
                }}
                className="rounded-xl bg-[#1598ef] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {t("addRider", { defaultValue: "Add rider" })}
              </button>
            </div>
            <div className="mt-5 grid gap-2 md:grid-cols-2">
              {query.data?.riders.map((r) => (
                <div key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <b>{r.user.name}</b>
                      <span className="ml-2 text-slate-500">
                        {r.user.email} · {r.hub?.name ?? "—"}
                      </span>
                      <p className="mt-1 text-xs font-semibold text-[#0787df]">{riderPaySummary(r)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditRider(r)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold dark:border-white/10"
                    >
                      {t("editRider")}
                    </button>
                  </div>
                  {editingRiderId === r.id && (
                    <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3 dark:border-white/10 md:grid-cols-3">
                      <select
                        aria-label={t("payModel")}
                        value={editRider.payModel}
                        onChange={(e) => setEditRider((v) => ({ ...v, payModel: e.target.value as PayModel }))}
                        className={control}
                      >
                        {PAY_MODELS.map((model) => (
                          <option key={model} value={model}>
                            {payModelLabel(model)}
                          </option>
                        ))}
                      </select>
                      {needsCommission(editRider.payModel) && (
                        <input
                          aria-label={t("commissionPercent")}
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={editRider.commissionPercent}
                          onChange={(e) => setEditRider((v) => ({ ...v, commissionPercent: e.target.value }))}
                          className={control}
                          placeholder={t("commissionPercent")}
                        />
                      )}
                      {needsSalary(editRider.payModel) && (
                        <input
                          aria-label={t("monthlySalary")}
                          type="number"
                          min={0}
                          step={1}
                          value={editRider.monthlySalary}
                          onChange={(e) => setEditRider((v) => ({ ...v, monthlySalary: e.target.value }))}
                          className={control}
                          placeholder={t("monthlySalary")}
                        />
                      )}
                      <div className="flex gap-2 md:col-span-3">
                        <button
                          type="button"
                          disabled={!isValidPay(editRider) || mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              path: `riders/${r.id}`,
                              method: "PATCH",
                              body: payPayload(editRider),
                            })
                          }
                          className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          {t("saveRider")}
                        </button>
                        <button type="button" onClick={() => setEditingRiderId(null)} className={control}>
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d] lg:col-span-2">
            <h2 className="font-display text-lg font-bold">{t("deliveryFeeEditor")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("deliveryFeeEditorDescription")}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
              <input aria-label={t("searchTownships")} value={feeSearch} onChange={(e) => setFeeSearch(e.target.value)} className={control} placeholder={t("searchTownships")} />
              <input aria-label={t("deliveryFee")} type="number" min={0} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={control} />
              <button
                disabled={!selectedTownships.length || !/^\d+$/.test(deliveryFee) || feeMutation.isPending}
                onClick={() => feeMutation.mutate()}
                className="rounded-xl bg-[#1598ef] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {t("applyDeliveryFee")}
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={() =>
                    setSelectedTownships((current) =>
                      allFilteredSelected
                        ? current.filter((id) => !filteredTownships.some((item) => item.id === id))
                        : [...new Set([...current, ...filteredTownships.map((item) => item.id)])],
                    )
                  }
                />
                {t("selectTownships")} ({selectedTownships.length})
              </label>
            </div>
            <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
              {filteredTownships.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-white/5">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={selectedTownships.includes(item.id)} onChange={() => toggleTownship(item.id)} />
                    <span>{townshipLabel(item)}</span>
                  </label>
                  <span className="font-bold">{item.deliveryFee == null ? "—" : `${item.deliveryFee.toLocaleString()} MMK`}</span>
                </li>
              ))}
            </ul>
          </section>
          <ReasonCodesSection />
          {user?.role === "SUPERADMIN" && <UserAdminSection hubs={query.data?.hubs ?? []} />}
        </div>
      )}
    </div>
  );
}
