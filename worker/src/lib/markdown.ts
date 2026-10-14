import { escapeHtml, safeUrl } from "./html";

/**
 * A deliberately small Markdown renderer for admin-authored content (class descriptions, lesson notes,
 * blog posts). Security model: ALL input is HTML-escaped first, then a fixed set of constructs is turned
 * into tags. Links are limited to http(s)/mailto/tel/relative; images to https or same-site paths.
 * No raw HTML, no scripts, no inline event handlers can ever come out of this function.
 *
 * Supported: # headings (rendered one level down: page title owns <h1>), paragraphs, **bold**, *italic*,
 * `code`, fenced code, - / 1. lists, > quotes, --- rules, [text](url), ![alt](url).
 */
export function renderMarkdown(src: string, depth = 0): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(5, h[1].length + 1);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${depth < 3 ? renderMarkdown(buf.join("\n"), depth + 1) : escapeHtml(buf.join(" "))}</blockquote>`);
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /^\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m || /^\d/.test(m[1]) !== ordered) break;
        items.push(m[2]);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

function inline(raw: string): string {
  let s = escapeHtml(raw);

  // protect code spans from further processing
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    const u = safeUrl(url);
    // images: only https or same-site paths (never data:, never protocol-relative)
    if (!u || !(u.startsWith("/") || /^https:\/\//i.test(u))) return alt;
    return `<img src="${u}" alt="${alt}" loading="lazy" decoding="async">`;
  });

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const u = safeUrl(url);
    if (!u) return text;
    const external = /^https?:\/\//i.test(u);
    return `<a href="${u}"${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${text}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");

  return s.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => codes[Number(idx)] ?? "");
}

/** Plain-text excerpt for meta descriptions (strips markdown punctuation). */
export function stripMarkdown(src: string, max = 160): string {
  const text = src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
