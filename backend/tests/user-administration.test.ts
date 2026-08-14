import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("Superadmin user administration",()=>{
  const suffix=`${Date.now()}-${Math.random().toString(16).slice(2)}`; let adminId=""; let hubId=""; const createdIds:string[]=[];
  beforeAll(async()=>{const admin=await prisma.user.create({data:{name:"Admin",username:`admin-${suffix}`,email:`admin-${suffix}@example.com`,passwordHash:await bcrypt.hash("AdminPassword123",4),role:"SUPERADMIN"}});adminId=admin.id;const hub=await prisma.hub.create({data:{name:`Hub ${suffix}`}});hubId=hub.id;});
  afterAll(async()=>{await prisma.refreshToken.deleteMany({where:{userId:{in:[...createdIds,adminId]}}});await prisma.userAdminAudit.deleteMany({where:{OR:[{actorId:adminId},{targetUserId:{in:createdIds}}]}});await prisma.rider.deleteMany({where:{userId:{in:createdIds}}});await prisma.user.deleteMany({where:{id:{in:[...createdIds,adminId]}}});await prisma.hub.delete({where:{id:hubId}});await prisma.$disconnect();});
  const auth=()=>`Bearer ${signAccessToken({sub:adminId,email:`admin-${suffix}@example.com`,role:"SUPERADMIN",tokenVersion:0})}`;

  test("creates, filters, edits, disables, and audits a scoped user without exposing secrets",async()=>{
    const created=await request(app).post("/api/v1/users").set("Authorization",auth()).send({name:"Finance User",username:`finance-${suffix}`,email:`finance-${suffix}@example.com`,password:"TemporaryPass123",role:"FINANCE",hubId});
    expect(created.status).toBe(201); expect(created.body.data).not.toHaveProperty("passwordHash"); const id=created.body.data.id as string;createdIds.push(id);
    const listed=await request(app).get(`/api/v1/users?role=FINANCE&active=true&search=finance-${suffix}`).set("Authorization",auth()); expect(listed.status).toBe(200);expect(listed.body.data.items.map((u:{id:string})=>u.id)).toContain(id);
    const edited=await request(app).patch(`/api/v1/users/${id}`).set("Authorization",auth()).send({role:"DISPATCHER",hubId});expect(edited.status).toBe(200);
    const disabled=await request(app).patch(`/api/v1/users/${id}/status`).set("Authorization",auth()).send({active:false});expect(disabled.status).toBe(200);expect(disabled.body.data.active).toBe(false);
    const audits=await prisma.userAdminAudit.findMany({where:{targetUserId:id}});expect(audits.map(a=>a.action)).toEqual(expect.arrayContaining(["USER_CREATED","USER_UPDATED","USER_DEACTIVATED"]));expect(audits.map(a=>`${a.beforeJson}${a.afterJson}`).join(" ")).not.toContain("TemporaryPass123");
  });

  test("password reset revokes an existing token and stores no password in audit",async()=>{
    const user=await prisma.user.create({data:{name:"Auditor",username:`auditor-${suffix}`,email:`auditor-${suffix}@example.com`,passwordHash:await bcrypt.hash("OldPassword123",4),role:"AUDITOR"}});createdIds.push(user.id);
    const oldToken=signAccessToken({sub:user.id,email:user.email,role:user.role,tokenVersion:user.tokenVersion});
    const reset=await request(app).post(`/api/v1/users/${user.id}/password-reset`).set("Authorization",auth()).send({password:"NewPassword456"});expect(reset.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/verify").set("Authorization",`Bearer ${oldToken}`)).status).toBe(401);
    const audit=await prisma.userAdminAudit.findFirstOrThrow({where:{targetUserId:user.id,action:"USER_PASSWORD_RESET"}});expect(audit.beforeJson).toBeNull();expect(audit.afterJson).toBeNull();
  });

  test("deactivation invalidates existing access and refresh tokens",async()=>{
    const password="DeactivatePass123";
    const user=await prisma.user.create({data:{name:"Finance Deactivate",username:`finance-deactivate-${suffix}`,email:`finance-deactivate-${suffix}@example.com`,passwordHash:await bcrypt.hash(password,4),role:"FINANCE",hubId}});
    createdIds.push(user.id);
    const loggedIn=await request(app).post("/api/v1/auth/login").send({identifier:user.email,password});
    expect(loggedIn.status).toBe(200);
    const staleAccess=loggedIn.body.data.accessToken as string;
    const refreshToken=loggedIn.body.data.refreshToken as string;
    const disabled=await request(app).patch(`/api/v1/users/${user.id}/status`).set("Authorization",auth()).send({active:false});
    expect(disabled.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/verify").set("Authorization",`Bearer ${staleAccess}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").send({refreshToken})).status).toBe(401);
  });

  test("privilege change invalidates existing access and refresh tokens",async()=>{
    const password="PrivilegePass123";
    const user=await prisma.user.create({data:{name:"Finance Privilege",username:`finance-privilege-${suffix}`,email:`finance-privilege-${suffix}@example.com`,passwordHash:await bcrypt.hash(password,4),role:"FINANCE",hubId}});
    createdIds.push(user.id);
    const loggedIn=await request(app).post("/api/v1/auth/login").send({identifier:user.email,password});
    expect(loggedIn.status).toBe(200);
    const staleAccess=loggedIn.body.data.accessToken as string;
    const refreshToken=loggedIn.body.data.refreshToken as string;
    const edited=await request(app).patch(`/api/v1/users/${user.id}`).set("Authorization",auth()).send({role:"DISPATCHER",hubId});
    expect(edited.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/verify").set("Authorization",`Bearer ${staleAccess}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").send({refreshToken})).status).toBe(401);
  });

  test("prevents self-deactivation and removal of the last active Superadmin",async()=>{
    const self=await request(app).patch(`/api/v1/users/${adminId}/status`).set("Authorization",auth()).send({active:false});expect(self.status).toBe(409);expect(self.body.error.code).toBe("SELF_DEACTIVATION");
    const demote=await request(app).patch(`/api/v1/users/${adminId}`).set("Authorization",auth()).send({role:"AUDITOR",hubId:null});expect(demote.status).toBe(409);expect(demote.body.error.code).toBe("SELF_PRIVILEGE_CHANGE");
  });

  test("dashboard overview resolves for a persisted active administrator",async()=>{const response=await request(app).get("/api/v1/master-data/dashboard").set("Authorization",auth());expect(response.status).toBe(200);expect(response.body.data).toHaveProperty("businessDate");});
});
