export type AppTheme="light"|"dark";
export type AppLocale="en"|"my";

export function resolveStoredTheme(value:string|null,systemTheme:string|null|undefined):AppTheme{
  if(value==="light"||value==="dark")return value;
  return systemTheme==="dark"?"dark":"light";
}
export function nextTheme(theme:AppTheme):AppTheme{return theme==="dark"?"light":"dark";}
export function resolveStoredLocale(value:string|null):AppLocale{return value==="my"?"my":"en";}
