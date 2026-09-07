/* eslint-env node */

const OMIT_KEYS = /^(?:message|prompt|content|reasoning|tool(?:s|_payload)?|raw(?:_)?(?:body|request|response)|request(?:_)?(?:body|message)|response(?:_)?body|conversation|partial[_-]?output|stack|stdout|stderr)$/i;
const SECRET_KEYS = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|password|passphrase|private[-_]?key|cookie|set-cookie|credential|bearer|session)/i;
const METRIC_KEYS = /(?:token|tokens|prompt[_-]?tokens|completion[_-]?tokens|input[_-]?tokens|output[_-]?tokens|per[_-]?token|token[_-]?count)/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s"']+/gi;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s"']+/g;
const UNIX_PATH = /(?:^|[\s(])\/(?:Users|home|private|tmp|var|opt|workspace|root)\/[^\s"']+/gi;
const CREDENTIAL_URL = /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@[^\s"']+/gi;

function redactString(value) {
  let result = String(value);
  result = result.replace(CREDENTIAL_URL, '[REDACTED_URL]');
  result = result.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]');
  result = result.replace(/\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|private[-_]?key)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/)[0]}=[REDACTED]`);
  result = result.replace(URL_PATTERN, '[REDACTED_URL]');
  result = result.replace(WINDOWS_PATH, '[REDACTED_PATH]');
  result = result.replace(UNIX_PATH, (match) => `${match.startsWith(' ') ? ' ' : ''}[REDACTED_PATH]`);
  return result;
}

function isErrorMessageKey(key, parentKey) {
  return key.toLowerCase() === 'message' && /error|failure|diagnostic|redacted/i.test(parentKey || '');
}

function redactValue(value, options = {}, parentKey = '') {
  const metricsEnabled = options.metricsEnabled === true;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options, parentKey)).filter((item) => item !== undefined);
  if (typeof value !== 'object') return undefined;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (OMIT_KEYS.test(key) && !isErrorMessageKey(key, parentKey)) continue;
    if (SECRET_KEYS.test(key)) { output[key] = '[REDACTED]'; continue; }
    if (!metricsEnabled && METRIC_KEYS.test(key)) continue;
    const sanitized = redactValue(child, options, key);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function redactDiagnostic(input, options = {}) {
  const result = redactValue(input, options);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  return result;
}

module.exports = { redactString, redactValue, redactDiagnostic };
