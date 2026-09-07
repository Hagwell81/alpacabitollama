# GitHub Release Setup Guide

This guide covers the exact steps needed to configure GitHub for the trusted
release pipeline. Complete these steps before creating your first release tag.

## 1. Repository secrets

Navigate to **Settings → Secrets and variables → Actions → New repository secret**
for each of the following.

### MINISIGN_PRIVATE_KEY (required)

The complete contents of the Minisign private key file.

**How to get the value:**

```powershell
Get-Content -Raw D:\dev\idea\alpacabitollama\trusted-artifacts.key
```

Copy the entire output (including the `untrusted comment:` line) and paste it
into the secret value field.

**Important:**
- The key file is encrypted with a passphrase.
- After adding this secret, move the key file out of the repository directory
  to secure offline storage (e.g. a USB drive or password manager attachment).
- The `.gitignore` already excludes `trusted-artifacts.key` from git.

### MINISIGN_PRIVATE_KEY_PASSWORD (required for encrypted keys)

The passphrase used when generating the Minisign key.

**How to get the value:**

This is the passphrase you entered when running `minisign -G`. If you do not
remember it, you will need to generate a new keypair (see section 5 below).

The workflow installs `minisign` on the GitHub Actions runner and pipes this
passphrase via stdin. It is never logged or stored in a file that persists
beyond the signing step.

## 2. Repository variables

Navigate to **Settings → Secrets and variables → Actions → Variables → New repository variable**.

### RELEASE_ARTIFACT_DECLARATIONS (required)

A JSON array describing every artifact that should be hashed and signed in the
trusted manifest. Each entry has:

- `reference`: A unique key in `KIND:VERSION/FILENAME` format (e.g. `archive:v1.0.0/llama-server-win.zip`)
- `url`: An HTTPS URL where the artifact can be downloaded
- `path`: A relative path where the artifact will be staged (e.g. `release-assets/llama-server-win.zip`)

**Example value:**

```json
[
  {
    "reference": "archive:v1.0.0/llama-D9305-win-cpu-x64.zip",
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b9305/llama-D9305-win-cpu-x64.zip",
    "path": "release-assets/llama-D9305-win-cpu-x64.zip"
  },
  {
    "reference": "archive:v1.0.0/llama-D9305-win-cuda-cu12.4-x64.zip",
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b9305/llama-D9305-win-cuda-cu12.4-x64.zip",
    "path": "release-assets/llama-D9305-win-cuda-cu12.4-x64.zip"
  },
  {
    "reference": "archive:v1.0.0/llama-D9305-ubuntu-x64.zip",
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b9305/llama-D9305-ubuntu-x64.zip",
    "path": "release-assets/llama-D9305-ubuntu-x64.zip"
  },
  {
    "reference": "archive:v1.0.0/llama-D9305-mac-arm64.zip",
    "url": "https://github.com/ggml-org/llama.cpp/releases/download/b9305/llama-D9305-mac-arm64.zip",
    "path": "release-assets/llama-D9305-mac-arm64.zip"
  }
]
```

**Replace the example URLs with the actual llama.cpp release assets you want
to pin.** The URLs must be HTTPS. The reference format is `KIND:TAG/ASSETNAME`
where `KIND` is `archive`, `model`, or `projector`.

## 3. Public key (committed to the repository)

The public key is already in the repository at:

```
desktop/resources/trusted-artifacts-public-key.pem
```

Its contents are:

```
untrusted comment: minisign public key 208DAD2726C97407
RWQHdMkmJ62NIN/S8W/otbJK3MOH7DB3wNTMazon9yqTHrlZIvHNvhiq
```

This file must be committed to the repository. It is safe to commit — the
public key cannot be used to sign, only to verify.

## 4. Creating a release

Once the secrets and variables are configured:

1. Ensure all changes are committed and pushed to `master`.
2. Create and push a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

3. The `Phase 1 release gate` workflow will automatically:
   - Download and stage the declared artifacts
   - Generate the trusted manifest with SHA-256 digests
   - Sign the manifest with your Minisign private key
   - Verify the signature with the public key
   - Build the WebUI and desktop packages
   - Run all Phase 1 release evidence checks
   - Publish the installers, manifest, signature, and evidence to the GitHub release

4. If any step fails, the release is blocked. Check the workflow logs for details.

## 5. Key rotation

If you need to generate a new keypair (e.g. annual rotation or compromise):

```powershell
# Generate a new keypair (will prompt for passphrase)
minisign -G -w D:\secure\minisign.key -p D:\dev\idea\alpacabitollama\desktop\resources\trusted-artifacts-public-key.pem

# Copy the private key to GitHub secret
Get-Content -Raw D:\secure\minisign.key
# Paste into MINISIGN_PRIVATE_KEY secret

# Update the passphrase secret
# Paste into MINISIGN_PRIVATE_KEY_PASSWORD secret

# Commit the new public key
cd D:\dev\idea\alpacabitollama
git add desktop/resources/trusted-artifacts-public-key.pem
git commit -m "Rotate Minisign signing key"
git push
```

## 6. Verifying locally

After a release is published, users can verify artifacts:

```powershell
# Download the manifest and signature from the release
# Then verify any artifact against the manifest
minisign -V -p desktop\resources\trusted-artifacts-public-key.pem -m trusted-artifacts.json -x trusted-artifacts.json.minisig
```

## 7. Summary of GitHub settings

| Type | Name | Purpose |
|------|------|---------|
| Secret | `MINISIGN_PRIVATE_KEY` | Private key contents for signing |
| Secret | `MINISIGN_PRIVATE_KEY_PASSWORD` | Passphrase for the encrypted key |
| Variable | `RELEASE_ARTIFACT_DECLARATIONS` | JSON array of artifacts to hash and sign |
| File (committed) | `desktop/resources/trusted-artifacts-public-key.pem` | Public key for verification |
