import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
  gfm: true,
  breaks: true,
  renderer: (() => {
    const r = new marked.Renderer();
    // Open links in a new tab safely
    r.link = ({ href, title, text }) =>
      `<a href="${href}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
    return r;
  })(),
});

export function renderMarkdown(src) {
  if (!src) return '';
  const raw = marked.parse(src);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'hr', 'img',
      'input',   // task-list checkboxes
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'class', 'type', 'checked', 'disabled'],
  });
}
