# REST API Reference

Complete reference for the Alpacabitollama API.

:::tip Interactive Documentation
Explore the API interactively with the **[API Explorer &#8599;](/api-explorer)** powered by Swagger UI.
:::

## Base URL

```
http://localhost:13434/v1
```

## Authentication

Include API key in header:

```
Authorization: Bearer your-api-key
```

## Endpoints

### Chat Completions

```
POST /v1/chat/completions
```

**Request**:

```json
{
  "model": "llama-3",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**Response**:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "llama-3",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

### Streaming

Set `stream: true` for SSE streaming:

```json
{
  "model": "llama-3",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

### List Models

```
GET /v1/models
```

**Response**:

```json
{
  "object": "list",
  "data": [
    {
      "id": "llama-3-8b",
      "object": "model",
      "created": 1704067200,
      "owned_by": "meta"
    }
  ]
}
```

### Model Info

```
GET /v1/models/{model_id}
```

### Completions (Legacy)

```
POST /v1/completions
```

### Embeddings

```
POST /v1/embeddings
```

**Request**:

```json
{
  "model": "llama-3",
  "input": "Hello world"
}
```

### Health Check

```
GET /health
```

**Response**:

```json
{
  "status": "ok",
  "timestamp": "2026-05-03T12:00:00Z"
}
```

## Error Responses

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error",
    "code": 401
  }
}
```

## SDK Examples

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:13434/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="llama-3",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### JavaScript

```javascript
const response = await fetch('http://localhost:13434/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-3',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```
