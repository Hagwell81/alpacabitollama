# Implementation Plan: AlpacaBitOllama Runtime and UI Enhancements

## Overview

Implement Requirements 1–20 in the existing Electron/Svelte desktop topology without replacing the current llama-server, router, curated-download, IndexedDB, or secure preload workflows. Main-process JavaScript owns processes, lifecycle, providers, files, credentials, configuration, scheduling, verification, and diagnostics; the Svelte/TypeScript renderer owns presentation, conversation state, and IndexedDB access. Tasks are ordered so pure contracts and test fixtures land before stateful integrations, and Phase 2 remains disabled until the Phase 1 gate passes.

Implementation language is **JavaScript for `desktop/` and TypeScript/Svelte for `webui/`**. Tests use the existing Vitest projects and Playwright browser suite. Use `fast-check` (pinned in `webui/package.json`) for the required property tests; do not implement custom generators or shrinkers.

## Tasks

- [x] 1. Baseline contracts, test harness, and compatibility inventory
  - [x] 1.1 Add shared runtime/provider/catalog/queue/error/stream contract modules under `desktop/runtime/`, `desktop/providers/`, and `webui/src/lib/types/runtime.ts`; define serializable success/error envelopes, correlation IDs, safe error fields, all eight public runtime states, model/provider references, and the normalized stream event union.
    - Target: `desktop/runtime/`, `desktop/providers/`, `webui/src/lib/types/runtime.ts`.
    - Intent: establish the common vocabulary used by main, preload, and renderer without changing existing public operations.
    - Prerequisites: none; use `design.md` Data Models and Error taxonomy.
    - Requirements: 1.1, 3.1, 4.1, 6.1, 8.2, 12.1, 16.1.
  - [x] 1.2 Inventory existing `main.js`, `preload.js`, `api-server.js`, `request-manager.js`, `binary-manager.js`, `lazy-start-manager.js`, WebUI services/stores/components, IPC channels, and IndexedDB stores; encode the inventory as compatibility fixtures and adapter test inputs under `desktop/tests/` and `webui/tests/fixtures/`.
    - Target: existing integration points plus `desktop/tests/fixtures/`, `webui/tests/fixtures/`.
    - Intent: capture current single-model, curated-download, router, history, streaming, cancellation, and preload authorization outcomes before refactoring.
    - Prerequisites: 1.1.
    - Requirements: 16.1, 16.6, 17.2, 17.3, 17.6.
  - [x] 1.3 Configure shared Vitest coverage for desktop Node modules and WebUI unit/client/UI projects, add deterministic fake-clock and controlled-process/reader/provider fixtures, and pin the property-testing dependency.
    - Target: `webui/package.json`, `webui/vitest.config.*`, `webui/tests/`, `desktop/tests/`, root scripts only if needed.
    - Intent: make pure, integration, browser, and property tests runnable without starting real long-lived servers.
    - Prerequisites: 1.2.
    - Requirements: 17.1, 17.2, 17.4, 17.6.
  - [x] 1.4 * Add baseline regression tests for current IPC aliases, local llama-server inference, curated selection/download, router mode, IndexedDB retrieval, streaming/cancellation, and preload allowlisting.
    - Target: `desktop/tests/compatibility/`, `webui/tests/compatibility/`.
    - Intent: fail fast if later migrations remove or rename an existing observable operation.
    - Prerequisites: 1.2, 1.3.
    - Requirements: 16.1, 16.6, 17.2, 17.3, 17.6.
  - [x] 1.5 * Add parser/serializer fixture conventions and a parse-print-parse test helper for runtime metadata, diagnostics, configuration, and Streaming_State.
    - Target: `desktop/tests/helpers/`, `webui/tests/helpers/`.
    - Intent: provide the shared test mechanism for Requirement 17.5 and later round-trip properties.
    - Prerequisites: 1.1, 1.3.
    - Requirements: 4.6, 11.6, 13.7, 17.5.

- [x] 2. Phase 1 runtime lifecycle and readiness coordination
  - [x] 2.1 Implement `desktop/runtime/runtime-state-machine.js` with the explicit adjacency table, transition reasons, correlation IDs, progress/cancellable metadata, bounded history, invalid-transition diagnostics, and operation epoch checks.
    - Target: `desktop/runtime/runtime-state-machine.js`, `desktop/diagnostics/` interface only.
    - Intent: ensure exactly one public Runtime_State and reject stale/invalid transitions without mutating valid state.
    - Prerequisites: 1.1, 1.3.
    - Requirements: 1.1–1.5, 2.5, 6.7.
  - [x] 2.2 Implement `desktop/runtime/managed-process.js` for curated executable selection, owned process tokens, stdout/stderr capture, health polling, graceful/forced termination, and safe exit classification.
    - Target: `desktop/runtime/managed-process.js`; integrate only through coordinator seams.
    - Intent: centralize resource ownership and prevent renderer-controlled executable paths or arguments.
    - Prerequisites: 1.1, 1.2, 2.1.
    - Requirements: 1.2, 1.4, 2.4, 9.3, 10.4.
  - [x] 2.3 Implement `desktop/runtime/ensure-ready-registry.js` with provider/model keys, shared readiness promises, per-caller detachment, safe shared cancellation, FIFO mutation lane, and one local-server model-load mutex.
    - Target: `desktop/runtime/ensure-ready-registry.js`.
    - Intent: coalesce identical EnsureReady calls while serializing different model mutations and preventing stale epochs from committing.
    - Prerequisites: 2.1, 2.2, 1.3.
    - Requirements: 2.1–2.5, 6.7.
  - [x] 2.4 Implement `desktop/runtime/runtime-coordinator.js` to compose lifecycle, process, readiness, and compatibility services; expose snapshots and compatibility aliases for `main.js` handlers.
    - Target: `desktop/runtime/runtime-coordinator.js`, `desktop/main.js`, `desktop/lazy-start-manager.js`.
    - Intent: make the coordinator the only owner of mutable lifecycle/model-load state while preserving `get-server-status`, `start-server`, `stop-server`, and `switch-model` behavior.
    - Prerequisites: 2.1–2.3.
    - Requirements: 1.1–1.4, 2.4, 16.1, 16.5.
  - [x] 2.5 * Add lifecycle transition, stale-epoch, startup failure, cleanup, and invalid-transition tests.
    - Target: `desktop/tests/runtime-state-machine.test.js`, `desktop/tests/runtime-coordinator.test.js`.
    - Intent: cover exact transition outcomes, resource release, safe recovery action, and terminal failure.
    - Prerequisites: 2.1–2.4.
    - Requirements: 1.2–1.4, 2.4, 17.1, 17.2.
  - [x] 2.6 Add fast-check tests for **Property 1: Lifecycle transition and operation safety**.
    - Validate: Requirements 1.1, 1.3, 1.5, 2.5, 6.7.
    - Target: `desktop/tests/properties/lifecycle.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 2.1–2.4.
  - [x] 2.7 Add fast-check tests for **Property 2: EnsureReady coalescing and cancellation isolation**.
    - Validate: Requirements 2.1–2.3.
    - Target: `desktop/tests/properties/ensure-ready.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 2.3–2.4.

