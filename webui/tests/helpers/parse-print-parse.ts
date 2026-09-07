import { expect } from 'vitest';

export interface ParsePrintParseOptions<TParsed, TInput = unknown> {
	input: TInput;
	parse: (input: TInput | string) => TParsed;
	print: (value: TParsed) => string;
	name?: string;
	equal?: (actual: TParsed, expected: TParsed) => void;
}

/** Verifies parse(print(parse(input))) is equivalent to the first parse. */
export function assertParsePrintParse<TParsed, TInput = unknown>({
	input,
	parse,
	print,
	name = 'value',
	equal = (actual, expected) => expect(actual).toEqual(expected)
}: ParsePrintParseOptions<TParsed, TInput>): { parsed: TParsed; printed: string } {
	let first: TParsed;
	try {
		first = parse(input);
	} catch (error) {
		throw new Error(`${name} failed initial parse: ${(error as Error).message}`, { cause: error });
	}
	let printed: string;
	try {
		printed = print(first);
	} catch (error) {
		throw new Error(`${name} failed print: ${(error as Error).message}`, { cause: error });
	}
	let second: TParsed;
	try {
		second = parse(printed);
	} catch (error) {
		throw new Error(`${name} failed round-trip parse: ${(error as Error).message}`, { cause: error });
	}
	equal(second, first);
	return { parsed: second, printed };
}

export function assertInvalidFixture<TInput = unknown>({
	input,
	parse,
	name = 'value',
	message
}: { input: TInput; parse: (input: TInput | string) => unknown; name?: string; message?: string }): void {
	expect(() => parse(input), `${name} should reject an invalid value`).toThrow(message);
}
