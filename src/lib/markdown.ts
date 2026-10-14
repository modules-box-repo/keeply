// Tiny dependency-free Markdown renderer. Input is HTML-escaped first, so output is safe to inject.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = s
    .replace(/!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => "<strong>" + (a ?? b) + "</strong>")
    .replace(/\*([^*\s][^*]*)\*|(^|\W)_([^_]+)_(?=\W|$)/g, (_m, a, p, b) => (a !== undefined ? "<em>" + a + "</em>" : p + "<em>" + b + "</em>"))
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => "<code>" + codes[Number(i)] + "</code>");
}

export function renderMarkdown(src: string): string {
  const lines = esc(src).split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push("<pre><code>" + buf.join("\n") + "</code></pre>");
    } else if (/^\s*$/.test(line)) {
      i++;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      const lv = line.match(/^#+/)![0].length;
      out.push("<h" + lv + ">" + inline(line.replace(/^#+\s+/, "")) + "</h" + lv + ">");
      i++;
    } else if (/^&gt;\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ""));
      out.push("<blockquote>" + inline(buf.join("<br/>")) + "</blockquote>");
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const buf: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
        let t = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        t = t.replace(/^\[( |x|X)\]\s/, (_m, c) => '<input type="checkbox" disabled ' + (c === " " ? "" : "checked ") + "/> ");
        buf.push("<li>" + inline(t) + "</li>");
      }
      out.push((ordered ? "<ol>" : "<ul>") + buf.join("") + (ordered ? "</ol>" : "</ul>"));
    } else {
      const buf: string[] = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|#{1,6}\s|&gt;|\s*([-*+]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
      out.push("<p>" + inline(buf.join("<br/>")) + "</p>");
    }
  }
  return out.join("");
}
