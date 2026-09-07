import { describe, expect, it } from 'vitest';
import { createFixture, FIXTURE_TYPES, parseFixture, printFixture } from '../helpers/fixture-conventions';
import { assertInvalidFixture, assertParsePrintParse } from '../helpers/parse-print-parse';

describe('parser/serializer test helpers', () => {
	it.each(Object.values(FIXTURE_TYPES))('round-trips %s fixture values', (type) => {
		const fixture = createFixture(type, { state: 'ready', sequence: 1 }, { name: `${type}-example` });
		const parsed = parseFixture(printFixture(fixture), type);
		expect(parsed).toEqual(fixture);
		const result = assertParsePrintParse({
			input: JSON.stringify(parsed.value),
			parse: JSON.parse,
			print: JSON.stringify,
			name: type
		});
		expect(result.parsed).toEqual(parsed.value);
	});

	it('reports invalid fixtures descriptively', () => {
		expect(() => parseFixture('{bad json', FIXTURE_TYPES.RUNTIME_METADATA)).toThrow('Invalid runtime-metadata JSON');
		expect(() => parseFixture(printFixture(createFixture(FIXTURE_TYPES.DIAGNOSTICS, {})), FIXTURE_TYPES.CONFIGURATION)).toThrow('Expected configuration fixture');
		assertInvalidFixture({ input: '{bad json', parse: JSON.parse, name: 'configuration' });
	});
});
