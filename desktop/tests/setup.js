/* eslint-env node */
/**
 * Vitest setup file — bridges `require('node:test')` to vitest's globals.
 *
 * Many test files in this project use `const test = require('node:test')`
 * alongside `node:assert/strict`. Vitest with `globals: true` provides `test`,
 * `describe`, `it`, etc. as globals, but the `require('node:test')` call
 * returns Node's built-in test runner instead, causing those tests to run
 * outside vitest's reporting and lifecycle.
 *
 * This shim intercepts `require('node:test')` and returns an object that maps
 * to vitest's globals, so all tests run under a single runner.
 */
const Module = require('module');

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'node:test') {
    return {
      test: globalThis.test,
      describe: globalThis.describe,
      it: globalThis.it,
      before: globalThis.before,
      after: globalThis.after,
      beforeEach: globalThis.beforeEach,
      afterEach: globalThis.afterEach,
      // node:test exports these as well; map to vitest equivalents.
      only: globalThis.it.only,
      skip: globalThis.it.skip,
      todo: globalThis.it.todo,
    };
  }
  return originalRequire.apply(this, arguments);
};
