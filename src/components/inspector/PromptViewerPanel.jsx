import React, { useState } from 'react';
import { useForumState } from '../../hooks/useForumState';
import { getLastPromptParts } from '../../modules/turns.js';

const SECTION_ORDER = [
  ['system', 'System'],
  ['persona', 'Persona'],
  ['scenario', 'Scenario'],
  ['proceduralMemory', 'Procedural Memory'],
  ['workMemory', 'Work Memory'],
  ['recentMessages', 'Recent Messages'],
  ['toolLogs', 'Tool Logs'],
];

export function PromptViewerPanel() {
  const [copiedSection, setCopiedSection] = useState(null);

  // Re-render on any state change so prompt viewer updates after each turn
  useForumState(s => s.messages?.length);

  const parts = getLastPromptParts();

  const handleCopySection = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(key);
      setTimeout(() => setCopiedSection(null), 1500);
    } catch {
      // clipboard not available
    }
  };

  const handleCopyAll = async () => {
    if (!parts) return;
    const allText = SECTION_ORDER
      .filter(([key]) => parts[key]?.trim())
      .map(([key, label]) => `=== ${label} ===\n${parts[key]}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(allText);
      setCopiedSection('_all');
      setTimeout(() => setCopiedSection(null), 1500);
    } catch {
      // clipboard not available
    }
  };

  if (!parts) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-mute)', fontSize: 13 }}>
        Run a turn to see the last assembled prompt.
      </div>
    );
  }

  const sections = SECTION_ORDER.filter(([key]) => parts[key]?.trim());

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, paddingRight: 4 }}>
        <button className="btn sm" onClick={handleCopyAll}>
          {copiedSection === '_all' ? '✓ Copied' : '📋 Copy all'}
        </button>
      </div>
      {sections.map(([key, label]) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </span>
            <button
              className="btn sm"
              style={{ fontSize: 11, padding: '1px 6px' }}
              onClick={() => handleCopySection(key, parts[key])}
            >
              {copiedSection === key ? '✓' : '📋'}
            </button>
          </div>
          <pre style={{
            margin: 0,
            padding: '8px 10px',
            background: 'var(--bg-raised, rgba(0,0,0,0.2))',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--fg)',
            border: '1px solid var(--border)',
            maxHeight: 300,
            overflowY: 'auto',
          }}>
            {parts[key]}
          </pre>
        </div>
      ))}
    </div>
  );
}
