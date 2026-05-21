/**
 * Lightweight Markdown → HTML renderer.
 * Handles: headings, bold, italic, code, code blocks, blockquotes,
 * ordered/unordered lists, horizontal rules, links, and paragraphs.
 * No dependencies.
 */
export function renderMarkdown(src) {
  if (!src) return "";

  const html = [];
  const lines = src.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escapeHtml(lines[i]));
        i += 1;
      }
      i += 1; // skip closing ```
      html.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push("<hr>");
      i += 1;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      html.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[\*\-\+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\*\-\+]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^[\*\-\+]\s+/, "")));
        i += 1;
      }
      html.push(`<ul>${items.map((li) => `<li>${li}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      html.push(`<ol>${items.map((li) => `<li>${li}</li>`).join("")}</ol>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Paragraph — collect contiguous non-empty lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|[\*\-\+]\s|\d+\.\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${inline(paraLines.join(" "))}</p>`);
  }

  return html.join("\n");
}

/** Process inline markdown: bold, italic, code, links */
function inline(text) {
  return text
    // Inline code (must come before bold/italic to avoid conflicts)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Line break
    .replace(/  $/gm, "<br>");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
