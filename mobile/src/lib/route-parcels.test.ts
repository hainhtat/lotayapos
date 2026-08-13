import type {AssignedParcel} from "./api";
import {datePresetRange,filterAndSortRoute,isUndeliveredParcel,matchesDeliveryFilter,parcelTownship,routeTownships} from "./route-parcels";

const parcel=(id:string,township:string,group?:string,status="ASSIGNED"):AssignedParcel=>({
  id,
  trackingNumber:`T-${id}`,
  orderId:`OS-${id}`,
  customerName:`Customer ${id}`,
  customerPhone:"09 111",
  address:"Street",
  township,
  codAmount:100,
  deliveryFee:10,
  status,
  linkedParcelGroupId:group,
});

describe("rider route organization",()=>{
  const parcels=[parcel("3","Yankin","linked"),parcel("1","Ahlone"),parcel("2","Yankin","linked")];
  it("offers unique sorted townships",()=>expect(routeTownships(parcels)).toEqual(["Ahlone","Yankin"]));
  it("filters by township and search",()=>expect(filterAndSortRoute(parcels,{township:"Yankin",search:"T-2",sortByTownship:true,deliveryFilter:"all"}).map(p=>p.id)).toEqual(["2"]));
  it("defaults to to-deliver parcels and can show delivered or all",()=>{
    const mixed=[
      parcel("d","Ahlone",undefined,"DELIVERED"),
      parcel("3","Yankin","linked"),
      parcel("1","Ahlone"),
      parcel("2","Yankin","linked"),
      parcel("f","Yankin",undefined,"FAILED"),
    ];
    expect(filterAndSortRoute(mixed,{township:"",search:"",sortByTownship:true}).map(p=>p.id)).toEqual(["1","3","2"]);
    expect(filterAndSortRoute(mixed,{township:"",search:"",sortByTownship:true,deliveryFilter:"delivered"}).map(p=>p.id)).toEqual(["d"]);
    expect(filterAndSortRoute(mixed,{township:"",search:"",sortByTownship:true,deliveryFilter:"all"}).map(p=>p.id)).toEqual(["1","3","2","d","f"]);
  });
  it("sorts undelivered first, then townships while keeping linked parcels adjacent",()=>{
    const mixed=[
      parcel("d","Ahlone",undefined,"DELIVERED"),
      parcel("3","Yankin","linked"),
      parcel("1","Ahlone"),
      parcel("2","Yankin","linked"),
      parcel("f","Yankin",undefined,"FAILED"),
    ];
    expect(filterAndSortRoute(mixed,{township:"",search:"",sortByTownship:true,deliveryFilter:"all"}).map(p=>p.id)).toEqual(["1","3","2","d","f"]);
  });
  it("matches delivery filter statuses",()=>{
    expect(matchesDeliveryFilter({status:"ASSIGNED"},"toDeliver")).toBe(true);
    expect(matchesDeliveryFilter({status:"OUT_FOR_DELIVERY"},"toDeliver")).toBe(true);
    expect(matchesDeliveryFilter({status:"PENDING_RETURN"},"toDeliver")).toBe(false);
    expect(matchesDeliveryFilter({status:"PENDING_RETURN"},"all")).toBe(true);
    expect(matchesDeliveryFilter({status:"DELIVERED"},"toDeliver")).toBe(false);
    expect(matchesDeliveryFilter({status:"FAILED"},"toDeliver")).toBe(false);
    expect(matchesDeliveryFilter({status:"REJECTED"},"toDeliver")).toBe(false);
    expect(matchesDeliveryFilter({status:"DELIVERED"},"delivered")).toBe(true);
    expect(matchesDeliveryFilter({status:"FAILED"},"delivered")).toBe(false);
    expect(matchesDeliveryFilter({status:"FAILED"},"all")).toBe(true);
    expect(matchesDeliveryFilter({status:"REJECTED"},"all")).toBe(true);
  });
  it("computes hub-timezone today/week/month date ranges",()=>{
    const wednesday=new Date("2026-08-12T15:30:00+06:30");
    expect(datePresetRange("today",wednesday)).toEqual({dateFrom:"2026-08-12",dateTo:"2026-08-12"});
    expect(datePresetRange("thisWeek",wednesday)).toEqual({dateFrom:"2026-08-10",dateTo:"2026-08-16"});
    expect(datePresetRange("thisMonth",wednesday)).toEqual({dateFrom:"2026-08-01",dateTo:"2026-08-31"});
    expect(datePresetRange("thisWeek",new Date("2026-08-10T08:00:00+06:30"))).toEqual({dateFrom:"2026-08-10",dateTo:"2026-08-16"});
    expect(datePresetRange("thisWeek",new Date("2026-08-16T22:00:00+06:30"))).toEqual({dateFrom:"2026-08-10",dateTo:"2026-08-16"});
    expect(datePresetRange("thisMonth",new Date("2026-02-01T12:00:00+06:30"))).toEqual({dateFrom:"2026-02-01",dateTo:"2026-02-28"});
    expect(datePresetRange("today",new Date("2026-08-11T20:00:00.000Z"))).toEqual({dateFrom:"2026-08-12",dateTo:"2026-08-12"});
  });
  it("marks terminal statuses as delivered for route priority",()=>{
    expect(isUndeliveredParcel({status:"ASSIGNED"})).toBe(true);
    expect(isUndeliveredParcel({status:"OUT_FOR_DELIVERY"})).toBe(true);
    expect(isUndeliveredParcel({status:"PICKED_UP"})).toBe(true);
    expect(isUndeliveredParcel({status:"DELIVERED"})).toBe(false);
    expect(isUndeliveredParcel({status:"PARTIAL"})).toBe(false);
    expect(isUndeliveredParcel({status:"FAILED"})).toBe(false);
    expect(isUndeliveredParcel({status:"REJECTED"})).toBe(false);
    expect(isUndeliveredParcel({status:"PENDING_RETURN"})).toBe(false);
    expect(isUndeliveredParcel({status:"RETURNED"})).toBe(false);
    expect(isUndeliveredParcel({status:"CANCELLED"})).toBe(false);
  });
  it("prefers Myanmar township names for my locale",()=>{
    const localized:AssignedParcel={...parcel("9","Yankin"),townshipRelation:{nameEn:"Yankin",nameMy:"ရန်ကင်း"}};
    expect(parcelTownship(localized,"my")).toBe("ရန်ကင်း");
    expect(routeTownships([localized],"my")).toEqual(["ရန်ကင်း"]);
    expect(filterAndSortRoute([localized],{township:"ရန်ကင်း",search:"",sortByTownship:true,locale:"my"}).map(p=>p.id)).toEqual(["9"]);
  });
});
