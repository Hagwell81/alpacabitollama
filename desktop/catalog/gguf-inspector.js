/* eslint-env node */
/**
 * Bounded GGUF metadata inspector.
 *
 * This module deliberately only reads the GGUF container header and metadata
 * entries. It does not resolve executables, load tensors, or start a model.
 */
const fs = require('fs');
const { TextDecoder } = require('util');

const MAGIC = 0x46554747; // "GGUF" as a little-endian uint32
const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxMetadataBytes: 4 * 1024 * 1024,
  maxKeyBytes: 16 * 1024,
  maxStringBytes: 1024 * 1024,
  maxArrayLength: 100000,
  maxExtensions: 128
});

const TYPES = Object.freeze({
  0: { name: 'uint8', read: (b, o) => b.readUInt8(o), size: 1 },
  1: { name: 'int8', read: (b, o) => b.readInt8(o), size: 1 },
  2: { name: 'uint16', read: (b, o) => b.readUInt16LE(o), size: 2 },
  3: { name: 'int16', read: (b, o) => b.readInt16LE(o), size: 2 },
  4: { name: 'uint32', read: (b, o) => b.readUInt32LE(o), size: 4 },
  5: { name: 'int32', read: (b, o) => b.readInt32LE(o), size: 4 },
  6: { name: 'float32', read: (b, o) => b.readFloatLE(o), size: 4 },
  7: { name: 'bool', read: (b, o) => b.readUInt8(o) !== 0, size: 1 },
  8: { name: 'string' },
  9: { name: 'array' },
  10: { name: 'uint64', read: (b, o) => b.readBigUInt64LE(o), size: 8 },
  11: { name: 'int64', read: (b, o) => b.readBigInt64LE(o), size: 8 },
  12: { name: 'float64', read: (b, o) => b.readDoubleLE(o), size: 8 }
});

// The supported grammar is intentionally explicit. Unknown valid fields are
// retained in extensions, rather than being mistaken for recognized metadata.
const RECOGNIZED = Object.freeze({
  'general.architecture': ['string'], 'general.quantization_version': ['uint32'],
  'general.alignment': ['uint32'], 'general.name': ['string'],
  'general.basename': ['string'], 'general.size_label': ['string'],
  'general.file_type': ['uint32'], 'general.description': ['string'],
  'general.uuid': ['string'], 'general.parameter_count': ['uint64'],
  'general.n_tensors': ['uint64'], 'general.languages': ['array'],
  'tokenizer.ggml.model': ['string'], 'tokenizer.ggml.pre': ['string'],
  'tokenizer.ggml.tokens': ['array'], 'tokenizer.ggml.merges': ['array'],
  'tokenizer.ggml.bos_token_id': ['uint32', 'uint64'],
  'tokenizer.ggml.eos_token_id': ['uint32', 'uint64'],
  'tokenizer.ggml.padding_token_id': ['uint32', 'uint64'],
  'tokenizer.ggml.add_bos_token': ['bool'], 'tokenizer.ggml.add_eos_token': ['bool'],
  'llama.context_length': ['uint32', 'uint64'], 'llama.embedding_length': ['uint32', 'uint64'],
  'llama.block_count': ['uint32', 'uint64'], 'llama.feed_forward_length': ['uint32', 'uint64'],
  'llama.attention.head_count': ['uint32', 'uint64'],
  'llama.attention.head_count_kv': ['uint32', 'uint64'],
  'llama.attention.layer_norm_rms_epsilon': ['float32', 'float64'],
  'llama.rope.dimension_count': ['uint32', 'uint64'],
  'llama.rope.freq_base': ['float32', 'float64']
});

function limits(options) { return { ...DEFAULT_LIMITS, ...(options || {}) }; }
function emptyResult() {
  return { format: 'gguf', valid: false, header: null, metadata: {}, metadataStatus: {}, extensions: {}, errors: [], truncated: false, bytesRead: 0, modelLoadAttempted: false };
}
function error(result, code, message, key) {
  result.errors.push({ code, message, ...(key ? { key } : {}) });
  if (code === 'TRUNCATED') result.truncated = true;
  if (code === 'LIMIT_EXCEEDED') result.truncated = true;
}
function safeValue(value) {
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (Array.isArray(value)) return value.map(safeValue);
  return value;
}

class BufferReader {
  constructor(buffer, maxBytes) { this.buffer = buffer; this.offset = 0; this.maxBytes = Math.min(buffer.length, maxBytes); }
  need(size) { if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.maxBytes) throw new ParseError('TRUNCATED', 'GGUF metadata is truncated.'); }
  bytes(size) { this.need(size); const value = this.buffer.subarray(this.offset, this.offset + size); this.offset += size; return value; }
  u32() { return this.bytes(4).readUInt32LE(0); }
  u64() { return this.bytes(8).readBigUInt64LE(0); }
  string(maxBytes) { const length = this.u64(); if (length > BigInt(maxBytes)) throw new ParseError('LIMIT_EXCEEDED', 'GGUF string exceeds the configured limit.'); const bytes = this.bytes(Number(length)); try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ParseError('MALFORMED_ENCODING', 'GGUF metadata contains invalid UTF-8.'); } }
}
class ParseError extends Error { constructor(code, message, key) { super(message); this.code = code; this.key = key; } }

