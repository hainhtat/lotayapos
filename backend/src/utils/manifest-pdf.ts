import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { Font as FontkitFont } from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, RGB, StandardFonts, rgb } from "pdf-lib";

export type ManifestParcel = {
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string;
  codAmount: number;
  deliveryFee?: number | null;
  zone: string | null;
  township: string | null;
  batchLabel?: string;
  shopName?: string;
  /** Parcel status enum (e.g. ASSIGNED) — rendered as a short Status label */
  status?: string;
  /** Return/exception note only — never a status code */
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
};

/** A4 portrait — matches active rider sheet print size */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 18;
const MARGIN_BOTTOM = 28;
const TABLE_RIGHT = PAGE_WIDTH - MARGIN_X;

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

/** Columns must end at or before TABLE_RIGHT (577.28). Status + Note for return notes. */
const COLS = [
  { key: "#", x: 18, w: 16 },
  { key: "Order", x: 34, w: 40 },
  { key: "Batch", x: 74, w: 52 },
  { key: "Merchant", x: 126, w: 48 },
  { key: "Customer", x: 174, w: 52 },
  { key: "Phone", x: 226, w: 54 },
  { key: "Township", x: 280, w: 48 },
  { key: "Address", x: 328, w: 68 },
  { key: "COD", x: 396, w: 36 },
  { key: "Fee", x: 432, w: 28 },
  { key: "Total", x: 460, w: 36 },
  { key: "Status", x: 496, w: 28 },
  { key: "Note", x: 524, w: 53 },
] as const;

const MYANMAR_RE = /[\u1000-\u109F]/;

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

function fit(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}...` : normalized;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} ks`;
}

function statusLabel(status?: string) {
  if (!status) return "-";
  return STATUS_SHORT[status] ?? status.slice(0, 3).toUpperCase();
}

function totalsFor(parcels: ManifestParcel[]) {
  const totalCod = parcels.reduce((sum, parcel) => sum + parcel.codAmount, 0);
  const totalFees = parcels.reduce((sum, parcel) => sum + (parcel.deliveryFee ?? 0), 0);
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

type FontPair = { regular: PDFFont; bold: PDFFont; myanmarKit: FontkitFont };

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
}

type PageContext = {
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  fonts: FontPair;
  y: number;
  pageIndex: number;
  continued: boolean;
  glyphPathCache: Map<number, string>;
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
    drawShapedMyanmar(ctx.page, ctx.fonts.myanmarKit, text, x, y, size, color, ctx.glyphPathCache);
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

function drawFooter(ctx: PageContext) {
  drawText(ctx, "Lotaya Delivery - Active rider sheet", MARGIN_X, 12, 7, false, BRAND.muted);
  drawText(ctx, `Page ${ctx.pageIndex + 1}`, PAGE_WIDTH - 48, 12, 7, false, BRAND.muted);
}

function drawBrandBar(ctx: PageContext) {
  drawRect(ctx, 0, PAGE_HEIGHT - 22, PAGE_WIDTH, 22, BRAND.blue);
  drawText(ctx, "LOTAYA", MARGIN_X, PAGE_HEIGHT - 15, 10, true, BRAND.white);
  drawText(ctx, "Active Rider Sheet", MARGIN_X + 58, PAGE_HEIGHT - 14, 8, false, BRAND.white);
}

function drawRiderSheetHeader(
  ctx: PageContext,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
) {
  drawBrandBar(ctx);
  ctx.y = PAGE_HEIGHT - 40;
  const title = ctx.continued
    ? `All Active Deliveries - Rider: ${fit(section.riderName, 42)} (continued)`
    : `All Active Deliveries - Rider: ${fit(section.riderName, 48)}`;
  drawText(ctx, title, MARGIN_X, ctx.y, 12, true, BRAND.navy);
  ctx.y -= 14;
  drawText(ctx, `Generated: ${formatYangonStamp(generatedAt)}  |  All remaining assigned orders combined`, MARGIN_X, ctx.y, 7, false, BRAND.muted);
  ctx.y -= 11;
  drawText(ctx, `Selected statuses: ${statusesLabel}`, MARGIN_X, ctx.y, 7, false, BRAND.slate);
  ctx.y -= 11;
  drawText(ctx, `Selected riders: ${fit(selectedRidersLabel, 90)}`, MARGIN_X, ctx.y, 7, false, BRAND.slate);
  if (section.hubName) {
    ctx.y -= 11;
    drawText(ctx, `Hub: ${fit(section.hubName, 40)}`, MARGIN_X, ctx.y, 7, false, BRAND.muted);
  }
  ctx.y -= 16;

  const cardW = (PAGE_WIDTH - MARGIN_X * 2 - 18) / 4;
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
    drawText(ctx, fit(card.value, 16), x + 10, ctx.y - 26, 9, true, BRAND.navy);
  });
  ctx.y -= 48;
}

function drawTableHeader(ctx: PageContext) {
  const h = 18;
  drawRect(ctx, MARGIN_X, ctx.y - h, TABLE_RIGHT - MARGIN_X, h, BRAND.softGray, BRAND.line);
  COLS.forEach((col) => drawText(ctx, col.key, col.x + 2, ctx.y - 12, 6, true, BRAND.slate));
  ctx.y -= h + 2;
}

