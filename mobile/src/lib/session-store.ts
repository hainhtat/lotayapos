import {kvDelete,kvGet,kvSet} from "@/lib/kv-store";

const tokenKey="lotaya-access-token";
const refreshKey="lotaya-refresh-token";
export const rememberedIdentifierKey="lotaya-login-identifier";
let sessionToken:string|null=null;
let sessionRefresh:string|null=null;

export async function restoreAccessToken(){sessionToken=await kvGet(tokenKey);return sessionToken;}
export async function getAccessToken(){return sessionToken??kvGet(tokenKey);}
export async function setAccessToken(token:string,_remember=true){sessionToken=token;await kvSet(tokenKey,token);}
export async function restoreRefreshToken(){sessionRefresh=await kvGet(refreshKey);return sessionRefresh;}
export async function getRefreshToken(){return sessionRefresh??kvGet(refreshKey);}
export async function setRefreshToken(token:string){sessionRefresh=token;await kvSet(refreshKey,token);}
export async function clearAccessToken(){
  sessionToken=null;
  sessionRefresh=null;
  await kvDelete(tokenKey);
  await kvDelete(refreshKey);
}
export async function saveRememberedIdentifier(identifier:string,remember:boolean){if(remember)await kvSet(rememberedIdentifierKey,identifier.trim());else await kvDelete(rememberedIdentifierKey);}
export function getRememberedIdentifier(){return kvGet(rememberedIdentifierKey);}
