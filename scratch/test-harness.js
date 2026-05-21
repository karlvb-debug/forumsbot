import {
  parseTextToolCalls,
  stripTextToolCalls,
  sanitizeJsonString,
  parseStrictEnvelope,
  parseLooseEnvelope,
  parseAiJson,
  estimateTokens,
  trimWords
} from '../public/modules/utils.js';

// Assert helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function testSubsystem1_ToolParsing() {
  console.log('Testing Subsystem 1: Tool Tag Parsing...');
  
  const content = 'I will look that up. [SEARCH: active learning in LLMs] and also [READ: https://example.com/docs] to confirm.';
  const calls = parseTextToolCalls(content);
  assert(calls.length === 2, 'Should parse exactly 2 tool calls');
  assert(calls[0].tool === 'web_search', 'First call should be web_search');
  assert(calls[0].args.query === 'active learning in LLMs', 'First call query match');
  assert(calls[1].tool === 'web_read', 'Second call should be web_read');
  assert(calls[1].args.url === 'https://example.com/docs', 'Second call URL match');

  const stripped = stripTextToolCalls(content);
  assert(
    stripped === 'I will look that up.  and also  to confirm.',
    'Should strip tags clean'
  );
}

async function testSubsystem2_JsonParsingAndTruncation() {
  console.log('Testing Subsystem 2: JSON Sanitization & Parsing...');

  // Case A: Sanitize literal newline inside JSON string
  const rawJsonWithNewline = '{\n"thought": "This is a thought\nwith a literal newline inside a string.",\n"action": "speak",\n"message": "Hello!"\n}';
  const sanitized = sanitizeJsonString(rawJsonWithNewline);
  const parsed = JSON.parse(sanitized);
  assert(parsed.thought.includes('\n') || parsed.thought.includes('\\n'), 'Literal newline should be sanitized');
  
  // Case B: Truncated JSON repair (model cuts off mid-message)
  const truncated = '{"thought":"Thinking...", "action":"speak", "message":"This is truncated text';
  const repaired = parseAiJson(truncated);
  assert(repaired.thought === 'Thinking...', 'Should extract thought from truncated');
  assert(repaired.action === 'speak', 'Should extract action from truncated');
  assert(repaired.message === 'This is truncated text', 'Should extract message from truncated');

  // Case C: Truncated JSON repair with double quotes in message
  const truncatedWithQuote = '{"thought":"Reflecting", "action":"speak", "message":"He said \\"Hello';
  const repairedWithQuote = parseAiJson(truncatedWithQuote);
  assert(repairedWithQuote.message.includes('He said "Hello'), 'Should parse repaired string with quotes');

  // Case D: Loose parsing (completely broken syntax but with braces and commas)
  const looseText = '{ thought: Let me think., action: speak, message: Go team! }';
  const looseParsed = parseLooseEnvelope(looseText);
  assert(looseParsed !== null, 'Loose parse should not be null');
  assert(looseParsed.thought === 'Let me think.', 'Loose parse thought');
  assert(looseParsed.message === 'Go team!', 'Loose parse message');
}

