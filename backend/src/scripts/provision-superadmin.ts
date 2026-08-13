import bcrypt from "bcryptjs";
import { prisma } from "../config/database.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

async function main() {
  const name = required("SUPERADMIN_NAME");
  const email = required("SUPERADMIN_EMAIL").toLowerCase();
  const username = required("SUPERADMIN_USERNAME").toLowerCase();
  const password = required("SUPERADMIN_PASSWORD");
  if (password.length < 12) throw new Error("SUPERADMIN_PASSWORD must contain at least 12 characters");
  if (await prisma.user.count() !== 0) throw new Error("Provisioning is allowed only when the user table is empty");
  const user = await prisma.user.create({ data: { name, username, email, passwordHash: await bcrypt.hash(password, 12), role: "SUPERADMIN" }, select: { id: true, email: true, role: true } });
  process.stdout.write(`Provisioned ${user.role} ${user.email} (${user.id})\n`);
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed"}\n`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
