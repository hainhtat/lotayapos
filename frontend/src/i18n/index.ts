import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

void i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem("lotaya-language") ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (language) => {
  localStorage.setItem("lotaya-language", language);
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
});

export default i18n;
