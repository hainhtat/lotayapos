import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { Font as FontkitFont } from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, RGB, StandardFonts, rgb } from "pdf-lib";

export type ManifestParcel = {
  id?: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string;
  codAmount: number;
  deliveryFee?: number | null;
  paidToOsFeeIncluded?: boolean;
  zone: string | null;
  township: string | null;
  batchLabel?: string;
  shopName?: string;
  /** Parcel status enum (e.g. ASSIGNED) — rendered as a short Status label */
  status?: string;
  /** Return/exception reason and note, never a status code */
  note?: string | null;
};

export type ManifestSection = {
  riderName: string;
  hubName?: string;
  parcels: ManifestParcel[];
};

export type ManifestInput = {
  sections?: ManifestSection[];
  /** @deprecated Prefer sections for multi-rider manifests */
  riderName?: string;
  /** @deprecated Prefer sections for multi-rider manifests */
  batchLabels?: string[];
  /** @deprecated Prefer sections for multi-rider manifests */
  parcels?: ManifestParcel[];
  generatedAt?: Date;
  statusesLabel?: string;
  documentTitle?: string;
  noteLabel?: string;
  documentSubtitle?: string;
  footerLabel?: string;
};

function isOsHandoverDocument(title?: string) {
  return title === "Return to OS Handover" || title === "Paid to OS Handover" || title === "OS Handover Report";
}

function handoverBrandLabel(title?: string) {
  if (title === "Return to OS Handover") return "Return Handover";
  if (title === "Paid to OS Handover") return "Paid to OS Handover";
  if (title === "OS Handover Report") return "OS Handover Report";
  return "Active Rider Sheet";
}

/** Active rider sheets retain A4 portrait; OS handovers use A4 landscape. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const RETURN_PAGE_WIDTH = 841.89;
const RETURN_PAGE_HEIGHT = 595.28;
const MARGIN_X = 18;
const MARGIN_BOTTOM = 28;

const BRAND = {
  blue: rgb(0.082, 0.596, 0.937),
  accent: rgb(0.027, 0.529, 0.875),
  navy: rgb(0.063, 0.075, 0.094),
  slate: rgb(0.2, 0.255, 0.333),
  soft: rgb(0.918, 0.965, 1),
  softGray: rgb(0.945, 0.961, 0.976),
  line: rgb(0.796, 0.835, 0.882),
  zebra: rgb(0.973, 0.98, 0.988),
  white: rgb(1, 1, 1),
  muted: rgb(0.392, 0.455, 0.545),
  green: rgb(0.071, 0.651, 0.416),
};

/** Landscape widths give return handovers space to wrap customer/address/reason. */
const RETURN_COL_DEFS = [
  ["#", 18], ["Order", 50], ["Batch", 56], ["Merchant", 62], ["Customer", 80],
  ["Phone", 56], ["Township", 65], ["Address", 128], ["COD", 47], ["Fee", 42],
  ["Total", 48], ["Status", 44], ["Note", 105],
] as const;
const PORTRAIT_COL_DEFS = [
  ["#", 14], ["Order", 38], ["Batch", 42], ["Merchant", 42], ["Customer", 55],
  ["Phone", 45], ["Township", 48], ["Address", 70], ["COD", 35], ["Fee", 30],
  ["Total", 34], ["Status", 38], ["Note", 48],
] as const;

function columns(defs: ReadonlyArray<readonly [string, number]>) {
  return defs.reduce<Array<{key:string;x:number;w:number}>>((cols,[key,w])=>{
    const x=cols.length?cols[cols.length-1]!.x+cols[cols.length-1]!.w:MARGIN_X;
    cols.push({key,x,w});
    return cols;
  },[]);
}
const RETURN_COLS = columns(RETURN_COL_DEFS);
const PORTRAIT_COLS = columns(PORTRAIT_COL_DEFS);

const MYANMAR_RE = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/;

