/* eslint-env node */

/**
 * Versioned fixture envelope used by parser/serializer tests.
 *
 * Fixtures are intentionally plain JSON: no Dates, Maps, class instances,
 * undefined values, or secrets. The domain value belongs in `value`; parser
 * tests should validate the value through the domain parser.
 */
const FIXTURE_SCHEMA_VERSION = 1;
const FIXTURE_TYPES = Object.freeze({
  RUNTIME_METADATA: 'runtime-metadata',
  DIAGNOSTICS: 'diagnostics',
  CONFIGURATION: 'configuration',
  STREAMING_STATE: 'streaming-state'
});

function createFixture(type, value, { name = type, schemaVersion = FIXTURE_SCHEMA_VERSION } = {}) {
  if (!Object.values(FIXTURE_TYPES).includes(type)) throw new TypeError(`Unknown fixture type: ${type}`);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('Fixture schemaVersion must be a positive integer');
  return { fixtureSchemaVersion: schemaVersion, type, name: String(name), value };
}

function printFixture(fixture) {
  assertFixtureEnvelope(fixture);
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

function parseFixture(text, expectedType) {
  let fixture;
  try {
    fixture = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`Invalid ${expectedType || 'fixture'} JSON: ${error.message}`);
  }
  assertFixtureEnvelope(fixture, expectedType);
  return fixture;
}

function assertFixtureEnvelope(fixture, expectedType) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new TypeError('Fixture must be an object');
  if (fixture.fixtureSchemaVersion !== FIXTURE_SCHEMA_VERSION) throw new TypeError(`Unsupported fixture schema version: ${fixture.fixtureSchemaVersion}`);
  if (!Object.values(FIXTURE_TYPES).includes(fixture.type)) throw new TypeError(`Unknown fixture type: ${fixture.type}`);
  if (expectedType && fixture.type !== expectedType) throw new TypeError(`Expected ${expectedType} fixture, received ${fixture.type}`);
  if (typeof fixture.name !== 'string' || !fixture.name) throw new TypeError('Fixture name is required');
  if (!Object.prototype.hasOwnProperty.call(fixture, 'value')) throw new TypeError('Fixture value is required');
  return fixture;
}

module.exports = { FIXTURE_SCHEMA_VERSION, FIXTURE_TYPES, createFixture, printFixture, parseFixture, assertFixtureEnvelope };
