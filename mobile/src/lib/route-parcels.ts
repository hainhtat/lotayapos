import type {AssignedParcel} from "@/lib/api";
import {hubCalendarDate} from "@/lib/hub-time";

const terminalStatuses=new Set(["DELIVERED","PARTIAL","FAILED","REJECTED","PENDING_RETURN","RETURNED","CANCELLED"]);

export type DeliveryFilter="all"|"toDeliver"|"delivered";
export type DatePreset="today"|"thisWeek"|"thisMonth";
export const DELIVERY_FILTERS:DeliveryFilter[]=["all","toDeliver","delivered"];
export const DATE_PRESETS:DatePreset[]=["today","thisWeek","thisMonth"];

export function isUndeliveredParcel(parcel:Pick<AssignedParcel,"status">){
  return !terminalStatuses.has(parcel.status);
}

export function matchesDeliveryFilter(parcel:Pick<AssignedParcel,"status">,filter:DeliveryFilter){
  if(filter==="all")return true;
  if(filter==="delivered")return parcel.status==="DELIVERED";
  return isUndeliveredParcel(parcel);
}

function ymdParts(ymd:string){
  const [year,month,day]=ymd.split("-").map(Number);
  return {year,month,day};
}

function isoFromParts(year:number,month:number,day:number){
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function addDays(year:number,month:number,day:number,offset:number){
  const date=new Date(Date.UTC(year,month-1,day+offset));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}

export function datePresetRange(preset:DatePreset,now=new Date()){
  const {year,month,day}=ymdParts(hubCalendarDate(now));
  if(preset==="today")return {dateFrom:isoFromParts(year,month,day),dateTo:isoFromParts(year,month,day)};
  if(preset==="thisWeek"){
    const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
    const mondayOffset=weekday===0?-6:1-weekday;
    const start=addDays(year,month,day,mondayOffset);
    const end=addDays(start.year,start.month,start.day,6);
    return {dateFrom:isoFromParts(start.year,start.month,start.day),dateTo:isoFromParts(end.year,end.month,end.day)};
  }
  const last=addDays(year,month+1,1,-1);
  return {dateFrom:isoFromParts(year,month,1),dateTo:isoFromParts(last.year,last.month,last.day)};
}

export function parcelTownship(parcel:AssignedParcel,locale="en"){
  if(locale.startsWith("my")&&parcel.townshipRelation?.nameMy)return parcel.townshipRelation.nameMy;
  return parcel.townshipRelation?.nameEn??parcel.township?.trim()??"";
}

export function routeTownships(parcels:AssignedParcel[],locale="en"){
  return [...new Set(parcels.map(parcel=>parcelTownship(parcel,locale)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

export function filterAndSortRoute(parcels:AssignedParcel[],input:{search:string;township:string;sortByTownship:boolean;deliveryFilter?:DeliveryFilter;locale?:string}){
  const locale=input.locale??"en";
  const deliveryFilter=input.deliveryFilter??"toDeliver";
  const needle=input.search.trim().toLocaleLowerCase();
  const filtered=parcels.filter(parcel=>{
    if(!matchesDeliveryFilter(parcel,deliveryFilter))return false;
    const township=parcelTownship(parcel,locale);
    const matchesTownship=!input.township||township===input.township;
    const haystack=[parcel.trackingNumber,parcel.orderId,parcel.customerName,parcel.customerPhone,parcel.address,township].filter(Boolean).join(" ").toLocaleLowerCase();
    return matchesTownship&&(!needle||haystack.includes(needle));
  });
  return filtered.map((parcel,index)=>({parcel,index})).sort((a,b)=>{
    const undelivered=Number(isUndeliveredParcel(b.parcel))-Number(isUndeliveredParcel(a.parcel));
    if(undelivered)return undelivered;
    if(input.sortByTownship){
      const township=parcelTownship(a.parcel,locale).localeCompare(parcelTownship(b.parcel,locale));
      if(township)return township;
      const aGroup=a.parcel.linkedParcelGroupId??a.parcel.id;const bGroup=b.parcel.linkedParcelGroupId??b.parcel.id;
      const group=aGroup.localeCompare(bGroup);
      if(group)return group;
    }
    return a.index-b.index;
  }).map(item=>item.parcel);
}
