import type { ErrorRequestHandler, RequestHandler } from "express"; import { validationResult } from "express-validator"; import { ApiError } from "../utils/api-error.js"; import { t } from "../i18n/messages.js";
export const validation: RequestHandler = (req,_res,next) => { const result = validationResult(req); if (!result.isEmpty()) return next(new ApiError(400,"VALIDATION_ERROR",t(req.locale,"validation"),result.array())); next(); };
export const notFound: RequestHandler = (req,_res,next) => next(new ApiError(404,"NOT_FOUND",`Route ${req.method} ${req.path} not found`));
export const errorHandler: ErrorRequestHandler = (error,req,res,_next) => {
  const oversized = error?.type === "entity.too.large" || error?.status === 413;
  const err = error instanceof ApiError ? error : oversized
    ? new ApiError(413, "PAYLOAD_TOO_LARGE", "The upload is too large")
    : new ApiError(500,"INTERNAL_ERROR","An unexpected error occurred");
  res.status(err.status).json({ success:false, error:{ code:err.code, message:err.message, details:err.details, requestId:req.requestId } });
};
