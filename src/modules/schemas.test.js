import { describe, expect, it } from 'vitest';
import { buildActorSchema, buildDocumentWriterSchema } from './schemas.js';

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
});
