import React, { useState } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Seg } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';

export function ScenarioPanel() {
  const [quickStartBusy, setQuickStartBusy] = useState(false);
  const mode = useForumState(s => s.scenario?.mode || 'problem');
  const title = useForumState(s => s.scenario?.title || '');
  const premise = useForumState(s => s.scenario?.premise || '');
  const objective = useForumState(s => s.scenario?.objective || '');
  const quickStartPrompt = useForumState(s => s.ui?.quickStartPrompt || '');
  const quickStartStatus = useForumState(s => s.ui?.quickStartStatus || '');
  const quickStartDraft = useForumState(s => s.ui?.quickStartDraft || null);
  const quickStartHistory = useForumState(s => s.ui?.quickStartHistory || []);

  const updateScenario = (key, val) => mutateState(s => { s.scenario[key] = val; });
  const updateQuickStartPrompt = (val) => mutateState(s => { s.ui.quickStartPrompt = val; });

  const runQuickStart = async () => {
    setQuickStartBusy(true);
    try {
      const session = await import('../../modules/session.js');
      await session.generateQuickStart(quickStartPrompt);
    } finally {
      setQuickStartBusy(false);
    }
  };

  const applyQuickStart = async () => {
    setQuickStartBusy(true);
    try {
      const session = await import('../../modules/session.js');
      await session.applyQuickStartConfig();
    } finally {
      setQuickStartBusy(false);
    }
  };

  const clearQuickStart = async () => {
    const session = await import('../../modules/session.js');
    session.discardQuickStartConfig();
  };

  return (
    <div>
      <div className="card">
        <div className="card-title"><h3><Ic.Target /> Mode</h3></div>
        <Seg full
          options={[
            { value: "problem", label: "Problem" },
            { value: "story", label: "Story" },
            { value: "freeform", label: "Freeform" },
          ]}
          value={mode} onChange={(v) => updateScenario('mode', v)}
        />
        <div className="field-hint" style={{ marginTop: 8 }}>
          {mode === "problem" && "Collaborative problem-solving — actors analyze, challenge assumptions, converge on solutions."}
          {mode === "story" && "Narrative roleplay — actors speak in character; web tools disabled."}
          {mode === "freeform" && "Open-ended discussion — no structured goal; actors explore freely."}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><h3>Anchor</h3><span className="badge">non-compressible</span></div>
        <Field label="Title">
          <input value={title} onChange={(e) => updateScenario('title', e.target.value)} />
        </Field>
        <Field label="Premise" info="The backstory that grounds every actor prompt">
          <textarea rows={4} value={premise} onChange={(e) => updateScenario('premise', e.target.value)} />
        </Field>
        <Field label="Objective" info="Used for drift scoring and the auto-stop goal judge">
          <textarea rows={3} value={objective} onChange={(e) => updateScenario('objective', e.target.value)} />
        </Field>
      </div>

      <div className="card" id="aiAssistantPanel">
        <div className="card-title"><h3><Ic.Bolt /> Quick Setup</h3></div>
        <div className="field-hint">Describe the forum you want in plain English. The AI generates scenario, actors and a memory seed.</div>
        <div style={{ height: 8 }} />
        <textarea
          id="aiAssistantInput"
          rows={3}
          value={quickStartPrompt}
          onChange={(e) => updateQuickStartPrompt(e.target.value)}
          placeholder="e.g. 'Three scientists debating climate policy' — or 'Add a lawyer and remove the Skeptic'…"
        />
        <div className="quick-chat" id="aiAssistantChat" aria-live="polite">
          {quickStartHistory.map((entry, index) => (
            <div key={index} className={"quick-chat-msg " + (entry.role === "user" ? "user" : "assistant")}>
              <div>{entry.role === "user" ? entry.content : (entry.message || entry.type || "Updated setup.")}</div>
              {entry.type && entry.type !== "chat" && entry.type !== "error" ? (
                <span className="badge">{entry.type === "patch" ? "Applied" : "Preview ready"}</span>
              ) : null}
            </div>
          ))}
        </div>
        {quickStartStatus ? <div className="field-hint" id="aiAssistantStatus">{quickStartStatus}</div> : <div className="field-hint" id="aiAssistantStatus" />}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button
            className="btn primary"
            id="aiAssistantSendBtn"
            onClick={runQuickStart}
            disabled={quickStartBusy || !quickStartPrompt.trim()}
          >
            {quickStartBusy ? "Generating..." : "Generate"}
          </button>
          {quickStartDraft ? (
            <button className="btn" id="aiAssistantApplyBtn" onClick={applyQuickStart} disabled={quickStartBusy}>
              Apply Setup
            </button>
          ) : (
            <button className="btn hidden-file" id="aiAssistantApplyBtn" type="button" hidden>Apply Setup</button>
          )}
          <button className="btn ghost" onClick={clearQuickStart} disabled={quickStartBusy}>Clear</button>
        </div>
      </div>
    </div>
  );
}
