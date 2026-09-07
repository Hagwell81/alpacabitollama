/* eslint-env node */
const CHANNELS = new Set([
  'get-server-status','get-provider-status','get-runtime-snapshot','get-feature-gates','evaluate-phase1','get-diagnostics-health','export-diagnostics','get-scheduler-status','ensure-ready','cancel-runtime-operation','get-model-catalog','get-model-fit-plan','start-server','stop-server','download-models','get-models-directory','set-selected-models','get-selected-models','get-app-data-directory','open-data-folder','get-installed-models','get-active-model','delete-model','switch-model','search-huggingface','download-huggingface-model','get-download-progress','get-all-download-progress','get-storage-info','get-last-error','copy-log-path','get-hardware-info','refresh-hardware-detection','get-hardware-snapshot','refresh-hardware-snapshot','go-back-to-main','register-user','login-user','get-current-user','logout-user','update-user-profile','web-search','fetch-web-page','jcm-health-check','jcm-index-repo','jcm-index-folder','jcm-search-symbols','jcm-get-symbol-source','jcm-list-repos','jcm-get-repo-outline','jcm-get-file-tree','jcm-get-file-content','jcm-get-context-bundle','jcm-get-file-outline','jcm-invalidate-cache','select-local-folder','get-api-settings','set-api-settings','api:health','api:count-tokens','api:queue-status','get-installed-backends','check-for-backend-update','download-backend','get-current-backend-info','update-backend','logs:get-initial','logs:open-file','logs:reveal-in-folder','docs:open','start-lazy-server','get-lazy-start-settings','set-lazy-start-enabled','get-provider-credentials','set-provider-credential','delete-provider-credential','count-tokens'
]);
const EVENTS = new Set(['model-switch-status','download-complete','logs:append','splash:update']);
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 256 * 1024;
const NO_ARGS = new Set(['get-server-status','get-provider-status','get-runtime-snapshot','get-feature-gates','evaluate-phase1','get-diagnostics-health','export-diagnostics','get-scheduler-status','get-model-catalog','start-server','stop-server','download-models','get-models-directory','get-selected-models','get-app-data-directory','open-data-folder','get-installed-models','get-active-model','get-all-download-progress','get-storage-info','get-last-error','copy-log-path','get-hardware-info','refresh-hardware-detection','get-hardware-snapshot','refresh-hardware-snapshot','go-back-to-main','get-current-user','logout-user','jcm-health-check','jcm-list-repos','select-local-folder','get-api-settings','api:health','api:queue-status','get-installed-backends','check-for-backend-update','get-current-backend-info','update-backend','logs:get-initial','logs:open-file','logs:reveal-in-folder','start-lazy-server','get-lazy-start-settings','get-provider-credentials','count-tokens']);
const STRING_CHANNELS = {
  'delete-model': 1, 'switch-model': 1, 'get-download-progress': 1,
  'jcm-index-repo': 1, 'jcm-index-folder': 1, 'jcm-get-repo-outline': 1,
  'jcm-invalidate-cache': 1, 'fetch-web-page': 1, 'docs:open': 1,
  'delete-provider-credential': 1
};
const BOOLEAN_CHANNELS = { 'set-lazy-start-enabled': 1 };
const ARRAY_CHANNELS = { 'set-selected-models': 1 };
const OBJECT_CHANNELS = { 'set-api-settings': 1, 'update-user-profile': 1 };
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value) => typeof value === 'boolean';
const isStringArray = (value) => Array.isArray(value) && value.every(isString);
const isMessageArray = (value) => Array.isArray(value) && value.every(isPlainObject);
const isOptional = (validator) => ({ validator, optional: true });
const channelSchemas = new Map([
  ['set-selected-models', [isStringArray]],
  ['set-api-settings', [isPlainObject]],
  ['update-user-profile', [isPlainObject]],
  ['get-model-fit-plan', [isString, isPlainObject]],
  ['search-huggingface', [isString, isOptional(isString)]],
  ['download-huggingface-model', [isString, isString, isOptional(isString)]],
  ['register-user', [isString, isString, isOptional(isString), isOptional(isString)]],
  ['login-user', [isString, isString]],
  ['web-search', [isString, isOptional(isNumber)]],
  ['jcm-search-symbols', [isString, isString, isOptional(isNumber), isOptional(isString)]],
  ['jcm-get-symbol-source', [isString, isString]],
  ['jcm-get-file-tree', [isString, isOptional(isString)]],
  ['jcm-get-file-content', [isString, isString]],
  ['jcm-get-file-outline', [isString, isString]],
  ['jcm-get-context-bundle', [isString, isString, isOptional(isBoolean)]],
  ['api:count-tokens', [isMessageArray, isOptional(isString)]],
  ['download-backend', [isOptional(isString), isOptional(isString)]],
  ['set-provider-credential', [isString, isString, isString, isString, isStringArray]],
  ['ensure-ready', [isPlainObject]],
  ['cancel-runtime-operation', [isPlainObject, isOptional(isString)]]
]);
function validateValue(value, path = 'argument') {
  if (typeof value === 'string') { if (value.length > MAX_STRING_LENGTH) throw new Error(`${path} exceeds string limit`); return; }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') throw new TypeError(`${path} is not serializable`);
  if (Array.isArray(value)) { if (value.length > 10000) throw new Error(`${path} exceeds item limit`); value.forEach((item, index) => validateValue(item, `${path}[${index}]`)); return; }
  if (isPlainObject(value)) { for (const [key, item] of Object.entries(value)) validateValue(item, `${path}.${key}`); }
}
function validateChannel(channel) { if (typeof channel !== 'string' || !CHANNELS.has(channel)) throw new Error('IPC channel is not allowed'); return channel; }
function validateArgs(channel, args) {
  validateChannel(channel);
  if (!Array.isArray(args)) throw new TypeError('IPC arguments must be an array');
  if (NO_ARGS.has(channel)) {
    if (args.length) throw new TypeError(`IPC channel ${channel} does not accept arguments`);
  } else {
    let schema = channelSchemas.get(channel);
    if (!schema && STRING_CHANNELS[channel]) schema = Array.from({ length: STRING_CHANNELS[channel] }, () => isString);
    if (!schema && BOOLEAN_CHANNELS[channel]) schema = [isBoolean];
    if (!schema && ARRAY_CHANNELS[channel]) schema = [Array.isArray];
    if (!schema && OBJECT_CHANNELS[channel]) schema = [isPlainObject];
    if (schema) {
      if (args.length > schema.length) throw new TypeError(`IPC channel ${channel} received too many arguments`);
      for (let index = 0; index < schema.length; index += 1) {
        const contract = schema[index];
        const optional = contract.optional === true;
        const validator = optional ? contract.validator : contract;
        const value = args[index];
        if (value === undefined && optional) continue;
        if (value === undefined || !validator(value)) {
          if (STRING_CHANNELS[channel]) throw new TypeError(`IPC channel ${channel} requires one string argument`);
          if (BOOLEAN_CHANNELS[channel]) throw new TypeError(`IPC channel ${channel} requires one boolean argument`);
          if (ARRAY_CHANNELS[channel]) throw new TypeError(`IPC channel ${channel} requires one array argument`);
          if (OBJECT_CHANNELS[channel]) throw new TypeError(`IPC channel ${channel} requires one object argument`);
          throw new TypeError(`IPC channel ${channel} has invalid argument ${index + 1}`);
        }
      }
    }
  }
  args.forEach((value, index) => {
    if (value !== undefined) validateValue(value, `argument[${index}]`);
  });
  let size;
  try { size = Buffer.byteLength(JSON.stringify(args)); } catch { throw new TypeError('IPC arguments must be serializable'); }
  if (size > MAX_PAYLOAD_BYTES) throw new Error('IPC payload exceeds size limit');
  return args;
}
function validateEvent(channel) { if (typeof channel !== 'string' || !EVENTS.has(channel)) throw new Error('IPC event is not allowed'); return channel; }
function validateEventCallback(callback) { if (typeof callback !== 'function') throw new TypeError('IPC event callback must be a function'); return callback; }
function validateSender(event) {
  if (!event || !event.sender) throw new Error('IPC sender is not available');
  if (event.sender.isDestroyed?.()) throw new Error('IPC sender is destroyed');
  const url = event.senderFrame?.url;
  if (url && !/^(file:|https?:\/\/localhost(?::\d+)?(?:\/|$))/.test(url)) throw new Error('IPC sender is not trusted');
  return event;
}
function installMainValidation(ipcMain) {
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => original(channel, (event, ...args) => {
    validateSender(event);
    return handler(event, ...validateArgs(channel, args));
  });
  return ipcMain;
}
module.exports = { CHANNELS, EVENTS, MAX_PAYLOAD_BYTES, validateChannel, validateArgs, validateEvent, validateEventCallback, validateSender, installMainValidation };
