import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  createDocumentTask,
  detectInlineScribeRequest,
  dismissScribeSuggestion,
  hashDocumentContent,
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

  it('skips the judge until 2 new messages arrive since the last pass', async () => {
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    await runScribePass(null); // judges m1+m2, advances the gate marker
    expect(chatStructured).toHaveBeenCalledTimes(1);

    // Nothing new since the last judgment — no second model call.
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(1);

    // One new message is still below the threshold.
    mockState.messages.push({ id: 'm3', type: 'actor', speaker: 'A', content: 'New point.' });
    expect(await runScribePass(null)).toBeNull();
    expect(chatStructured).toHaveBeenCalledTimes(1);

    // A second new message re-arms the gate.
    mockState.messages.push({ id: 'm4', type: 'user', speaker: 'You', content: 'Capture that.' });
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    await runScribePass(null);
    expect(chatStructured).toHaveBeenCalledTimes(2);
  });

  it('manual mode skips the pass entirely (no model call)', async () => {
    mockState.documentWriting.scribeMode = 'manual';
    const result = await runScribePass(null);
    expect(result).toBeNull();
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('returns null when the model judges nothing worth recording (empty edits)', async () => {
    chatStructured.mockResolvedValueOnce({ thought: '', summary: '', documentEdits: [] });
    const result = await runScribePass(null);
    expect(result).toBeNull();
    expect(mockState.pendingDocumentEdits).toHaveLength(0);
    expect(mockState.pendingScribeSuggestions).toHaveLength(0);
    expect(mockState.documents[0].content).toBe('one\ntwo');
  });

  it('auto_apply commits the edit directly to the document', async () => {
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

  it('auto_review files a pending proposal without touching the document', async () => {
    mockState.documentWriting.scribeMode = 'auto_review';
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
