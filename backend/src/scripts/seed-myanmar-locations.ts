import { readFileSync } from "node:fs";
import { prisma } from "../config/database.js";

type GeographyRow = {
  regionCode: string;
  regionNameEn: string;
  regionNameMm: string;
  districtCode: string;
  districtNameEn: string;
  districtNameMm: string;
  townshipCode: string;
  townshipNameEn: string;
  townshipNameMm: string;
};

const dataPath = new URL("../../data/myanmar-geography.json", import.meta.url);

async function main() {
  const rows = JSON.parse(readFileSync(dataPath, "utf8")) as GeographyRow[];
  const townships = new Map<string, GeographyRow>();
  for (const row of rows) townships.set(row.townshipCode, row);

  let regionCount = 0;
  let districtCount = 0;

  await prisma.$transaction(async (tx) => {
    const regionIds = new Set<string>();
    const districtIds = new Set<string>();

    for (const row of townships.values()) {
      const region = await tx.regionState.upsert({
        where: { code: row.regionCode },
        update: { nameEn: row.regionNameEn, nameMy: row.regionNameMm },
        create: { code: row.regionCode, nameEn: row.regionNameEn, nameMy: row.regionNameMm },
      });
      if (!regionIds.has(region.id)) {
        regionIds.add(region.id);
        regionCount += 1;
      }

      const district = await tx.district.upsert({
        where: { code: row.districtCode },
        update: { regionStateId: region.id, nameEn: row.districtNameEn, nameMy: row.districtNameMm },
        create: { code: row.districtCode, regionStateId: region.id, nameEn: row.districtNameEn, nameMy: row.districtNameMm },
      });
      if (!districtIds.has(district.id)) {
        districtIds.add(district.id);
        districtCount += 1;
      }

      await tx.township.upsert({
        where: { code: row.townshipCode },
        update: { districtId: district.id, nameEn: row.townshipNameEn, nameMy: row.townshipNameMm },
        create: {
          code: row.townshipCode,
          districtId: district.id,
          nameEn: row.townshipNameEn,
          nameMy: row.townshipNameMm,
          deliveryFee: 3000,
        },
      });
    }
  });

  process.stdout.write(`Seeded ${regionCount} regions/states, ${districtCount} districts, and ${townships.size} townships.\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Location seed failed"}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
