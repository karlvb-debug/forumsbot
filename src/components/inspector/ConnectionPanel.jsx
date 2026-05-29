import React, { useState } from 'react';
import * as Ic from '../Icons';
import { Field, Toggle, Range } from '../shared/FormControls';
import { useForumState, mutateState } from '../../hooks/useForumState';
import { isEmbeddingModel } from '../../modules/api.js';
import { useActions, getConnectionStatus, getConnectionStatusVersion, subscribeConnectionStatus } from '../../hooks/useActions';
import { useSyncExternalStore } from 'react';

const PROVIDERS = {
  'lm-studio': {
    label: 'LM Studio',
    local: true,
    defaultUrl: 'http://127.0.0.1:1234',
    defaultKey: 'lm-studio',
    urlLabel: 'Server URL',
    urlHint: 'Base URL of your local LM Studio server',
    keyLabel: 'API key',
    keyHint: 'LM Studio ignores this — any non-empty value works',
    suggestedModels: [],
    supportsEmbeddings: true,
  },
  'ollama': {
    label: 'Ollama',
    local: true,
    defaultUrl: 'http://127.0.0.1:11434',
    defaultKey: '',
    urlLabel: 'Ollama URL',
    urlHint: 'Base URL of your local Ollama server',
    keyLabel: 'API key',
    keyHint: 'Ollama does not require an API key',
    suggestedModels: [],
    supportsEmbeddings: true,
  },
  'openai': {
    label: 'OpenAI',
    local: false,
    defaultUrl: 'https://api.openai.com',
    defaultKey: '',
    urlLabel: 'Base URL',
    urlHint: 'Leave as default unless routing through a proxy',
    keyLabel: 'OpenAI API key',
    keyHint: 'platform.openai.com/api-keys',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini', 'o3-mini'],
    suggestedEmbeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'],
    supportsEmbeddings: true,
    warning: 'Requests and actor content will be sent to OpenAI servers. Auto-run can consume many tokens quickly — watch your usage.',
  },
  'gemini': {
    label: 'Gemini',
    local: false,
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultKey: '',
    urlLabel: 'Base URL',
    urlHint: 'OpenAI-compatible Gemini endpoint — usually leave as default',
    keyLabel: 'Gemini API key',
    keyHint: 'aistudio.google.com — free tier available',
    suggestedModels: ['gemini-2.0-flash', 'gemini-2.0-pro-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    suggestedEmbeddingModels: [],
    supportsEmbeddings: false,
    warning: 'Requests and actor content will be sent to Google servers. Embeddings are not supported — memory recall falls back to keyword matching.',
  },
  'huggingface': {
    label: 'Hugging Face',
    local: false,
    defaultUrl: '',
    defaultKey: '',
    urlLabel: 'Endpoint URL',
    urlHint: 'Your TGI Inference Endpoint URL (must be OpenAI-compatible)',
    keyLabel: 'HF API token',
    keyHint: 'huggingface.co/settings/tokens',
    suggestedModels: [],
    supportsEmbeddings: false,
    warning: 'Requests will be sent to your Hugging Face endpoint. Embeddings are not supported — memory recall falls back to keyword matching.',
  },
  'custom': {
    label: 'Custom',
    local: false,
    defaultUrl: '',
    defaultKey: '',
    urlLabel: 'Base URL',
    urlHint: 'Any OpenAI-compatible API endpoint',
    keyLabel: 'API key',
    keyHint: 'API key for your endpoint',
    suggestedModels: [],
    supportsEmbeddings: false,
    warning: null,
  },
};

export function ConnectionPanel() {
  useSyncExternalStore(subscribeConnectionStatus, getConnectionStatusVersion);
  const status = getConnectionStatus();

  const provider = useForumState(s => s.settings?.provider || 'lm-studio');
  const baseUrl = useForumState(s => s.settings?.baseUrl || '');
  const apiKey = useForumState(s => s.settings?.apiKey || '');
  const model = useForumState(s => s.settings?.model || '');
  const embModel = useForumState(s => s.settings?.embeddingModel || '');
  const temperature = useForumState(s => s.settings?.temperature ?? 0.8);
  const maxTokens = useForumState(s => s.settings?.maxTokens ?? 2000);
  const topP = useForumState(s => s.settings?.topP ?? 0.95);
  const repeatPenalty = useForumState(s => s.settings?.repeatPenalty ?? 1.1);
  const streaming = useForumState(s => s.settings?.streamingEnabled !== false);
  const availableModels = useForumState(s => s.ui?.availableModels || []);
  const chatModels = useForumState(s => s.ui?.chatModels || []);
  const embeddingModels = useForumState(s => s.ui?.embeddingModels || []);
  const tokenSpeed = useForumState(s => s.ui?.tokenSpeed || null);
  const modelIsEmbedding = isEmbeddingModel(model);
  const embeddingProbe = useForumState(s => s.ui?.embeddingProbeResult || null);

  const [loadingModel, setLoadingModel] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const { pingConnection } = useActions();

  const handleLoadModel = async (identifier) => {
    setLoadingModel(identifier);
    setLoadError(null);
    try {
      const { loadLmStudioModel, loadModels } = await import('../../modules/api.js');
      await loadLmStudioModel(identifier);
      await loadModels();
      mutateState(s => { s.settings.model = identifier; });
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoadingModel(null);
    }
  };

  const cfg = PROVIDERS[provider] || PROVIDERS['custom'];

  const updateSetting = (key, val) => mutateState(s => { s.settings[key] = val; });

  const switchProvider = (p) => {
    const c = PROVIDERS[p] || PROVIDERS['custom'];
    mutateState(s => {
      s.settings.provider = p;
      s.settings.baseUrl = c.defaultUrl;
      s.settings.apiKey = c.defaultKey;
      s.settings.model = '';
      s.settings.embeddingModel = '';
      s.ui.availableModels = [];
      s.ui.embeddingProbeResult = null;
    });
  };

  // For cloud providers, model is a combobox (type OR pick from suggestions)
  // For local, it's a dropdown populated by pingConnection
  const isLocal = cfg.local;
  const hasSuggestions = (cfg.suggestedModels || []).length > 0;
  const hasEmbSuggestions = (cfg.suggestedEmbeddingModels || []).length > 0;

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3><Ic.Plug /> Provider</h3>
          <span className={"badge" + (status.tone === 'ok' ? ' ok' : status.tone === 'error' ? ' err' : '')}>{status.message}</span>
        </div>

        <Field label="Provider">
          <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
            <optgroup label="Local (private)">
              <option value="lm-studio">LM Studio</option>
              <option value="ollama">Ollama</option>
            </optgroup>
            <optgroup label="Cloud (sends data externally)">
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="huggingface">Hugging Face</option>
              <option value="custom">Custom / Other</option>
            </optgroup>
          </select>
        </Field>

        {cfg.warning && (
          <div className="provider-warning">
            <span>⚠</span> {cfg.warning}
          </div>
        )}

        <Field label={cfg.urlLabel} info={cfg.urlHint}>
          <input value={baseUrl} onChange={(e) => updateSetting('baseUrl', e.target.value)} placeholder={cfg.defaultUrl || 'https://...'} />
        </Field>
        <Field label={cfg.keyLabel} info={cfg.keyHint}>
          <input value={apiKey} onChange={(e) => updateSetting('apiKey', e.target.value)} type="password" placeholder={cfg.local ? '' : 'sk-...'} />
        </Field>

        {tokenSpeed && <div className="card-row"><span className="lbl">Tok/s observed</span><span className="val">{tokenSpeed} tok/s</span></div>}
      </div>

      {isLocal && status.tone === 'error' && (
        <div className="card getting-started-card">
          <div className="card-title"><h3>Getting Started</h3></div>
          <ol className="getting-started-steps">
            <li>Open <strong>LM Studio</strong> on this computer</li>
            <li>Go to <strong>Models</strong> and download a model (e.g. Mistral 7B)</li>
            <li>Click <strong>Load Model</strong> on the home screen</li>
            <li>Click <strong>↻ Refresh</strong> below once the model is loaded</li>
          </ol>
          <button className="btn sm" onClick={pingConnection} style={{ marginTop: 8 }}>↻ Refresh connection</button>
        </div>
      )}

      {isLocal && status.tone === 'ok' && availableModels.length > 0 && !model && (
        <div className="card getting-started-card">
          <div className="card-title"><h3>Select a model</h3></div>
          <p style={{ marginBottom: 8, fontSize: '0.85em', color: 'var(--fg-dim)' }}>
            LM Studio is connected. Pick a loaded model to get started.
          </p>
          {availableModels.map(id => (
            <button key={id} className="btn sm" style={{ display: 'block', width: '100%', marginBottom: 4, textAlign: 'left' }}
              onClick={() => mutateState(s => { s.settings.model = id; })}>
              {id}
            </button>
          ))}
          {loadError && <div className="field-hint hint-warn" style={{ marginTop: 6 }}>{loadError}</div>}
        </div>
      )}

      <div className="card">
        <div className="card-title"><h3>Models</h3><button className="btn sm ghost" onClick={pingConnection}>↻ Refresh</button></div>

        <Field label="Chat model" info="Used for all actor, director, and system turns">
          {isLocal ? (
            <>
              <select value={model} onChange={(e) => updateSetting('model', e.target.value)}>
                <option value="">— select a model —</option>
                {(chatModels.length ? chatModels : availableModels).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              {modelIsEmbedding && (
                <div className="field-hint hint-warn" style={{ marginTop: 4 }}>
                  ⚠ "{model}" looks like an embedding model, not a chat model. Actors will likely produce errors or garbage output.
                </div>
              )}
            </>
          ) : hasSuggestions ? (
            <>
              <select value={cfg.suggestedModels.includes(model) ? model : ''} onChange={(e) => e.target.value && updateSetting('model', e.target.value)}>
                <option value="">— choose or type below —</option>
                {cfg.suggestedModels.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <input
                value={model}
                onChange={(e) => updateSetting('model', e.target.value)}
                placeholder="or type a model name…"
                style={{ marginTop: 4 }}
              />
            </>
          ) : (
            <input value={model} onChange={(e) => updateSetting('model', e.target.value)} placeholder="model name…" />
          )}
        </Field>

        {cfg.supportsEmbeddings ? (
          <Field label="Embedding model" hint="Optional — improves memory recall">
            {isLocal ? (
              <select value={embModel} onChange={(e) => updateSetting('embeddingModel', e.target.value)}>
                <option value="">— fall back to chat model —</option>
                {(embeddingModels.length ? embeddingModels : availableModels).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            ) : hasEmbSuggestions ? (
              <>
                <select value={cfg.suggestedEmbeddingModels.includes(embModel) ? embModel : ''} onChange={(e) => e.target.value && updateSetting('embeddingModel', e.target.value)}>
                  <option value="">— choose or type below —</option>
                  {cfg.suggestedEmbeddingModels.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
                <input value={embModel} onChange={(e) => updateSetting('embeddingModel', e.target.value)} placeholder="or type a model name…" style={{ marginTop: 4 }} />
              </>
            ) : (
              <input value={embModel} onChange={(e) => updateSetting('embeddingModel', e.target.value)} placeholder="embedding model name…" />
            )}
          </Field>
        ) : (
          <div className="field-hint hint-warn">Embeddings not supported by this provider — memory recall uses keyword fallback.</div>
        )}

        {embeddingProbe && cfg.supportsEmbeddings && (
          <div className={`field-hint${embeddingProbe.ok ? '' : ' hint-warn'}`}>
            {embeddingProbe.ok ? '✓ Embedding model OK' : `⚠ ${embeddingProbe.reason}`}
          </div>
        )}
      </div>

      <details className="card card-disclosure">
        <summary className="card-title">
          <h3>Generation tuning</h3>
          <span className="disclosure-sub">global defaults · advanced</span>
        </summary>
        <div className="disclosure-body">
          <Field label="Temperature" info="Global default actor creativity. Individual actors can override this in Actors → Behavior.">
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
      </details>
    </div>
  );
}
