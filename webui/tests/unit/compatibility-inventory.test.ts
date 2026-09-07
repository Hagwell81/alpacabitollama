import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import inventory from '../fixtures/compatibility-inventory.json';

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('compatibility inventory fixtures', () => {
  it('covers the current service, store, component, and IndexedDB integration points', () => {
    for (const path of inventory.capturedFrom) expect(source(path)).toBeTruthy();
    for (const entry of Object.values(inventory.services)) expect(source(entry.path)).toBeTruthy();
    for (const entry of Object.values(inventory.stores)) expect(source(entry.path)).toBeTruthy();
    for (const path of Object.values(inventory.components)) expect(source(path)).toBeTruthy();
  });

  it('matches the current Dexie database and store schema', () => {
    const dbSource = source('src/lib/services/database.service.ts');
    expect(dbSource).toContain(`super('${inventory.indexedDb.databaseName}')`);
    expect(dbSource).toContain(`this.version(${inventory.indexedDb.versions[0]})`);
    expect(dbSource).toContain(`this.version(${inventory.indexedDb.versions[1]})`);
    for (const [name, store] of Object.entries(inventory.indexedDb.stores)) {
      expect(dbSource).toContain(`${name}: '`);
      for (const index of store.indexes) expect(dbSource).toContain(index);
    }
    expect(dbSource).toContain('this.version(3)');
    expect(dbSource).toContain('streamingState');
    expect(inventory.indexedDb.streamingStateStore.present).toBe(true);
  });

  it('preserves adapter inputs for model modes, streaming, cancellation, and history', () => {
    expect(inventory.adapterInputs.singleModel.expected).toContain('/v1');
    expect(inventory.adapterInputs.router.expected).toContain('load/unload');
    expect(inventory.adapterInputs.streaming.events).toEqual(expect.arrayContaining(['content', 'reasoning_content', 'tool_calls', '[DONE]']));
    expect(inventory.adapterInputs.cancellation.signal).toBe('AbortSignal');
    expect(inventory.adapterInputs.history.expected).toContain('IDs');
  });
});