const STATUS_SHORT: Record<string, string> = {
  CREATED: "CRT",
  PICKED_UP: "PKU",
  ASSIGNED: "ASN",
  OUT_FOR_DELIVERY: "OFD",
  DELIVERED: "DLV",
  PARTIAL: "PRT",
  FAILED: "FLD",
  REJECTED: "REJ",
  PENDING_RETURN: "PRN",
  RETURNED: "RTN",
};

function fallbackGraphemes(value: string) {
  const parts: string[] = [];
  for (const char of value) {
    const prior = parts.at(-1);
    if ((/\p{Mark}/u.test(char) || prior?.endsWith("\u200D")) && parts.length) parts[parts.length - 1] += char;
    else if (/[\u200C\u200D]/.test(char) && parts.length) parts[parts.length - 1] += char;
    else if (/\p{Regional_Indicator}/u.test(char) && prior && /^\p{Regional_Indicator}$/u.test(prior)) parts[parts.length - 1] += char;
    else parts.push(char);
  }
  return parts;
}

function graphemes(value: string) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("my", { granularity: "grapheme" }).segment(value)].map((part) => part.segment);
  }
  return fallbackGraphemes(value);
}

export function fitManifestText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  const parts = graphemes(normalized);
  return parts.length > maxLength ? `${parts.slice(0, Math.max(1, maxLength - 3)).join("")}...` : normalized;
}

function wrapManifestText(value: string, maxChars: number, maxLines = 4) {
  const normalized=value.replace(/\s+/g," ").trim();
  if(!normalized)return ["-"];
  const words=normalized.split(" ");
  const lines:string[]=[];
  let line="";
  for(const word of words){
    const parts=graphemes(word);
    while(parts.length>maxChars){
      const head=parts.splice(0,maxChars).join("");
      if(line){lines.push(line);line="";}
      lines.push(head);
    }
    const remaining=parts.join("");
    if(line&&graphemes(`${line} ${remaining}`).length>maxChars){lines.push(line);line=remaining;}
    else line=line?`${line} ${remaining}`:remaining;
  }
  if(line)lines.push(line);
  if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=fitManifestText(lines[maxLines-1]!,Math.max(1,maxChars-3));}
  return lines;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} ks`;
}

function statusLabel(status?: string) {
  if (!status) return "-";
  return STATUS_SHORT[status] ?? status.slice(0, 3).toUpperCase();
}

function totalsFor(parcels: ManifestParcel[], returnHandover = false) {
  const totalCod = parcels.reduce((sum, parcel) => sum + parcel.codAmount, 0);
  const totalFees = parcels.reduce((sum, parcel) => sum + (returnHandover ? (parcel.paidToOsFeeIncluded ? parcel.deliveryFee ?? 0 : 0) : parcel.deliveryFee ?? 0), 0);
  return { totalCod, totalFees, totalAmount: totalCod + totalFees, count: parcels.length };
}

function normalizeSections(input: ManifestInput): ManifestSection[] {
  if (input.sections?.length) return input.sections;
  return [{ riderName: input.riderName ?? "Unassigned", parcels: input.parcels ?? [] }];
}

function formatYangonStamp(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} (Yangon)`;
}

function loadMyanmarFontBytes() {
  if (!loadMyanmarFontBytes.cache) {
    loadMyanmarFontBytes.cache = readFileSync(join(process.cwd(), "assets/fonts/NotoSansMyanmar-Regular.ttf"));
  }
  return loadMyanmarFontBytes.cache;
}
loadMyanmarFontBytes.cache = null as Buffer | null;

type FontPair = { regular: PDFFont; bold: PDFFont; myanmar: PDFFont; myanmarKit: FontkitFont };

/**
 * pdf-lib drawSvgPath applies scale(s, -s) assuming SVG y-down.
 * Fontkit paths are font y-up — negate Y so glyphs sit upright on the baseline.
 */
