import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { MAX_MANIFEST_ROWS, parseDeliveryManifestItems, parseDeliveryManifestText } from "../utils/manifest-text-parser.js";
import { extractPdfTextItems, itemsHaveReadableText } from "../utils/pdf-text.js";

export { parseDeliveryManifestText } from "../utils/manifest-text-parser.js";

export const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
export const MAX_MANIFEST_PAGES = 50;
const ACTOR_WINDOW_MS = 60_000;
const ACTOR_MAX_ATTEMPTS = 5;
type Actor = { id: string; role: string };

let activeExtractions = 0;
const actorAttempts = new Map<string, number[]>();
const MAX_CONCURRENT_EXTRACTIONS = 2;

function acquireExtraction(actorId: string) {
  const now = Date.now();
  const recent = (actorAttempts.get(actorId) ?? []).filter((value) => now - value < ACTOR_WINDOW_MS);
  if (recent.length >= ACTOR_MAX_ATTEMPTS) throw new ApiError(429, "PDF_RATE_LIMITED", "Too many PDF previews; retry shortly");
  if (activeExtractions >= MAX_CONCURRENT_EXTRACTIONS) throw new ApiError(503, "PDF_EXTRACTOR_BUSY", "PDF preview capacity is temporarily busy");
  recent.push(now);
  actorAttempts.set(actorId, recent);
  activeExtractions += 1;
  return () => {
    activeExtractions = Math.max(0, activeExtractions - 1);
  };
}

export async function previewManifestPdf(batchId: string, pdf: Buffer, actor: Actor) {
  if (!pdf.length || pdf.length > MAX_MANIFEST_BYTES) throw new ApiError(413, "PDF_TOO_LARGE", "PDF must be 10 MB or smaller");
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ApiError(400, "INVALID_PDF", "The uploaded file is not a valid PDF");
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", "You may not import parcel manifests");
  }
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { hubId: true } });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (user.role !== "SUPERADMIN" && user.hubId !== batch.hubId) throw new ApiError(403, "FORBIDDEN", "Batch is outside your hub scope");

  const release = acquireExtraction(actor.id);
  let work: string | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), "lotaya-manifest-"));
    await writeFile(join(work, `${randomUUID()}.pdf`), pdf, { flag: "wx", mode: 0o600 });
    let extracted;
    try {
      extracted = await extractPdfTextItems(pdf, MAX_MANIFEST_PAGES);
    } catch {
      throw new ApiError(422, "INVALID_PDF", "The PDF is corrupt, encrypted, or cannot be read");
    }
    if (extracted.pageLimitExceeded) throw new ApiError(400, "PDF_PAGE_LIMIT", `PDF may contain at most ${MAX_MANIFEST_PAGES} pages`);
    if (!itemsHaveReadableText(extracted.items)) {
      throw new ApiError(422, "OCR_REQUIRED", "This appears to be a scanned PDF. OCR is required; no customer data was transmitted or guessed.");
    }
    const parsed = parseDeliveryManifestItems(extracted.items);
    if (!parsed.length) throw new ApiError(422, "MANIFEST_FORMAT_UNRECOGNIZED", "No manifest rows could be recognized. Review the PDF columns or use the editable paste grid.");
    const rows = parsed.map((row) => ({
      ...row,
      orderId: row.reference,
      customerPhone: row.phone ?? "",
      townshipId: "",
      districtId: "",
      regionStateId: "",
      zoneId: "",
      confidence: 0.55,
      warnings: [...(!row.phone ? ["PHONE_MISSING"] : []), "TOWNSHIP_NOT_MATCHED"],
    }));
    return { rows, pageCount: extracted.pageCount, truncated: parsed.length >= MAX_MANIFEST_ROWS, extraction: "LOCAL_TEXT" as const, saved: false };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    release();
  }
}