// Simulates applyDocumentEdit logic from turns.js
function simulateDocumentEdit(editText, prevContent) {
  const bareKeyword = /^(append|replace|full|edit|update|insert|add|write|none|n\/a|null|undefined|\{\}|\[\])$/i;
  if (bareKeyword.test(editText.trim())) {
    return prevContent;
  }

  let newContent = prevContent;
  if (/^\[FULL\]/i.test(editText)) {
    newContent = editText.replace(/^\[FULL\]\s*/i, "").trim();
  } else if (/^\[REPLACE:/i.test(editText)) {
    const match = editText.match(/^\[REPLACE:\s*([\s\S]*?)\]\s*([\s\S]*)$/i);
    if (match) {
      const findText = match[1].trim();
      const replaceText = match[2].trim();
      if (prevContent.includes(findText)) {
        newContent = prevContent.replace(findText, replaceText);
      } else {
        const idx = prevContent.toLowerCase().indexOf(findText.toLowerCase());
        if (idx !== -1) {
          newContent = prevContent.slice(0, idx) + replaceText + prevContent.slice(idx + findText.length);
        } else {
          newContent = prevContent + (prevContent ? "\n\n" : "") + replaceText;
        }
      }
    }
  } else {
    const cleaned = editText.replace(/^\[APPEND\]\s*/i, "").trim();
    if (cleaned) {
      newContent = prevContent + (prevContent ? "\n\n" : "") + cleaned;
    }
  }
  return newContent;
}

async function testSubsystem3_DocumentEdits() {
  console.log('Testing Subsystem 3: Shared Document operations...');

  const initial = '## Setup\n- Bullet 1\n- Bullet 2';

  // Test FULL replacement
  const fullEdit = '[FULL] ## Brand New Document\nAll content replaced.';
  assert(
    simulateDocumentEdit(fullEdit, initial) === '## Brand New Document\nAll content replaced.',
    'FULL edit should overwrite entire document'
  );

  // Test Surgical REPLACE
  const replaceEdit = '[REPLACE: - Bullet 2] - Bullet 2 (Modified)';
  const expectedReplace = '## Setup\n- Bullet 1\n- Bullet 2 (Modified)';
  assert(
    simulateDocumentEdit(replaceEdit, initial) === expectedReplace,
    'REPLACE should surgically edit text'
  );

  // Test Case-insensitive Fuzzy REPLACE
  const fuzzyReplace = '[REPLACE: - bullet 1] - Bullet One';
  const expectedFuzzy = '## Setup\n- Bullet One\n- Bullet 2';
  assert(
    simulateDocumentEdit(fuzzyReplace, initial) === expectedFuzzy,
    'REPLACE should support fuzzy matching'
  );

  // Test REPLACE fallback when text not found (appends to end)
  const missingReplace = '[REPLACE: Nonexistent] Appended text';
  assert(
    simulateDocumentEdit(missingReplace, initial).endsWith('Appended text'),
    'REPLACE fallback should append'
  );

  // Test APPEND
  const appendEdit = '[APPEND] - Bullet 3';
  assert(
    simulateDocumentEdit(appendEdit, initial) === '## Setup\n- Bullet 1\n- Bullet 2\n\n- Bullet 3',
    'APPEND should add text at end'
  );

  // Test bare operations rejected
  assert(
    simulateDocumentEdit('replace', initial) === initial,
    'Bare keyword "replace" should be ignored'
  );
  assert(
    simulateDocumentEdit('{}', initial) === initial,
    'Bare JSON brackets should be ignored'
  );
}

async function testSubsystem4_LiveEndpoints() {
  console.log('Testing Subsystem 4: Live Local Server Endpoints...');

  const serverUrl = 'http://127.0.0.1:4173';

  // Test A: Web Search endpoint
  try {
    const res = await fetch(`${serverUrl}/api/tool-execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'web_search',
        args: { query: 'Node.js LTS release' }
      })
    });
    assert(res.ok, 'Search endpoint HTTP response OK');
    const data = await res.json();
    assert(Array.isArray(data.results), 'Search should return results array');
    assert(data.results.length > 0, 'Search should find at least one result');
    assert(data.results[0].title && data.results[0].url, 'Result has title and url');
    console.log(`  🌐 DuckDuckGo search result verified: "${data.results[0].title}"`);
  } catch (err) {
    throw new Error(`Search endpoint failed: ${err.message}`);
  }

  // Test B: Web Read endpoint
  try {
    const res = await fetch(`${serverUrl}/api/tool-execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'web_read',
        args: { url: 'https://example.com' }
      })
    });
    assert(res.ok, 'Read webpage HTTP response OK');
    const data = await res.json();
    assert(data.text && data.text.includes('Example Domain'), 'Read webpage should extract text');
    console.log(`  🌐 Cheerio webpage reading verified: "${data.text.slice(0, 40)}..."`);
  } catch (err) {
    throw new Error(`Read webpage endpoint failed: ${err.message}`);
  }
}

async function runAll() {
  console.log('=== FORUM AUTOMATED TESTING HARNESS ===');
  try {
    await testSubsystem1_ToolParsing();
    await testSubsystem2_JsonParsingAndTruncation();
    await testSubsystem3_DocumentEdits();
    await testSubsystem4_LiveEndpoints();
    console.log('\n⭐⭐⭐ ALL TESTS PASSED SUCCESSFULLY! ⭐⭐⭐');
  } catch (err) {
    console.error('\n❌ TEST HARNESS FAILED:', err.message);
    process.exit(1);
  }
}

runAll();
