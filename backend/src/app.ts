import express from "express"; import { corsMiddleware,requestContext } from "./middleware/core.js"; import { csrfOriginGuard } from "./middleware/csrf-origin.js"; import { securityHeaders } from "./middleware/security-headers.js"; import { errorHandler,notFound } from "./middleware/error.js"; import { v1Router } from "./routes/v1/index.js"; import { env } from "./config/env.js";
export const app = express();
if (env.nodeEnv === "production") app.set("trust proxy", 1);
app.use(requestContext); app.use(securityHeaders); app.use(corsMiddleware); app.use(express.json({limit:"512kb"})); app.use("/api/v1",csrfOriginGuard,v1Router); app.use(notFound); app.use(errorHandler);
