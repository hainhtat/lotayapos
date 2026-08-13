import { myanmarFontRepairs, repairPdfText } from "./myanmar-pdf-font.js";

export type PdfTextItem = { str: string; x: number; y: number; page: number };

const MAX_PAGES = 50;

async function fontPostScriptName(page: { commonObjs: { get(id: string): Promise<unknown> } }, fontName: string) {
  try {
    const font = (await page.commonObjs.get(fontName)) as { name?: string } | undefined;
    return font?.name ?? fontName;
  } catch {
    return fontName;
  }
}

export async function extractPdfTextItems(pdf: Buffer, maxPages = MAX_PAGES) {
  const data = new Uint8Array(pdf);
  const repairs = myanmarFontRepairs(pdf);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data, disableWorker: true, isEvalSupported: false, verbosity: 0 } as never).promise;
  try {
    const pageCount = doc.numPages;
    if (pageCount > maxPages) return { pageCount, items: [] as PdfTextItem[], pageLimitExceeded: true as const };
    const items: PdfTextItem[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const pdfPage = await doc.getPage(page);
      await pdfPage.getOperatorList();
      const content = await pdfPage.getTextContent();
      const names = new Map<string, string>();
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
        const loaded = "fontName" in item && typeof item.fontName === "string" ? item.fontName : "";
        if (loaded && !names.has(loaded)) names.set(loaded, await fontPostScriptName(pdfPage, loaded));
        items.push({
          str: repairPdfText(item.str, names.get(loaded), repairs),
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          page,
        });
      }
    }
    return { pageCount, items, pageLimitExceeded: false as const };
  } finally {
    await doc.cleanup();
  }
}

export function itemsHaveReadableText(items: PdfTextItem[]) {
  const text = items.map((item) => item.str).join("");
  return Boolean(text.normalize("NFC").replace(/[\d\s.,()\-–—]/g, ""));
}
