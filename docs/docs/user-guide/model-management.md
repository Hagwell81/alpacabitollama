# Model Management

Manage AI models in Alpacabitollama.

## Curated Models

Alpacabitollama ships with a curated list of models that are pre-configured with
trusted download URLs, vision projector (mmproj) pairings, and size estimates:

| Category | Model | Size | Vision |
|----------|-------|------|--------|
| Qwen | Qwen3.6-35B-A3B (Q4_K_M) | ~22.5 GB | Yes |
| Qwen | Qwen3.5-9B (Q4_K_M) | ~5.7 GB | Yes |
| Qwen | Qwen3.5-4B (Q4_K_M) | ~2.9 GB | Yes |
| gpt-oss | gpt-oss-20b (Q4_K_M) | ~14.0 GB | No |
| Gemma | gemma-4-26B-A4B-it (Q4_K_M) | ~17.0 GB | Yes |
| Gemma | gemma-4-E4b-it (Q4_K_M) | ~6.0 GB | Yes |
| Gemma | gemma-4-E2b-it (Q4_K_M) | ~3.2 GB | Yes |
| Ministral | Ministral-3-14B-Reasoning-2512 (Q4_K_M) | ~8.4 GB | Yes |
| Ministral | Ministral-3-8B-Reasoning-2512 (Q4_K_M) | ~5.4 GB | Yes |
| Ministral | Ministral-3-3B-Reasoning-2512 (Q4_K_M) | ~2.4 GB | Yes |
| Phi | Phi-4-reasoning-plus (Q4_K_M) | ~10.0 GB | No |
| Phi | Phi-4-mini-reasoning (Q4_K_M) | ~2.4 GB | No |
| Small | SmolLM3-3B (Q4_K_M) | ~2.5 MB | No |
| Bonsai (1-bit) | Bonsai-8B (Q1_0) | ~1.1 GB | No |
| Bonsai (1-bit) | Bonsai-4B (Q1_0) | ~570 MB | No |
| Bonsai (1-bit) | Bonsai-1.7B (Q1_0) | ~250 MB | No |

### Downloading Curated Models

1. Open the **Models** tab in Chat Settings
2. Browse the curated list
3. Click **Download** on the desired model
4. Wait for the download to complete — the progress bar shows real-time status

For vision models (marked "Vision Model"), the paired mmproj projector file is
downloaded automatically alongside the model file.

## Hugging Face Search

You can search any public Hugging Face repository for additional GGUF models:

1. Open the **Models** tab in Chat Settings
2. Enter a Hugging Face repository ID (e.g. `prism-ml/Bonsai-8B-gguf`) in the
   search box
3. Optionally provide a **Hugging Face token** if the repository is gated or
   private
4. Click **Search**

The search results show:

- **Model files** — all `.gguf` files in the repository, with sizes
- **Vision projector (mmproj) files** — projector files for multimodal models
- **Gated badge** — shown if the repository requires a token
- **Vision Model badge** — shown if the repository contains mmproj files or
  vision-related tags

### Downloading from Hugging Face

1. Click **Download** next to the desired model file
2. If the model is a vision model, the paired mmproj file is downloaded
   automatically and the association is stored
3. The model appears in the installed models list once the download completes

### Gated Repositories

Some Hugging Face repositories require you to accept a license or request
access before downloading. If a repository is gated:

- The search results show a **Gated — token required to download** badge
- You must provide a valid Hugging Face token in the token field
- The token is sent only to `huggingface.co` and is never stored in the app or
  logged

### Rate Limits

Hugging Face applies rate limits to unauthenticated API requests. If you hit
the rate limit, the search returns a clear error message. Adding a Hugging Face
token raises the rate limit.

## Switching Models

To switch the active model:

1. Open the **Models** tab in Chat Settings
2. Click **Switch** next to an installed model
3. The current llama-server instance is stopped gracefully
4. The new model is loaded and the server restarts

The app automatically matches the correct mmproj projector for vision models.
Non-vision models run without a projector — the app will never apply a
projector from a different model, which would cause a crash.

## Reasoning Models

Models with "Reasoning" in their name (e.g. Ministral-3-3B-Reasoning-2512,
Phi-4-reasoning-plus) produce both:

- **Reasoning content** — shown in a collapsible "Reasoning" block
- **Answer content** — shown as the main response

Both are visible in the chat UI and persisted to the conversation history.

## Deleting Models

Click the **Delete** button next to an installed model to free disk space.
This removes the model file and any paired mmproj file from disk.
