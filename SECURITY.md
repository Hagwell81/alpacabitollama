# Security and release artifact trust

## Release signing ownership

The release signing key is owned by the project maintainers responsible for release security. The private Minisign key must remain outside the repository and must be stored only in an encrypted GitHub Actions secret named `MINISIGN_PRIVATE_KEY` (or an equivalent protected release environment). It must never be committed, printed, uploaded as an artifact, passed as a command-line argument, or placed in `desktop/resources`.

The corresponding Minisign public key is committed at `desktop/resources/trusted-artifacts-public-key.pem`. The `.pem` suffix is retained for repository compatibility; the file contents are a Minisign public-key record, not a PEM-encoded RSA key. Runtime verification uses the Minisign key to validate the detached signature for `desktop/resources/trusted-artifacts.json` before downloaded backend or model artifacts can be treated as executable.

## Manifest process

The release workflow requires the repository variable `RELEASE_ARTIFACT_DECLARATIONS`. It must contain a JSON array with an exact HTTPS source URL and a relative staging path for every artifact:

```json
[
  {
    "reference": "archive:v1.2.3/llama-server-linux.tar.gz",
    "url": "https://downloads.example.org/llama-server-linux.tar.gz",
    "path": "release-assets/llama-server-linux.tar.gz"
  },
  {
    "reference": "model:v1.2.3/model.gguf",
    "url": "https://downloads.example.org/model.gguf",
    "path": "release-assets/model.gguf"
  },
  {
    "reference": "projector:v1.2.3/mmproj-model-f16.gguf",
    "url": "https://downloads.example.org/mmproj-model-f16.gguf",
    "path": "release-assets/mmproj-model-f16.gguf"
  }
]
```

The generator creates the payload `trusted-artifacts.json` and a detached signature `trusted-artifacts.json.minisig`. Minisign signs the exact canonical UTF-8 payload `{version,entries}`. The runtime reconstructs those same canonical bytes, verifies the Minisign Ed25519/BLAKE2b signature and key ID, and verifies the trusted comment signature before marking entries trusted.

Before signing, the workflow downloads each declared URL using HTTPS only, follows only HTTPS redirects, writes to an atomic temporary file, and stages the exact bytes at `path`. The manifest generator then computes SHA-256 over those staged bytes and signs the canonical manifest payload. A URL, redirect, response header, or downloaded checksum is not trusted by itself; the detached Minisign signature over the resulting digest is the trust decision. The workflow blocks publication if any declaration, download, key, signature, or verification step fails.

The implementation is in:

- `desktop/scripts/stage-release-artifacts.js`
- `desktop/scripts/generate-trusted-artifact-manifest.js`
- `desktop/scripts/verify-trusted-artifact-manifest.js`
- `desktop/security/trusted-artifact-manifest.js`
- `.github/workflows/phase1-release.yml`

The declarations must cover every artifact that the application is allowed to download and execute. Do not use a response header, redirect URL, locally computed digest, or unsigned release metadata as trust evidence. Legacy inline RSA signatures are rejected; a manifest is trusted only when its detached Minisign sidecar verifies.

## Minisign setup and GitHub Actions

The public key shown in the repository must match the private key used for release signing. Verify a pair locally with a harmless temporary file:

```powershell
$testFile = Join-Path $env:TEMP "alpacabitollama-minisign-test.txt"
$signature = "$testFile.minisig"
"verification test" | Set-Content -NoNewline -Encoding utf8 $testFile
minisign -S -s "$HOME\.minisign\minisign.key" -m $testFile -x $signature
minisign -V -p desktop\resources\trusted-artifacts-public-key.pem -m $testFile -x $signature
Remove-Item $testFile, $signature -Force
```

For unattended GitHub Actions signing, the key must not require an interactive password prompt. The safest operational arrangement is to keep the key file encrypted at rest outside CI, and place only the protected CI signing copy in the GitHub secret. If the current key is password-protected, create a separate CI signing key with the same public key only if your key-management process supports that; otherwise use a controlled key conversion procedure and rotate the public key. Do not put a password in the workflow or repository variable.

Copy the complete contents of the CI Minisign private-key file into **Settings → Secrets and variables → Actions → New repository secret** using:

```powershell
Get-Content -Raw C:\path\to\minisign.key
```

Use this exact secret name:

```text
MINISIGN_PRIVATE_KEY
```

If the private key is encrypted (recommended), also create a second secret for the passphrase:

```text
MINISIGN_PRIVATE_KEY_PASSWORD
```

The workflow installs `minisign` on the runner and passes the passphrase via stdin. The passphrase is never logged, printed, or stored in a file that persists beyond the signing step. If the key is unencrypted, the `MINISIGN_PRIVATE_KEY_PASSWORD` secret may be omitted.

The workflow passes the secret only to the signer and removes all temporary working data when signing completes. It never logs the value. The committed file is only the public key at `desktop/resources/trusted-artifacts-public-key.pem`.

Then create **Settings → Secrets and variables → Actions → Variables → New repository variable**:

```text
RELEASE_ARTIFACT_DECLARATIONS
```

Paste the JSON declaration array above, replacing the example URLs with real publisher-controlled HTTPS artifact URLs.

## Rotation and revocation

- Rotate the Minisign signing key at least annually or immediately after suspected compromise.
- Generate the replacement key in a controlled maintainer environment.
- Replace `desktop/resources/trusted-artifacts-public-key.pem` and publish a newly signed manifest in the same protected change.
- Verify the new key ID and a signed test artifact before merging the public-key change.
- Revoke the old key in the release/security records and invalidate manifests signed by it.
- If compromise affects released artifacts, stop publication, issue a GitHub Security Advisory, publish a replacement release, and notify users through the project’s documented release channel.
- Keep private-key access limited to release security maintainers and require protected-branch/release review for public-key changes.

Until the public key, detached signature, and release artifact declarations are supplied, the application intentionally fails closed for trusted artifact verification and the Phase 1/Phase 2 gate must remain closed.