- [x] 3. Provider boundary and local adapter
  - [x] 3.1 Implement `desktop/providers/provider-contract.js` and normalized error/response utilities for descriptor, listing, readiness, health, chat, stream, cancellation, capabilities, and provider status.
    - Target: `desktop/providers/provider-contract.js`, `desktop/providers/normalize.js`.
    - Intent: provide one typed behavioral contract while retaining provider-specific wire details behind adapters.
    - Prerequisites: 1.1, 2.4.
    - Requirements: 3.1, 3.3–3.5, 18.1, 18.6.
  - [x] 3.2 Implement `desktop/providers/llama-server-provider.js` around current `/v1`, health, model, and slot behavior; preserve current request parameters, reasoning/tool events, model switching, AbortSignal cancellation, and local-only defaults.
    - Target: `desktop/providers/llama-server-provider.js`, `desktop/api-server.js`, `desktop/request-manager.js` integration seams.
    - Intent: move current behavior behind the common provider contract without changing renderer chat APIs.
    - Prerequisites: 3.1, 2.4.
    - Requirements: 3.2, 8.1–8.6, 16.1–16.3.
  - [x] 3.3 Implement `desktop/providers/provider-registry.js` with descriptor registration, capability gating, Phase 1/Phase 2 flags, explicit remote-provider opt-in, and provider status projection.
    - Target: `desktop/providers/provider-registry.js`, `desktop/feature-gates.js`.
    - Intent: keep local provider available when optional providers are unavailable and prevent Phase 2 use before the gate.
    - Prerequisites: 3.1, 2.4.
    - Requirements: 3.1, 3.3, 18.1, 18.5, 19.6, 20.6.
  - [x] 3.4 Update `webui/src/lib/services/chat.service.ts` and `provider.service.ts` to preserve `sendMessage`, reasoning/tool callbacks, model selection, and AbortSignal while consuming normalized provider responses.
    - Target: `webui/src/lib/services/chat.service.ts`, `webui/src/lib/services/provider.service.ts`.
    - Intent: keep the existing renderer chat contract stable while delegating transport and SSE normalization.
    - Prerequisites: 3.1–3.3.
    - Requirements: 3.2, 8.1–8.2, 16.1–16.2.
  - [x] 3.5 * Add contract tests using mocked providers for capability refusal, equivalent response normalization, cancellation, health, malformed payloads, auth failures, and redacted provider errors.
    - Target: `desktop/tests/providers/`, `webui/tests/unit/provider.service.test.ts`.
    - Prerequisites: 3.1–3.4.
    - Requirements: 3.1–3.5, 17.1–17.3.
  - [x] 3.6 Add fast-check tests for **Property 3: Provider normalization and capability refusal**.
    - Validate: Requirements 3.1, 3.3–3.5, 18.1, 18.6.
    - Target: `desktop/tests/properties/provider-normalization.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 3.1–3.3.
  - [x] 3.7 Add fast-check tests for **Property 4: Provider error redaction**.
    - Validate: Requirements 3.4, 10.3, 10.7, 12.1, 12.6.
    - Target: `desktop/tests/properties/provider-redaction.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 3.1–3.3.

