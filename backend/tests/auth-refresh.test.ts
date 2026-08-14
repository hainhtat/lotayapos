import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { hashRefreshToken } from "../src/utils/refresh-token.js";

describe("auth refresh rotation", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = "RefreshPass123";
  const createdIds: string[] = [];
  let adminId = "";

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Refresh Admin",
        username: `refresh-admin-${suffix}`,
        email: `refresh-admin-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "SUPERADMIN",
      },
    });
    adminId = admin.id;
    createdIds.push(admin.id);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.userAdminAudit.deleteMany({ where: { OR: [{ actorId: { in: createdIds } }, { targetUserId: { in: createdIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  const setCookies = (response: request.Response) => {
    const header = response.headers["set-cookie"];
    return Array.isArray(header) ? header : header ? [header] : [];
  };

  const cookieLine = (cookies: string[], name: string) => {
    const line = cookies.find((value) => value.startsWith(`${name}=`));
    expect(line).toBeDefined();
    return line!;
  };

  const cookieValue = (line: string, name: string) => decodeURIComponent(line.split(";")[0].slice(name.length + 1));

  const cookieAttr = (line: string, name: string) =>
    line.split(";").map((part) => part.trim()).find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`));

  async function loginUser(input: { identifier: string; remember?: boolean | string }) {
    return request(app).post("/api/v1/auth/login").send({ identifier: input.identifier, password, remember: input.remember });
  }

  test("login sets refreshToken httpOnly cookie Path=/api/v1/auth and JSON refreshToken", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Refresh User",
        username: `refresh-user-${suffix}`,
        email: `refresh-user-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(user.id);

    const response = await loginUser({ identifier: user.email });
    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken.length).toBeGreaterThanOrEqual(16);

    const cookies = setCookies(response);
    const access = cookieLine(cookies, "accessToken");
    const refresh = cookieLine(cookies, "refreshToken");
    expect(access.toLowerCase()).toContain("httponly");
    expect(refresh.toLowerCase()).toContain("httponly");
    expect(cookieAttr(access, "Path")).toBe("Path=/");
    expect(cookieAttr(refresh, "Path")).toBe("Path=/api/v1/auth");
    expect(cookieValue(refresh, "refreshToken")).toBe(response.body.data.refreshToken);
  });

  test("cookie refresh rotates and reuse of the old token revokes the family", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Rotate Cookie",
        username: `rotate-cookie-${suffix}`,
        email: `rotate-cookie-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(user.id);

    const loggedIn = await loginUser({ identifier: user.email });
    expect(loggedIn.status).toBe(200);
    const original = loggedIn.body.data.refreshToken as string;
    const cookies = setCookies(loggedIn);
    const refreshCookie = cookieLine(cookies, "refreshToken");

    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `${refreshCookie.split(";")[0]}`);
    expect(rotated.status).toBe(200);
    const next = rotated.body.data.refreshToken as string;
    expect(next).not.toBe(original);
    const rotatedCookies = setCookies(rotated);
    expect(cookieValue(cookieLine(rotatedCookies, "refreshToken"), "refreshToken")).toBe(next);

    const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("AUTH_REQUIRED");

    const family = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: next });
    expect(family.status).toBe(401);
    const remaining = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(remaining).toBe(0);
  });

  test("JSON body refreshToken rotates for mobile dual delivery", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Rotate Body",
        username: `rotate-body-${suffix}`,
        email: `rotate-body-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(user.id);

    const loggedIn = await loginUser({ identifier: user.email });
    expect(loggedIn.status).toBe(200);
    const original = loggedIn.body.data.refreshToken as string;

    const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).toEqual(expect.any(String));
    expect(rotated.body.data.refreshToken).not.toBe(original);
    expect(cookieValue(cookieLine(setCookies(rotated), "refreshToken"), "refreshToken")).toBe(rotated.body.data.refreshToken);
  });

  test("logout revokes by hash lookup and does not issue a new refresh token", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Logout User",
        username: `logout-user-${suffix}`,
        email: `logout-user-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(user.id);

    const loggedIn = await loginUser({ identifier: user.email });
    expect(loggedIn.status).toBe(200);
    const original = loggedIn.body.data.refreshToken as string;
    const before = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(before).toHaveLength(1);
    expect(before[0].tokenHash).toBe(hashRefreshToken(original));
    expect(before[0].revokedAt).toBeNull();

    const loggedOut = await request(app).post("/api/v1/auth/logout").send({ refreshToken: original });
    expect(loggedOut.status).toBe(204);

    const after = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].revokedAt).not.toBeNull();
    expect(after[0].replacedById).toBeNull();

    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(refresh.status).toBe(401);
  });

  test("password reset revokes refresh tokens", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Reset User",
        username: `reset-user-${suffix}`,
        email: `reset-user-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "AUDITOR",
      },
    });
    createdIds.push(user.id);

    const loggedIn = await loginUser({ identifier: user.email });
    expect(loggedIn.status).toBe(200);
    const refreshToken = loggedIn.body.data.refreshToken as string;
    const adminLogin = await loginUser({ identifier: `refresh-admin-${suffix}@example.com` });
    expect(adminLogin.status).toBe(200);

    const reset = await request(app)
      .post(`/api/v1/users/${user.id}/password-reset`)
      .set("Authorization", `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ password: "NewRefreshPass456" });
    expect(reset.status).toBe(200);

    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(refresh.status).toBe(401);
    const remaining = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(remaining).toBe(0);
  });

  test("accepts JSON boolean and string remember values", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Remember User",
        username: `remember-user-${suffix}`,
        email: `remember-user-${suffix}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
    createdIds.push(user.id);

    const asString = await loginUser({ identifier: user.email, remember: "true" });
    expect(asString.status).toBe(200);
    const stringToken = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(asString.body.data.refreshToken) } });
    expect(stringToken.remember).toBe(true);

    const asFalse = await loginUser({ identifier: user.email, remember: "false" });
    expect(asFalse.status).toBe(200);
    const falseToken = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(asFalse.body.data.refreshToken) } });
    expect(falseToken.remember).toBe(false);

    const omitted = await loginUser({ identifier: user.email });
    expect(omitted.status).toBe(200);
    const omittedToken = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(omitted.body.data.refreshToken) } });
    expect(omittedToken.remember).toBe(false);
  });
});
