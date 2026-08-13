export type PhoneLauncher={canOpenURL(url:string):Promise<boolean>;openURL(url:string):Promise<unknown>};

export function sanitizedCustomerPhone(phone:string|undefined){
  return phone?.replace(/[^+\d]/g,"")??"";
}

export async function callCustomer(phone:string|undefined,launcher:PhoneLauncher){
  const normalized=sanitizedCustomerPhone(phone);
  if(!normalized)return "missing" as const;
  const url=`tel:${normalized}`;
  try{
    if(!await launcher.canOpenURL(url))return "unavailable" as const;
    await launcher.openURL(url);return "opened" as const;
  }catch{return "error" as const;}
}