- [x] 4. Catalog, GGUF inspection, model identity, and digests
  - [x] 4.1 Implement `desktop/catalog/model-catalog.js` as an immutable normalized snapshot merger for local GGUF, curated, router, and discovery sources, including deterministic ordering, stale-source retention, aliases, availability, verification, and source failure records.
    - Target: `desktop/catalog/model-catalog.js`.
    - Intent: preserve verified records when sources fail and represent each Model_Record consistently.
    - Prerequisites: 1.1, 3.1, 2.4.
    - Requirements: 4.1, 4.5, 14.1, 18.2–18.3.
  - [x] 4.2 Implement `desktop/catalog/gguf-inspector.js` with bounded streaming header/key-value parsing, recognized typed metadata, explicit unknown/malformed status, safe extensions, and no model loading during inspection.
    - Target: `desktop/catalog/gguf-inspector.js`.
    - Intent: tolerate malformed metadata without discarding the model record and enforce metadata resource limits.
    - Prerequisites: 4.1, 1.3.
    - Requirements: 4.2, 17.5, performance/resource limits.
  - [x] 4.3 Implement `desktop/catalog/model-identity.js` and integrate streamed digest identity with catalog aliases; equal verified digests collapse content identity, different digests remain distinct, and unverified artifacts cannot be available for execution.
    - Target: `desktop/catalog/model-identity.js`, `desktop/security/artifact-verifier.js` integration seam.
    - Prerequisites: 4.1, 4.2, 1.1.
    - Requirements: 4.3–4.6, 9.1–9.2.
  - [x] 4.4 Add catalog and GGUF fixtures for valid fields, absent fields, malformed types/lengths/encodings, duplicate digest aliases, changed bytes, unavailable sources, stale records, deterministic sort, and serializer/deserializer round trips.
    - Target: `desktop/tests/catalog/`, `desktop/tests/fixtures/gguf/`.
    - Prerequisites: 4.1–4.3.
    - Requirements: 4.2–4.6, 17.5.
  - [x] 4.5 Add fast-check tests for **Property 5: Catalog identity and serialization round trip**.
    - Validate: Requirements 4.3, 4.4, 4.6.
    - Target: `desktop/tests/properties/catalog-identity.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 4.1–4.3.
  - [x] 4.6 Add fast-check tests for **Property 6: GGUF and catalog failure tolerance**.
    - Validate: Requirements 4.2, 4.5, 18.3.
    - Target: `desktop/tests/properties/catalog-failure.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 4.1–4.3.

- [x] 5. Hardware snapshots and deterministic fit planning
  - [x] 5.1 Implement `desktop/planning/hardware-snapshot.js` with CPU, accelerator, usable memory, driver/OS identity, backend capabilities, confidence normalization, and non-blocking probe failures.
    - Target: `desktop/planning/hardware-snapshot.js`, existing hardware IPC integration in `desktop/main.js`.
    - Intent: expose safe Hardware_Snapshot data without optimistic defaults when detection is incomplete.
    - Prerequisites: 1.1, 2.4.
    - Requirements: 5.1, 5.3, 16.5.
  - [x] 5.2 Implement `desktop/planning/fit-plan.js` with conservative weight/KV/overhead estimates, usable-memory safety fraction, context recommendation, offload capability checks, assumptions, alternatives, and deterministic non-mutating output.
    - Target: `desktop/planning/fit-plan.js`.
    - Intent: return `fits`, `tight`, `does-not-fit`, or `unknown`; never claim fit when required inputs are missing.
    - Prerequisites: 4.1, 5.1.
    - Requirements: 5.2–5.5, 14.1–14.3.
  - [x] 5.3 * Add example tests for known hardware/model sizes, missing hardware, conservative boundaries, alternatives, and repeated non-mutating evaluation.
    - Target: `desktop/tests/planning/fit-plan.test.js`.
    - Prerequisites: 5.1–5.2.
    - Requirements: 5.2–5.5, 17.1, 17.6.
  - [x] 5.4 Add fast-check tests for **Property 7: Deterministic conservative fit planning**.
    - Validate: Requirements 5.2, 5.3, 5.5.
    - Target: `desktop/tests/properties/fit-plan.property.test.js`.
    - Prerequisites: 5.2.

