/**
 * schemas.js — Single source of truth for all actor output schemas.
 *
 * Exports:
 *   buildActorSchema(actor, options)      → JSON Schema for API response_format
 *   buildSchemaPromptLine(actor, options) → "Return only valid JSON: {...}" string
 *
 * Options: { showThoughts = true, hasEditable = false, stageDirections = false, allowNextSpeaker = true }
 *
 * Normal actor turns intentionally do not include documentEdits anymore. Document
 * writing happens through the dedicated writer-task schema below.
 */

// ── Field definitions ─────────────────────────────────────────────────────────
// Each field has:
//   json   — the JSON Schema fragment for this field
//   prompt — the human-readable description used in the prompt line

const FIELDS = {
  thought: {
    json: { type: 'string' },
    prompt: 'private reasoning (not shown to others)',
  },
  action: {
    json: { type: 'string', enum: ['speak', 'skip'] },
    prompt: '"speak" or "skip"',
  },
  message: {
    json: { type: 'string' },
    prompt: 'public message, empty string if skipping',
  },
  nextSpeaker: {
    json: { type: 'string' },
    prompt: 'name of the actor who should speak next (optional, omit to use turn order)',
  },
  anchor: {
    json: { type: 'string' },
    prompt: 'a settled group agreement to pin, max 20 words (optional)',
  },
  pinFact: {
    json: { type: 'string' },
    prompt: 'an undisputed fact just established, one sentence (optional)',
  },
  pauseRequest: {
    json: {
      type: 'object',
      properties: {
        reason:              { type: 'string', enum: ['decision', 'conflict', 'question', 'clarification', 'information'] },
        context:             { type: 'string' },
        question:            { type: 'string' },
        options:             { type: 'array', items: { type: 'string' } },
        defaultIfNoResponse: { type: 'string' },
      },
      required: ['reason', 'context', 'defaultIfNoResponse'],
      additionalProperties: false,
    },
    prompt: '{"reason":"decision|conflict|question|clarification|information","context":"...","question":"...","defaultIfNoResponse":"..."} (optional)',
  },
  documentEdits: {
    json: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          op:         { type: 'string', enum: ['append', 'replace', 'full'] },
          content:    { type: 'string' },
          startLine:  { type: 'number' },
          endLine:    { type: 'number' },
        },
        required: ['documentId', 'op', 'content'],
        additionalProperties: false,
      },
    },
    prompt: '[{"documentId":"<id>","op":"append|replace|full","content":"...","startLine":N,"endLine":M}] (optional, omit if no changes)',
  },
  manageActors: {
    json: {
      type: 'object',
      properties: {
        create: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:           { type: 'string' },
              role:           { type: 'string' },
              persona:        { type: 'string' },
              goal:           { type: 'string' },
              voice:          { type: 'string' },
              authority:      { type: 'number' },
              temperature:    { type: 'number' },
              canDirect:      { type: 'boolean' },
              canManageCast:  { type: 'boolean' },
              canResearch:    { type: 'boolean' },
              canSeeThoughts: { type: 'boolean' },
              canInject:      { type: 'boolean' },
              canWriteDocuments: { type: 'boolean' },
              canPause:       { type: 'boolean' },
              canAnchor:      { type: 'boolean' },
              canPinFacts:    { type: 'boolean' },
              canSuggestSpeaker: { type: 'boolean' },
              canUpdateStyle: { type: 'boolean' },
            },
            required: ['name', 'role'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    prompt: '{"create":[{"name":"...","role":"...","persona":"...","goal":"...","voice":"..."}]} (optional)',
  },
  promptInjections: {
    json: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetName: { type: 'string' },
          content:    { type: 'string' },
          scope:      { type: 'string', enum: ['next_turn_only', 'persistent'] },
        },
        required: ['targetName', 'content'],
        additionalProperties: false,
      },
    },
    prompt: '[{"targetName":"...","content":"...","scope":"next_turn_only|persistent"}] private actor guidance (optional)',
  },
  privateMessages: {
    json: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          toName:  { type: 'string' },
          content: { type: 'string' },
        },
        required: ['toName', 'content'],
        additionalProperties: false,
      },
    },
    prompt: '[{"toName":"...","content":"..."}] message visible only to that actor (optional)',
  },
  updateStyle: {
    json: { type: 'string' },
    prompt: 'new global style instruction to apply to all actors from this turn forward (optional — use only when the user explicitly asks to change the style)',
  },
};

