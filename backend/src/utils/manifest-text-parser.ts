export const MAX_MANIFEST_ROWS = 500;
export type ParsedManifestLine = { reference?: string; customerName: string; address: string; phone?: string; codAmount: number; sourcePage: number };
const amount = (value: string) => Number(value.replace(/[^0-9]/g, ""));
const looksLikePhone = (value: string) => /(?:\+?95|0)\s*9[\d\s-]{5,}/.test(value);

export function parseDeliveryManifestText(pages: string[]): ParsedManifestLine[] {
  const rows: ParsedManifestLine[] = [];
  pages.forEach((page, pageIndex) => {
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim() || /delivery\s+manifest|customer\s+address|no\.?\s+customer/i.test(line)) continue;
      const numbered = line.match(/^\s*(\d{1,5})\s{1,}(.+)$/);
      if (!numbered) {
        const prior = rows.at(-1);
        if (prior && prior.sourcePage === pageIndex + 1 && line.trim().length > 2) prior.address = `${prior.address} ${line.trim()}`.trim();
        continue;
      }
      const reference = numbered[1];
      const columns = numbered[2].trim().split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
      if (columns.length < 3) continue;
      const last = columns.at(-1)!;
      const codAmount = amount(last);
      if (!Number.isSafeInteger(codAmount) || codAmount < 0 || !/[0-9]/.test(last)) continue;
      columns.pop();
      let phone: string | undefined;
      if (columns.length > 2 && looksLikePhone(columns.at(-1)!)) phone = columns.pop();
      const customerName = columns.shift()?.trim() ?? "";
      const address = columns.join(" ").trim();
      if (customerName && address) rows.push({ reference, customerName, address, phone, codAmount, sourcePage: pageIndex + 1 });
    }
  });
  return rows.slice(0, MAX_MANIFEST_ROWS);
}