- [x] 6. Scheduler, admission, eviction, circuit breaker, and OOM recovery
  - [x] 6.1 Implement `desktop/scheduling/admission-scheduler.js` with bounded active/queued work, typed capacity rejection, exact one terminal outcome, shutdown/replacement clearing, injected time, and exposed counters.
    - Target: `desktop/scheduling/admission-scheduler.js`, compatibility adapter for `desktop/request-manager.js`.
    - Intent: preserve admitted work while rejecting only over-capacity work and classifying cancellation separately.
    - Prerequisites: 2.4, 3.1, 5.2.
    - Requirements: 6.1–6.2, 7.4–7.6.
  - [x] 6.2 Implement `desktop/scheduling/circuit-breaker.js` keyed by provider and operation category with CLOSED/OPEN/HALF_OPEN state, threshold, reset clock, one probe, and cancellation exclusion.
    - Target: `desktop/scheduling/circuit-breaker.js`.
    - Prerequisites: 6.1, 3.1.
    - Requirements: 7.1–7.3, 7.6.
  - [x] 6.3 Implement `desktop/scheduling/model-resource-manager.js` with nonnegative reference counts, active-stream/reservation tracking, idle unload eligibility, deterministic LRU/digest eviction, pinned/selected protection, and resource snapshots.
    - Target: `desktop/scheduling/model-resource-manager.js`.
    - Prerequisites: 4.1, 5.2, 6.1.
    - Requirements: 6.3–6.5, 20.5.
  - [x] 6.4 Implement `desktop/scheduling/controlled-oom-recovery.js` and wire exactly one recognized-OOM retry to the scheduler; return original and recovery outcomes and do not retry non-OOM failures.
    - Target: `desktop/scheduling/controlled-oom-recovery.js`, `desktop/scheduling/admission-scheduler.js`.
    - Prerequisites: 6.1, 6.3, 5.2.
    - Requirements: 6.6–6.7, 20.5.
  - [x] 6.5 Integrate scheduler/circuit/resource manager through `runtime-coordinator.js`, preserving `request-manager.js` public behavior and adding scheduler status IPC.
    - Target: `desktop/runtime/runtime-coordinator.js`, `desktop/request-manager.js`, `desktop/main.js`.
    - Prerequisites: 6.1–6.4, 2.4.
    - Requirements: 6.1–6.7, 7.1–7.6, 16.1.
  - [x] 6.6 Add unit/reference-model tests for queue bounds, counters, cancellation, shutdown, circuit transitions, references, eviction, and one-retry OOM outcomes.
    - Target: `desktop/tests/scheduling/`.
    - Prerequisites: 6.1–6.5.
    - Requirements: 17.1–17.2, 17.6.
  - [x] 6.7 Add fast-check tests for **Property 8: Admission and queue accounting**.
    - Validate: Requirements 6.1–6.2, 7.1–7.2, 7.4–7.6.
    - Target: `desktop/tests/properties/queue-accounting.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 6.1–6.2.
  - [x] 6.8 Add fast-check tests for **Property 9: Reference-counted deterministic recovery**.
    - Validate: Requirements 6.3–6.7, 20.5.
    - Target: `desktop/tests/properties/resource-recovery.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 6.1, 6.3–6.4.
  - [x] 6.9 Add fast-check tests for **Property 10: Circuit breaker state machine**.
    - Validate: Requirements 7.1–7.3.
    - Target: `desktop/tests/properties/circuit-breaker.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 6.1–6.2.

- [x] 7. Streaming cancellation, heartbeat, metrics, and Dexie persistence
  - [x] 7.1 Implement `webui/src/lib/utils/stream-reducer.ts` for SSE parsing, normalized content/reasoning/tool/heartbeat/timing/model/completion/cancel/error events, recoverable versus terminal malformed events, callback ordering, and idempotent completion.
    - Target: `webui/src/lib/utils/stream-reducer.ts`, `desktop/providers/` normalization integration.
    - Intent: never forward malformed content and never classify caller cancellation as backend failure.
    - Prerequisites: 3.1–3.4.
    - Requirements: 8.2, 8.5–8.6, 17.5.
  - [x] 7.2 Update provider transport and `chat.service.ts` to propagate AbortSignal, stop body reading/backend request within the two-second target, monitor configurable heartbeat activity, persist partial output before timeout, and emit privacy-safe metrics.
    - Target: `webui/src/lib/services/chat.service.ts`, `webui/src/lib/services/provider.service.ts`, `desktop/providers/llama-server-provider.js`.
    - Prerequisites: 7.1, 3.2–3.4.
    - Requirements: 8.1, 8.3–8.4.
  - [x] 7.3 Extend `webui/src/lib/services/database.service.ts` with additive Dexie versions/tables for bounded Streaming_State checkpoints and restart recovery; preserve all existing IDs, order, branches, attachments, model references, and timestamps.
    - Target: `webui/src/lib/services/database.service.ts`, migration fixtures.
    - Intent: make checkpoint writes asynchronous/coalesced and mark active streams interrupted after restart without deleting history.
    - Prerequisites: 1.2, 1.5, 7.1.
    - Requirements: 11.4, 13.1–13.7, 17.5.
  - [x] 7.4 Update `webui/src/lib/stores/chat.svelte.ts` and add `streaming.svelte.ts` for request-keyed state, bounded checkpoints, conversation isolation, cancellation/continue/retry, context-overflow measurements, and final completion reconciliation.
    - Target: `webui/src/lib/stores/chat.svelte.ts`, `webui/src/lib/stores/streaming.svelte.ts`.
    - Prerequisites: 7.1–7.3.
    - Requirements: 13.1–13.6, 16.1.
  - [x] 7.5 Add unit/integration tests for SSE event parsing, two-second controlled cancellation, heartbeat timeout, malformed events, metric redaction, Dexie migration, navigation isolation, restart interruption, partial-output recovery, and Context_Overflow actions.
    - Target: `webui/tests/unit/stream-reducer.test.ts`, `webui/tests/client/streaming-recovery.test.ts`, `webui/tests/fixtures/`.
    - Prerequisites: 7.1–7.4.
    - Requirements: 8.1–8.6, 13.1–13.7, 17.1–17.3, 17.6.
  - [x] 7.6 Add fast-check tests for **Property 11: Stream reducer safety**.
    - Validate: Requirements 8.2, 8.5–8.6.
    - Target: `webui/tests/unit/properties/stream-reducer.property.test.ts`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 7.1–7.4.
  - [x] 7.7 Add fast-check tests for **Property 12: Stream timeout and metric privacy**.
    - Validate: Requirements 8.3–8.4, 12.4.
    - Target: `webui/tests/unit/properties/stream-metrics.property.test.ts`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 7.1–7.4.
  - [x] 7.8 Add fast-check tests for **Property 17: Streaming state isolation and round trip**.
    - Validate: Requirements 13.1–13.2, 13.7.
    - Target: `webui/tests/unit/properties/streaming-state.property.test.ts`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 7.1–7.4.

- [x] 8. Artifact verification, safe extraction, secure preload, API/CORS, credentials, and configuration migration
  - [x] 8.1 Implement `desktop/security/artifact-verifier.js` with streamed SHA-256/configured digesting, trusted digest/signature checks, reuse policy, quarantine/removal, deterministic identity, and safe recovery actions; integrate with binary/model downloads.
    - Target: `desktop/security/artifact-verifier.js`, `desktop/binary-manager.js`, download/model-switch handlers.
    - Prerequisites: 4.3, 2.2.
    - Requirements: 9.1–9.4, 9.6, 16.1.
  - [x] 8.2 Implement `desktop/security/safe-extractor.js` with application-data-root confinement, absolute/drive/traversal/symlink escape rejection, compressed-bomb limits, exclusive temporary writes, and atomic rename.
    - Target: `desktop/security/safe-extractor.js`.
    - Prerequisites: 8.1.
    - Requirements: 9.5, 10.4, performance/resource limits.
  - [x] 8.3 Implement `desktop/security/credential-store.js` using Electron `safeStorage` when available, explicit fallback acceptance, redacted renderer status, and no credential-bearing logs/URLs/errors.
    - Target: `desktop/security/credential-store.js`, `desktop/main.js`, `desktop/preload.js` integration.
    - Prerequisites: 1.1, 3.3.
    - Requirements: 10.3, 10.5, 10.7, 18.4.
  - [x] 8.4 Implement `desktop/security/bridge-schema.js` and refactor `desktop/preload.js` plus main handlers to validate typed allowlisted channels, argument shapes, payload size, event subscriptions, filesystem/process restrictions, and cleanup on renderer destruction.
    - Target: `desktop/security/bridge-schema.js`, `desktop/preload.js`, `desktop/main.js`.
    - Intent: preserve compatibility aliases while rejecting unknown channels and renderer-originated process/filesystem commands.
    - Prerequisites: 1.1, 2.4, 3.3.
    - Requirements: 10.4, 16.1, 16.6.
  - [x] 8.5 Update `desktop/api-server.js` for loopback default, explicit non-loopback confirmation, explicit CORS allowlist, credentialed wildcard rejection, API-key enforcement, and safe configuration migration hooks.
    - Target: `desktop/api-server.js`, `desktop/runtime/runtime-coordinator.js`.
    - Prerequisites: 8.3–8.4.
    - Requirements: 10.1–10.3, 10.6–10.7, 16.2–16.3.
  - [x] 8.6 Implement `desktop/config/versioned-config-store.js` with schema versioning, validation, ordered bounded idempotent migrations, backup-before-write, unknown-setting retention, affected-field safe defaults, warning records, and recovery-mode export/reset without automatic data deletion.
    - Target: `desktop/config/versioned-config-store.js`, `desktop/main.js`, settings integration.
    - Prerequisites: 1.2, 8.3, 8.5.
    - Requirements: 11.1–11.3, 11.5–11.6, 16.4.
  - [x] 8.7 Add example tests for trusted/tampered artifacts, archive traversal, secure/fallback credential storage, bridge authorization, CORS/API-key policy, migration backups, invalid values, recovery mode, and current-schema idempotence.
    - Target: `desktop/tests/security/`, `desktop/tests/config/`.
    - Prerequisites: 8.1–8.6.
    - Requirements: 9.1–9.6, 10.1–10.7, 11.1–11.6, 17.1–17.3, 17.6.
  - [x] 8.8 Add fast-check tests for **Property 13: Artifact identity and path safety**.
    - Validate: Requirements 9.5–9.6.
    - Target: `desktop/tests/properties/artifact-safety.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 8.1–8.2.
  - [x] 8.9 Add fast-check tests for **Property 14: Security policy validation**.
    - Validate: Requirements 10.1–10.7.
    - Target: `desktop/tests/properties/security-policy.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 8.3–8.5.
  - [x] 8.10 Add fast-check tests for **Property 15: Configuration migration idempotence**.
    - Validate: Requirements 11.1–11.6, 16.4.
    - Target: `desktop/tests/properties/config-migration.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 8.6.

