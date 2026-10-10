import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { buildParcelLinkSuggestions } from "../src/services/parcel-link-suggestions.service.js";
import { signAccessToken } from "../src/utils/jwt.js";

const nonce = Date.now().toString(36);
const hubId = `suggest-hub-${nonce}`;
const otherHubId = `suggest-other-hub-${nonce}`;
const shopId = `suggest-shop-${nonce}`;
const otherShopId = `suggest-other-shop-${nonce}`;
const userId = `suggest-user-${nonce}`;
const batchIds = Array.from({length: 4}, (_, i) => `suggest-batch-${i}-${nonce}`);
const token = (role = "DISPATCHER") => signAccessToken({ sub: userId, email: `suggest-${nonce}@test.local`, role, tokenVersion: 0 });

function candidate(id: string, customerName = "May Aung", customerPhone = "09123456789", shop = shopId, hub = hubId) {
  return { id, trackingNumber: id, customerName, customerPhone, address: id, township: "Hlaing", status: "PICKED_UP", riderId: null, deliveryFee: 4000, createdAt: new Date(), batch: { shopId: shop, hubId: hub, shop: { name: shop } } };
}

describe("dispatch link suggestions", () => {
  beforeAll(async () => {
    await prisma.hub.createMany({data:[{id:hubId,name:hubId},{id:otherHubId,name:otherHubId}]});
    await prisma.onlineShop.createMany({data:[{id:shopId,name:shopId},{id:otherShopId,name:otherShopId}]});
    await prisma.user.create({data:{id:userId,name:"Dispatcher",username:userId,email:`suggest-${nonce}@test.local`,passwordHash:"test-only",role:"DISPATCHER",hubId}});
    await prisma.batch.createMany({data:batchIds.map((id,i)=>({id,shopId:i===2?otherShopId:shopId,hubId:i===3?otherHubId:hubId,pickupDate:new Date(`2037-01-0${i+1}`),label:id}))});
    await prisma.parcel.createMany({data:[
      {batchId:batchIds[0]!,trackingNumber:`SUG-A-${nonce}`,customerName:"May  Aung",customerPhone:"၀၉ ၁၂၃ ၄၅၆ ၇၈၉",address:"No. 12 Road",codAmount:10000,deliveryFee:4000,status:"PICKED_UP"},
      {batchId:batchIds[1]!,trackingNumber:`SUG-B-${nonce}`,customerName:"may aung",customerPhone:"+95 9 123 456 789",address:"No 12 Rd",codAmount:10000,deliveryFee:3000,status:"ASSIGNED"},
      {batchId:batchIds[1]!,trackingNumber:`SUG-DEL-${nonce}`,customerName:"May Aung",customerPhone:"09123456789",address:"No. 12 Road",codAmount:10000,deliveryFee:4000,status:"DELIVERED"},
      {batchId:batchIds[2]!,trackingNumber:`SUG-OS-${nonce}`,customerName:"May Aung",customerPhone:"09123456789",address:"No. 12 Road",codAmount:10000,deliveryFee:4000,status:"PICKED_UP"},
      {batchId:batchIds[3]!,trackingNumber:`SUG-OH-${nonce}`,customerName:"May Aung",customerPhone:"09123456789",address:"No. 12 Road",codAmount:10000,deliveryFee:4000,status:"PICKED_UP"},
    ]});
  });
  afterAll(async () => {
    await prisma.parcel.deleteMany({where:{batchId:{in:batchIds}}});
    await prisma.batch.deleteMany({where:{id:{in:batchIds}}});
    await prisma.user.delete({where:{id:userId}});
    await prisma.onlineShop.deleteMany({where:{id:{in:[shopId,otherShopId]}}});
    await prisma.hub.deleteMany({where:{id:{in:[hubId,otherHubId]}}});
  });
  test("finds cross-batch normalized matches but excludes delivered and other scopes", async () => {
    const response = await request(app).get("/api/v1/operations/parcels/link-suggestions").set("Authorization",`Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.groups).toHaveLength(1);
    expect(response.body.data.groups[0]).toMatchObject({shopId,hubId,baseDeliveryFee:4000,totalDeliveryFee:5000,savings:2000});
    expect(response.body.data.groups[0].parcels.map((p:{trackingNumber:string})=>p.trackingNumber).sort()).toEqual([`SUG-A-${nonce}`,`SUG-B-${nonce}`].sort());
  });
  test("requires auth, role and hub scope", async () => {
    const path="/api/v1/operations/parcels/link-suggestions";
    expect((await request(app).get(path)).status).toBe(401);
    await prisma.user.update({where:{id:userId},data:{role:"FINANCE"}});
    try {
      expect((await request(app).get(path).set("Authorization",`Bearer ${token("FINANCE")}`)).status).toBe(403);
    } finally {
      await prisma.user.update({where:{id:userId},data:{role:"DISPATCHER"}});
    }
    expect((await request(app).get(`${path}?hubId=${otherHubId}`).set("Authorization",`Bearer ${token()}`)).status).toBe(403);
  });
  test("name and phone are both required within one shop and hub; large groups disclose truncation", () => {
    expect(buildParcelLinkSuggestions([candidate("a"),candidate("b","Other"),candidate("c","May Aung","0922222222"),candidate("d","May Aung","09123456789",otherShopId),candidate("e","May Aung","09123456789",shopId,otherHubId)]).groups).toHaveLength(0);
    const result=buildParcelLinkSuggestions(Array.from({length:22},(_,i)=>candidate(String(i))));
    expect(result.groups[0]?.parcels).toHaveLength(20);
    expect(result.groups[0]?.omittedCandidates).toBe(2);
    expect(result.omittedCandidates).toBe(2);
  });
});
