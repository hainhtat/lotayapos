import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { MAX_MANIFEST_ROWS, parseDeliveryManifestText } from "../utils/manifest-text-parser.js";

export { parseDeliveryManifestText } from "../utils/manifest-text-parser.js";

export const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
export const MAX_MANIFEST_PAGES = 50;
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const EXTRACT_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_EXTRACTIONS = 2;
const ACTOR_WINDOW_MS = 60_000;
const ACTOR_MAX_ATTEMPTS = 5;
type Actor = { id: string; role: string };

let activeExtractions = 0;
const actorAttempts = new Map<string, number[]>();

const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase().replace(/[.,()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
type RunFailure = Error & { kind?: "missing" | "invalid" | "timeout" | "limit" };
function run(command: string, args: string[], stdoutLimit = MAX_EXTRACTED_BYTES) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes=0; let stderrBytes=0; let settled=false;
    const finish=(error?:RunFailure,value?:string)=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(killTimer);error?reject(error):resolve(value??"");};
    const terminate=(kind:RunFailure["kind"],message:string)=>{const error=Object.assign(new Error(message),{kind});child.kill("SIGTERM");killTimer=setTimeout(()=>child.kill("SIGKILL"),500);finish(error);};
    let killTimer: NodeJS.Timeout;
    const timeout=setTimeout(()=>terminate("timeout","PDF extraction timed out"),EXTRACT_TIMEOUT_MS);
    child.stdout.on("data", (chunk:Buffer) => { stdoutBytes+=chunk.length; if(stdoutBytes>stdoutLimit)return terminate("limit","PDF extraction output exceeded limit"); stdout.push(Buffer.from(chunk)); });
    child.stderr.on("data", (chunk:Buffer) => { if(stderrBytes<MAX_DIAGNOSTIC_BYTES){const remaining=MAX_DIAGNOSTIC_BYTES-stderrBytes;stderr.push(Buffer.from(chunk).subarray(0,remaining));stderrBytes+=Math.min(chunk.length,remaining);} });
    child.once("error", (error:NodeJS.ErrnoException) => { const failure=error as RunFailure; if(error.code==="ENOENT")failure.kind="missing"; finish(failure); });
    child.once("close", (code) => code === 0 ? finish(undefined,Buffer.concat(stdout).toString("utf8")) : finish(Object.assign(new Error(Buffer.concat(stderr).toString("utf8") || `PDF extractor exited ${code}`),{kind:"invalid" as const})));
  });
}

function extractor(name: "pdftotext" | "pdfinfo") {
  return name === "pdfinfo" ? process.env.PDFINFO_PATH || name : process.env.PDF_TO_TEXT_PATH || name;
}

function acquireExtraction(actorId:string){
  const now=Date.now(); const recent=(actorAttempts.get(actorId)??[]).filter(value=>now-value<ACTOR_WINDOW_MS);
  if(recent.length>=ACTOR_MAX_ATTEMPTS) throw new ApiError(429,"PDF_RATE_LIMITED","Too many PDF previews; retry shortly");
  if(activeExtractions>=MAX_CONCURRENT_EXTRACTIONS) throw new ApiError(503,"PDF_EXTRACTOR_BUSY","PDF preview capacity is temporarily busy");
  recent.push(now);actorAttempts.set(actorId,recent);activeExtractions++; return ()=>{activeExtractions=Math.max(0,activeExtractions-1);};
}

export async function previewManifestPdf(batchId: string, pdf: Buffer, actor: Actor) {
  if (!pdf.length || pdf.length > MAX_MANIFEST_BYTES) throw new ApiError(413, "PDF_TOO_LARGE", "PDF must be 10 MB or smaller");
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ApiError(400, "INVALID_PDF", "The uploaded file is not a valid PDF");
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not import parcel manifests");
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { hubId: true } });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (user.role !== "SUPERADMIN" && user.hubId !== batch.hubId) throw new ApiError(403, "FORBIDDEN", "Batch is outside your hub scope");

  const release=acquireExtraction(actor.id);
  let work: string | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), "lotaya-manifest-"));
    const input = join(work, `${randomUUID()}.pdf`);
    await writeFile(input, pdf, { flag: "wx", mode: 0o600 });
    let info = ""; let text = "";
    try {
      info = await run(extractor("pdfinfo"), [input],64*1024);
      const match = info.match(/^Pages:\s+(\d+)/m);
      if (match && Number(match[1]) > MAX_MANIFEST_PAGES) throw new ApiError(400, "PDF_PAGE_LIMIT", `PDF may contain at most ${MAX_MANIFEST_PAGES} pages`);
      text = await run(extractor("pdftotext"), ["-layout", "-enc", "UTF-8", input, "-"]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const kind=(error as RunFailure).kind;
      if(kind==="missing") throw new ApiError(503,"PDF_EXTRACTION_UNAVAILABLE","PDF extraction tools are unavailable; configure PDFINFO_PATH and PDF_TO_TEXT_PATH or install Poppler on PATH");
      if(kind==="timeout"||kind==="limit") throw new ApiError(422,kind==="timeout"?"PDF_EXTRACTION_TIMEOUT":"PDF_TEXT_TOO_LARGE",kind==="timeout"?"PDF extraction timed out":"Extracted PDF text is too large");
      throw new ApiError(422,"INVALID_PDF","The PDF is corrupt, encrypted, or cannot be read");
    }
    const pages = text.split("\f").filter((page) => page.trim());
    if (pages.length > MAX_MANIFEST_PAGES) throw new ApiError(400, "PDF_PAGE_LIMIT", `PDF may contain at most ${MAX_MANIFEST_PAGES} pages`);
    if (!normalize(text).replace(/[\d\s]/g, "")) throw new ApiError(422, "OCR_REQUIRED", "This appears to be a scanned PDF. OCR is required; no customer data was transmitted or guessed.");
    const parsed = parseDeliveryManifestText(pages);
    if (!parsed.length) throw new ApiError(422, "MANIFEST_FORMAT_UNRECOGNIZED", "No manifest rows could be recognized. Review the PDF columns or use the editable paste grid.");
    const townships = await prisma.township.findMany({ include: { district: { include: { regionState: true } } } });
    const rows = parsed.map((row) => {
      const haystack = ` ${normalize(row.address)} `;
      const candidates = townships.filter((township) => [township.nameEn, township.nameMy].filter(Boolean).some((name) => haystack.includes(` ${normalize(name!)} `)));
      const township = candidates.length === 1 ? candidates[0] : null;
      const warnings = [
        ...(!row.phone ? ["PHONE_MISSING"] : []),
        ...(!township ? [candidates.length > 1 ? "TOWNSHIP_AMBIGUOUS" : "TOWNSHIP_NOT_MATCHED"] : []),
      ];
      return { ...row, orderId: row.reference, customerPhone: row.phone ?? "", townshipId: township?.id ?? "", districtId: township?.districtId ?? "", regionStateId: township?.district.regionStateId ?? "", zoneId: "", confidence: township ? (warnings.length ? 0.86 : 0.96) : 0.55, warnings };
    });
    return { rows, pageCount: pages.length, truncated: parsed.length >= MAX_MANIFEST_ROWS, extraction: "LOCAL_TEXT" as const, saved: false };
  } finally {
    if(work) await rm(work, { recursive: true, force: true });
    release();
  }
}
