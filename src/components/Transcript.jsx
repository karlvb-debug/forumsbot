import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState } from '../hooks/useForumState';
import { useStreaming } from '../hooks/useStreaming';
import { renderMarkdown } from '../modules/markdown.js';
import { PauseCard } from './PauseCard';

const THOUGHT_COLLAPSE_THRESHOLD = 150;
const THOUGHT_PREVIEW_LENGTH = 80;
const MSG_COLLAPSE_WORDS = 250;
const MSG_PREVIEW_WORDS = 80;

function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

// Display-layer sanitizer. Actor output is a JSON envelope and tools are
// text-tags ([SEARCH:]/[READ:]) that belong in the thought stream — but
// legacy data and the occasional malformed parse leak envelope syntax into
// the visible message. Strip the unambiguous artifacts before rendering.
function cleanMessageText(raw) {
  if (!raw) return '';
  let t = String(raw);
  // Tool-invocation tags — never render as prose
  t = t.replace(/\[(?:SEARCH|READ|FETCH|TOOL)\s*:[^\]]*\]/gi, ' ');
  // Trailing malformed-JSON tail: ...Story Idea 1. ");""Geophysics","Bio"]}  →  ...Story Idea 1.
  t = t.replace(/\s*"\s*\)\s*;[\s\S]*[\]}]\s*$/, '');
  // Orphaned JSON key/colon tail: ...premise. ":[  →  ...premise.
  t = t.replace(/\s*"\s*:\s*\[?\s*$/, '');
  // Trailing JSON close right after a quote: ...text"]}  →  ...text
  t = t.replace(/"\s*[\]}]+\s*$/, '');
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

const MessageCard = React.memo(function MessageCard({ msg, actor, showThoughts, onAnchor, onFeedback, onFork }) {
  const [thoughtExpanded, setThoughtExpanded] = useState(false);
  const [msgExpanded, setMsgExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!actor) return null;

  if (msg.type === 'pause') {
    return <PauseCard msg={msg} />;
  }

  const timeStr = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : msg.time || '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || msg.text || msg.message || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };

  if (msg.type === 'skip') {
    return (
      <article className="msg">
        <span className="swatch" style={{ background: actor.color }}>{(actor.name || '?')[0]}</span>
        <div className="msg-body">
          <div className="msg-head">
            <span className="msg-name">{actor.name}</span>
            <span className="msg-role">{actor.role}</span>
            <span className="msg-time">{timeStr}</span>
          </div>
          <div className="skipped">— skip — {msg.content || msg.text || msg.reason || ''}</div>
        </div>
      </article>
    );
  }

  // Parse thought from AI JSON envelope
  let thought = msg.thought || null;
  let text = cleanMessageText(msg.content || msg.text || msg.message || '');

  // Message collapse: >250 words collapses to 80
  const totalWords = wordCount(text);
  const isLongMsg = totalWords > MSG_COLLAPSE_WORDS;
  const displayText = isLongMsg && !msgExpanded
    ? text.trim().split(/\s+/).slice(0, MSG_PREVIEW_WORDS).join(' ') + '…'
    : text;

  // Tool calls display
  const toolCalls = msg.toolCalls || [];

  const typeClass = msg.type === 'user' ? ' msg--user' : msg.type === 'dm' ? ' msg--dm' : '';

  return (
    <article className={'msg' + typeClass}>
      <span className="swatch" style={{ background: actor.color }}>{(actor.name || '?')[0]}</span>
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name">{actor.name}</span>
          <span className="msg-role">{actor.role}</span>
          <span className="msg-time">{timeStr}</span>
          {msg.anchored && (
            <span title="Anchored" style={{ color: "var(--info)", fontSize: 12 }}>
              <Ic.Anchor width={12} height={12} />
            </span>
          )}
        </div>

        {toolCalls.length > 0 && toolCalls.map((tc, i) => (
          <div className="tool-call" key={i} style={{ marginBottom: 8 }}>
            <div className="tc-head">⌕ {tc.tool}{tc.query ? ` · "${tc.query}"` : ''}{tc.domain ? ` → ${tc.domain}` : ''}</div>
          </div>
        ))}

        <div className="msg-text md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }} />
        {isLongMsg && (
          <button
            className="chip-btn"
            style={{ fontSize: 11, marginTop: 2 }}
            onClick={() => setMsgExpanded(v => !v)}
          >
            {msgExpanded ? 'Show less' : `Show more (${totalWords}w)`}
          </button>
        )}

        {thought && showThoughts && (() => {
          const isLong = thought.length > THOUGHT_COLLAPSE_THRESHOLD;
          const displayText = isLong && !thoughtExpanded
            ? thought.slice(0, THOUGHT_PREVIEW_LENGTH) + '…'
            : thought;
          return (
            <div className="thought">
              <span className="thought-label">private</span>
              <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }} />
              {isLong && (
                <button
                  className="chip-btn"
                  style={{ fontSize: 11, marginTop: 2 }}
                  onClick={() => setThoughtExpanded(v => !v)}
                >
                  {thoughtExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          );
        })()}

        <div className="msg-actions">
          <button
            title={copied ? 'Copied!' : 'Copy message'}
            style={{ opacity: copied ? 1 : undefined }}
            onClick={handleCopy}
          >
            {copied ? '✓' : '📋'}
          </button>
          <button className={msg.feedback === "up" ? "active" : ""} title="Helpful" onClick={() => onFeedback?.(msg.id, "up")}>👍</button>
          <button className={msg.feedback === "down" ? "active" : ""} title="Unhelpful" onClick={() => onFeedback?.(msg.id, "down")}>👎</button>
          <button
            className={msg.anchored ? "active" : ""}
            title="Anchor this claim"
            onClick={() => onAnchor?.(msg.id)}
          >
            <Ic.Anchor width={13} height={13} />
          </button>
          <button title="Fork from here" onClick={() => onFork?.(msg.id)}>⑂</button>
        </div>
      </div>
    </article>
  );
});

function StreamingBubble({ streaming, showThoughts }) {
  if (!streaming) return null;
  const hasThought = !!streaming.thought;
  const hasMessage = !!streaming.message;

  // Status label in the header changes with phase
  const statusLabel = hasMessage ? 'writing…' : hasThought ? 'thinking…' : 'sending…';

  return (
    <article className="msg streaming">
      <span className="swatch" style={{ background: streaming.color || 'var(--fg-mute)' }}>
        {(streaming.speaker || '?')[0]}
      </span>
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name">{streaming.speaker}</span>
          <span className="msg-role streaming-status-label">{statusLabel}</span>
        </div>

        {/* ── Thought phase ── visible until message begins */}
        {hasThought && !hasMessage && (
          showThoughts
            ? <div className="msg-text streaming-thought-live">{streaming.thought}<span className="cursor-blink">▊</span></div>
            : <div className="streaming-thinking-pill"><span className="streaming-thinking-dot" />Thinking…</div>
        )}

        {/* ── Message phase ── thought collapses to a summary pill */}
        {hasMessage && (
          <>
            {showThoughts && hasThought && (
              <details className="streaming-thought-summary">
                <summary>💭 {streaming.thought.trim().split(/\s+/).filter(Boolean).length}w of reasoning</summary>
                <div className="streaming-thought-summary-body">{streaming.thought}</div>
              </details>
            )}
            <div className="msg-text md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming.message) }} />
            <span className="cursor-blink">▊</span>
          </>
        )}

        {/* ── Preamble: nothing received yet ── */}
        {!hasThought && !hasMessage && (
          <div className="msg-text"><span className="cursor-blink">▊</span></div>
        )}
      </div>
    </article>
  );
}

function RoundDivider({ round, time }) {
  return (
    <div className="round-divider">
      Round {round}{time ? ` · ${time}` : ''}
    </div>
  );
}

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export function Transcript({ showThoughts }) {
  const messages = useForumState(s => s.messages || []);
  const actors = useForumState(s => s.actors || []);
  const autoRunning = useForumState(s => s.autoRunning);
  const contextInfo = useForumState(s => s.contextInfo || {});
  const streaming = useStreaming();

  // Context-window usage meter (moved here from the composer)
  const promptTokens = contextInfo.lastPromptTokens || 0;
  const maxCtx = contextInfo.maxContextLength || 0;
  const tokenPct = maxCtx > 0 ? Math.min(100, (promptTokens / maxCtx) * 100) : 0;

  const scrollRef = useRef(null);
  const wasAtBottomRef = useRef(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const matchRefs = useRef([]);

  // Build actor lookup map (by id and by name)
  const actorMap = useMemo(() => {
    const m = new Map();
    actors.forEach(a => {
      m.set(a.id, a);
      m.set(a.name, a);
    });
    return m;
  }, [actors]);

  // Group messages by round and insert dividers
  const displayItems = useMemo(() => {
    const items = [];
    let lastRound = 0;
    messages.forEach(msg => {
      const round = msg.round || 0;
      if (round > lastRound && round > 0) {
        const time = msg.createdAt
          ? new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : '';
        items.push({ type: 'divider', round, time, id: `divider-${round}` });
        lastRound = round;
      }
      items.push({ type: 'message', msg, id: msg.id });
    });
    return items;
  }, [messages]);

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll when new messages arrive or streaming updates
  useEffect(() => {
    const el = scrollRef.current;
    if (el && wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streaming?.text]);

  // Memoized so high-frequency streaming re-renders don't re-scan all messages.
  const turnCount = useMemo(() => messages.filter(m => m.type !== 'skip' && m.type !== 'system').length, [messages]);
  const anchoredCount = useMemo(() => messages.filter(m => m.anchored).length, [messages]);

  // Search: IDs of messages matching the query
  const searchLower = searchQuery.toLowerCase().trim();
  const matchIds = useMemo(() => {
    if (!searchLower) return [];
    return messages
      .filter(m => (m.content || m.text || m.message || '').toLowerCase().includes(searchLower))
      .map(m => m.id);
  }, [messages, searchLower]);

  // Scroll to current match
  useEffect(() => {
    if (!matchIds.length) return;
    const idx = Math.min(searchMatchIdx, matchIds.length - 1);
    const el = matchRefs.current[matchIds[idx]];
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matchIds, searchMatchIdx]);

  // Ctrl+F / Cmd+F to open search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(v => !v);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // Stable handler identities so the memoized MessageCard list does not
  // re-render on every streaming token. None close over render-scope values.
  const onAnchor = useCallback((msgId) => {
    mutateState(s => {
      const msg = s.messages.find(m => m.id === msgId);
      if (msg) {
        msg.anchored = !msg.anchored;
        if (msg.anchored) {
          if (!s.anchors) s.anchors = [];
          if (!s.anchors.some(a => a.messageId === msgId)) {
            s.anchors.push({
              id: 'ank-' + Date.now(),
              text: msg.content || msg.text || msg.message || '',
              source: msg.speaker || 'Unknown',
              createdAt: new Date().toISOString(),
              messageId: msgId,
            });
          }
        } else {
          s.anchors = (s.anchors || []).filter(a => a.messageId !== msgId);
        }
      }
    });
  }, []);

  const onFeedback = useCallback((msgId, value) => {
    mutateState(s => {
      const msg = s.messages.find(m => m.id === msgId);
      if (msg) msg.feedback = msg.feedback === value ? "" : value;
    });
  }, []);

  const onFork = useCallback(async (msgId) => {
    const session = await import('../modules/session.js');
    await session.forkSessionAtMessage(msgId);
  }, []);

  return (
    <div className="transcript" ref={scrollRef}>
      <div className="transcript-header">
        <div className="transcript-meta">
          <span>● {autoRunning ? 'Auto running' : `${turnCount} turns`}</span>
          <span className="sep" />
          <span>{anchoredCount} anchored</span>
          {maxCtx > 0 && (
            <span className="token-meter" title="Tokens used in last prompt vs context window">
              <span className="sep" />
              <span>{formatTokens(promptTokens)} / {formatTokens(maxCtx)}</span>
              <div className="token-bar"><div style={{ width: `${tokenPct}%` }} /></div>
            </span>
          )}
          <button
            className="chip-btn"
            style={{ marginLeft: 'auto', fontSize: 11 }}
            title="Search transcript (Ctrl+F)"
            onClick={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery(''); }}
          >
            🔍
          </button>
        </div>

        {searchOpen && (
          <div className="transcript-search">
            <input
              autoFocus
              className="search-input"
              placeholder="Search messages…"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchMatchIdx(0); }}
            />
            {searchLower && (
              <span className="search-count">
                {matchIds.length ? `${Math.min(searchMatchIdx + 1, matchIds.length)}/${matchIds.length}` : '0'}
              </span>
            )}
            {matchIds.length > 1 && (
              <>
                <button className="chip-btn" onClick={() => setSearchMatchIdx(i => (i - 1 + matchIds.length) % matchIds.length)}>↑</button>
                <button className="chip-btn" onClick={() => setSearchMatchIdx(i => (i + 1) % matchIds.length)}>↓</button>
              </>
            )}
            <button className="chip-btn" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>✕</button>
          </div>
        )}
      </div>

      {displayItems.map(item => {
        if (item.type === 'divider') {
          return <RoundDivider key={item.id} round={item.round} time={item.time} />;
        }
        const msg = item.msg;
        const actor = actorMap.get(msg.actorId) || actorMap.get(msg.speaker) || {
          name: msg.speaker || 'System',
          role: msg.type === 'dm' ? 'Director' : msg.type === 'user' ? 'You' : '',
          color: msg.color || '#9aa0a6',
        };
        const isSearchMatch = searchLower && matchIds.includes(msg.id);
        const isActiveMatch = isSearchMatch && matchIds[Math.min(searchMatchIdx, matchIds.length - 1)] === msg.id;
        return (
          <div
            key={item.id}
            ref={el => { if (el) matchRefs.current[msg.id] = el; else delete matchRefs.current[msg.id]; }}
            className={isActiveMatch ? 'search-match-active' : isSearchMatch ? 'search-match' : undefined}
          >
            <MessageCard
              msg={msg}
              actor={actor}
              showThoughts={showThoughts}
              onAnchor={onAnchor}
              onFeedback={onFeedback}
              onFork={onFork}
            />
          </div>
        );
      })}

      <StreamingBubble streaming={streaming} showThoughts={showThoughts} />

      {!messages.length && !streaming && (
        <div className="empty-transcript">
          <div className="empty-transcript-icon">💬</div>
          <div className="empty-transcript-text">No messages yet</div>
          <div className="empty-transcript-hint">Send a message or press Next to start</div>
        </div>
      )}
    </div>
  );
}
