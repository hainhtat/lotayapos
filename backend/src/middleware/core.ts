import cors from "cors"; import type { RequestHandler } from "express"; import { randomUUID } from "node:crypto"; import { env } from "../config/env.js";
export const requestContext: RequestHandler = (req,res,next) => { req.requestId = randomUUID(); res.setHeader("x-request-id", req.requestId); const language = String(req.headers["accept-language"] ?? "").toLowerCase(); req.locale = language.startsWith("my") ? "my" : "en"; next(); };
export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || env.webOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
});
