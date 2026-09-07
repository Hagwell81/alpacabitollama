export const FIXTURE_SCHEMA_VERSION = 1 as const;

export const FIXTURE_TYPES = {
	RUNTIME_METADATA: 'runtime-metadata',
	DIAGNOSTICS: 'diagnostics',
	CONFIGURATION: 'configuration',
	STREAMING_STATE: 'streaming-state'
} as const;

export type FixtureType = (typeof FIXTURE_TYPES)[keyof typeof FIXTURE_TYPES];

export interface FixtureEnvelope<T> {
	fixtureSchemaVersion: number;
	type: FixtureType;
	name: string;
	value: T;
}

/** Fixtures stay plain JSON and keep domain values inside a versioned envelope. */
export function createFixture<T>(
	type: FixtureType,
	value: T,
	options: { name?: string; schemaVersion?: number } = {}
): FixtureEnvelope<T> {
	const schemaVersion = options.schemaVersion ?? FIXTURE_SCHEMA_VERSION;
	if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('Fixture schemaVersion must be a positive integer');
	return { fixtureSchemaVersion: schemaVersion, type, name: options.name ?? type, value };
}

export function printFixture<T>(fixture: FixtureEnvelope<T>): string {
	assertFixtureEnvelope(fixture);
	return `${JSON.stringify(fixture, null, 2)}\n`;
}

export function parseFixture<T>(text: string, expectedType?: FixtureType): FixtureEnvelope<T> {
	let fixture: unknown;
	try {
		fixture = JSON.parse(text);
	} catch (error) {
		throw new TypeError(`Invalid ${expectedType ?? 'fixture'} JSON: ${(error as Error).message}`);
	}
	return assertFixtureEnvelope<T>(fixture, expectedType);
}

export function assertFixtureEnvelope<T>(fixture: unknown, expectedType?: FixtureType): FixtureEnvelope<T> {
	if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new TypeError('Fixture must be an object');
	const candidate = fixture as Partial<FixtureEnvelope<T>>;
	if (candidate.fixtureSchemaVersion !== FIXTURE_SCHEMA_VERSION) throw new TypeError(`Unsupported fixture schema version: ${candidate.fixtureSchemaVersion}`);
	if (!Object.values(FIXTURE_TYPES).includes(candidate.type as FixtureType)) throw new TypeError(`Unknown fixture type: ${candidate.type}`);
	if (expectedType && candidate.type !== expectedType) throw new TypeError(`Expected ${expectedType} fixture, received ${candidate.type}`);
	if (typeof candidate.name !== 'string' || !candidate.name) throw new TypeError('Fixture name is required');
	if (!Object.prototype.hasOwnProperty.call(candidate, 'value')) throw new TypeError('Fixture value is required');
	return candidate as FixtureEnvelope<T>;
}
