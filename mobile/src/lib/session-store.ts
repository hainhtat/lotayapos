import {kvDelete,kvGet,kvSet} from "@/lib/kv-store";

const tokenKey="lotaya-access-token";
export const rememberedIdentifierKey="lotaya-login-identifier";
let sessionToken:string|null=null;

export async function restoreAccessToken(){sessionToken=await kvGet(tokenKey);return sessionToken;}
export async function getAccessToken(){return sessionToken??kvGet(tokenKey);}
export async function setAccessToken(token:string,remember:boolean){sessionToken=token;if(remember)await kvSet(tokenKey,token);else await kvDelete(tokenKey);}
export async function clearAccessToken(){sessionToken=null;await kvDelete(tokenKey);}
export async function saveRememberedIdentifier(identifier:string,remember:boolean){if(remember)await kvSet(rememberedIdentifierKey,identifier.trim());else await kvDelete(rememberedIdentifierKey);}
export function getRememberedIdentifier(){return kvGet(rememberedIdentifierKey);}
