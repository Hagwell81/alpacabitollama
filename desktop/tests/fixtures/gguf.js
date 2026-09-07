/* eslint-env node */
// Small binary GGUF fixtures contain metadata only; no tensor payload is used.
function u64(value) { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(BigInt(value)); return buffer; }
function string(value) { const bytes = Buffer.from(value); return Buffer.concat([u64(bytes.length), bytes]); }
function rawString(bytes, declaredLength = bytes.length) { return Buffer.concat([u64(declaredLength), Buffer.from(bytes)]); }
function value(type, data) {
  if (type === 4) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(data); return buffer; }
  if (type === 7) return Buffer.from([data ? 1 : 0]);
  if (type === 8) return string(data);
  if (type === 9) return Buffer.concat([Buffer.from([4, 0, 0, 0]), u64(data.length), ...data.map((item) => value(4, item))]);
  throw new Error(`fixture type ${type} is not implemented`);
}
function entry(key, type, data) { const typeBuffer = Buffer.alloc(4); typeBuffer.writeUInt32LE(type); return Buffer.concat([string(key), typeBuffer, value(type, data)]); }
function rawEntry(keyBytes, type, rawValue) { const typeBuffer = Buffer.alloc(4); typeBuffer.writeUInt32LE(type); return Buffer.concat([rawString(keyBytes), typeBuffer, rawValue]); }
function gguf(entries, version = 3) {
  const header = Buffer.alloc(24); header.writeUInt32LE(0x46554747, 0); header.writeUInt32LE(version, 4);
  header.writeBigUInt64LE(0n, 8); header.writeBigUInt64LE(BigInt(entries.length), 16);
  return Buffer.concat([header, ...entries]);
}
const valid = gguf([
  entry('general.architecture', 8, 'llama'), entry('llama.context_length', 4, 4096),
  entry('tokenizer.ggml.add_bos_token', 7, true), entry('custom.safe_extension', 8, 'kept')
]);
const absent = gguf([entry('general.architecture', 8, 'llama')]);
const malformedType = gguf([entry('llama.context_length', 8, 'not-a-number')]);
const malformedLength = gguf([rawEntry(Buffer.from('general.name'), 8, rawString(Buffer.from('short'), 99))]);
const malformedEncoding = gguf([rawEntry(Buffer.from('general.name'), 8, rawString([0xc3, 0x28]))]);
const oversized = gguf([entry('general.name', 8, '0123456789')]);
const truncated = valid.subarray(0, valid.length - 2);
const changedBytes = Object.freeze({ original: Buffer.from('model-bytes-v1'), changed: Buffer.from('model-bytes-v2') });
module.exports = {
  gguf, entry, rawEntry, rawString, valid, absent, malformedType, malformedLength, malformedEncoding,
  oversized, truncated, changedBytes
};
