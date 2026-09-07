/* eslint-env node */
const assert = require('node:assert/strict');
const { FIXTURE_TYPES, createFixture, parseFixture, printFixture } = require('./fixture-conventions');
const { assertParsePrintParse, assertInvalidFixture } = require('./parse-print-parse');

function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}\n    ${error.message}`); process.exitCode = 1; }
}

console.log('parser/serializer helper tests');

test('supports all runtime metadata fixture domains', () => {
  for (const type of Object.values(FIXTURE_TYPES)) {
    const fixture = createFixture(type, { state: 'ready', sequence: 1 }, { name: `${type}-example` });
    const printed = printFixture(fixture);
    const parsed = parseFixture(printed, type);
    assert.deepStrictEqual(parsed, fixture);
    assertParsePrintParse({ input: JSON.stringify(parsed.value), parse: JSON.parse, print: (value) => JSON.stringify(value), name: type });
  }
});

test('reports invalid fixture and parser input descriptively', () => {
  assert.throws(() => parseFixture('{bad json', FIXTURE_TYPES.RUNTIME_METADATA), /Invalid runtime-metadata JSON/);
  assert.throws(() => parseFixture(printFixture(createFixture(FIXTURE_TYPES.DIAGNOSTICS, {})), FIXTURE_TYPES.CONFIGURATION), /Expected configuration fixture/);
  assertInvalidFixture({ input: '{bad json', parse: JSON.parse, name: 'configuration' });
});
