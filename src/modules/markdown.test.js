import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown — XSS safety', () => {
  it('escapes script tags in plain text', () => {
    const result = renderMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes HTML in bold text', () => {
    const result = renderMarkdown('**<b>bold injection</b>**');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
    expect(result).toContain('<strong>');
  });

  it('escapes HTML in italic text', () => {
    const result = renderMarkdown('*<em>italic injection</em>*');
    expect(result).not.toContain('<em>italic');
    expect(result).toContain('&lt;em&gt;');
  });

  it('escapes HTML in link display text', () => {
    const result = renderMarkdown('[<script>x</script>](http://example.com)');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes HTML in heading text', () => {
    const result = renderMarkdown('# <img src=x onerror=alert(1)>');
    expect(result).toContain('&lt;img');
    expect(result).not.toContain('<img');
  });
});

describe('renderMarkdown — correct rendering', () => {
  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>');
    expect(renderMarkdown('## Sub')).toContain('<h2>');
  });

  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  it('renders inline code without escaping code content', () => {
    const result = renderMarkdown('`const x = 1`');
    expect(result).toContain('<code>');
    expect(result).toContain('const x = 1');
  });

  it('renders fenced code blocks with HTML escaping', () => {
    const result = renderMarkdown('```\n<div>test</div>\n```');
    expect(result).toContain('<pre>');
    expect(result).toContain('&lt;div&gt;');
    expect(result).not.toContain('<div>test</div>');
  });

  it('renders links', () => {
    const result = renderMarkdown('[click](http://example.com)');
    expect(result).toContain('<a href="http://example.com"');
    expect(result).toContain('click');
  });

  it('returns empty string for falsy input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
  });
});
