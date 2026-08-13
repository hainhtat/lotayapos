import type {AssignedParcel} from "./api";
import {filterAndSortRoute,parcelTownship,routeTownships} from "./route-parcels";

const parcel=(id:string,township:string,group?:string):AssignedParcel=>({id,trackingNumber:`T-${id}`,customerName:`Customer ${id}`,customerPhone:"09 111",address:"Street",township,codAmount:100,deliveryFee:10,status:"ASSIGNED",linkedParcelGroupId:group});
describe("rider route organization",()=>{
  const parcels=[parcel("3","Yankin","linked"),parcel("1","Ahlone"),parcel("2","Yankin","linked")];
  it("offers unique sorted townships",()=>expect(routeTownships(parcels)).toEqual(["Ahlone","Yankin"]));
  it("filters by township and search",()=>expect(filterAndSortRoute(parcels,{township:"Yankin",search:"T-2",sortByTownship:true}).map(p=>p.id)).toEqual(["2"]));
  it("sorts townships while keeping linked parcels adjacent",()=>expect(filterAndSortRoute(parcels,{township:"",search:"",sortByTownship:true}).map(p=>p.id)).toEqual(["1","3","2"]));
  it("prefers Myanmar township names for my locale",()=>{
    const localized:AssignedParcel={...parcel("9","Yankin"),townshipRelation:{nameEn:"Yankin",nameMy:"ရန်ကင်း"}};
    expect(parcelTownship(localized,"my")).toBe("ရန်ကင်း");
    expect(routeTownships([localized],"my")).toEqual(["ရန်ကင်း"]);
    expect(filterAndSortRoute([localized],{township:"ရန်ကင်း",search:"",sortByTownship:true,locale:"my"}).map(p=>p.id)).toEqual(["9"]);
  });
});