function flipFontkitSvgPathY(path: string): string {
  return path.replace(/([MLQC])([^MLQCZ]+)/gi, (_full, cmd: string, args: string) => {
    const nums = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const step = cmd.toUpperCase() === "C" ? 6 : cmd.toUpperCase() === "Q" ? 4 : 2;
    const out: number[] = [];
    for (let i = 0; i < nums.length; i += step) {
      for (let j = 0; j < step; j += 1) {
        const n = nums[i + j] ?? 0;
        out.push(j % 2 === 1 ? -n : n);
      }
    }
    return `${cmd}${out.join(" ")}`;
  });
}

function drawShapedMyanmar(
  page: ReturnType<PDFDocument["addPage"]>,
  font: FontkitFont,
  text: string,
  x: number,
  y: number,
  size: number,
  color: RGB,
  glyphPathCache: Map<number, string>,
) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let cursorX = x;
  let cursorY = y;
  for (let i = 0; i < run.glyphs.length; i += 1) {
    const glyph = run.glyphs[i]!;
    const pos = run.positions[i]!;
    let flipped = glyphPathCache.get(glyph.id);
    if (flipped === undefined) {
      const raw = glyph.path?.toSVG?.() ?? "";
      flipped = raw ? flipFontkitSvgPathY(raw) : "";
      glyphPathCache.set(glyph.id, flipped);
    }
    if (flipped) {
      page.drawSvgPath(flipped, {
        x: cursorX + pos.xOffset * scale,
        y: cursorY + pos.yOffset * scale,
        scale,
        color,
      });
    }
    cursorX += pos.xAdvance * scale;
    cursorY += pos.yAdvance * scale;
  }
  return cursorX - x;
}

function isMyanmarCharacter(char: string) {
  return /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/.test(char);
}

function scriptRuns(text: string) {
  const runs: Array<{ text: string; myanmar: boolean }> = [];
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    const myanmar = isMyanmarCharacter(char)
      || (/^[\u200C\u200D]$/.test(char) && (runs.at(-1)?.myanmar === true || isMyanmarCharacter(chars[index + 1] ?? "")));
    const prior = runs.at(-1);
    if (prior?.myanmar === myanmar) prior.text += char;
    else runs.push({ text: char, myanmar });
  }
  return runs;
}

type PageContext = {
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  fonts: FontPair;
  y: number;
  pageIndex: number;
  continued: boolean;
  glyphPathCache: Map<number, string>;
  pageWidth: number;
  pageHeight: number;
  cols: Array<{key:string;x:number;w:number}>;
  tableRight: number;
  marginBottom: number;
  returnHandover: boolean;
};

function drawRect(ctx: PageContext, x: number, y: number, w: number, h: number, fill: RGB, stroke?: RGB) {
  ctx.page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: stroke, borderWidth: stroke ? 0.5 : 0 });
}

function drawText(
  ctx: PageContext,
  text: string,
  x: number,
  y: number,
  size: number,
  bold = false,
  color = BRAND.navy,
) {
  if (!text) return;
  if (MYANMAR_RE.test(text)) {
    let cursorX = x;
    for (const run of scriptRuns(text)) {
      if (run.myanmar) {
        const width = drawShapedMyanmar(ctx.page, ctx.fonts.myanmarKit, run.text, cursorX, y, size, color, ctx.glyphPathCache);
        ctx.page.drawText(run.text, { x: cursorX, y, size, font: ctx.fonts.myanmar, opacity: 0 });
        cursorX += width;
      } else {
        const font = bold ? ctx.fonts.bold : ctx.fonts.regular;
        ctx.page.drawText(run.text, { x: cursorX, y, size, font, color });
        cursorX += font.widthOfTextAtSize(run.text, size);
      }
    }
    return;
  }
  ctx.page.drawText(text, {
    x,
    y,
    size,
    font: bold ? ctx.fonts.bold : ctx.fonts.regular,
    color,
  });
}

