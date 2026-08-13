import type { RequestHandler } from "express"; import * as service from "../services/auth.service.js"; import { env } from "../config/env.js";
const cookieSecurity = env.nodeEnv === "production" ? "; Secure" : "";
const respondWithToken = (res: Parameters<RequestHandler>[1], result: Awaited<ReturnType<typeof service.login>>) => { res.setHeader("Set-Cookie", `accessToken=${result.accessToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=900${cookieSecurity}`); return { ...result, token: result.accessToken }; };
export const register: RequestHandler = async (req,res) => { const result = await service.register(req.body,{ id:req.auth!.sub, role:req.auth!.role }); return res.status(201).json({success:true,data:respondWithToken(res,result)}); };
export const login: RequestHandler = async (req,res) => { const result = await service.login(req.body); return res.json({success:true,data:respondWithToken(res,result)}); };
export const verify: RequestHandler = async (req,res) => res.json({success:true,data:await service.verify(req.auth!.sub)});
export const logout: RequestHandler = async (_req,res) => { res.setHeader("Set-Cookie", `accessToken=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${cookieSecurity}`); return res.status(204).send(); };
