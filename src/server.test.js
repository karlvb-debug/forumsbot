// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cleanBaseUrl, isBlockedUrl, isPrivateIp } from '../server.js';

describe('cleanBaseUrl', () => {
  it('appends /v1 to a bare host', () => {
    expect(cleanBaseUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1');
  });

  it('adds http:// when the scheme is missing', () => {
    expect(cleanBaseUrl('127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1');
  });

  it('keeps an existing /v1 suffix', () => {
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
  });

  it('strips endpoint paths users paste in', () => {
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1/chat/completions')).toBe('http://127.0.0.1:1234/v1');
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1/models')).toBe('http://127.0.0.1:1234/v1');
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1/embeddings')).toBe('http://127.0.0.1:1234/v1');
  });

  it('strips query strings and trailing slashes', () => {
    expect(cleanBaseUrl('http://127.0.0.1:1234/?key=x')).toBe('http://127.0.0.1:1234/v1');
  });

  it('defaults when empty', () => {
    expect(cleanBaseUrl('')).toBe('http://127.0.0.1:1234/v1');
  });
});

describe('isBlockedUrl', () => {
  it('allows ordinary public http(s) URLs', () => {
    expect(isBlockedUrl('https://example.com/page')).toBe(false);
    expect(isBlockedUrl('http://93.184.216.34/')).toBe(false);
  });

  it('blocks non-http protocols', () => {
    expect(isBlockedUrl('file:///etc/passwd')).toBe(true);
    expect(isBlockedUrl('ftp://example.com')).toBe(true);
    expect(isBlockedUrl('gopher://example.com')).toBe(true);
  });

  it('blocks malformed URLs', () => {
    expect(isBlockedUrl('not a url')).toBe(true);
    expect(isBlockedUrl('')).toBe(true);
  });

  it('blocks loopback in all spellings', () => {
    expect(isBlockedUrl('http://localhost/')).toBe(true);
    expect(isBlockedUrl('http://127.0.0.1:1234/')).toBe(true);
    expect(isBlockedUrl('http://127.9.8.7/')).toBe(true);
    expect(isBlockedUrl('http://[::1]/')).toBe(true);
  });

  it('blocks private IPv4 ranges', () => {
    expect(isBlockedUrl('http://10.0.0.5/')).toBe(true);
    expect(isBlockedUrl('http://172.16.0.1/')).toBe(true);
    expect(isBlockedUrl('http://172.31.255.1/')).toBe(true);
    expect(isBlockedUrl('http://192.168.1.1/')).toBe(true);
    expect(isBlockedUrl('http://169.254.169.254/')).toBe(true); // cloud metadata
    expect(isBlockedUrl('http://0.0.0.0/')).toBe(true);
  });

  it('allows public IPv4 near private boundaries', () => {
    expect(isBlockedUrl('http://172.15.0.1/')).toBe(false);
    expect(isBlockedUrl('http://172.32.0.1/')).toBe(false);
    expect(isBlockedUrl('http://11.0.0.1/')).toBe(false);
  });

  it('blocks IPv6 link-local and unique-local literals', () => {
    expect(isBlockedUrl('http://[fe80::1]/')).toBe(true);
    expect(isBlockedUrl('http://[fc00::1]/')).toBe(true);
    expect(isBlockedUrl('http://[fd12:3456::1]/')).toBe(true);
  });

  it('blocks .local and .internal hostnames', () => {
    expect(isBlockedUrl('http://printer.local/')).toBe(true);
    expect(isBlockedUrl('http://db.internal/')).toBe(true);
  });
});

describe('isPrivateIp', () => {
  it('flags loopback and unspecified', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.254')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  it('flags RFC1918 and link-local ranges', () => {
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.9.9')).toBe(true);
    expect(isPrivateIp('192.168.0.10')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true);
  });

  it('flags IPv6 private ranges including v4-mapped', () => {
    expect(isPrivateIp('fe80::abcd')).toBe(true);
    expect(isPrivateIp('fd00::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('passes public addresses', () => {
    expect(isPrivateIp('93.184.216.34')).toBe(false);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700::6810:84e5')).toBe(false);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });
});