function drawFooter(ctx: PageContext, footerLabel = "Lotaya Delivery - Active rider sheet") {
  drawText(ctx, footerLabel, MARGIN_X, 12, 7, false, BRAND.muted);
  drawText(ctx, `Page ${ctx.pageIndex + 1}`, ctx.pageWidth - 48, 12, 7, false, BRAND.muted);
}

function drawBrandBar(ctx: PageContext, label = "Active Rider Sheet") {
  drawRect(ctx, 0, ctx.pageHeight - 22, ctx.pageWidth, 22, BRAND.blue);
  drawText(ctx, "LOTAYA", MARGIN_X, ctx.pageHeight - 15, 10, true, BRAND.white);
  drawText(ctx, label, MARGIN_X + 58, ctx.pageHeight - 14, 8, false, BRAND.white);
}

function drawRiderSheetHeader(
  ctx: PageContext,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
  documentTitle = "All Active Deliveries",
  documentSubtitle = "All remaining assigned orders combined",
) {
  drawBrandBar(ctx, handoverBrandLabel(documentTitle));
  ctx.y = ctx.pageHeight - 40;
  const riderTitle = documentTitle === "All Active Deliveries";
  const title = ctx.continued
    ? `${documentTitle} - ${riderTitle ? "Rider: " : ""}${fitManifestText(section.riderName, 42)} (continued)`
    : `${documentTitle} - ${riderTitle ? "Rider: " : ""}${fitManifestText(section.riderName, 48)}`;
  drawText(ctx, title, MARGIN_X, ctx.y, 12, true, BRAND.navy);
  ctx.y -= 14;
  drawText(ctx, `Generated: ${formatYangonStamp(generatedAt)}  |  ${documentSubtitle}`, MARGIN_X, ctx.y, 7, false, BRAND.muted);
  ctx.y -= 11;
  drawText(ctx, `Selected statuses: ${statusesLabel}`, MARGIN_X, ctx.y, 7, false, BRAND.slate);
  ctx.y -= 11;
  drawText(ctx, `${isOsHandoverDocument(documentTitle) ? "Handover" : "Selected riders"}: ${fitManifestText(selectedRidersLabel, 90)}`, MARGIN_X, ctx.y, 7, false, BRAND.slate);
  if (section.hubName) {
    ctx.y -= 11;
    drawText(ctx, `Hub: ${fitManifestText(section.hubName, 40)}`, MARGIN_X, ctx.y, 7, false, BRAND.muted);
  }
  ctx.y -= 16;

  const cardW = (ctx.pageWidth - MARGIN_X * 2 - 18) / 4;
  const cards = [
    { label: "Orders", value: String(totals.count), color: BRAND.blue },
    { label: "COD", value: money(totals.totalCod), color: BRAND.navy },
    { label: "Fees", value: money(totals.totalFees), color: BRAND.green },
    { label: "Total", value: money(totals.totalAmount), color: BRAND.accent },
  ];
  cards.forEach((card, index) => {
    const x = MARGIN_X + index * (cardW + 6);
    drawRect(ctx, x, ctx.y - 34, cardW, 38, BRAND.soft, BRAND.line);
    drawRect(ctx, x, ctx.y - 34, 3, 38, card.color);
    drawText(ctx, card.label, x + 10, ctx.y - 10, 7, false, BRAND.muted);
    drawText(ctx, fitManifestText(card.value, 16), x + 10, ctx.y - 26, 9, true, BRAND.navy);
  });
  ctx.y -= 48;
}

function drawTableHeader(ctx: PageContext, noteLabel?: string) {
  const h = 18;
  drawRect(ctx, MARGIN_X, ctx.y - h, ctx.tableRight - MARGIN_X, h, BRAND.softGray, BRAND.line);
  ctx.cols.forEach((col) => drawText(ctx, col.key === "Note" && noteLabel ? noteLabel : col.key, col.x + 2, ctx.y - 12, 6, true, BRAND.slate));
  ctx.y -= h + 2;
}