- [x] 9. Structured diagnostics, privacy projection, feature gates, and rollback
  - [x] 9.1 Implement `desktop/diagnostics/diagnostics-service.js` and redaction utilities for structured records, pre-persistence/pre-export redaction, bounded count/byte retention, safe renderer health projection, and streamed export.
    - Target: `desktop/diagnostics/diagnostics-service.js`, `desktop/diagnostics/redactor.js`.
    - Intent: preserve operational evidence while excluding secrets, message content, private paths, headers, credential URLs, and per-token content metrics.
    - Prerequisites: 1.1, 2.4, 3.1, 8.3.
    - Requirements: 12.1–12.6, 16.3.
  - [x] 9.2 Implement `desktop/feature-gates.js` for `runtimeLifecycleV1`, `phase1ExitCriteriaPassed`, and independently gated Phase 2 flags; add rollback that disables optional work and returns to legacy local path without deleting data.
    - Target: `desktop/feature-gates.js`, `desktop/runtime/runtime-coordinator.js`.
    - Prerequisites: 2.4, 8.6, 9.1.
    - Requirements: 18.5, 19.6, 20.6, 16.5.
  - [x] 9.3 Add diagnostic and redaction tests for required fields, secret/content exclusion, metrics-disabled behavior, retention bounds, export shape, and rollback preservation.
    - Target: `desktop/tests/diagnostics/`, `desktop/tests/feature-gates.test.js`.
    - Prerequisites: 9.1–9.2.
    - Requirements: 12.1–12.6, 16.2–16.5, 17.1–17.2.
  - [x] 9.4 Add fast-check tests for **Property 16: Privacy-safe diagnostics projection**.
    - Validate: Requirements 12.1, 12.3–12.6.
    - Target: `desktop/tests/properties/diagnostics.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 9.1.

- [x] 10. Renderer readiness, health, model selector, recovery, and accessibility UI
  - [x] 10.1 Implement `webui/src/lib/services/runtime.service.ts`, `runtime.svelte.ts`, and `ReadinessPanel.svelte` for snapshots, exactly-one valid next action, numeric progress, cancellation, failure recovery, reduced-motion behavior, and disabled reasons.
    - Target: `webui/src/lib/services/runtime.service.ts`, `webui/src/lib/stores/runtime.svelte.ts`, `webui/src/lib/components/app/runtime/ReadinessPanel.svelte`.
    - Prerequisites: 2.4, 5.2, 9.1, 9.2.
    - Requirements: 15.1–15.6, 1.1–1.4.
  - [x] 10.2 Implement `HealthView.svelte` and diagnostics projection for readiness, active model, queue/circuit/provider status, verification status, and latest safe error/recovery action.
    - Target: `webui/src/lib/components/app/runtime/HealthView.svelte`, settings/diagnostics route.
    - Prerequisites: 9.1, 10.1.
    - Requirements: 12.2–12.3, 15.3–15.4.
  - [x] 10.3 Implement grouped model catalog state and `ProviderGroup.svelte`; update `ModelsSelector.svelte`/`utils.ts` for availability, fit, capabilities, verification, active/loading/idle state, historical unavailable models, deterministic search/order, and pending-selection preservation.
    - Target: `webui/src/lib/stores/models.svelte.ts` or existing model store, `webui/src/lib/components/app/models/ProviderGroup.svelte`, `webui/src/lib/components/app/models/ModelsSelector.svelte`, `utils.ts`.
    - Prerequisites: 4.1, 5.2, 2.4.
    - Requirements: 4.1, 5.4, 14.1–14.6, 16.1.
  - [x] 10.4 Add `ConversationRecovery.svelte` and integrate with `ChatScreen.svelte` for interrupted/cancelled/failed/Context_Overflow states, Continue/Retry/context-reduction actions, and no cross-conversation partial output.
    - Target: `webui/src/lib/components/app/chat/ConversationRecovery.svelte`, `ChatScreen/ChatScreen.svelte`.
    - Prerequisites: 7.4, 10.1.
    - Requirements: 13.3–13.6, 15.3.
  - [x] 10.5 Add accessible labels, non-color status indicators, focus targets, keyboard activation/navigation, focus restoration, disabled reasons, no keyboard trap, and reduced-motion styles across runtime/model/recovery controls.
    - Target: readiness, health, model selector, chat/recovery components and shared styles.
    - Prerequisites: 10.1–10.4.
    - Requirements: 14.5, 15.4–15.6.
  - [x] 10.6 Add Vitest/UI and Playwright tests for state/action mapping, selection determinism, unavailable historical values, keyboard search/arrow/Enter/Escape/focus, readiness failures, reduced motion, accessible names, streaming conversation switching, and recovery actions.
    - Target: `webui/tests/ui/`, `webui/tests/e2e/`.
    - Prerequisites: 10.1–10.5.
    - Requirements: 14.1–14.6, 15.1–15.6, 17.3, 17.6.
  - [x] 10.7 Add fast-check tests for **Property 18: Model selection determinism and readiness actions**.
    - Validate: Requirements 14.1, 14.3–14.4, 14.6, 15.1–15.3.
    - Target: `webui/tests/unit/properties/model-readiness.property.test.ts`.
    - Prerequisites: 10.1, 10.3.

- [x] 11. Phase 1 integration, compatibility, performance, and release gate
  - [x] 11.1 Wire all Phase 1 modules through `main.js`, `preload.js`, `api-server.js`, `request-manager.js`, existing model/download/settings handlers, `ChatService`, `ChatStore`, `DatabaseService`, `ChatScreen`, and `ModelsSelector`; retain every compatibility alias listed in the design.
    - Target: existing integration files and coordinator/provider/catalog/scheduler services.
    - Intent: finish integration with no orphaned services and preserve local-first behavior.
    - Prerequisites: 2.4, 3.4, 4.3, 6.5, 7.4, 8.4–8.6, 9.2, 10.1–10.5.
    - Requirements: 1–17, especially 16.1–16.6.
  - [x] 11.2 Add controlled-process/provider integration tests for startup, model switching, readiness coalescing, queue saturation, cancellation deadline, health failure, digest quarantine, OOM recovery, migration recovery, local-only network capture, and compatibility aliases.
    - Target: `desktop/tests/integration/`, `webui/tests/client/`.
    - Prerequisites: 11.1.
    - Requirements: 1.2, 2.1–2.4, 6.1–6.6, 8.1–8.3, 9.1–9.5, 11.2–11.5, 16.2–16.6, 17.2.
  - [x] 11.3 Add performance/resource-limit tests for queue/body bounds, checkpoint cadence, diagnostics retention, GGUF limits, bounded extraction, bounded discovery interfaces, and fit memory safety; verify no message content is persisted/transmitted in metrics-disabled/local-only cases.
    - Target: `desktop/tests/limits/`, `webui/tests/client/privacy-limits.test.ts`.
    - Prerequisites: 11.1.
    - Requirements: 8.4, 9.5, 10.3, 12.3–12.5, 16.2–16.3, performance/resource limits.
  - [x] 11.4 Run the complete Phase 1 validation suite and record results in test output/release checks: `npm --prefix webui run check`, `npm --prefix webui run lint`, `npm --prefix webui run test -- --run`, `npm --prefix webui run build`, `npm --prefix desktop run build`, and targeted desktop test command established in 1.3.
    - Target: test/build configuration and `release-checks.json` only if the existing release check format requires integration.
    - Prerequisites: 11.2–11.3.
    - Requirements: 17.1–17.7.
  - [x] 11.5 Implement the Phase 1 exit evaluator: all lifecycle/provider/security/cancellation/migration/privacy/backward-compatibility and regression checks must pass before setting `phase1ExitCriteriaPassed`; failures keep Phase 2 disabled and expose diagnostics/recovery action.
    - Target: `desktop/feature-gates.js`, release-check integration, diagnostics projection.
    - Prerequisites: 11.4, 9.2.
    - Requirements: 17.7, 18.1, 18.5, 19.1, 20.1, 20.6.
  - [x] 11.6 Add the final cross-boundary/browser release suite covering all Requirements 1–17, including representative process/filesystem/secure-storage/browser/external-provider examples and parse-print-parse checks.
    - Target: `desktop/tests/release/`, `webui/tests/e2e/`.
    - Prerequisites: 11.2–11.5.
    - Requirements: 17.1–17.7.

## Phase 1 Exit Criteria Gate

Do not begin or enable any Phase 2 task unless task 11.5 passes all of the following automated checks:
  - Requirements 1–17 unit, integration, browser, and property suites pass, including all 19 property tasks that apply to Phase 1.
  - Backward-compatibility fixtures preserve single-model llama-server, curated downloads, router mode, IndexedDB history, streaming, cancellation, and preload authorization outcomes.
  - Security/privacy checks pass for artifact verification, safe extraction, loopback/CORS/API keys, secure storage, bridge validation, diagnostics redaction, and local-only network behavior.
  - Migration/recovery checks pass with backups, idempotence, preserved identifiers/data, launchable recovery mode, and no automatic deletion.
  - Resource/cancellation checks pass for one-load-at-a-time, bounded queues/body/checkpoints/diagnostics/artifacts, reference-counted unload, heartbeat timeout, and controlled OOM retry.
  - The gate sets `phase1ExitCriteriaPassed` only on success; otherwise every Phase 2 flag remains disabled and the existing local workflow remains available.

- [ ] 12. Phase 2 provider and discovery extensions (gated)
  - [~] 12.1 Implement `OpenAICompatibleProvider`, `OllamaProvider`, and `LMStudioProvider` adapters plus shared transport/normalization/cancellation/health/redaction contract suite; register them only when `phase1ExitCriteriaPassed` and explicit user configuration are true.
    - Target: `desktop/providers/openai-compatible-provider.js`, `ollama-provider.js`, `lmstudio-provider.js`, shared transport and registry.
    - Prerequisites: 11.5, 3.1–3.6.
    - Requirements: 18.1, 18.3–18.6.
  - [~] 12.2 Implement opt-in bounded discovery/cache under `desktop/catalog/discovery-cache.js` with source attribution, verification status, pagination, cancellation, expiry, previous-record retention, and no implicit network access.
    - Target: `desktop/catalog/discovery-cache.js`, catalog/bridge/UI integrations.
    - Prerequisites: 11.5, 4.1–4.5, 8.4–8.5.
    - Requirements: 18.2–18.3, 16.2–16.3.
  - [~] 12.3 Add remote-provider disclosure UI and tests for transport, authentication, privacy, availability, failure redaction, cancellation, phase gate, and local-provider fallback.
    - Target: provider settings components, `webui/tests/`, `desktop/tests/providers/phase2/`.
    - Prerequisites: 12.1–12.2.
    - Requirements: 18.3–18.6.

- [ ] 13. Phase 2 calibration, settings/tools/organization, and split panels (gated)
  - [~] 13.1 Implement bounded opt-in local benchmark calibration with pause/cancel/resource limits, summarized Model_Digest + Hardware_Snapshot results, clear opt-out, and no prompt/generated-content transmission.
    - Target: `desktop/calibration/`, `desktop/feature-gates.js`, settings IPC and WebUI settings.
    - Prerequisites: 11.5, 5.1–5.2, 9.2.
    - Requirements: 19.1–19.2, 19.6.
  - [~] 13.2 Implement richer grouped provider settings, model management, and supported tool-progress/continuation states without changing the common chat contract.
    - Target: provider settings/model management components and provider capability projections.
    - Prerequisites: 12.1, 11.5, 10.3–10.5.
    - Requirements: 19.3.
  - [~] 13.3 Implement local project/workspace organization using existing conversation identifiers and local artifacts only; add the nested split layout with resizable panes, minimum sizes, persistence, keyboard navigation, and single-pane fallback.
    - Target: WebUI stores/components/routes/styles and additive persistence helpers.
    - Prerequisites: 11.5, 7.3, 10.5.
    - Requirements: 19.4–19.5.
  - [~] 13.4 * Add browser/property/example tests for calibration opt-in/privacy, pause/cancel, settings/tool states, organization ID preservation, split-pane resize/persistence/accessibility, and fallback behavior.
    - Target: `webui/tests/e2e/`, `webui/tests/unit/`, `desktop/tests/calibration/`.
    - Prerequisites: 13.1–13.3.
    - Requirements: 19.1–19.6, 17.3–17.6.
  - [~] 13.5 Add fast-check tests for **Property 19: Phase gates and optional complexity**.
    - Validate: Requirements 18.5, 19.1–19.2, 19.6, 20.1, 20.3, 20.6.
    - Target: `desktop/tests/properties/phase2-gates.property.test.js`.
    - Prerequisites: 13.1–13.3.

- [ ] 14. Phase 2 routing and multi-model scheduling (gated)
  - [~] 14.1 Implement opt-in route candidate evaluation using capabilities, Fit_Plans, privacy/availability constraints, user preferences, and current scheduler state; return typed no-route results and preserve configured fallback behavior.
    - Target: `desktop/routing/route-planner.js`, `desktop/routing/route-result.js`.
    - Prerequisites: 11.5, 12.1, 5.2, 6.5.
    - Requirements: 20.1, 20.3, 20.6.
  - [~] 14.2 Integrate route selection with EnsureReady, one-load-at-a-time scheduling, reference-counted unload, cancellation, OOM recovery, and response metadata containing Model_Digest, Provider identity, reason, and readiness outcome.
    - Target: `desktop/runtime/runtime-coordinator.js`, `desktop/routing/`, `webui/src/lib/stores/chat.svelte.ts`.
    - Prerequisites: 14.1, 2.3, 6.3–6.4, 7.4.
    - Requirements: 20.2, 20.4–20.5.
  - [~] 14.3 Add routing tests for no-route, fallback, visible model changes, prior metadata preservation, phase gate, cancellation, bounded admission, and provider parity.
    - Target: `desktop/tests/routing/`, `webui/tests/e2e/routing.spec.ts`.
    - Prerequisites: 14.1–14.2.
    - Requirements: 20.1–20.6, 17.2–17.4.
  - [~] 14.4 Add fast-check tests for routing portions of **Property 9: Reference-counted deterministic recovery**.
    - Validate: Requirements 20.5.
    - Target: `desktop/tests/properties/routing.property.test.js`; use at least 100 runs and the required Feature/Property comment.
    - Prerequisites: 14.1–14.2.

## Checkpoints

- [x] Checkpoint A — After baseline/contracts: run the targeted contract, fixture, and harness tests; ensure no existing source behavior has been removed.
- [x] Checkpoint B — After runtime/provider/catalog/planning: run desktop unit/property tests and `npm --prefix webui run check`; ask the user if contract or compatibility questions arise.
- [x] Checkpoint C — After scheduler/stream/security/config/diagnostics: run targeted desktop tests and WebUI unit/client tests; verify no secrets or conversation content appear in diagnostics or network fixtures.
- [x] Checkpoint D — After UI integration: run WebUI UI/browser tests, accessibility checks, and `npm --prefix webui run lint`.
- [x] Checkpoint E — Phase 1 Exit Criteria: all Requirements 1–17 regression, security, privacy, migration, cancellation, integration, browser, property, and build checks pass; otherwise keep every Phase 2 flag disabled.
- [~] Checkpoint F — Each Phase 2 capability: run its gate, opt-in, rollback, privacy, accessibility, and compatibility tests before enabling it independently.

## Notes

- Tasks marked with `*` are optional test tasks and may be skipped for a faster MVP; core implementation tasks are never optional.
- Each task is limited to writing, modifying, or testing code. No deployment, user acceptance, training, or documentation-only work is included.
- All 19 design properties are explicitly assigned one property-focused task: P1 2.6; P2 2.7; P3 3.6; P4 3.7; P5 4.5; P6 4.6; P7 5.4; P8 6.7; P9 6.8 and routing extension 14.4; P10 6.9; P11 7.6; P12 7.7; P13 8.8; P14 8.9; P15 8.10; P16 9.4; P17 7.8; P18 10.7; P19 13.5. Property tests use at least 100 runs and the required feature/property comment.
- Phase 1 must retain compatibility aliases, local-only defaults, current conversation identifiers, curated downloads, router mode, secure preload behavior, and recovery/rollback backups.
- Resource limits are mandatory: one model-load mutation, bounded queues/request bodies/checkpoints/diagnostics/GGUF metadata/discovery/artifacts, streamed hashing/extraction, conservative fit estimates, and cancellable background work.
- Validation commands for the existing project are `npm --prefix webui run check`, `npm --prefix webui run lint`, `npm --prefix webui run test -- --run`, `npm --prefix webui run build`, and `npm --prefix desktop run build`; use the targeted desktop test command established by task 1.3 for Node-only suites. Do not start `npm run dev`, `npm start`, or watcher commands as validation.
- Do not recreate or modify `.config.kiro`, `requirements.md`, or `design.md` as part of implementation.

## Requirement Coverage Index

- Requirements 1–2: Tasks 2.1–2.7, 11.1–11.2.
- Requirements 3: Tasks 3.1–3.7, 11.1–11.2.
- Requirement 4: Tasks 4.1–4.6, 11.1.
- Requirement 5: Tasks 5.1–5.4, 10.3, 11.3.
- Requirements 6–7: Tasks 6.1–6.9, 11.1–11.3.
- Requirement 8: Tasks 3.2–3.4, 7.1–7.7, 11.2–11.3.
- Requirement 9: Tasks 4.3, 8.1–8.2, 8.7–8.8, 11.2–11.3.
- Requirement 10: Tasks 8.3–8.5, 8.7–8.9, 9.1, 11.2–11.3.
- Requirement 11: Tasks 7.3, 8.6–8.10, 11.2.
- Requirement 12: Tasks 8.3, 9.1–9.4, 10.2, 11.3.
- Requirement 13: Tasks 7.1–7.8, 10.4, 11.2.
- Requirements 14–15: Tasks 10.1–10.7, 11.2.
- Requirements 16–17: Tasks 1.2–1.5, 2.4, 3.2–3.4, 7.3–7.4, 8.4–8.6, 9.2, 11.1–11.6.
- Requirements 18–20: Tasks 3.3, 9.2, 11.5, 12.1–12.3, 13.1–13.5, 14.1–14.4.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.5"] },
    { "id": 2, "tasks": ["1.4", "2.1", "3.1", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "4.2", "4.3", "5.2"] },
    { "id": 4, "tasks": ["2.3", "3.4", "3.5", "4.4", "4.5", "4.6", "5.3", "5.4"] },
    { "id": 5, "tasks": ["2.4", "3.6", "3.7", "6.1", "6.2", "7.1", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 6, "tasks": ["2.5", "2.6", "2.7", "6.3", "6.4", "6.7", "6.8", "6.9", "7.2", "7.3", "8.5", "8.6", "8.7", "8.8", "8.9", "9.1", "9.2", "9.4"] },
    { "id": 7, "tasks": ["6.5", "7.4", "7.6", "7.7", "7.8", "8.10", "9.3", "10.1", "10.2", "10.3", "10.4"] },
    { "id": 8, "tasks": ["6.6", "7.5", "10.5", "10.7"] },
    { "id": 9, "tasks": ["10.6"] },
    { "id": 10, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 11, "tasks": ["11.4"] },
    { "id": 12, "tasks": ["11.5"] },
    { "id": 13, "tasks": ["11.6"] },
    { "id": 14, "tasks": ["12.1", "12.2", "13.1", "13.2", "13.3", "14.1"] },
    { "id": 15, "tasks": ["12.3", "13.4", "14.2", "14.3"] },
    { "id": 16, "tasks": ["13.5", "14.4"] }
  ]
}
```
