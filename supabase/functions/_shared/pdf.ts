// A small PDF writer with no dependencies: Letter pages, the standard
// Helvetica, Helvetica-Bold, and Courier fonts (no embedding needed), text,
// rules, and filled boxes. Enough for a report a lawyer can open anywhere.
// Text is WinAnsi; characters outside it are replaced with '?'.
// Environment-neutral: no Deno or browser globals.

export type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier

export const PAGE = { width: 612, height: 792 } as const;

function esc(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += "\\" + c.toString(8).padStart(3, "0");
    else if (ch === "’" || ch === "‘") out += "'";
    else if (ch === "“" || ch === "”") out += '"';
    else if (ch === "–" || ch === "—") out += "-";
    else if (ch === "…") out += "...";
    else if (ch === "·") out += "\\267";
    else out += "?";
  }
  return out;
}

/** Approximate advance width in points for layout. Helvetica averages ~0.52 em; Courier is fixed at 0.6 em. */
export function textWidth(s: string, font: Font, size: number): number {
  if (font === "F3") return s.length * 0.6 * size;
  let w = 0;
  for (const ch of s) {
    if ("iljtfI.,:;'|!".includes(ch)) w += 0.28;
    else if ("mwMW".includes(ch)) w += 0.85;
    else if (ch === " ") w += 0.28;
    else if (ch >= "A" && ch <= "Z") w += 0.68;
    else if (ch >= "0" && ch <= "9") w += 0.56;
    else w += 0.52;
  }
  return w * size * (font === "F2" ? 1.04 : 1);
}

export function wrap(s: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of s.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (textWidth(next, font, size) <= maxWidth || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

export class PdfDocument {
  private pages: string[][] = [];
  private meta: { title: string; author: string; subject?: string };

  constructor(meta: { title: string; author: string; subject?: string }) {
    this.meta = meta;
  }

  addPage(): number {
    this.pages.push([]);
    return this.pages.length - 1;
  }

  private ops(page: number): string[] {
    const p = this.pages[page];
    if (!p) throw new Error(`No page ${page}`);
    return p;
  }

  text(page: number, x: number, y: number, str: string, opts: { font?: Font; size?: number; color?: [number, number, number] } = {}) {
    const { font = "F1", size = 10, color = [0.1, 0.12, 0.16] } = opts;
    this.ops(page).push(`BT /${font} ${size} Tf ${color.map((c) => c.toFixed(3)).join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET`);
  }

  rule(page: number, x1: number, y: number, x2: number, opts: { width?: number; color?: [number, number, number] } = {}) {
    const { width = 0.6, color = [0.78, 0.8, 0.84] } = opts;
    this.ops(page).push(`${color.map((c) => c.toFixed(3)).join(" ")} RG ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
  }

  box(page: number, x: number, y: number, w: number, h: number, color: [number, number, number]) {
    this.ops(page).push(`${color.map((c) => c.toFixed(3)).join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Serialize. Object numbering: 1 catalog, 2 pages, 3-5 fonts, 6 info, then page+content pairs. */
  render(): Uint8Array {
    const enc = new TextEncoder();
    const objects: string[] = [];
    const add = (body: string) => { objects.push(body); return objects.length; };
    const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesIdx = add(""); // placeholder, filled after pages are known
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
    const d = new Date();
    const stamp = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}Z`;
    const info = add(`<< /Title (${esc(this.meta.title)}) /Author (${esc(this.meta.author)}) ${this.meta.subject ? `/Subject (${esc(this.meta.subject)}) ` : ""}/Producer (VYBZ) /CreationDate (${stamp}) >>`);
    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const content = ops.join("\n");
      const cid = add(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
      const pid = add(`<< /Type /Page /Parent ${pagesIdx} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${cid} 0 R >>`);
      pageIds.push(pid);
    }
    objects[pagesIdx - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    const byteLen = (s: string) => enc.encode(s).length;
    let pos = byteLen(out);
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pos);
      const s = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
      out += s;
      pos += byteLen(s);
    }
    const xref = pos;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc.encode(out);
  }
}