function startRiderPage(
  ctx: PageContext,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
  documentTitle?: string,
  noteLabel?: string,
  documentSubtitle?: string,
) {
  drawRiderSheetHeader(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel, documentTitle, documentSubtitle);
  drawTableHeader(ctx, noteLabel);
}

function drawParcelRow(ctx: PageContext, parcel: ManifestParcel, index: number, returnHandover = false) {
  const fee = parcel.deliveryFee ?? 0;
  const includedFee = returnHandover && !parcel.paidToOsFeeIncluded ? 0 : fee;
  const total = parcel.codAmount + includedFee;
  const orderLabel = parcel.orderId?.trim() || parcel.trackingNumber;
  const address = parcel.address.replace(/\s+/g, " ").trim();
  const shopLines=wrapManifestText(parcel.shopName??"-",ctx.returnHandover?18:10,3);
  const customerLines=wrapManifestText(parcel.customerName,ctx.returnHandover?22:11,4);
  const addressLines=wrapManifestText(address,ctx.returnHandover?38:14,4);
  const noteLines=wrapManifestText(parcel.note?.trim()||"",ctx.returnHandover?32:11,4);
  const rowLines=Math.max(shopLines.length,customerLines.length,addressLines.length,noteLines.length,parcel.orderId?.trim()?2:1);
  const rowH=Math.max(18,rowLines*8+6);
  if (ctx.y - rowH < ctx.marginBottom) return false;
  if (index % 2 === 1) drawRect(ctx, MARGIN_X, ctx.y - rowH, ctx.tableRight - MARGIN_X, rowH, BRAND.zebra);
  ctx.page.drawRectangle({x:MARGIN_X,y:ctx.y-rowH,width:ctx.tableRight-MARGIN_X,height:rowH,borderColor:BRAND.line,borderWidth:0.4});

  const y1 = ctx.y - 10;
  const cols=ctx.cols;
  const statusCol = cols[11]!;
  const noteCol = cols[12]!;

  drawText(ctx, String(index + 1), cols[0]!.x + 2, y1, 7, true, BRAND.slate);
  drawText(ctx, fitManifestText(orderLabel, 13), cols[1]!.x + 2, y1, 7, true, BRAND.navy);
  if (parcel.orderId?.trim()) {
    drawText(ctx, fitManifestText(parcel.trackingNumber, 15), cols[1]!.x + 2, y1-8, 5.5, false, BRAND.muted);
  }
  drawText(ctx, fitManifestText(parcel.batchLabel ?? "-", 16), cols[2]!.x + 2, y1, 6.5);
  shopLines.forEach((line,i)=>drawText(ctx,line,cols[3]!.x+2,y1-i*8,6.2));
  customerLines.forEach((line,i)=>drawText(ctx,line,cols[4]!.x+2,y1-i*8,6.2,true));
  drawText(ctx, fitManifestText(parcel.customerPhone ?? "-", 15), cols[5]!.x + 2, y1, 6, false, BRAND.slate);
  drawText(ctx, fitManifestText(parcel.township ?? parcel.zone ?? "-", 17), cols[6]!.x + 2, y1, 6, false, BRAND.slate);
  addressLines.forEach((line,i)=>drawText(ctx,line,cols[7]!.x+2,y1-i*8,6));
  drawText(ctx, money(parcel.codAmount), cols[8]!.x + 1, y1, 6, true);
  drawText(ctx, money(includedFee), cols[9]!.x + 1, y1, 6, false, BRAND.slate);
  drawText(ctx, money(total), cols[10]!.x + 1, y1, 6.5, true, BRAND.accent);
  drawText(ctx, statusLabel(parcel.status), statusCol.x + 1, y1, 6, true, BRAND.slate);
  noteLines.forEach((line,i)=>drawText(ctx,line,noteCol.x+1,y1-i*8,6,false,BRAND.muted));

  ctx.y -= rowH;
  return true;
}

