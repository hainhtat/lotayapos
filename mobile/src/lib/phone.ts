export type PhoneLauncher={canOpenURL(url:string):Promise<boolean>;openURL(url:string):Promise<unknown>};

export async function callCustomer(phone:string|undefined,launcher:PhoneLauncher){
  const normalized=phone?.replace(/[^+\d]/g,"");
  if(!normalized)return "missing" as const;
  const url=`tel:${normalized}`;
  try{
    if(!await launcher.canOpenURL(url))return "unavailable" as const;
    await launcher.openURL(url);return "opened" as const;
  }catch{return "error" as const;}
}
