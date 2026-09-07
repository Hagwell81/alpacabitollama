/* eslint-env node */
const assert = require('assert');
const test = globalThis.test;
const fc = require('fast-check');
const { normalizeProviderError } = require('../../providers/normalize');

const safeIdentifier = fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/);
const secret = fc.stringMatching(/^[A-Za-z0-9_-]{1,24}$/);
const unapprovedContent = fc.string({ minLength: 1, maxLength: 32 })
  .filter((value) => value.trim().length > 0);

// Feature: alpacabitollama-runtime-and-ui-enhancements, Property 4: Provider error redaction
// **Validates: Requirements 3.4, 10.3, 10.7, 12.1, 12.6**

test('redacts generated credentials, private paths, credential URLs, and unapproved details', () => {
  fc.assert(
    fc.property(
      safeIdentifier,
      safeIdentifier,
      secret,
      secret,
      secret,
      secret,
      secret,
      secret,
      unapprovedContent,
      (providerId, operation, authorization, apiKey, accessToken, password, privateKey, urlPassword, content) => {
        const authorizationValue = `authorization-secret-${authorization}`;
        const apiKeyValue = `api-key-secret-${apiKey}`;
        const accessTokenValue = `access-token-secret-${accessToken}`;
        const passwordValue = `password-secret-${password}`;
        const privateKeyValue = `private-key-secret-${privateKey}`;
        const urlPasswordValue = `url-password-secret-${urlPassword}`;
        const contentValue = `unapproved-content-${content}`;
        const unixPath = `/home/${providerId}/private/model.gguf`;
        const windowsPath = `C:\\Users\\${providerId}\\private\\model.gguf`;
        const credentialUrl = `https://remote-user:${urlPasswordValue}@provider.example.test/v1/models`;
        const error = normalizeProviderError({
          code: 'PROVIDER_TIMEOUT',
          message: [
            `authorization: Bearer ${authorizationValue}`,
            `api-key=${apiKeyValue}`,
            `access-token: ${accessTokenValue}`,
            `password=${passwordValue}`,
            `private-key: ${privateKeyValue}`,
            credentialUrl,
            unixPath,
            windowsPath
          ].join(' '),
          retryable: true,
          details: {
            responseBody: contentValue,
            credential: authorizationValue,
            path: unixPath,
            url: credentialUrl,
            providerId: 'wire-value-must-not-replace-context'
          }
        }, { providerId, operation, correlationId: 'corr-property-4' });

        const serialized = JSON.stringify(error);
        for (const forbidden of [
          authorizationValue, apiKeyValue, accessTokenValue, passwordValue, privateKeyValue, urlPasswordValue,
          unixPath, windowsPath, credentialUrl, contentValue
        ]) {
          assert.ok(!serialized.includes(forbidden), `forbidden value leaked: ${forbidden}`);
        }
        assert.deepStrictEqual(error, {
          code: 'PROVIDER_TIMEOUT',
          message: [
            'authorization: [REDACTED]',
            'api-key=[REDACTED]',
            'access-token: [REDACTED]',
            'password=[REDACTED]',
            'private-key: [REDACTED]',
            '[REDACTED_URL]/v1/models',
            '[REDACTED_PATH]',
            '[REDACTED_PATH]'
          ].join(' '),
          retryable: true,
          recoveryAction: 'Retry',
          correlationId: 'corr-property-4',
          details: { providerId, operation }
        });
      }
    ),
    { numRuns: 120 }
  );
});

test('redacts private paths containing spaces without leaking adjacent context', () => {
  const error = normalizeProviderError({
    code: 'PROVIDER_PROTOCOL',
    message: 'model path /home/alice smith/private/model.gguf and C:\\Users\\alice smith\\private\\model.gguf'
  }, { providerId: 'local', operation: 'health', correlationId: 'corr-spaced-path' });

  assert.strictEqual(error.message, 'model path [REDACTED_PATH] and [REDACTED_PATH]');
  assert.ok(!JSON.stringify(error).includes('alice smith'));
});
