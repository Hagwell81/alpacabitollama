/* eslint-env node */
const assert = require('node:assert/strict');

/**
 * Verifies parse(print(parse(input))) is equivalent to the first parse.
 * The injected functions are the domain parser and serializer under test.
 */
function assertParsePrintParse({ input, parse, print, name = 'value', equal = assert.deepStrictEqual }) {
  if (typeof parse !== 'function' || typeof print !== 'function') throw new TypeError('parse and print functions are required');
  let first;
  try { first = parse(input); } catch (error) { throw new Error(`${name} failed initial parse: ${error.message}`, { cause: error }); }
  let printed;
  try { printed = print(first); } catch (error) { throw new Error(`${name} failed print: ${error.message}`, { cause: error }); }
  let second;
  try { second = parse(printed); } catch (error) { throw new Error(`${name} failed round-trip parse: ${error.message}`, { cause: error }); }
  equal(second, first);
  return { parsed: second, printed };
}

function assertInvalidFixture({ input, parse, name = 'value', message }) {
  assert.equal(typeof parse, 'function', 'parse function is required');
  assert.throws(() => parse(input), (error) => {
    if (!(error instanceof Error)) return false;
    return !message || error.message.includes(message);
  }, `${name} should reject an invalid value`);
}

module.exports = { assertParsePrintParse, assertInvalidFixture };