function startRiderPage(
  ctx: PageContext,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
) {
  drawRiderSheetHeader(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
  drawTableHeader(ctx);
}

function drawParcelRow(ctx: PageContext, parcel: ManifestParcel, index: number) {
  const rowH = 26;
  if (ctx.y - rowH < MARGIN_BOTTOM) return false;

  if (index % 2 === 1) {
    drawRect(ctx, MARGIN_X, ctx.y - rowH, TABLE_RIGHT - MARGIN_X, rowH, BRAND.zebra);
  }
  ctx.page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - rowH,
    width: TABLE_RIGHT - MARGIN_X,
    height: rowH,
    borderColor: BRAND.line,
    borderWidth: 0.4,
  });

  const fee = parcel.deliveryFee ?? 0;
  const total = parcel.codAmount + fee;
  const orderLabel = parcel.orderId?.trim() || parcel.trackingNumber;
  const address = parcel.address.replace(/\s+/g, " ").trim();
  const y1 = ctx.y - 9;
  const y2 = ctx.y - 19;
  const statusCol = COLS[11];
  const noteCol = COLS[12];
  const noteText = parcel.note?.trim() || "";

  drawText(ctx, String(index + 1), COLS[0].x + 2, y1, 7, true, BRAND.slate);
  drawText(ctx, fit(orderLabel, 8), COLS[1].x + 2, y1, 7, true, BRAND.navy);
  if (parcel.orderId?.trim()) {
    drawText(ctx, fit(parcel.trackingNumber, 8), COLS[1].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(ctx, fit(parcel.batchLabel ?? "-", 11), COLS[2].x + 2, y1, 6.5);
  drawText(ctx, fit(parcel.shopName ?? "-", 10), COLS[3].x + 2, y1, 6.5);
  drawText(ctx, fit(parcel.customerName, 11), COLS[4].x + 2, y1, 6.5, true);
  drawText(ctx, fit(parcel.customerPhone ?? "-", 11), COLS[5].x + 2, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(parcel.township ?? parcel.zone ?? "-", 10), COLS[6].x + 2, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(address, 16), COLS[7].x + 2, y1, 6);
  if (address.length > 16) {
    drawText(ctx, fit(address.slice(16), 16), COLS[7].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(ctx, fit(money(parcel.codAmount), 8), COLS[8].x + 1, y1, 6, true);
  drawText(ctx, fit(money(fee), 7), COLS[9].x + 1, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(money(total), 8), COLS[10].x + 1, y1, 6.5, true, BRAND.accent);
  drawText(ctx, fit(statusLabel(parcel.status), 5), statusCol.x + 1, y1, 6, true, BRAND.slate);
  if (noteText) {
    drawText(ctx, fit(noteText, 14), noteCol.x + 1, y1, 5.5, false, BRAND.muted);
    if (noteText.length > 14) {
      drawText(ctx, fit(noteText.slice(14), 14), noteCol.x + 1, y2, 5, false, BRAND.muted);
    }
  }

  ctx.y -= rowH;
  return true;
}

function drawSectionTotals(ctx: PageContext, totals: ReturnType<typeof totalsFor>) {
  drawRect(ctx, MARGIN_X, ctx.y - 24, TABLE_RIGHT - MARGIN_X, 22, BRAND.blue);
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
  const selectedRidersLabel = sections.map((section) => section.riderName).join(", ") || "-";

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const myanmarBytes = loadMyanmarFontBytes();
  const myanmarKit = fontkit.create(myanmarBytes);
  const fonts: FontPair = { regular, bold, myanmarKit };
  const glyphPathCache = new Map<number, string>();

  if (!sections.length) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const ctx: PageContext = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex: 0, continued: false, glyphPathCache };
    drawBrandBar(ctx);
    drawText(ctx, "All Active Deliveries", MARGIN_X, PAGE_HEIGHT - 40, 12, true);
    drawText(ctx, "No riders selected.", MARGIN_X, PAGE_HEIGHT - 58, 9, false, BRAND.muted);
    drawFooter(ctx);
    return doc;
  }

  let pageIndex = 0;
  for (const section of sections) {
    const totals = totalsFor(section.parcels);
    let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let ctx: PageContext = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: false, glyphPathCache };
    startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel);

    if (!section.parcels.length) {
      drawText(ctx, "No assigned parcels for this rider.", MARGIN_X, ctx.y - 8, 9, false, BRAND.muted);
      ctx.y -= 20;
    }

    for (const [index, parcel] of section.parcels.entries()) {
      const drawn = drawParcelRow(ctx, parcel, index);
      if (!drawn) {
        drawFooter(ctx);
        pageIndex += 1;
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        ctx = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: true, glyphPathCache };
        startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
        drawParcelRow(ctx, parcel, index);
      }
    }

    if (ctx.y - 28 < MARGIN_BOTTOM) {
      drawFooter(ctx);
      pageIndex += 1;
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      ctx = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: true, glyphPathCache };
      startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
    }
    drawSectionTotals(ctx, totals);
    drawFooter(ctx);
    pageIndex += 1;
  }

  return doc;
}

export async function generateDispatchManifestPdf(input: ManifestInput) {
  const doc = await buildPdfDocument(input);
  return Buffer.from(await doc.save());
}
