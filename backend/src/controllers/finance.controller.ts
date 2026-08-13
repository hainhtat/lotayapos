import type { RequestHandler } from "express";
import * as service from "../services/finance.service.js";
import * as ledgerService from "../services/ledger.service.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.auth!.sub, role: req.auth!.role });

export const settlement: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.createRiderSettlement(req.body, actor(req)) });
export const settlementPreview: RequestHandler = async (req, res) => res.json({ success: true, data: await service.previewRiderSettlement({ businessDate: String(req.query.businessDate), riderId: typeof req.query.riderId === "string" ? req.query.riderId : undefined }, actor(req)) });
export const riderOutstanding: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listRiderOutstanding({ businessDate: String(req.query.businessDate) }, actor(req)) });
export const osSettlementDrafts: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listOsSettlementDrafts({ shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined }, actor(req)) });
export const osSettlementPreview: RequestHandler = async (req, res) => res.json({ success: true, data: await service.previewOsSettlement(req.body, actor(req)) });
export const createOsSettlement: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.postOsSettlement(req.body, actor(req)) });
export const osSettlements: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listOsSettlements({ shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined, hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined }, actor(req)) });
export const osSettlementDetail: RequestHandler = async (req, res) => res.json({ success: true, data: await service.getOsSettlement(String(req.params.id), actor(req)) });
export const reverseOsSettlement: RequestHandler = async (req, res) => res.json({ success: true, data: await service.reverseOsSettlement({ id: String(req.params.id), ...req.body }, actor(req)) });
export const osPendingReturns: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listOsPendingReturns({ shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined, hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined }, actor(req)) });
export const receiveOsReturn: RequestHandler = async (req, res) => {
  const data = await service.receiveOsReturn(req.body, actor(req));
  const status = data.alreadyReceived ? 200 : 201;
  res.status(status).json({ success: true, data });
};
export const declareSettlement: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.declareRiderSettlement(req.body, actor(req)) });
export const close: RequestHandler = async (req, res) => res.json({ success: true, data: await service.closeCashbook(req.body, actor(req)) });
export const approveVariance: RequestHandler = async (req, res) => res.json({ success: true, data: await service.approveCashbookVariance(req.body, actor(req)) });
export const reopen: RequestHandler = async (req, res) => res.json({ success: true, data: await service.reopenCashbook(req.body, actor(req)) });
export const openingBalance: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.postOpeningBalance(req.body, actor(req)) });
export const walletTransfer: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.postWalletTransfer(req.body, actor(req)) });
export const adjustment: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.postCashbookAdjustment(req.body, actor(req)) });
export const expenseCategories: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listExpenseCategories(actor(req)) });
export const createExpenseCategory: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.createExpenseCategory(req.body, actor(req)) });
export const expenses: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listExpenses({ businessDate: typeof req.query.businessDate === "string" ? req.query.businessDate : undefined, hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined }, actor(req)) });
export const createExpense: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.postExpense(req.body, actor(req)) });
export const ledger: RequestHandler = async (req, res) => res.json({ success: true, data: await ledgerService.getLedgerReport(req.query, actor(req)) });
export const deliveryCollection: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await ledgerService.postDeliveryCollection(req.body, actor(req)) });
export const returnDeduction: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await ledgerService.postReturnDeduction(req.body, actor(req)) });
export const reversal: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await ledgerService.reverseJournalEntry(req.body, actor(req)) });
