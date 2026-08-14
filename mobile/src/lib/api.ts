import {clearAccessToken,getAccessToken,getRefreshToken,setAccessToken,setRefreshToken} from "@/lib/session-store";

const base=process.env.EXPO_PUBLIC_API_BASE_URL??"http://localhost:4000/api/v1";

type UnauthorizedListener=()=>void;
const unauthorizedListeners=new Set<UnauthorizedListener>();
export function onUnauthorized(listener:UnauthorizedListener){
  unauthorizedListeners.add(listener);
  return()=>{unauthorizedListeners.delete(listener)};
}
function notifyUnauthorized(){for(const listener of unauthorizedListeners)listener()}

export class ApiError extends Error{
  constructor(message:string,public readonly status:number){
    super(message);
    this.name="ApiError";
  }
}

type ApiSuccess<T>={success:true;data:T;pagination?:{page:number;pageSize:number;total:number;totalPages:number}};

function skipRefresh(path:string){
  return path.startsWith("/auth/login")||path.startsWith("/auth/refresh")||path.startsWith("/auth/register");
}

let refreshInFlight:Promise<boolean>|null=null;

async function persistSession(data:{accessToken?:string;refreshToken?:string}|null|undefined){
  if(!data?.accessToken)return false;
  await setAccessToken(data.accessToken);
  if(data.refreshToken)await setRefreshToken(data.refreshToken);
  return true;
}

export async function refreshSession():Promise<boolean>{
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=(async()=>{
    const refreshToken=await getRefreshToken();
    if(!refreshToken)return false;
    try{
      const response=await fetch(`${base}/auth/refresh`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({refreshToken}),
      });
      const body=await response.json().catch(()=>null);
      if(!response.ok)return false;
      return persistSession(body?.data);
    }catch{
      return false;
    }
  })().finally(()=>{refreshInFlight=null});
  return refreshInFlight;
}

async function send(path:string,init:RequestInit){
  const token=await getAccessToken();
  return fetch(`${base}${path}`,{
    ...init,
    headers:{
      "content-type":"application/json",
      ...(token?{authorization:`Bearer ${token}`}:{}),
    },
  });
}

export async function api<T>(path:string,init:RequestInit={},retried=false):Promise<ApiSuccess<T>>{
  const token=await getAccessToken();
  let response:Response;
  try{
    response=await send(path,init);
  }catch{
    throw new ApiError("Unable to reach the API. Start the backend on port 4000 and check EXPO_PUBLIC_API_BASE_URL.",0);
  }
  const body=await response.json().catch(()=>null);
  if(!response.ok){
    if(response.status===401&&!skipRefresh(path)&&!retried){
      const refreshed=await refreshSession();
      if(refreshed)return api<T>(path,init,true);
      if(token){
        await clearAccessToken();
        notifyUnauthorized();
      }
    }else if(response.status===401&&token){
      await clearAccessToken();
      notifyUnauthorized();
    }
    throw new ApiError(body?.error?.message??"Request failed",response.status);
  }
  return body as ApiSuccess<T>;
}

type ParcelResponse={
  id:string;
  trackingNumber:string;
  orderId?:string|null;
  customerName:string;
  customerPhone?:string;
  address:string;
  township?:string|null;
  townshipRelation?:{nameEn:string;nameMy?:string|null}|null;
  codAmount:number;
  deliveryFee:number;
  status:string;
  reasonCode?:string;
  linkGroup?:{id:string;parcels?:Array<{id:string;trackingNumber:string;status:string}>}|null;
};
export type AssignedParcel=ParcelResponse&{
  linkedParcelGroupId?:string|null;
  linkedParcelCount?:number;
  linkedParcelIds?:string[];
};

function enrichAssignedParcels(parcels:ParcelResponse[]):AssignedParcel[]{
  const counts=new Map<string,number>();
  for(const parcel of parcels)if(parcel.linkGroup?.id)counts.set(parcel.linkGroup.id,(counts.get(parcel.linkGroup.id)??0)+1);
  return parcels.map((parcel):AssignedParcel=>({
    ...parcel,
    linkedParcelGroupId:parcel.linkGroup?.id??null,
    linkedParcelCount:parcel.linkGroup?.id?counts.get(parcel.linkGroup.id):undefined,
  }));
}

export async function getAssignedParcels(filters?:{dateFrom?:string;dateTo?:string}):Promise<AssignedParcel[]>{
  const pageSize=100;
  let page=1;
  let totalPages=1;
  const parcels:ParcelResponse[]=[];
  while(page<=totalPages){
    const params=new URLSearchParams({assignedToMe:"true",page:String(page),pageSize:String(pageSize)});
    if(filters?.dateFrom)params.set("dateFrom",filters.dateFrom);
    if(filters?.dateTo)params.set("dateTo",filters.dateTo);
    const result=await api<ParcelResponse[]>(`/parcels?${params.toString()}`);
    parcels.push(...result.data);
    totalPages=result.pagination?.totalPages??1;
    page+=1;
  }
  return enrichAssignedParcels(parcels);
}

export async function getAssignedParcel(id:string):Promise<AssignedParcel>{
  const parcel=(await api<ParcelResponse>(`/parcels/${encodeURIComponent(id)}`)).data;
  return {...parcel,linkedParcelGroupId:parcel.linkGroup?.id??null,linkedParcelCount:parcel.linkGroup?.parcels?.length};
}

export type SettlementDeclaration={id:string;cash:number;kbzPay:number;wavePay:number;status:string;updatedAt:string};
export type SettlementPosting={id:string;status:string;expectedAmount:number;actualAmount:number;variance:number};
export type RiderSettlementPreview={
  riderId:string;
  businessDate:string;
  parcelCount:number;
  parcels?:Array<{id:string;trackingNumber:string;orderId?:string|null;codAmount:number;deliveryFee:number;commissionAmount:number}>;
  cod:number;
  fees:number;
  commission:number;
  salaryDeduction?:number;
  expectedAmount:number;
  outstandingAmount?:number;
  paidAmount?:number;
  payModel?:"PERCENTAGE"|"SALARY"|"SALARY_PLUS_PERCENTAGE";
  commissionRateBps?:number;
  declaration:SettlementDeclaration|null;
  settlement:SettlementPosting|null;
};
export function getRiderSettlementPreview(businessDate:string){
  return api<RiderSettlementPreview>(`/finance/rider-settlements/preview?businessDate=${encodeURIComponent(businessDate)}`).then(result=>result.data);
}
export function declareRiderSettlement(input:{businessDate:string;cash:number;kbzPay:number;wavePay:number}){
  return api<SettlementDeclaration>("/finance/rider-settlements/declarations",{method:"POST",body:JSON.stringify(input)}).then(result=>result.data);
}
export type ReasonCode={id:string;code:string;labelEn:string;labelMy:string;outcome:"PARTIAL"|"FAILED"|"REJECTED";noteRequired:boolean;active:boolean};
export function getReasonCodes(outcome:ReasonCode["outcome"]){
  return api<ReasonCode[]>(`/master-data/reason-codes?outcome=${outcome}`).then(result=>result.data);
}
