# Plan: Add Model Name Tag Under Robot Avatar in Playground

## Goal
Display the full underlying model ID (e.g. `openai/gpt-4o`) as a name tag beneath the robot avatar for assistant messages in the playground.

## Files to Modify

### `ui/src/pages/AgentPlayground.tsx`

#### 1. Fix `loadSession` — preserve `model` field (line 412-420)

**Problem:** When loading a session from the API, the `model` field from `ChatSessionMessage` is dropped during the mapping to `Message`. This means restored messages won't show the model name tag.

**Change:** Add `model: normalized.model,` to the returned object.

```tsx
// Before (line 412-420)
setMessages(session.messages.map(m => {
  const normalized = normalizeSessionMessageMedia(m)
  return ({
  id: crypto.randomUUID(),
  role: normalized.role as Message['role'],
  content: normalizeContentMedia(normalized.content) as Message['content'],
  images: normalized.images,
  createdAt: new Date(m.createdAt ?? m.timestamp ?? new Date().toISOString()),
})}))

// After
setMessages(session.messages.map(m => {
  const normalized = normalizeSessionMessageMedia(m)
  return ({
  id: crypto.randomUUID(),
  role: normalized.role as Message['role'],
  content: normalizeContentMedia(normalized.content) as Message['content'],
  images: normalized.images,
  model: normalized.model,
  createdAt: new Date(m.createdAt ?? m.timestamp ?? new Date().toISOString()),
})}))
```

#### 2. Restructure assistant avatar to include name tag (line 1619-1623)

**Change:** Wrap the avatar in a vertical column layout and add a truncated model name label below it.

```tsx
// Before (line 1619-1623)
{message.role === 'assistant' && (
  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
    <Bot className="w-4 h-4 text-muted-foreground" />
  </div>
)}

// After
{message.role === 'assistant' && (
  <div className="flex flex-col items-center gap-1 shrink-0">
    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
      <Bot className="w-4 h-4 text-muted-foreground" />
    </div>
    {message.model && (
      <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[5rem] select-none">
        {message.model}
      </span>
    )}
  </div>
)}
```

#### 3. Add name tag under loading spinner (line ~1738-1751)

**Change:** Add the model name tag under the loading spinner avatar to maintain consistency.

```tsx
// Before
{isLoading && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.toolCalls && (
  <div className="flex gap-3 items-center text-muted-foreground">
    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
      <Loader2 className="w-4 h-4 animate-spin" />
    </div>
    <span className="text-sm font-mono">Thinking...</span>
  </div>
)}

// After
{isLoading && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.toolCalls && (
  <div className="flex items-start gap-3 text-muted-foreground">
    <div className="flex flex-col items-center gap-1">
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
      {messages[messages.length - 1]?.model && (
        <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[5rem] select-none">
          {messages[messages.length - 1]?.model}
        </span>
      )}
    </div>
    <span className="text-sm font-mono">Thinking...</span>
  </div>
)}
```

#### 4. Keep existing bottom-of-bubble label (line 1697-1728)

No changes — the model name remains in the message bubble as well.

## Verification
- Open playground, send a message — model name appears under the Bot avatar
- Load an old session — model name should appear (from `loadSession` fix)
- During "Thinking..." loading state, model name appears under the loader
