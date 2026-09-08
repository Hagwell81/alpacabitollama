# Chat Interface

Using the Alpacabitollama chat UI.

## Overview

The chat interface provides a conversational AI experience with:
- Streaming responses (SSE)
- Reasoning content display (for reasoning models)
- Code highlighting
- Message history with branching
- Markdown rendering with image attachments
- Tool call display (agentic workflows)

## Sending Messages

Type in the input box and press Enter (or Shift+Enter for new line).

## Streaming

Responses appear in real-time as the model generates tokens. The app uses
Server-Sent Events (SSE) to stream content from the local llama-server
instance. If the server closes the connection without a terminal event, the
app finalizes the response with whatever content was accumulated.

## Reasoning Content

Models that produce reasoning content (e.g. Ministral-3-3B-Reasoning-2512,
Phi-4-reasoning-plus) show their reasoning in a collapsible **Reasoning** block
above the final answer. The reasoning is persisted to the conversation history
so it remains visible when you reload the conversation.

You can configure how reasoning is displayed in Settings:
- **Show thought in progress** — expand the reasoning block while the model is
  still generating
- **Always show agentic turns** — highlight individual turns in multi-step
  agentic workflows

## Code Blocks

Code appears with syntax highlighting and copy button:

```python
print("Hello World")
```

## Message Actions

- **Copy**: Copy message text
- **Regenerate**: Regenerate response
- **Delete**: Remove message
- **Edit**: Modify your message (creates a branch by default)

## Conversation Management

- New conversation: Ctrl+N
- Rename conversation: Click title
- Delete conversation: Right-click in sidebar
- Branch conversation: Edit a message and check "Branch conversation after edit"

## Model Switching

You can switch models mid-conversation from the Models tab in Chat Settings.
The current model is shown as a badge on each assistant message. Switching
models gracefully stops the current server instance and loads the new model.

## Statistics

Each assistant message shows generation statistics:
- Prompt tokens and evaluation time
- Generated tokens and tokens per second
- Total time

Click the statistics badge to toggle between **Generation** and **Summary**
views.
