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

vi.mock('./telemetry.js', () => ({
  alignLineAttributions: vi.fn((oldLines, newLines, oldAttrs, author) => newLines.map(() => ({ author }))),
}));

import {
  acceptDocumentProposal,
  applyEditsToContent,
  createDocumentTask,
  hashDocumentContent,
} from './documentWriting.js';

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
