import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState } = vi.hoisted(() => ({
  mockState: {
    scenario: { title: 'Test', objective: 'Write a brief' },
    settings: { temperature: 0.8, maxTokens: 1000 },
    messages: [],
    actors: [],
    documents: [],
    documentWriting: { designatedWriterId: '' },
    documentTasks: [],
    pendingDocumentEdits: [],
  }
}));

vi.mock('./state.js', () => ({
  state: mockState,
  saveState: vi.fn(),
  logTransition: vi.fn(),
}));

vi.mock('./api.js', () => ({
  chatStructured: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('./knowledge.js', () => ({
  actorCanReadDocument: vi.fn(() => true),
  countWords: vi.fn(text => String(text || '').trim().split(/\s+/).filter(Boolean).length),
  ensureDefaultWriter: vi.fn(() => mockState.actors[0]),
  ensureSessionDocument: vi.fn(async ({ force = false } = {}) => {
    const existing = (mockState.documents || []).find(d => d.enabled !== false && d.aiEditable);
    if (existing) return existing;
    const sc = mockState.scenario || {};
    const hasIntent = !!(String(sc.task || '').trim() || String(sc.doneWhen || '').trim());
    if (!force && !hasIntent) return null;
    const doc = {
      id: 'session-doc', title: 'Session Deliverable', content: '',
      enabled: true, aiEditable: true, versions: [], writerId: mockState.actors[0]?.id || '',
    };
    mockState.documents.push(doc);
    return doc;
  }),
  putKbEntry: vi.fn(async () => {}),
  resolveDesignatedWriter: vi.fn(() => mockState.actors.find(a => a.id === mockState.documentWriting.designatedWriterId) || null),
}));

vi.mock('./turns.js', () => ({
  addMessage: vi.fn(async () => {}),
}));

vi.mock('./uiStore.js', () => ({
  showToast: vi.fn(),
}));

import {
  acceptDocumentProposal,
  acceptScribeSuggestion,
  applyEditsToContent,
  captureDeliverableOnComplete,
  createDocumentTask,
  detectInlineScribeRequest,
  dismissScribeSuggestion,
  hashDocumentContent,
  produceDeliverable,
  resolveEffectiveScribeMode,
  runScribePass,
} from './documentWriting.js';
import { chatStructured } from './api.js';

describe('documentWriting', () => {
  beforeEach(() => {
    mockState.actors = [
      { id: 'w1', name: 'Writer', enabled: true, canWriteDocuments: true }
    ];
    mockState.documents = [
      { id: 'd1', title: 'Doc', content: 'one\ntwo\nthree', enabled: true, aiEditable: true, versions: [], lineAttribution: [] }
    ];
    mockState.documentWriting = { designatedWriterId: 'w1' };
    mockState.documentTasks = [];
    mockState.pendingDocumentEdits = [];
  });

  it('applies append, replace, and full edits deterministically', () => {
    expect(applyEditsToContent('one', [{ documentId: 'd1', op: 'append', content: 'two' }], 'd1')).toBe('one\n\ntwo');
    expect(applyEditsToContent('one\ntwo\nthree', [{ documentId: 'd1', op: 'replace', startLine: 2, endLine: 2, content: 'TWO' }], 'd1')).toBe('one\nTWO\nthree');
    expect(applyEditsToContent('one', [{ documentId: 'd1', op: 'full', content: 'all new' }], 'd1')).toBe('all new');
  });

  it('keeps later replace targets correct when an earlier edit changes the line count', () => {
    // Both edits use line numbers from the ORIGINAL document. The first edit
    // collapses lines 1-2 into one line; naive sequential application would
    // shift the second edit's target up by one line and replace "four".
    const original = 'one\ntwo\nthree\nfour\nfive';
    const edits = [
      { documentId: 'd1', op: 'replace', startLine: 1, endLine: 2, content: 'ONE+TWO' },
      { documentId: 'd1', op: 'replace', startLine: 5, endLine: 5, content: 'FIVE' },
    ];
    expect(applyEditsToContent(original, edits, 'd1')).toBe('ONE+TWO\nthree\nfour\nFIVE');
  });

  it('applies replace before append so original line numbers stay valid', () => {
    const original = 'one\ntwo';
    const edits = [
      { documentId: 'd1', op: 'append', content: 'tail' },
      { documentId: 'd1', op: 'replace', startLine: 2, endLine: 2, content: 'TWO' },
    ];
    expect(applyEditsToContent(original, edits, 'd1')).toBe('one\nTWO\n\ntail');
  });

  it('ignores edits addressed to other documents', () => {
    expect(applyEditsToContent('one', [{ documentId: 'other', op: 'full', content: 'x' }], 'd1')).toBe('one');
  });

  it('treats append/replace on an empty document as a full write', () => {
    // First capture into an empty document: no leading blank line, no off-by-one.
    expect(applyEditsToContent('', [{ documentId: 'd1', op: 'append', content: 'hello' }], 'd1')).toBe('hello');
    expect(applyEditsToContent('   \n  ', [{ documentId: 'd1', op: 'replace', startLine: 1, endLine: 1, content: 'hello' }], 'd1')).toBe('hello');
  });

  it('falls back to append when a replace targets past the end of the document', () => {
    expect(applyEditsToContent('one\ntwo', [{ documentId: 'd1', op: 'replace', startLine: 9, endLine: 9, content: 'tail' }], 'd1')).toBe('one\ntwo\n\ntail');
  });

  it('creates manual writer tasks for writable documents', () => {
    const task = createDocumentTask({ documentId: 'd1', instruction: 'Summarize decisions.' });
    expect(task.actorId).toBe('w1');
    expect(task.status).toBe('pending');
    expect(mockState.documentTasks).toHaveLength(1);
  });

  it('accepts pending proposals only when the base content matches', async () => {
    const baseHash = hashDocumentContent('one\ntwo\nthree');
    mockState.pendingDocumentEdits = [{
      id: 'p1',
      taskId: 't1',
      documentId: 'd1',
      actorId: 'w1',
      writerName: 'Writer',
      summary: 'Update line',
      edits: [],
      previewContent: 'one\nTWO\nthree',
      baseHash,
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: ''
    }];

    await expect(acceptDocumentProposal('p1')).resolves.toBe(true);
    expect(mockState.documents[0].content).toBe('one\nTWO\nthree');
    expect(mockState.pendingDocumentEdits[0].status).toBe('accepted');
  });

  it('marks proposals conflicted if the document changed', async () => {
    mockState.pendingDocumentEdits = [{
      id: 'p1',
      taskId: 't1',
      documentId: 'd1',
      actorId: 'w1',
      writerName: 'Writer',
      summary: 'Update line',
      edits: [],
      previewContent: 'changed',
      baseHash: hashDocumentContent('older content'),
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: ''
    }];

    await expect(acceptDocumentProposal('p1')).resolves.toBe(false);
    expect(mockState.documents[0].content).toBe('one\ntwo\nthree');
    expect(mockState.pendingDocumentEdits[0].status).toBe('conflicted');
  });
});

describe('scribe autonomy modes', () => {
  beforeEach(() => {
    mockState.actors = [
      { id: 'w1', name: 'Scribe', enabled: true, canWriteDocuments: true, color: '#abc' }
    ];
    mockState.documents = [
      { id: 'd1', title: 'Notes', content: 'one\ntwo', enabled: true, aiEditable: true, versions: [], lineAttribution: [] }
    ];
    mockState.documentWriting = { designatedWriterId: 'w1', scribeMode: 'auto_apply' };
    mockState.pendingDocumentEdits = [];
    mockState.pendingScribeSuggestions = [];
    // Two substantive messages so the autonomous activity gate is open.
    mockState.messages = [
      { id: 'm1', type: 'actor', speaker: 'A', content: 'We decided X.' },
      { id: 'm2', type: 'actor', speaker: 'B', content: 'Agreed — X it is.' },
    ];
    chatStructured.mockReset();
  });

  // Stage-1 gate approval — autonomous passes call this before drafting.
  const gateYes = () => chatStructured.mockResolvedValueOnce({ record: true });
  const gateNo = () => chatStructured.mockResolvedValueOnce({ record: false });

  it('skips the judge until 2 new messages arrive since the last pass', async () => {
    gateYes();
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    await runScribePass(null); // judges m1+m2 (gate + draft), advances the marker
    expect(chatStructured).toHaveBeenCalledTimes(2);

    // Nothing new since the last judgment — no further model calls.
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(2);

    // One new message is still below the threshold.
    mockState.messages.push({ id: 'm3', type: 'actor', speaker: 'A', content: 'New point.' });
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(2);

    // A second new message re-arms the gate.
    mockState.messages.push({ id: 'm4', type: 'user', speaker: 'You', content: 'Capture that.' });
    gateYes();
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    await runScribePass(null);
    expect(chatStructured).toHaveBeenCalledTimes(4);
  });

  it('a negative stage-1 gate skips the draft call entirely and consumes the transcript', async () => {
    gateNo();
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(1); // gate only, no draft
    expect(mockState.documentWriting.lastScribeMsgId).toBe('m2');
    // Marker advanced — the next pass without new messages makes no calls.
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(1);
  });

  it('a gate failure fails open to the full judge', async () => {
    chatStructured.mockRejectedValueOnce(new Error('fast tier down'));
    chatStructured.mockResolvedValueOnce({
      thought: '', summary: 'Recorded.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const result = await runScribePass(null);
    expect(result?.applied).toBe(true);
    expect(mockState.documents[0].content).toBe('one\ntwo\n\nthree');
  });

  it('manual mode skips the pass entirely (no model call)', async () => {
    mockState.documentWriting.scribeMode = 'manual';
    const result = await runScribePass(null);
    expect(result).toBeNull();
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('returns null when the model judges nothing worth recording (empty edits)', async () => {
    gateYes();
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    const result = await runScribePass(null);
    expect(result).toBeNull();
    expect(mockState.pendingDocumentEdits).toHaveLength(0);
    expect(mockState.pendingScribeSuggestions).toHaveLength(0);
    expect(mockState.documents[0].content).toBe('one\ntwo');
  });

  it('auto_apply commits the edit directly to the document', async () => {
    gateYes();
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Recorded the decision.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const result = await runScribePass(null);
    expect(result?.applied).toBe(true);
    expect(mockState.documents[0].content).toBe('one\ntwo\n\nthree');
    expect(mockState.pendingDocumentEdits).toHaveLength(0);
    expect(mockState.pendingScribeSuggestions).toHaveLength(0);
  });

  it('coerces an edit with the wrong documentId onto the target document', async () => {
    // Small models routinely echo back a wrong id; the edit must still apply
    // rather than being silently dropped (which used to mean "nothing changed").
    gateYes();
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Recorded.',
      documentEdits: [{ documentId: 'totally-wrong-id', op: 'append', content: 'three' }]
    });
    const result = await runScribePass(null);
    expect(result?.applied).toBe(true);
    expect(mockState.documents[0].content).toBe('one\ntwo\n\nthree');
  });

  it('auto_review files a pending proposal without touching the document', async () => {
    mockState.documentWriting.scribeMode = 'auto_review';
    gateYes();
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Drafted update.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const result = await runScribePass(null);
    expect(result?.status).toBe('pending');
    expect(mockState.pendingDocumentEdits).toHaveLength(1);
    expect(mockState.documents[0].content).toBe('one\ntwo');
  });

  it('ask mode queues a suggestion; accepting it applies the edit', async () => {
    mockState.documentWriting.scribeMode = 'ask';
    gateYes();
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Capture the decision.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const suggestion = await runScribePass(null);
    expect(suggestion?.status).toBe('pending');
    expect(mockState.pendingScribeSuggestions).toHaveLength(1);
    expect(mockState.documents[0].content).toBe('one\ntwo');

    await expect(acceptScribeSuggestion(suggestion.id)).resolves.toBe(true);
    expect(mockState.documents[0].content).toBe('one\ntwo\n\nthree');
    expect(mockState.pendingScribeSuggestions[0].status).toBe('accepted');
  });

  it('ask mode suggestions can be dismissed without applying', async () => {
    mockState.documentWriting.scribeMode = 'ask';
    gateYes();
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Capture the decision.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const suggestion = await runScribePass(null);
    expect(dismissScribeSuggestion(suggestion.id)).toBe(true);
    expect(mockState.pendingScribeSuggestions[0].status).toBe('dismissed');
    expect(mockState.documents[0].content).toBe('one\ntwo');
  });

  it('inline instruction overrides manual mode and applies directly', async () => {
    mockState.documentWriting.scribeMode = 'manual';
    chatStructured.mockResolvedValueOnce({
      thought: '',
      summary: 'Captured per user request.',
      documentEdits: [{ documentId: 'd1', op: 'append', content: 'three' }]
    });
    const result = await runScribePass(null, { instruction: 'scribe, add that' });
    expect(result?.applied).toBe(true);
    expect(mockState.documents[0].content).toBe('one\ntwo\n\nthree');
  });
});

describe('detectInlineScribeRequest', () => {
  it.each([
    'Scribe, write that up.',
    'scribe write the decision',
    'Add that to the doc',
    'Update the document with the latest decision',
    'write this up in the notes',
  ])('detects: %s', (text) => {
    expect(detectInlineScribeRequest(text)).toBe(text.trim());
  });

  it.each([
    'How does the scribe work?',
    'Random conversation about writing.',
    '',
    '   ',
  ])('ignores: %s', (text) => {
    expect(detectInlineScribeRequest(text)).toBeNull();
  });
});

describe('effective scribe mode', () => {
  const restore = () => { mockState.scenario = { title: 'Test', objective: 'Write a brief' }; };
  afterEach(restore);

  it('honors an explicit user choice verbatim, even manual on a goal session', () => {
    mockState.documentWriting = { scribeMode: 'manual', scribeModeUserSet: true };
    mockState.scenario = { title: 'T', task: 'Produce a plan' };
    expect(resolveEffectiveScribeMode()).toBe('manual');
  });

  it('auto-arms review-first for a deliverable scenario the user has not configured', () => {
    mockState.documentWriting = { scribeMode: 'manual', scribeModeUserSet: false };
    mockState.scenario = { title: 'T', task: 'Produce a plan' };
    expect(resolveEffectiveScribeMode()).toBe('auto_review');
  });

  it('stays manual for a roleplay session with no task or doneWhen', () => {
    mockState.documentWriting = { scribeMode: 'manual', scribeModeUserSet: false };
    mockState.scenario = { title: 'T' };
    expect(resolveEffectiveScribeMode()).toBe('manual');
  });

  it('honors a blueprint-set non-manual mode without an explicit user choice', () => {
    mockState.documentWriting = { scribeMode: 'ask', scribeModeUserSet: false };
    mockState.scenario = { title: 'T' };
    expect(resolveEffectiveScribeMode()).toBe('ask');
  });
});

describe('deliverable production', () => {
  beforeEach(() => {
    mockState.actors = [
      { id: 'w1', name: 'Writer', enabled: true, canWriteDocuments: true, color: '#abc' }
    ];
    mockState.documents = [
      { id: 'd1', title: 'Doc', content: '', enabled: true, aiEditable: true, versions: [] }
    ];
    mockState.documentWriting = { designatedWriterId: 'w1', scribeMode: 'manual' };
    mockState.messages = [
      { id: 'm1', type: 'actor', speaker: 'A', content: 'We decided X.' },
      { id: 'm2', type: 'actor', speaker: 'B', content: 'Agreed — X it is.' },
    ];
    mockState.scenario = { title: 'Test', task: 'Write a brief', doneWhen: 'Brief exists' };
    chatStructured.mockReset();
  });
  afterEach(() => { mockState.scenario = { title: 'Test', objective: 'Write a brief' }; });

  it('produceDeliverable forces a write even from manual mode', async () => {
    chatStructured.mockResolvedValueOnce({
      thought: '', summary: 'Deliverable.',
      documentEdits: [{ documentId: 'd1', op: 'full', content: '# Brief\nDone.' }]
    });
    const result = await produceDeliverable();
    expect(result?.applied).toBe(true);
    expect(result?.documentId).toBe('d1');
    expect(mockState.documents[0].content).toBe('# Brief\nDone.');
  });

  it('self-heals a writable document when none exists in a deliverable session', async () => {
    mockState.documents = []; // no writable document at all
    chatStructured.mockResolvedValueOnce({
      thought: '', summary: 'Deliverable.',
      documentEdits: [{ documentId: 'session-doc', op: 'full', content: '# Brief' }]
    });
    const result = await produceDeliverable();
    expect(result?.applied).toBe(true);
    expect(mockState.documents.find(d => d.aiEditable)?.content).toBe('# Brief');
  });

  it('captureDeliverableOnComplete writes the deliverable when intent exists', async () => {
    chatStructured.mockResolvedValueOnce({
      thought: '', summary: 'Final.',
      documentEdits: [{ documentId: 'd1', op: 'full', content: '# Final' }]
    });
    const result = await captureDeliverableOnComplete();
    expect(result?.applied).toBe(true);
    expect(mockState.documents[0].content).toBe('# Final');
  });

  it('captureDeliverableOnComplete is a no-op without deliverable intent', async () => {
    mockState.scenario = { title: 'Test' }; // no task / doneWhen
    const result = await captureDeliverableOnComplete();
    expect(result).toBeNull();
    expect(chatStructured).not.toHaveBeenCalled();
  });
});
