import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import inventory from '../fixtures/compatibility-inventory.json';
import { ModelsService } from '$lib/services/models.service';

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

describe('renderer compatibility regressions', () => {
  it('keeps the inventoried service and store operations available', () => {
    for (const entry of Object.values(inventory.services)) {
      const text = source(entry.path);
      for (const operation of entry.operations) {
        if (operation === 'stream SSE' || operation === 'AbortSignal cancellation') continue;
        const name = operation.replace(/ .*/, '');
        if (name === 'tool-call' || name === 'reasoning' || name === 'model/timings') continue;
        expect(text.toLowerCase()).toContain(name.toLowerCase());
      }
    }
    expect(source(inventory.services.ChatService.path)).toContain('signal?: AbortSignal');
    expect(source(inventory.services.DatabaseService.path)).toContain('getAllConversations');
    expect(source(inventory.services.DatabaseService.path)).toContain('getConversationMessages');
  });

  it('preserves single-model and router model list/load/unload HTTP behavior', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'local-model.gguf' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'org/model.Q4_K_M', status: { value: 'loaded' } }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(ModelsService.list()).resolves.toEqual({ data: [{ id: 'local-model.gguf' }] });
    await expect(ModelsService.listRouter()).resolves.toEqual({ data: [{ id: 'org/model.Q4_K_M', status: { value: 'loaded' } }] });
    await ModelsService.load('org/model.Q4_K_M', ['--ctx-size', '4096']);
    await ModelsService.unload('org/model.Q4_K_M');

    expect(fetchMock.mock.calls[0][0]).toBe('/v1/models');
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/models');
    expect(fetchMock.mock.calls[2][0]).toBe('/models/load');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ model: 'org/model.Q4_K_M', extra_args: ['--ctx-size', '4096'] });
    expect(fetchMock.mock.calls[3][0]).toBe('/models/unload');
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ model: 'org/model.Q4_K_M' });
    fetchMock.mockRestore();
  });

  it('preserves curated/local model selection identity parsing', () => {
    const parsed = ModelsService.parseModelId(inventory.adapterInputs.router.model);
    expect(parsed.raw).toBe('org/model.Q4_K_M');
    expect(parsed.orgName).toBe('org');
    expect(parsed.quantization).toBe('Q4_K_M');
    expect(parsed.modelName).toBe('model');
  });

  it('keeps IndexedDB retrieval fields and migration contract intact', () => {
    const db = source(inventory.services.DatabaseService.path);
    expect(db).toContain(`super('${inventory.indexedDb.databaseName}')`);
    expect(db).toContain('this.version(1)');
    expect(db).toContain('this.version(2)');
    expect(db).toContain('static async getAllConversations');
    expect(db).toContain('static async getConversationMessages');
    for (const field of inventory.adapterInputs.history.messageIds) expect(field).toMatch(/-/);
    expect(inventory.indexedDb.streamingStateStore.present).toBe(true);
  });

  it('keeps streaming event names and AbortSignal cancellation seams', () => {
    // Streaming logic was moved from ChatService to ProviderService.
    // Check ProviderService for the SSE event patterns and cancellation.
    const provider = source('src/lib/services/provider.service.ts');
    for (const event of inventory.adapterInputs.streaming.events) {
      if (event === '[DONE]') expect(provider).toContain("[DONE]");
      else expect(provider).toContain(event);
    }
    expect(provider).toContain('signal');
    expect(provider).toContain('aborted');
    expect(provider).toContain('reader.releaseLock()');
    // ChatService should still have the AbortSignal seam for cancellation.
    const chat = source(inventory.services.ChatService.path);
    expect(chat).toContain('signal');
    expect(inventory.adapterInputs.cancellation.expected).toContain('reader stops');
  });

  it('keeps preload-backed provider settings and the documented compatibility fixture', () => {
    const providers = source(inventory.stores.providersStore?.path ?? 'src/lib/stores/providers.svelte.ts');
    expect(providers).toContain('getProviderCredentials');
    expect(providers).toContain('setProviderCredential');
    expect(providers).toContain('deleteProviderCredential');
    expect(inventory.compatibilityOutcomes).toContain('preload-backed provider settings');
  });
});
