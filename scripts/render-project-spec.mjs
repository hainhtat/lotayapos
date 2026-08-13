import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const markdownPath = resolve(root, "PROJECT_SPEC.md");
const outputPath = resolve(root, "PROJECT_SPEC.html");
const markdown = await readFile(markdownPath, "utf8");

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const slugify = (value) => value
  .toLowerCase()
  .replace(/[`*_]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const inline = (value) => escapeHtml(value)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const lines = markdown.split(/\r?\n/);
const sections = [];
const output = [];
let index = 0;
let inCode = false;
let codeLanguage = "";
let codeLines = [];

const isTableDivider = (line) => /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim());
const cells = (line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim());

while (index < lines.length) {
  const line = lines[index];
  const trimmed = line.trim();

  if (trimmed.startsWith("```")) {
    if (!inCode) {
      inCode = true;
      codeLanguage = trimmed.slice(3).trim();
      codeLines = [];
    } else {
      output.push(`<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      inCode = false;
    }
    index += 1;
    continue;
  }

  if (inCode) {
    codeLines.push(line);
    index += 1;
    continue;
  }

  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    const title = heading[2];
    const id = slugify(title);
    if (level === 2) sections.push({ id, title: title.replace(/\*\*/g, "") });
    output.push(`<h${level} id="${id}">${inline(title)}</h${level}>`);
    index += 1;
    continue;
  }

  if (trimmed.startsWith("|") && isTableDivider(lines[index + 1] ?? "")) {
    const headers = cells(trimmed);
    index += 2;
    const rows = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      rows.push(cells(lines[index]));
      index += 1;
    }
    output.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    continue;
  }

  if (/^-\s+/.test(trimmed)) {
    const items = [];
    while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
      items.push(lines[index].trim().replace(/^-\s+/, ""));
      index += 1;
    }
    output.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    continue;
  }

  if (/^\d+\.\s+/.test(trimmed)) {
    const items = [];
    while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
      items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
      index += 1;
    }
    output.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
    continue;
  }

  if (!trimmed) {
    index += 1;
    continue;
  }

  const paragraph = [trimmed];
  index += 1;
  while (index < lines.length) {
    const next = lines[index].trim();
    if (!next || /^(#{1,3})\s+/.test(next) || next.startsWith("|") || next.startsWith("```") || /^-\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
    paragraph.push(next);
    index += 1;
  }
  output.push(`<p>${inline(paragraph.join(" "))}</p>`);
}

const nav = sections.map(({ id, title }) => `<a href="#${id}">${escapeHtml(title)}</a>`).join("");
const generatedAt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date());

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="SME Delivery ERP System and Rider Mobile App project specification">
  <title>SME Delivery ERP — Project Specification</title>
  <style>
    :root { color-scheme: light; --bg:#f4f7fb; --surface:#fff; --surface-2:#eef5fb; --text:#172033; --muted:#637087; --line:#dce5ee; --accent:#147ed0; --accent-soft:#e3f2fd; --code:#eff4f8; --shadow:0 16px 40px rgba(24,45,72,.08); }
    :root[data-theme="dark"] { color-scheme: dark; --bg:#0d1420; --surface:#131d2b; --surface-2:#182538; --text:#e8eef6; --muted:#9cacbf; --line:#293a50; --accent:#55b7ff; --accent-soft:#163751; --code:#1b293b; --shadow:0 18px 45px rgba(0,0,0,.28); }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.7 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .topbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.8rem clamp(1rem,4vw,2rem); background:color-mix(in srgb, var(--surface) 88%, transparent); border-bottom:1px solid var(--line); backdrop-filter:blur(18px); }
    .brand { display:flex; align-items:center; gap:.75rem; font-weight:800; letter-spacing:-.02em; }
    .brand-mark { display:grid; place-items:center; width:2rem; height:2rem; border-radius:.65rem; background:var(--accent); color:#fff; font-size:.8rem; }
    button { border:1px solid var(--line); border-radius:.7rem; padding:.5rem .75rem; background:var(--surface); color:var(--text); cursor:pointer; font:inherit; }
    button:hover { border-color:var(--accent); }
    .layout { display:grid; grid-template-columns:260px minmax(0, 860px); gap:clamp(1.5rem,4vw,4rem); max-width:1220px; margin:0 auto; padding:2.5rem clamp(1rem,4vw,2rem) 5rem; }
    aside { position:sticky; top:5.5rem; align-self:start; max-height:calc(100vh - 7rem); overflow:auto; }
    aside h2 { margin:0 0 .75rem; font-size:.75rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
    nav { display:grid; gap:.2rem; }
    nav a { padding:.4rem .65rem; border-left:2px solid transparent; color:var(--muted); text-decoration:none; font-size:.9rem; line-height:1.35; }
    nav a:hover { color:var(--accent); border-left-color:var(--accent); background:var(--accent-soft); }
    main { min-width:0; padding:clamp(1.25rem,4vw,3.5rem); background:var(--surface); border:1px solid var(--line); border-radius:1.25rem; box-shadow:var(--shadow); }
    h1,h2,h3 { line-height:1.2; letter-spacing:-.035em; scroll-margin-top:5rem; }
    h1 { margin:0 0 1rem; font-size:clamp(2rem,5vw,3.4rem); }
    h2 { margin:3.5rem 0 1rem; padding-top:.5rem; border-top:1px solid var(--line); font-size:clamp(1.45rem,3vw,2rem); }
    h1 + p { margin-top:0; padding:1rem 1.1rem; border-radius:.8rem; background:var(--surface-2); color:var(--muted); }
    h3 { margin:2rem 0 .7rem; font-size:1.15rem; color:var(--accent); }
    p { margin:.8rem 0; }
    ul,ol { padding-left:1.35rem; }
    li { margin:.38rem 0; padding-left:.2rem; }
    strong { color:var(--text); }
    code { padding:.12rem .34rem; border:1px solid var(--line); border-radius:.35rem; background:var(--code); font:85%/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre { overflow:auto; padding:1rem; border:1px solid var(--line); border-radius:.8rem; background:var(--code); }
    pre code { padding:0; border:0; background:transparent; }
    .table-wrap { overflow-x:auto; margin:1rem 0 1.5rem; border:1px solid var(--line); border-radius:.85rem; }
    table { width:100%; border-collapse:collapse; font-size:.92rem; }
    th,td { padding:.75rem .85rem; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { position:sticky; top:0; background:var(--surface-2); color:var(--text); font-size:.8rem; letter-spacing:.03em; }
    tr:last-child td { border-bottom:0; }
    tbody tr:hover { background:color-mix(in srgb, var(--accent-soft) 55%, transparent); }
    footer { max-width:1220px; margin:-3.5rem auto 0; padding:0 2rem 3rem; color:var(--muted); text-align:right; font-size:.8rem; }
    @media (max-width:900px) { .layout { grid-template-columns:1fr; padding-top:1rem; } aside { position:static; max-height:none; padding:1rem; border:1px solid var(--line); border-radius:1rem; background:var(--surface); } nav { grid-template-columns:repeat(2,minmax(0,1fr)); } main { border-radius:1rem; } }
    @media (max-width:560px) { .brand span:last-child { display:none; } nav { grid-template-columns:1fr; } main { padding:1.1rem; } th,td { padding:.65rem; } }
    @media print { .topbar,aside { display:none; } body { background:#fff; color:#111; font-size:11pt; } .layout { display:block; max-width:none; padding:0; } main { border:0; box-shadow:none; padding:0; } h2 { break-before:page; } h3 { break-after:avoid; } table,pre,ul,ol { break-inside:avoid; } footer { margin:1rem 0 0; padding:0; } }
  </style>
</head>
<body>
  <header class="topbar"><div class="brand"><span class="brand-mark">ERP</span><span>Project Specification</span></div><button id="theme-toggle" type="button" aria-label="Toggle color theme">Toggle theme</button></header>
  <div class="layout"><aside><h2>Contents</h2><nav>${nav}</nav></aside><main>${output.join("\n")}</main></div>
  <footer>Generated from PROJECT_SPEC.md on ${escapeHtml(generatedAt)}.</footer>
  <script>
    const root = document.documentElement;
    const saved = localStorage.getItem("project-spec-theme");
    if (saved) root.dataset.theme = saved;
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      localStorage.setItem("project-spec-theme", next);
    });
  </script>
</body>
</html>`;

await writeFile(outputPath, html);
console.log(`Generated ${outputPath}`);
