import { app } from "./app.js"; import { env } from "./config/env.js"; import { prisma } from "./config/database.js";
const server = app.listen(env.port, env.listenHost, () => console.log(`Lotaya API listening on ${env.listenHost}:${env.port}`)); const shutdown = async () => { server.close(); await prisma.$disconnect(); }; process.on("SIGTERM",shutdown); process.on("SIGINT",shutdown);
