import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { normalizeMyanmarPhone } from "../src/utils/phone.js";

describe("user phone identity", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const subscriber = `${String(Date.now()).slice(-7)}${Math.floor(10 + Math.random() * 90)}`;
  const localPhone = `09${subscriber}`;
  const canonicalPhone = `+959${subscriber}`;
  const secondPhone = `09${subscriber.slice(0, -1)}${subscriber.endsWith("9") ? "8" : "9"}`;
  const password = "PhoneLoginPass123";
  const createdIds: string[] = [];
  let adminId = "";
  let hubId = "";

  const auth = () => `Bearer ${signAccessToken({ sub: adminId, email: `phone-admin-${suffix}@example.com`, role: "SUPERADMIN", tokenVersion: 0 })}`;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: "Phone Admin", username: `phone-admin-${suffix}`, email: `phone-admin-${suffix}@example.com`, passwordHash: await bcrypt.hash(password, 4), role: "SUPERADMIN" },
    });
    adminId = admin.id;
    createdIds.push(admin.id);
    hubId = (await prisma.hub.create({ data: { name: `Phone login hub ${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.userAdminAudit.deleteMany({ where: { OR: [{ actorId: adminId }, { targetUserId: { in: createdIds } }] } });
    await prisma.rider.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.hub.delete({ where: { id: hubId } });
  });

  test("normalizes safe local and international Myanmar phone spellings", () => {
    expect(normalizeMyanmarPhone(localPhone)).toBe(canonicalPhone);
    expect(normalizeMyanmarPhone(`+95 9-${subscriber}`)).toBe(canonicalPhone);
    expect(normalizeMyanmarPhone(`(${localPhone})`)).toBeNull();
    expect(normalizeMyanmarPhone("09123abc456")).toBeNull();
  });

  test("admin provisions a rider phone and the rider logs in using either spelling", async () => {
    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", auth())
      .send({ name: "Phone Rider", username: `phone-rider-${suffix}`, email: `phone-rider-${suffix}@example.com`, phone: `09 ${subscriber}`, password, role: "RIDER", hubId });

    expect(created.status).toBe(201);
    expect(created.body.data.phone).toBe(canonicalPhone);
    expect(created.body.data).not.toHaveProperty("passwordHash");
    const riderUserId = created.body.data.id as string;
    createdIds.push(riderUserId);

    for (const identifier of [localPhone, `+95 9-${subscriber}`]) {
      const login = await request(app).post("/api/v1/auth/login").send({ identifier, password });
      expect(login.status).toBe(200);
      expect(login.body.data.user).toMatchObject({ id: riderUserId, phone: canonicalPhone });
    }

    const audit = await prisma.userAdminAudit.findFirstOrThrow({ where: { targetUserId: riderUserId, action: "USER_CREATED" } });
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ phone: canonicalPhone });
    expect(audit.afterJson).not.toContain(password);
  });

  test("rejects an equivalent duplicate phone and permits clearing it on update", async () => {
    const duplicate = await request(app)
      .post("/api/v1/users")
      .set("Authorization", auth())
      .send({ name: "Duplicate Rider", username: `duplicate-rider-${suffix}`, email: `duplicate-rider-${suffix}@example.com`, phone: canonicalPhone, password, role: "RIDER", hubId });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USER_EXISTS");

    const targetId = createdIds.at(-1)!;
    const changed = await request(app).patch(`/api/v1/users/${targetId}`).set("Authorization", auth()).send({ phone: secondPhone });
    expect(changed.status).toBe(200);
    expect(changed.body.data.phone).toBe(normalizeMyanmarPhone(secondPhone));
    const cleared = await request(app).patch(`/api/v1/users/${targetId}`).set("Authorization", auth()).send({ phone: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.phone).toBeNull();
  });

  test("keeps malformed and unknown phone credential failures generic", async () => {
    for (const identifier of ["09(123456789)", "09999999999"]) {
      const response = await request(app).post("/api/v1/auth/login").send({ identifier, password: "WrongPassword123" });
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({ code: "AUTH_INVALID", message: "Invalid credentials" });
    }
  });
});
