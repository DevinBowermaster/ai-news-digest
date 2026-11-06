import { Marked } from "marked";

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Markdown to email HTML. The digest quotes untrusted feed text, so raw HTML is
 * shown as text, images are dropped (no tracking pixels), and only https links
 * survive, with the host printed next to them so a misleading label is visible.
 */
const marked = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text ?? ""),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return label;
      }
      if (url.protocol !== "https:") return label;
      return `<a href="${esc(url.href)}" style="color:#1a5fb4">${label}</a> <span style="color:#6b6b6b;font-size:12px">(${esc(url.host)})</span>`;
    },
  },
});

/** Second line of defence behind the renderer: refuse to send anything that could run or load. */
export function assertNoActiveHtml(html: string): void {
  if (/<(script|img|iframe|object|embed|form|style|link|base)\b|<meta\s+http-equiv|<[^>]*\son\w+\s*=|href="(?!https:)/i.test(html)) {
    throw new Error("rendered digest contains active HTML; refusing to send");
  }
}

export function subjectFor(markdown: string): string {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "Digest";
  const first = /^- (.+)$/m.exec(markdown)?.[1]?.replace(/\\(.)/g, "$1").replace(/[*_`[\]]/g, "").trim();
  return (first ? `${title} | ${first}` : title).slice(0, 140);
}

/** Inline styles only: most email clients ignore <style> blocks. */
export function renderHtml(markdown: string): string {
  const body = (marked.parse(markdown) as string)
    .replace(/<h1>/g, '<h1 style="font-size:20px;margin:0 0 12px">')
    .replace(/<h2>/g, '<h2 style="font-size:16px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px">')
    .replace(/<h3>/g, '<h3 style="font-size:15px;margin:16px 0 4px">')
    .replace(/<li>/g, '<li style="margin:0 0 6px">');
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f;max-width:680px;margin:0 auto;padding:16px">${body}</body></html>`;
  return html;
}
