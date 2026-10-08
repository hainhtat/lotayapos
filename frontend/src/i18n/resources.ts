import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enBatches from "./locales/en/batches.json";
import enParcels from "./locales/en/parcels.json";
import enDispatch from "./locales/en/dispatch.json";
import enReturns from "./locales/en/returns.json";
import enFinance from "./locales/en/finance.json";
import enSettings from "./locales/en/settings.json";
import enReports from "./locales/en/reports.json";
import enRiderApp from "./locales/en/rider-app.json";
import enOperationsReview from "./locales/en/operations-review.json";
import myCommon from "./locales/my/common.json";
import myDashboard from "./locales/my/dashboard.json";
import myBatches from "./locales/my/batches.json";
import myParcels from "./locales/my/parcels.json";
import myDispatch from "./locales/my/dispatch.json";
import myReturns from "./locales/my/returns.json";
import myFinance from "./locales/my/finance.json";
import mySettings from "./locales/my/settings.json";
import myReports from "./locales/my/reports.json";
import myRiderApp from "./locales/my/rider-app.json";
import myOperationsReview from "./locales/my/operations-review.json";

// Keep the existing flat translation namespace so current t("key") calls still work.
const en = { ...enCommon, ...enDashboard, ...enBatches, ...enParcels, ...enDispatch, ...enReturns, ...enFinance, ...enSettings, ...enReports, ...enRiderApp, ...enOperationsReview };
const my = { ...myCommon, ...myDashboard, ...myBatches, ...myParcels, ...myDispatch, ...myReturns, ...myFinance, ...mySettings, ...myReports, ...myRiderApp, ...myOperationsReview };

export const resources = {
  en: { translation: en },
  my: { translation: my },
};
