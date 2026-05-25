import React from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeConnectionStatus } from '../../hooks/useActions';
import { useSyncExternalStore } from 'react';

export function ConnectionPanel() {
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const status = getConnectionStatus();

  const baseUrl = useForumState(s => s.settings?.baseUrl || 'http://127.0.0.1:1234');
  const apiKey = useForumState(s => s.settings?.apiKey || 'lm-studio');
  const model = useForumState(s => s.settings?.model || '');
  const embModel = useForumState(s => s.settings?.embeddingModel || '');
  const temperature = useForumState(s => s.settings?.temperature ?? 0.8);
  const maxTokens = useForumState(s => s.settings?.maxTokens ?? 2000);
  const topP = useForumState(s => s.settings?.topP ?? 0.95);
  const repeatPenalty = useForumState(s => s.settings?.repeatPenalty ?? 1.1);
  const streaming = useForumState(s => s.settings?.streamingEnabled !== false);
  const availableModels = useForumState(s => s.ui?.availableModels || []);
  const tokenSpeed = useForumState(s => s.ui?.tokenSpeed || null);

  const { pingConnection } = useActions();

  const updateSetting = (key, val) => mutateState(s => { s.settings[key] = val; });

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3><Ic.Plug /> LM Studio</h3>
          <span className={"badge" + (status.tone === 'ok' ? ' ok' : status.tone === 'error' ? ' err' : '')}>{status.message}</span>
        </div>
        <Field label="Server URL" info="Base URL of your LM Studio server">
          <input value={baseUrl} onChange={(e) => updateSetting('baseUrl', e.target.value)} />
        </Field>
        <Field label="API key" info="Local LM Studio ignores this — any non-empty value works">
          <input value={apiKey} onChange={(e) => updateSetting('apiKey', e.target.value)} type="password" />
        </Field>
        {tokenSpeed && <div className="card-row"><span className="lbl">Tok/s observed</span><span className="val">{tokenSpeed} tok/s</span></div>}
      </div>

      <div className="card">
        <div className="card-title"><h3>Models</h3><button className="btn sm ghost" onClick={pingConnection}>↻ Refresh</button></div>
        <Field label="Chat model" info="Used for all actor, director and system turns">
          <select value={model} onChange={(e) => updateSetting('model', e.target.value)}>
            <option value="">— select a model —</option>
            {availableModels.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Field>
        <Field label="Embedding model" hint="Optional — improves memory recall">
          <select value={embModel} onChange={(e) => updateSetting('embeddingModel', e.target.value)}>
            <option value="">— fall back to chat model —</option>
            {availableModels.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Field>
      </div>

      <div className="card">
        <div className="card-title"><h3>Generation</h3></div>
        <Field label="Temperature" info="Default actor creativity. Individual actors can override.">
          <Range value={temperature} onChange={(v) => updateSetting('temperature', v)} min={0} max={2} step={0.05} />
        </Field>
        <Field label="Max tokens / response">
          <Range value={maxTokens} onChange={(v) => updateSetting('maxTokens', v)} min={200} max={8000} step={100} format={(v) => `${v}`} />
        </Field>
        <Field label="Top-P (nucleus)">
          <Range value={topP} onChange={(v) => updateSetting('topP', v)} min={0.1} max={1} step={0.05} />
        </Field>
        <Field label="Repeat penalty">
          <Range value={repeatPenalty} onChange={(v) => updateSetting('repeatPenalty', v)} min={1} max={1.5} step={0.05} />
        </Field>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <Toggle checked={streaming} onChange={(v) => updateSetting('streamingEnabled', v)} label="Streaming" />
        </div>
      </div>
    </div>
  );
}
