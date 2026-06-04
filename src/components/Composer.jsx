import React, { useState, useRef, useCallback } from 'react';
import * as Ic from './Icons';
import { useForumState, mutateState } from '../hooks/useForumState';
import { useActions, getBusy, getBusyVersion, subscribeBusy } from '../hooks/useActions';
import { useSyncExternalStore } from 'react';
import { addMessage } from '../modules/turns.js';

export function Composer({ showThoughts, onToggleThoughts }) {
  const [text, setText] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const taRef = useRef(null);

  const toolsEnabled = useForumState(s => !!s.settings?.toolsEnabled);
  const autoRunning = useForumState(s => s.autoRunning);
  const continueMode = useForumState(s => s.ui?.continueMode || 'next');

  const { continueConversation, sendMessage } = useActions();

  // Subscribe to busy state
  useSyncExternalStore(subscribeBusy, getBusyVersion);
  const busy = getBusy();

  const autoresize = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(200, el.scrollHeight) + 'px';
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    const outgoing = text.trim();
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    if (outgoing) {
      await sendMessage(outgoing);
    }
    // Auto consumes new user messages in its normal loop. When idle, composer
    // submit advances according to the selected continuation mode.
    if (!autoRunning && !getBusy()) await continueConversation();
  }, [text, sendMessage, continueConversation, autoRunning]);

  const handleToggleTools = useCallback(() => {
    mutateState(s => { s.settings.toolsEnabled = !s.settings.toolsEnabled; });
  }, []);

  const handleSubmitNote = useCallback(async () => {
    const note = noteText.trim();
    if (!note) return;
    await addMessage({ type: 'system', speaker: 'Moderator', content: '📌 ' + note, color: '#666' });
    setNoteText('');
    setNoteOpen(false);
  }, [noteText]);

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {noteOpen && (
        <div className="composer-note-row" style={{ display: 'flex', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            style={{ flex: 1, fontSize: 13 }}
            placeholder="Moderator note…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleSubmitNote(); }
              if (e.key === 'Escape') { setNoteOpen(false); setNoteText(''); }
            }}
          />
          <button type="button" className="chip-btn" onClick={handleSubmitNote} disabled={!noteText.trim()}>
            Post
          </button>
          <button type="button" className="chip-btn" onClick={() => { setNoteOpen(false); setNoteText(''); }}>
            Cancel
          </button>
        </div>
      )}
      <div className="composer-inner">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.target.value); autoresize(e.target); }}
          placeholder="Join the forum — Enter sends, empty Enter continues…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (e.metaKey || e.ctrlKey) {
              // Cmd/Ctrl+Enter follows the selected continuation mode too.
              if (!text.trim()) { e.preventDefault(); if (!busy) continueConversation(); }
              else handleSubmit(e);
            } else if (!e.shiftKey) {
              // Plain Enter: send if there's text, else continue with the selected mode.
              e.preventDefault();
              if (text.trim()) handleSubmit(e);
              else if (!busy) continueConversation();
            }
          }}
        />
        <div className="composer-row">
          <button
            type="button"
            className={"chip-btn" + (showThoughts ? " active" : "")}
            onClick={onToggleThoughts}
            title="Show actors' private thoughts"
          >
            <Ic.Eye width={12} height={12} /> Thoughts
          </button>
          <button
            type="button"
            className={"chip-btn" + (toolsEnabled ? " active" : "")}
            onClick={handleToggleTools}
            title="Allow researcher actors to search the web"
          >
            <Ic.Globe width={12} height={12} /> Tools
          </button>
          <button
            type="button"
            className={"chip-btn" + (noteOpen ? " active" : "")}
            onClick={() => setNoteOpen(v => !v)}
            title="Inject a moderator note into the transcript"
          >
            📌 Note
          </button>
          <span className="grow" />
          <button
            type="submit"
            className="send-btn"
            title={text.trim() ? `Send then continue via ${continueMode}` : `Continue via ${continueMode} (Enter)`}
            disabled={!text.trim() && busy}
          >
            <Ic.Send width={13} height={13} /> {text.trim() ? 'Send' : 'Continue'}
            <span className="kbd">↵</span>
          </button>
        </div>
      </div>
    </form>
  );
}
