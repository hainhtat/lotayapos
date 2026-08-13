import {I18n} from "i18n-js";
import en from "./locales/en/common.json";
import my from "./locales/my/common.json";
import enSettlement from "./locales/en/settlement.json";
import mySettlement from "./locales/my/settlement.json";
import enOutcomes from "./locales/en/outcomes.json";
import myOutcomes from "./locales/my/outcomes.json";
import enLogin from "./locales/en/login.json";
import myLogin from "./locales/my/login.json";
import {kvGet,kvSet} from "@/lib/kv-store";
import {resolveStoredLocale,type AppLocale} from "@/lib/preferences";

export const i18n=new I18n({
  en:{...en,...enSettlement,...enOutcomes,...enLogin},
  my:{...my,...mySettlement,...myOutcomes,...myLogin},
});
i18n.enableFallback=true;
i18n.locale="en";

export async function loadLocale(){
  i18n.locale=resolveStoredLocale(await kvGet("lotaya-locale"));
}

export async function setLocale(locale:AppLocale){
  i18n.locale=locale;
  await kvSet("lotaya-locale",locale);
}
