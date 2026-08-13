export function isNewerRelease(current:string,remote:string){
  const parts=(value:string)=>value.split(".").map((part)=>Number.parseInt(part,10)||0);
  const a=parts(current);
  const b=parts(remote);
  const length=Math.max(a.length,b.length);
  for(let index=0;index<length;index+=1){
    if((b[index]??0)>(a[index]??0))return true;
    if((b[index]??0)<(a[index]??0))return false;
  }
  return false;
}

export function isAllowedApkUrl(url:string){
  try{
    const parsed=new URL(url);
    return parsed.protocol==="https:"&&parsed.hostname==="lotaya.mmds.site"&&parsed.pathname.toLowerCase().endsWith(".apk");
  }catch{
    return false;
  }
}

export type RiderAppRelease={version:string;apkUrl:string};

export async function fetchRiderAppRelease(url:string,fetcher:typeof fetch=fetch):Promise<RiderAppRelease|null>{
  try{
    const response=await fetcher(url,{headers:{accept:"application/json"}});
    if(!response.ok)return null;
    const body=await response.json() as Partial<RiderAppRelease>;
    if(typeof body.version!=="string"||typeof body.apkUrl!=="string"||!isAllowedApkUrl(body.apkUrl))return null;
    return {version:body.version.trim(),apkUrl:body.apkUrl.trim()};
  }catch{
    return null;
  }
}
