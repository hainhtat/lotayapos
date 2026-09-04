import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { gracefulShutdown } from "./utils/graceful-shutdown.js";

const server = app.listen(env.port, env.listenHost, () => console.log(`Lotaya API listening on ${env.listenHost}:${env.port}`));
let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: string) {
  if (shutdownPromise) return shutdownPromise;
  console.log(`Received ${signal}; draining HTTP requests`);
  shutdownPromise = gracefulShutdown(server, () => prisma.$disconnect())
    .catch((error) => {
      console.error("Graceful shutdown failed", error);
      process.exitCode = 1;
    });
  return shutdownPromise;
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
