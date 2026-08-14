import type { RequestHandler, Response } from "express";
import * as service from "../services/auth.service.js";
import { env } from "../config/env.js";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_SECONDS } from "../utils/jwt.js";

const cookieSecurity = env.nodeEnv === "production" ? "; Secure" : "";

function appendCookie(res: Response, value: string) {
  res.append("Set-Cookie", value);
}

function setSessionCookies(res: Response, result: Awaited<ReturnType<typeof service.login>>) {
  const refreshMaxAge = result.remember ? REFRESH_TTL_SECONDS.remember : REFRESH_TTL_SECONDS.session;
  appendCookie(res, `accessToken=${encodeURIComponent(result.accessToken)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ACCESS_TOKEN_TTL_SECONDS}${cookieSecurity}`);
  appendCookie(res, `refreshToken=${encodeURIComponent(result.refreshToken)}; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=${refreshMaxAge}${cookieSecurity}`);
}

function clearSessionCookies(res: Response) {
  appendCookie(res, `accessToken=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${cookieSecurity}`);
  appendCookie(res, `refreshToken=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0${cookieSecurity}`);
}

function sessionBody(result: Awaited<ReturnType<typeof service.login>>) {
  return {
    user: result.user,
    accessToken: result.accessToken,
    token: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
  };
}

export const register: RequestHandler = async (req, res) => {
  const result = await service.register(req.body, { id: req.auth!.sub, role: req.auth!.role });
  setSessionCookies(res, result);
  return res.status(201).json({ success: true, data: sessionBody(result) });
};

export const login: RequestHandler = async (req, res) => {
  const result = await service.login(req.body);
  setSessionCookies(res, result);
  return res.json({ success: true, data: sessionBody(result) });
};

export const refresh: RequestHandler = async (req, res) => {
  const result = await service.refresh({ cookieHeader: req.headers.cookie, refreshToken: req.body?.refreshToken });
  setSessionCookies(res, result);
  return res.json({ success: true, data: sessionBody(result) });
};

export const verify: RequestHandler = async (req, res) => res.json({ success: true, data: await service.verify(req.auth!.sub) });

export const logout: RequestHandler = async (req, res) => {
  await service.logout({ cookieHeader: req.headers.cookie, refreshToken: req.body?.refreshToken, userId: req.auth?.sub });
  clearSessionCookies(res);
  return res.status(204).send();
};
