/**
 * schemas.js — Single source of truth for all actor output schemas.
 *
 * Exports:
 *   buildActorSchema(actor, options)      → JSON Schema for API response_format
 *   buildSchemaPromptLine(actor, options) → "Return only valid JSON: {...}" string
 *
 * Options: { showThoughts = true, hasEditable = false, stageDirections = false }
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
  rateSignal: {
    json: {
      type: 'object',
      properties: {
        novel:      { type: 'boolean' },
        advancing:  { type: 'boolean' },
        flag:       { type: 'string', enum: ['repeat', 'loop', 'ok'] },
      },
      required: ['novel', 'advancing'],
      additionalProperties: false,
    },
    prompt: '{"novel":bool,"advancing":bool,"flag":"repeat|loop|ok"} quality signal for prior message (optional)',
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
            },
            required: ['name', 'role'],
            additionalProperties: false,
          },
        },
        silence: { type: 'array', items: { type: 'string' } },
        resume:  { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    prompt: '{"create":[{"name":"...","role":"...","persona":"...","goal":"...","voice":"...","authority":50,"temperature":0.8}],"silence":["Name"],"resume":["Name"]} (optional)',
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
};

// ── Field selection per actor type ────────────────────────────────────────────

/**
 * Returns an ordered list of field names for the given actor and options.
 * @param {object} actor
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean }} options
 * @returns {{ required: string[], optional: string[] }}
 */
function selectFields(actor, options = {}) {
  const { showThoughts = true, hasEditable = false, stageDirections = false } = options;

  const required = [];
  const optional = [];

  // `thought` is always required in the schema; when thoughts are off the model
  // simply returns "". (The showThoughts param is kept for the callers' intent.)
  required.push('thought');

  // Director
  if (actor.canDirect) {
    required.push('action', 'message');
    optional.push('nextSpeaker', 'anchor', 'pinFact', 'rateSignal', 'pauseRequest');
    optional.push('manageActors', 'promptInjections', 'privateMessages');
    if (hasEditable) optional.push('documentEdits');
    return { required, optional };
  }

  // Manager (canManageCast but not canDirect)
  if (actor.canManageCast) {
    required.push('action', 'message');
    optional.push('manageActors');
    if (actor.canInject) {
      optional.push('promptInjections', 'privateMessages');
    }
    return { required, optional };
  }

  // Researcher
  if (actor.canResearch) {
    required.push('action', 'message');
    if (hasEditable) optional.push('documentEdits');
    return { required, optional };
  }

  // Regular actor
  required.push('action', 'message');
  optional.push('nextSpeaker', 'anchor', 'pinFact', 'rateSignal', 'pauseRequest');
  if (hasEditable) optional.push('documentEdits');
  if (actor.canInject) {
    optional.push('promptInjections', 'privateMessages');
  }
  return { required, optional };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the JSON Schema object for LM Studio's response_format field.
 * @param {object} actor
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean }} options
 * @returns {object} JSON Schema
 */
export function buildActorSchema(actor, options = {}) {
  const { required: reqFields, optional: optFields } = selectFields(actor, options);
  const allFields = [...reqFields, ...optFields];

  const properties = {};
  for (const name of allFields) {
    properties[name] = FIELDS[name].json;
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
 * @param {{ showThoughts?: boolean, hasEditable?: boolean, stageDirections?: boolean }} options
 * @returns {string}
 */
export function buildSchemaPromptLine(actor, options = {}) {
  const { stageDirections = false, schemaActive = false } = options;
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
    // Story mode overrides the message description
    if (name === 'message' && stageDirections) {
      promptValue = '*actions in asterisks* plus "spoken dialogue in quotes"';
    }
    return `"${name}":"${promptValue}"`;
  });

  return `Return only valid JSON: {${pairs.join(',')}}`;
}
