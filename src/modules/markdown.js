import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      return `<a href="${token.href}"${token.title ? ` title="${token.title}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    html(token) {
      return (token.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }
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
