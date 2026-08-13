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
  blue: { r: 0.082, g: 0.596, b: 0.937 },
  accent: { r: 0.027, g: 0.529, b: 0.875 },
  navy: { r: 0.063, g: 0.075, b: 0.094 },
  slate: { r: 0.2, g: 0.255, b: 0.333 },
  soft: { r: 0.918, g: 0.965, b: 1 },
  softGray: { r: 0.945, g: 0.961, b: 0.976 },
  line: { r: 0.796, g: 0.835, b: 0.882 },
  zebra: { r: 0.973, g: 0.98, b: 0.988 },
  white: { r: 1, g: 1, b: 1 },
  muted: { r: 0.392, g: 0.455, b: 0.545 },
  green: { r: 0.071, g: 0.651, b: 0.416 },
};

/** Column layout inspired by All Active Rider Sheets */
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

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n]+/g, " ");
}

function fit(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}...` : normalized;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} ks`;
}

function rgb({ r, g, b }: { r: number; g: number; b: number }) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
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

function buildPdf(pages: string[]) {
  const header = "%PDF-1.4\n";
  const fontRegularId = 3 + pages.length;
  const fontBoldId = fontRegularId + 1;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  pages.forEach((_, index) => {
    const contentId = fontBoldId + 1 + index;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pages.forEach((content) => {
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

  const chunks = [header];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(""), "utf8"));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
  chunks.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
      .join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(chunks.join(""), "utf8");
}

type DrawState = {
  y: number;
  commands: string[];
  pageIndex: number;
  pages: string[];
  continued: boolean;
};

function flushPage(state: DrawState) {
  state.pages.push(state.commands.join("\n"));
  state.commands = [];
  state.pageIndex += 1;
}

function drawRect(
  state: DrawState,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: { r: number; g: number; b: number },
  stroke?: { r: number; g: number; b: number },
) {
  state.commands.push("q");
  state.commands.push(`${rgb(fill)} rg`);
  state.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
  state.commands.push("f");
  if (stroke) {
    state.commands.push(`${rgb(stroke)} RG`);
    state.commands.push("0.5 w");
    state.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    state.commands.push("S");
  }
  state.commands.push("Q");
}

function drawText(
  state: DrawState,
  text: string,
  x: number,
  y: number,
  size: number,
  bold = false,
  color = BRAND.navy,
) {
  state.commands.push("BT");
  state.commands.push(`/${bold ? "F2" : "F1"} ${size} Tf`);
  state.commands.push(`${rgb(color)} rg`);
  state.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
  state.commands.push(`(${escapePdfText(text)}) Tj`);
  state.commands.push("ET");
}

function drawFooter(state: DrawState) {
  drawText(state, "Lotaya Delivery - Active rider sheet", MARGIN_X, 12, 7, false, BRAND.muted);
  drawText(state, `Page ${state.pageIndex + 1}`, PAGE_WIDTH - 48, 12, 7, false, BRAND.muted);
}

function drawBrandBar(state: DrawState) {
  drawRect(state, 0, PAGE_HEIGHT - 22, PAGE_WIDTH, 22, BRAND.blue);
  drawText(state, "LOTAYA", MARGIN_X, PAGE_HEIGHT - 15, 10, true, BRAND.white);
  drawText(state, "Active Rider Sheet", MARGIN_X + 58, PAGE_HEIGHT - 14, 8, false, BRAND.white);
}

function drawRiderSheetHeader(
  state: DrawState,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
) {
  drawBrandBar(state);
  state.y = PAGE_HEIGHT - 40;
  const title = state.continued
    ? `All Active Deliveries - Rider: ${fit(section.riderName, 42)} (continued)`
    : `All Active Deliveries - Rider: ${fit(section.riderName, 48)}`;
  drawText(state, title, MARGIN_X, state.y, 12, true, BRAND.navy);
  state.y -= 14;
  drawText(
    state,
    `Generated: ${formatYangonStamp(generatedAt)}  |  All remaining assigned orders combined`,
    MARGIN_X,
    state.y,
    7,
    false,
    BRAND.muted,
  );
  state.y -= 11;
  drawText(state, `Selected statuses: ${statusesLabel}`, MARGIN_X, state.y, 7, false, BRAND.slate);
  state.y -= 11;
  drawText(state, `Selected riders: ${fit(selectedRidersLabel, 90)}`, MARGIN_X, state.y, 7, false, BRAND.slate);
  if (section.hubName) {
    state.y -= 11;
    drawText(state, `Hub: ${fit(section.hubName, 40)}`, MARGIN_X, state.y, 7, false, BRAND.muted);
  }
  state.y -= 16;

  const cardW = (PAGE_WIDTH - MARGIN_X * 2 - 18) / 4;
  const cards = [
    { label: "Orders", value: String(totals.count), color: BRAND.blue },
    { label: "COD", value: money(totals.totalCod), color: BRAND.navy },
    { label: "Fees", value: money(totals.totalFees), color: BRAND.green },
    { label: "Total", value: money(totals.totalAmount), color: BRAND.accent },
  ];
  cards.forEach((card, index) => {
    const x = MARGIN_X + index * (cardW + 6);
    drawRect(state, x, state.y - 34, cardW, 38, BRAND.soft, BRAND.line);
    drawRect(state, x, state.y - 34, 3, 38, card.color);
    drawText(state, card.label, x + 10, state.y - 10, 7, false, BRAND.muted);
    drawText(state, fit(card.value, 16), x + 10, state.y - 26, 9, true, BRAND.navy);
  });
  state.y -= 48;
}

function drawTableHeader(state: DrawState) {
  const h = 18;
  drawRect(state, MARGIN_X, state.y - h, PAGE_WIDTH - MARGIN_X * 2, h, BRAND.softGray, BRAND.line);
  COLS.forEach((col) => drawText(state, col.key, col.x + 2, state.y - 12, 6, true, BRAND.slate));
  state.y -= h + 2;
}

function startRiderPage(
  state: DrawState,
  section: ManifestSection,
  totals: ReturnType<typeof totalsFor>,
  generatedAt: Date,
  statusesLabel: string,
  selectedRidersLabel: string,
) {
  state.commands = [];
  drawRiderSheetHeader(state, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
  drawTableHeader(state);
}

function drawParcelRow(state: DrawState, parcel: ManifestParcel, index: number) {
  const rowH = 26;
  if (state.y - rowH < MARGIN_BOTTOM) return false;

  if (index % 2 === 1) {
    drawRect(state, MARGIN_X, state.y - rowH, PAGE_WIDTH - MARGIN_X * 2, rowH, BRAND.zebra);
  }
  state.commands.push("q");
  state.commands.push(`${rgb(BRAND.line)} RG`);
  state.commands.push("0.4 w");
  state.commands.push(
    `${MARGIN_X.toFixed(2)} ${(state.y - rowH).toFixed(2)} ${(PAGE_WIDTH - MARGIN_X * 2).toFixed(2)} ${rowH.toFixed(2)} re`,
  );
  state.commands.push("S");
  state.commands.push("Q");

  const fee = parcel.deliveryFee ?? 0;
  const total = parcel.codAmount + fee;
  const orderLabel = parcel.orderId?.trim() || parcel.trackingNumber;
  const address = parcel.address.replace(/\s+/g, " ").trim();
  const y1 = state.y - 9;
  const y2 = state.y - 19;

  drawText(state, String(index + 1), COLS[0].x + 2, y1, 7, true, BRAND.slate);
  drawText(state, fit(orderLabel, 8), COLS[1].x + 2, y1, 7, true, BRAND.navy);
  if (parcel.orderId?.trim()) {
    drawText(state, fit(parcel.trackingNumber, 8), COLS[1].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(state, fit(parcel.batchLabel ?? "-", 12), COLS[2].x + 2, y1, 6.5);
  drawText(state, fit(parcel.shopName ?? "-", 11), COLS[3].x + 2, y1, 6.5);
  drawText(state, fit(parcel.customerName, 12), COLS[4].x + 2, y1, 6.5, true);
  drawText(state, fit(parcel.customerPhone ?? "-", 12), COLS[5].x + 2, y1, 6, false, BRAND.slate);
  drawText(state, fit(parcel.township ?? parcel.zone ?? "-", 11), COLS[6].x + 2, y1, 6, false, BRAND.slate);
  drawText(state, fit(address, 24), COLS[7].x + 2, y1, 6);
  if (address.length > 24) {
    drawText(state, fit(address.slice(24), 24), COLS[7].x + 2, y2, 5.5, false, BRAND.muted);
  }
  drawText(state, fit(money(parcel.codAmount), 9), COLS[8].x + 1, y1, 6, true);
  drawText(state, fit(money(fee), 8), COLS[9].x + 1, y1, 6, false, BRAND.slate);
  drawText(state, fit(money(total), 9), COLS[10].x + 1, y1, 6.5, true, BRAND.accent);
  drawText(state, fit(parcel.note ?? "", 4), COLS[11].x, y1, 6, false, BRAND.muted);

  state.y -= rowH;
  return true;
}

function drawSectionTotals(state: DrawState, totals: ReturnType<typeof totalsFor>) {
  drawRect(state, MARGIN_X, state.y - 24, PAGE_WIDTH - MARGIN_X * 2, 22, BRAND.blue);
  drawText(
    state,
    `Orders: ${totals.count}   COD: ${money(totals.totalCod)}   Fees: ${money(totals.totalFees)}   Total: ${money(totals.totalAmount)}`,
    MARGIN_X + 8,
    state.y - 15,
    8,
    true,
    BRAND.white,
  );
  state.y -= 30;
}

export function generateDispatchManifestPdf(input: ManifestInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const statusesLabel = input.statusesLabel ?? "Assigned, Out for delivery, Picked up";
  const sections = normalizeSections(input);
  const selectedRidersLabel = sections.map((section) => section.riderName).join(", ") || "-";
  const pages: string[] = [];

  if (!sections.length) {
    const state: DrawState = { y: PAGE_HEIGHT - 40, commands: [], pageIndex: 0, pages, continued: false };
    drawBrandBar(state);
    drawText(state, "All Active Deliveries", MARGIN_X, PAGE_HEIGHT - 40, 12, true);
    drawText(state, "No riders selected.", MARGIN_X, PAGE_HEIGHT - 58, 9, false, BRAND.muted);
    drawFooter(state);
    flushPage(state);
    return buildPdf(pages);
  }

  sections.forEach((section) => {
    const totals = totalsFor(section.parcels);
    const state: DrawState = {
      y: PAGE_HEIGHT - 40,
      commands: [],
      pageIndex: pages.length,
      pages,
      continued: false,
    };

    startRiderPage(state, section, totals, generatedAt, statusesLabel, selectedRidersLabel);

    if (!section.parcels.length) {
      drawText(state, "No assigned parcels for this rider.", MARGIN_X, state.y - 8, 9, false, BRAND.muted);
      state.y -= 20;
    }

    section.parcels.forEach((parcel, index) => {
      const drawn = drawParcelRow(state, parcel, index);
      if (!drawn) {
        drawFooter(state);
        flushPage(state);
        state.pageIndex = pages.length;
        state.continued = true;
        startRiderPage(state, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
        drawParcelRow(state, parcel, index);
      }
    });

    if (state.y - 28 < MARGIN_BOTTOM) {
      drawFooter(state);
      flushPage(state);
      state.pageIndex = pages.length;
      state.continued = true;
      startRiderPage(state, section, totals, generatedAt, statusesLabel, selectedRidersLabel);
    }
    drawSectionTotals(state, totals);
    drawFooter(state);
    flushPage(state);
  });

  return buildPdf(pages);
}
