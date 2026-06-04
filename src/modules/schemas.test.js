import { describe, expect, it } from 'vitest';
import { buildActorSchema, buildDocumentWriterSchema, buildSchemaPromptLine } from './schemas.js';

describe('schemas', () => {
  it('does not expose documentEdits on normal actor turns', () => {
    const schema = buildActorSchema({ name: 'Writer', canWriteDocuments: true }, { hasEditable: true });
    expect(schema.properties.documentEdits).toBeUndefined();
  });

  it('exposes documentEdits only in the writer-task schema', () => {
    const schema = buildDocumentWriterSchema();
    expect(schema.properties.documentEdits).toBeDefined();
    expect(schema.required).toContain('documentEdits');
  });

  it('prompts agentic-selected actor turns to speak without changing the API schema shape', () => {
    const schema = buildActorSchema({ name: 'Architect' }, { forceSpeak: true });
    const prompt = buildSchemaPromptLine({ name: 'Architect' }, { forceSpeak: true });
    expect(schema.properties.action.enum).toEqual(['speak', 'skip']);
    expect(prompt).toContain('"action":"speak"');
  });
});