// ── Field selection per actor type ────────────────────────────────────────────

/**
 * Returns an ordered list of field names for the given actor and options.
 * @param {object} actor
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean, allowNextSpeaker?: boolean }} options
 * @returns {{ required: string[], optional: string[] }}
 */
function selectFields(actor, options = {}) {
  const { showThoughts = true, hasEditable = false, stageDirections = false, allowNextSpeaker = true } = options;

  const required = [];
  const optional = [];

  // `thought` is always required in the schema; when thoughts are off the model
  // simply returns "". (The showThoughts param is kept for the callers' intent.)
  required.push('thought');
  required.push('action', 'message');

  if (allowNextSpeaker && actor.canSuggestSpeaker) {
    optional.push('nextSpeaker');
  }
  if (actor.canAnchor) {
    optional.push('anchor');
  }
  if (actor.canPinFacts) {
    optional.push('pinFact');
  }
  if (actor.canPause) {
    optional.push('pauseRequest');
  }
  if (actor.canManageCast) {
    optional.push('manageActors');
  }
  if (actor.canInject) {
    optional.push('promptInjections', 'privateMessages');
  }
  if (actor.canUpdateStyle) {
    optional.push('updateStyle');
  }

  return { required, optional };
}

export function buildDocumentWriterSchema() {
  return {
    type: 'object',
    properties: {
      thought: FIELDS.thought.json,
      summary: { type: 'string' },
      documentEdits: FIELDS.documentEdits.json,
    },
    required: ['thought', 'summary', 'documentEdits'],
    additionalProperties: false,
  };
}

export function buildDocumentWriterPromptLine() {
  return [
    'Return only valid JSON with:',
    '- "thought": brief private planning, or "" if not needed',
    '- "summary": one sentence describing the proposed document change',
    `- "documentEdits": ${FIELDS.documentEdits.prompt}`
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the JSON Schema object for LM Studio's response_format field.
 * @param {object} actor
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean, allowNextSpeaker?: boolean }} options
 * @returns {object} JSON Schema
 */
export function buildActorSchema(actor, options = {}) {
  const { required: reqFields, optional: optFields } = selectFields(actor, options);
  const allFields = [...reqFields, ...optFields];

  const properties = {};
  for (const name of allFields) {
    if (name === 'nextSpeaker' && options.validSpeakerNames?.length) {
      // Constrain to an enum of valid participant names + '' (empty = no suggestion)
      properties[name] = { type: 'string', enum: [...options.validSpeakerNames, ''] };
    } else {
      properties[name] = FIELDS[name].json;
    }
  }

  return {
    type: 'object',
    properties,
    required: reqFields,
    additionalProperties: false,
  };
}

/**
 * Build the human-readable "Return only valid JSON: {...}" prompt line.
 * @param {object} actor
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean, allowNextSpeaker?: boolean }} options
 * @returns {string}
 */
export function buildSchemaPromptLine(actor, options = {}) {
  const { stageDirections = false, schemaActive = false, forceSpeak = false } = options;
  const { required: reqFields, optional: optFields } = selectFields(actor, options);

  // When the model's response is grammar-constrained (response_format), the
  // required envelope shape (thought/action/message) is already enforced and the
  // verbose "Return only valid JSON: {...}" restatement is wasted tokens. Emit
  // only the OPTIONAL fields, whose meaning and when-to-use the grammar can't convey.
  if (schemaActive) {
    if (!optFields.length) return '';
    const opts = optFields.map(name => `- "${name}": ${FIELDS[name].prompt}`);
    return `Optional JSON fields you may add to the response object when relevant:\n${opts.join('\n')}`;
  }

  const allFields = [...reqFields, ...optFields];
  const pairs = allFields.map(name => {
    let promptValue = FIELDS[name].prompt;
    if (name === 'action' && forceSpeak) {
      promptValue = 'speak';
    }
    // Stage directions override the message description.
    if (name === 'message' && stageDirections) {
      promptValue = '*actions in asterisks* plus "spoken dialogue in quotes"';
    }
    return `"${name}":"${promptValue}"`;
  });

  return `Return only valid JSON: {${pairs.join(',')}}`;
}
