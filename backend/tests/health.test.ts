import request from "supertest"; import { app } from "../src/app.js";
test("returns a localized health response", async () => { const response = await request(app).get("/api/v1/health").set("accept-language","my"); expect(response.status).toBe(200); expect(response.body.success).toBe(true); expect(response.body.data.message).toContain("ဝန်ဆောင်မှု"); });
