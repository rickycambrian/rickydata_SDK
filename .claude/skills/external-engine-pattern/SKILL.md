---
name: external-engine-pattern
description: Verified pattern for making SDK UI components accept an external state machine (engine) provided by the host app, bypassing the SDK's built-in networking. Use when extracting tightly-coupled app components into reusable SDK packages, or when apps need to use their own API proxy instead of the SDK's direct gateway calls.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# External Engine Pattern

Verified working pattern for decoupling SDK UI components from SDK networking by accepting an optional external engine. Confirmed 2026-03-15 — SDK build passes (53.9KB ESM), typecheck passes, research app integrated successfully (Tasks #1, #3, #4, #5).

## Pattern 1: Define the Engine Interface

**Provenance:** Verified 2026-03-15. Interface at `packages/chat/src/types/chat.ts`. Used by ChatBubbleWindow and ChatBubbleProvider.

### When to Use

When an SDK component has a built-in state machine (hook) for networking, but apps may need to provide their own. Define an interface that captures the component's data/action contract without coupling to the implementation.

### The Interface

```typescript
/** External engine interface — apps provide their own chat state machine. */
export interface ChatEngine {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  sendMessage: () => Promise<void>;
  isContextual: boolean;
  // Optional features — SDK UI degrades gracefully when absent
  sessionId?: string | null;
  streamingPhase?: 'idle' | 'tools' | 'streaming';
  activeTools?: string[];
  abort?: () => void;
}
```

Key design decisions:
- Required fields are the minimum the UI needs to render (messages, input, streaming state, error handling)
- Optional fields enable enhanced UI features (tool status indicators, abort button) but the component works without them
- `sendMessage()` is `Promise<void>` — the engine handles all side effects internally; the component just awaits completion
- No framework-specific types — this interface works with any state management (Zustand, useState, Redux, etc.)

## Pattern 2: Config-Level Engine Injection

**Provenance:** Verified 2026-03-15. Config type at `packages/chat/src/providers/ChatBubbleProvider.tsx`. Engine field on `ChatBubbleConfig`.

### When to Use

When the SDK component is wrapped in a provider/config pattern. Add the engine as an optional field on the config object, not as a separate prop.

### Implementation

```typescript
// In the provider config type
export interface ChatBubbleConfig {
  agentId: string;
  wallet: WalletAdapter;
  // ... other config fields ...

  /** External chat engine — bypasses built-in useChatBubbleEngine when provided. */
  engine?: ChatEngine;
}
```

Why config-level (not prop-level): The engine is a cross-cutting concern that affects the entire component tree (window, message list, input bar). Passing it through config/context avoids prop-drilling through every sub-component.

## Pattern 3: useResolvedEngine Helper

**Provenance:** Verified 2026-03-15. Implemented in `packages/chat/src/components/ChatBubbleWindow.tsx`.

### When to Use

When the component needs to transparently switch between built-in and external engines. The helper keeps the component code clean — it just uses `engine.*` without knowing the source.

### Implementation

```typescript
/** Use external engine from config if provided, otherwise fall back to built-in engine. */
function useResolvedEngine(
  config: { engine?: ChatEngine },
  builtInEngine: ReturnType<typeof useChatBubbleEngine>,
): ChatEngine {
  if (config.engine) return config.engine;
  return builtInEngine;
}

export function ChatBubbleWindow() {
  const { config } = useChatBubbleConfig();

  // Built-in engine always runs (hooks can't be conditional)
  const builtInEngine = useChatBubbleEngine({ context: chatContext, gatewayToken });

  // Resolution: external wins if present
  const engine = useResolvedEngine(config, builtInEngine);

  // Rest of component uses `engine.*` uniformly
  return (
    <>
      <ChatMessageList messages={engine.messages} streaming={engine.streaming} />
      <ChatInputBar
        value={engine.input}
        onChange={engine.setInput}
        onSend={() => engine.sendMessage().catch(() => undefined)}
        disabled={engine.streaming}
      />
    </>
  );
}
```

### Critical: Built-in Hook Still Runs

React hooks cannot be called conditionally. The built-in `useChatBubbleEngine()` always executes even when an external engine is provided. This is fine because:
1. The built-in engine is lightweight when not actively streaming
2. Its state (messages, session) is simply ignored when the external engine is active
3. No wasted network calls — the built-in engine only creates sessions when `sendMessage()` is called

## Pattern 4: App-Side Engine Mapping

**Provenance:** Verified 2026-03-15. Implemented at `web/src/components/ChatBubbleIntegration.tsx` in the research app.

### When to Use

When the host app has its own chat hook (e.g., `useChatEngine`) with a different return shape than the SDK's `ChatEngine` interface. Map the app hook's return value to the SDK interface.

### Implementation

```typescript
// App's own chat hook with app-specific features
const appEngine = useChatEngine({
  context: chatContext,
  gatewayToken,
  onNavigate: handleNavigate,
  onRevalidate: handleRevalidate,
});

// Map to SDK's ChatEngine interface
const engine = useMemo<ChatEngine>(() => ({
  messages: toSdkMessages(appEngine.messages),
  input: appEngine.input,
  setInput: appEngine.setInput,
  streaming: appEngine.streaming,
  loading: appEngine.loading,
  error: appEngine.error,
  clearError: appEngine.clearError,
  sendMessage: appEngine.sendMessage,
  isContextual: appEngine.isContextual,
  sessionId: appEngine.sessionId,
  abort: appEngine.abort,
}), [
  appEngine.messages,
  appEngine.input,
  appEngine.setInput,
  appEngine.streaming,
  appEngine.loading,
  appEngine.error,
  appEngine.clearError,
  appEngine.sendMessage,
  appEngine.isContextual,
  appEngine.sessionId,
  appEngine.abort,
]);

// Pass engine through config
const config: ChatBubbleConfig = useMemo(() => ({
  agentId: 'research-paper-analyst-geo-uploader',
  wallet,
  engine,   // <-- external engine
  title: 'Research Assistant',
  theme: { preset: 'dark' },
  callbacks: { onNavigate, onRevalidate },
}), [wallet, engine, handleNavigate, handleRevalidate]);
```

Key insight: The `useMemo` for the engine object must list all engine properties in its dependency array. This ensures the SDK component re-renders when any engine state changes (new messages, streaming toggle, etc.).

### Type Bridging

If the app's message type differs slightly from the SDK's `ChatMessage`, create a simple mapper:

```typescript
function toSdkMessages(messages: AppMessage[]): ChatMessage[] {
  return messages as ChatMessage[];  // works when types are structurally compatible
}
```

Use structural compatibility (`as` cast) when types align. Only write a full mapper when fields actually differ.

## When NOT to Use This Pattern

- If the app can use the SDK's built-in networking directly (no API proxy needed), skip the external engine — just pass `wallet` and `agentId` and let the SDK handle everything
- If the app only needs to customize callbacks (navigation, revalidation), use `ChatBubbleCallbacks` instead of a full external engine
- If the app needs a completely different UI, don't use the SDK component at all — build a custom UI using the SDK's hooks directly

## Known Limitations

- The built-in engine hook always runs even when unused (React hook rules). This is a minor overhead, not a bug.
- The engine interface is synchronous for reads (messages, streaming) and async only for actions (sendMessage). If an app needs async data loading for messages, it must handle that internally and expose the loaded state.
- `streamingPhase` and `activeTools` are optional — SDK components that use these features show degraded (but functional) UI when they're absent.
