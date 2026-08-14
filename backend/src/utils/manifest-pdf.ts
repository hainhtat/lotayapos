import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
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

const COLS = [
  { key: "#", x: 18, w: 18 },
  { key: "Order", x: 36, w: 42 },
  { key: "Batch", x: 78, w: 58 },
  { key: "Merchant", x: 136, w: 52 },
  { key: "Customer", x: 188, w: 58 },
  { key: "Phone", x: 246, w: 58 },
  { key: "Township", x: 304, w: 52 },
  { key: "Address", x: 356, w: 98 },
  { key: "COD", x: 454, w: 40 },
  { key: "Fee", x: 494, w: 32 },
  { key: "Total", x: 526, w: 40 },
  { key: "Note", x: 566, w: 12 },
] as const;

const MYANMAR_RE = /[\u1000-\u109F]/;

function fit(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}...` : normalized;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} ks`;
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

type FontPair = { regular: PDFFont; bold: PDFFont; myanmar: PDFFont };

function pickFont(text: string, fonts: FontPair, bold = false) {
  return MYANMAR_RE.test(text) ? fonts.myanmar : bold ? fonts.bold : fonts.regular;
}

type PageContext = {
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  fonts: FontPair;
  y: number;
  pageIndex: number;
  continued: boolean;
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
  ctx.page.drawText(text, {
    x,
    y,
    size,
    font: pickFont(text, ctx.fonts, bold),
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
  drawRect(ctx, MARGIN_X, ctx.y - h, PAGE_WIDTH - MARGIN_X * 2, h, BRAND.softGray, BRAND.line);
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
    drawRect(ctx, MARGIN_X, ctx.y - rowH, PAGE_WIDTH - MARGIN_X * 2, rowH, BRAND.zebra);
  }
  ctx.page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - rowH,
    width: PAGE_WIDTH - MARGIN_X * 2,
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

  drawText(ctx, String(index + 1), COLS[0].x + 2, y1, 7, true, BRAND.slate);
  drawText(ctx, fit(orderLabel, 8), COLS[1].x + 2, y1, 7, true, BRAND.navy);
  if (parcel.orderId?.trim()) {
    drawText(ctx, fit(parcel.trackingNumber, 8), COLS[1].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(ctx, fit(parcel.batchLabel ?? "-", 12), COLS[2].x + 2, y1, 6.5);
  drawText(ctx, fit(parcel.shopName ?? "-", 11), COLS[3].x + 2, y1, 6.5);
  drawText(ctx, fit(parcel.customerName, 12), COLS[4].x + 2, y1, 6.5, true);
  drawText(ctx, fit(parcel.customerPhone ?? "-", 12), COLS[5].x + 2, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(parcel.township ?? parcel.zone ?? "-", 11), COLS[6].x + 2, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(address, 24), COLS[7].x + 2, y1, 6);
  if (address.length > 24) {
    drawText(ctx, fit(address.slice(24), 24), COLS[7].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(ctx, fit(money(parcel.codAmount), 9), COLS[8].x + 1, y1, 6, true);
  drawText(ctx, fit(money(fee), 8), COLS[9].x + 1, y1, 6, false, BRAND.slate);
  drawText(ctx, fit(money(total), 9), COLS[10].x + 1, y1, 6.5, true, BRAND.accent);
  drawText(ctx, fit(parcel.note ?? "", 4), COLS[11].x, y1, 6, false, BRAND.muted);

  ctx.y -= rowH;
  return true;
}

function drawSectionTotals(ctx: PageContext, totals: ReturnType<typeof totalsFor>) {
  drawRect(ctx, MARGIN_X, ctx.y - 24, PAGE_WIDTH - MARGIN_X * 2, 22, BRAND.blue);
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
  const myanmar = await doc.embedFont(loadMyanmarFontBytes());
  const fonts: FontPair = { regular, bold, myanmar };

  if (!sections.length) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const ctx: PageContext = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex: 0, continued: false };
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
    let ctx: PageContext = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: false };
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
        ctx = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: true };
        startRiderPage(ctx, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
        drawParcelRow(ctx, parcel, index);
      }
    }

    if (ctx.y - 28 < MARGIN_BOTTOM) {
      drawFooter(ctx);
      pageIndex += 1;
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      ctx = { doc, page, fonts, y: PAGE_HEIGHT - 40, pageIndex, continued: true };
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
