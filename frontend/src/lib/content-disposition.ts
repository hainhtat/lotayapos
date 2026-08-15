/** Parse `filename` / `filename*` from a Content-Disposition header value. */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header?.trim()) return null;

  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;\s]+)/i.exec(header);
  if (star?.[1]) {
    const encoded = star[1].replace(/^["']|["']$/g, "");
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded) return decoded;
    } catch {
      /* fall through to plain filename */
    }
  }

  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  if (quoted?.[1] != null) {
    const name = quoted[1].replace(/\\(.)/g, "$1").trim();
    if (name) return name;
  }

  const bare = /filename\s*=\s*([^;\s]+)/i.exec(header);
  if (bare?.[1]) {
    const name = bare[1].replace(/^["']|["']$/g, "").trim();
    if (name && !/^UTF-8''/i.test(name)) return name;
  }

  return null;
}

function localIsoDate(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Prefer server Content-Disposition; else lotaya-manifest-YYYY-MM-DD.pdf (local date). */
export function resolveManifestPdfFilename(
  contentDisposition: string | null | undefined,
  now = new Date(),
): string {
  return parseContentDispositionFilename(contentDisposition) ?? `lotaya-manifest-${localIsoDate(now)}.pdf`;
}