function readValue(reader, type, opts, depth = 0) {
  const spec = TYPES[type];
  if (!spec || depth > 2) throw new ParseError('MALFORMED_VALUE', 'Unsupported or excessively nested GGUF value.');
  if (spec.name === 'string') return reader.string(opts.maxStringBytes);
  if (spec.name === 'array') {
    const elementType = reader.u32(); const count = reader.u64();
    if (count > BigInt(opts.maxArrayLength)) throw new ParseError('LIMIT_EXCEEDED', 'GGUF array exceeds the configured limit.');
    const values = [];
    for (let i = 0; i < Number(count); i += 1) values.push(readValue(reader, elementType, opts, depth + 1));
    return values;
  }
  const value = reader.bytes(spec.size);
  return safeValue(spec.read(value, 0));
}

function parseBuffer(input, options = {}) {
  const opts = limits(options); const result = emptyResult();
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  result.bytesRead = Math.min(buffer.length, opts.maxBytes);
  let currentKey;
  try {
    const reader = new BufferReader(buffer, opts.maxBytes);
    if (reader.u32() !== MAGIC) throw new ParseError('INVALID_MAGIC', 'Not a GGUF file.');
    const version = reader.u32();
    if (![2, 3].includes(version)) throw new ParseError('UNSUPPORTED_VERSION', `Unsupported GGUF version: ${version}.`);
    const tensorCount = reader.u64(); const metadataCount = reader.u64();
    if (metadataCount > BigInt(opts.maxArrayLength)) throw new ParseError('LIMIT_EXCEEDED', 'GGUF metadata entry count exceeds the configured limit.');
    result.header = { version, tensorCount: safeValue(tensorCount), metadataKvCount: Number(metadataCount) };
    reader.maxBytes = Math.min(reader.maxBytes, reader.offset + opts.maxMetadataBytes);
    for (let index = 0; index < Number(metadataCount); index += 1) {
      const key = reader.string(opts.maxKeyBytes); currentKey = key; const type = reader.u32();
      const spec = TYPES[type];
      if (!spec) throw new ParseError('MALFORMED_VALUE', `Unknown GGUF metadata type: ${type}.`, key);
      const value = readValue(reader, type, opts);
      const typeName = spec.name;
      if (Object.prototype.hasOwnProperty.call(RECOGNIZED, key)) {
        if (!RECOGNIZED[key].includes(typeName)) {
          result.metadataStatus[key] = 'malformed';
          error(result, 'MALFORMED_TYPE', `Unexpected type ${typeName} for recognized metadata.`, key);
        } else {
          result.metadata[key] = value; result.metadataStatus[key] = 'known';
        }
      } else if (Object.keys(result.extensions).length < opts.maxExtensions) {
        result.extensions[key] = { type: typeName, value };
      }
    }
    for (const key of Object.keys(RECOGNIZED)) if (!Object.prototype.hasOwnProperty.call(result.metadataStatus, key)) result.metadataStatus[key] = 'unknown';
    result.valid = result.errors.length === 0;
  } catch (caught) {
    const parseError = caught instanceof ParseError ? caught : new ParseError('MALFORMED', caught.message);
    const malformedKey = parseError.key || currentKey;
    if (malformedKey && Object.prototype.hasOwnProperty.call(RECOGNIZED, malformedKey)) {
      result.metadataStatus[malformedKey] = 'malformed';
    }
    error(result, parseError.code, parseError.message, malformedKey);
    result.valid = false;
    if (result.header) for (const key of Object.keys(RECOGNIZED)) if (!Object.prototype.hasOwnProperty.call(result.metadataStatus, key)) result.metadataStatus[key] = 'unknown';
  }
  return result;
}

async function inspectGGUF(source, options = {}) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return parseBuffer(source, options);
  const opts = limits(options); const chunks = []; let total = 0;
  const iterable = typeof source === 'string' ? fs.createReadStream(source, { highWaterMark: 64 * 1024 }) : source;
  if (!iterable || !iterable[Symbol.asyncIterator]) throw new TypeError('GGUF source must be a Buffer, path, or async iterable.');
  for await (const chunk of iterable) {
    const value = Buffer.from(chunk); const remaining = opts.maxBytes - total;
    if (remaining <= 0) break;
    chunks.push(value.subarray(0, remaining)); total += Math.min(value.length, remaining);
    if (value.length > remaining) break;
  }
  const result = parseBuffer(Buffer.concat(chunks, total), opts);
  if (total >= opts.maxBytes) { result.valid = false; error(result, 'LIMIT_EXCEEDED', 'GGUF inspection reached the configured byte limit.'); }
  return result;
}

function inspectGGUFBuffer(buffer, options) { return parseBuffer(buffer, options); }
function inspectGGUFFile(filePath, options) { return inspectGGUF(filePath, options); }

module.exports = { inspectGGUF, inspectGGUFBuffer, inspectGGUFFile, parseBuffer, DEFAULT_LIMITS, RECOGNIZED, TYPES };
