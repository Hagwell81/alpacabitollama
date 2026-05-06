# VS Code Integration

Connect Alpacabitollama to Visual Studio Code.

## Setup

1. Install the Alpacabitollama VS Code extension
2. Open VS Code settings
3. Set API endpoint to `http://localhost:13434/v1`
4. Configure model preference

## Settings

```json
{
  "alpacabitollama.apiEndpoint": "http://localhost:13434/v1",
  "alpacabitollama.model": "llama-3-8b",
  "alpacabitollama.temperature": 0.7
}
```

## Features

- Inline code completion
- Chat sidebar
- Code explanation
- Refactoring suggestions

## Commands

- `Alpacabitollama: Explain` — Explain selected code
- `Alpacabitollama: Refactor` — Refactor selected code
- `Alpacabitollama: Generate` — Generate from prompt
- `Alpacabitollama: Chat` — Open chat panel

## Troubleshooting

If VS Code cannot connect:
- Verify Alpacabitollama server is running
- Check port matches (13434)
- Test endpoint in browser