function drawSectionTotals(ctx: PageContext, totals: ReturnType<typeof totalsFor>) {
  drawRect(ctx, MARGIN_X, ctx.y - 24, ctx.tableRight - MARGIN_X, 22, BRAND.blue);
  drawText(
    ctx,
    `Orders: ${totals.count}   COD: ${money(totals.totalCod)}   Fees: ${money(totals.totalFees)}   Total: ${money(totals.totalAmount)}`,
    MARGIN_X + 8,
    ctx.y - 15,
    8,
    true,
    BRAND.white,
  );
  ctx.y -= 30;
}

async function buildPdfDocument(input: ManifestInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const statusesLabel = input.statusesLabel ?? "Assigned, Out for delivery, Picked up";
  const sections = normalizeSections(input);
  const returnHandover = isOsHandoverDocument(input.documentTitle);
  const pageWidth = returnHandover ? RETURN_PAGE_WIDTH : PAGE_WIDTH;
  const pageHeight = returnHandover ? RETURN_PAGE_HEIGHT : PAGE_HEIGHT;
  const cols = returnHandover ? RETURN_COLS : PORTRAIT_COLS;
  const pageContext = (page: ReturnType<PDFDocument["addPage"]>, pageIndex: number, continued: boolean): PageContext => ({
    doc, page, fonts, y: pageHeight - 40, pageIndex, continued, glyphPathCache,
    pageWidth, pageHeight, cols, tableRight: pageWidth - MARGIN_X, marginBottom: MARGIN_BOTTOM, returnHandover,
  });
  const selectedRidersLabel = sections.map((section) => section.riderName).join(", ") || "-";

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const myanmarBytes = loadMyanmarFontBytes();
  const myanmarKit = fontkit.create(myanmarBytes);
  const myanmar = await doc.embedFont(myanmarBytes, { subset: true });
  const fonts: FontPair = { regular, bold, myanmar, myanmarKit };
  const glyphPathCache = new Map<number, string>();

  if (!sections.length) {
    const page = doc.addPage([pageWidth, pageHeight]);
    const ctx = pageContext(page, 0, false);
    drawBrandBar(ctx);
    drawText(ctx, "All Active Deliveries", MARGIN_X, pageHeight - 40, 12, true);
    drawText(ctx, "No riders selected.", MARGIN_X, pageHeight - 58, 9, false, BRAND.muted);
    drawFooter(ctx);
    return doc;
  }

  let pageIndex = 0;
  for (const section of sections) {
    const totals = totalsFor(section.parcels, returnHandover);
    let page = doc.addPage([pageWidth, pageHeight]);
    let ctx = pageContext(page, pageIndex, false);
    startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel, input.documentTitle, input.noteLabel, input.documentSubtitle);

    if (!section.parcels.length) {
      drawText(ctx, "No assigned parcels for this rider.", MARGIN_X, ctx.y - 8, 9, false, BRAND.muted);
      ctx.y -= 20;
    }

    for (const [index, parcel] of section.parcels.entries()) {
      const drawn = drawParcelRow(ctx, parcel, index, returnHandover);
      if (!drawn) {
        drawFooter(ctx, input.footerLabel);
        pageIndex += 1;
        page = doc.addPage([pageWidth, pageHeight]);
        ctx = pageContext(page, pageIndex, true);
        startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel, input.documentTitle, input.noteLabel, input.documentSubtitle);
        drawParcelRow(ctx, parcel, index, returnHandover);
      }
    }

    if (ctx.y - 28 < ctx.marginBottom) {
      drawFooter(ctx, input.footerLabel);
      pageIndex += 1;
      page = doc.addPage([pageWidth, pageHeight]);
      ctx = pageContext(page, pageIndex, true);
      startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel, input.documentTitle, input.noteLabel, input.documentSubtitle);
    }
    drawSectionTotals(ctx, totals);
    drawFooter(ctx, input.footerLabel);
    pageIndex += 1;
  }

  return doc;
}

export async function generateDispatchManifestPdf(input: ManifestInput) {
  const doc = await buildPdfDocument(input);
  return Buffer.from(await doc.save());
}
