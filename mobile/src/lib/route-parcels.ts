import type {AssignedParcel} from "@/lib/api";

export function parcelTownship(parcel:AssignedParcel,locale="en"){
  if(locale.startsWith("my")&&parcel.townshipRelation?.nameMy)return parcel.townshipRelation.nameMy;
  return parcel.townshipRelation?.nameEn??parcel.township?.trim()??"";
}

export function routeTownships(parcels:AssignedParcel[],locale="en"){
  return [...new Set(parcels.map(parcel=>parcelTownship(parcel,locale)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

export function filterAndSortRoute(parcels:AssignedParcel[],input:{search:string;township:string;sortByTownship:boolean;locale?:string}){
  const locale=input.locale??"en";const needle=input.search.trim().toLocaleLowerCase();
  const filtered=parcels.filter(parcel=>{
    const township=parcelTownship(parcel,locale);
    const matchesTownship=!input.township||township===input.township;
    const haystack=[parcel.trackingNumber,parcel.customerName,parcel.customerPhone,parcel.address,township].filter(Boolean).join(" ").toLocaleLowerCase();
    return matchesTownship&&(!needle||haystack.includes(needle));
  });
  if(!input.sortByTownship)return filtered;
  return filtered.map((parcel,index)=>({parcel,index})).sort((a,b)=>{
    const township=parcelTownship(a.parcel,locale).localeCompare(parcelTownship(b.parcel,locale));
    if(township)return township;
    const aGroup=a.parcel.linkedParcelGroupId??a.parcel.id;const bGroup=b.parcel.linkedParcelGroupId??b.parcel.id;
    return aGroup.localeCompare(bGroup)||a.index-b.index;
  }).map(item=>item.parcel);
}
