---
name: wallet-adapter-pattern
description: Verified pattern for creating wallet-agnostic auth adapters that bridge wallet libraries (Privy, MetaMask, etc.) to the SDK's WalletAdapter interface. Use when building wallet integrations for SDK packages or adapting app-specific wallet hooks into stable adapter objects.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Wallet Adapter Pattern

Verified working pattern for decoupling SDK components from specific wallet libraries. Confirmed 2026-03-15 — SDK build passes, typecheck passes, research app integrated successfully (Tasks #2, #4, #5).

## Pattern 1: Plain Object Interface (Not Hooks)

**Provenance:** Verified 2026-03-15. Interface at `packages/chat/src/types/wallet.ts`. Used by ChatBubbleProvider and useWalletAuth.

### When to Use

When designing any SDK interface that needs wallet signing. Define a plain object interface, not a React hook, so it works in any framework or outside React.

### The Interface

```typescript
export interface WalletAdapter {
  /** Return the connected wallet address (lowercase 0x-prefixed) or null. */
  getAddress(): string | null;

  /** EIP-191 personal_sign. Used for gateway challenge/verify auth. */
  signMessage(message: string): Promise<string>;

  /** Whether the wallet is ready to sign (connected + initialized). */
  isReady(): boolean;

  /** Subscribe to address changes. Returns unsubscribe function. */
  onAddressChange?(callback: (address: string | null) => void): () => void;
}
```

Key design decisions:
- `getAddress()` returns `string | null` (not a reactive value) — callers poll when needed
- `signMessage()` is the only async method — keeps the interface simple
- `isReady()` gates auth flows — prevents signing before wallet is initialized
- `onAddressChange()` is optional — only needed for reactive UI updates

## Pattern 2: SDK-Side Factory Adapters (No Hard Dependencies)

**Provenance:** Verified 2026-03-15. Factories at `packages/chat/src/adapters/privy.ts`, `window-ethereum.ts`, `custom.ts`.

### When to Use

When the SDK provides convenience adapters for popular wallet libraries. Inline the minimal type definitions instead of importing the wallet library.

### Implementation

```typescript
// Inline types to avoid hard dependency on @privy-io/react-auth
interface PrivyWallet {
  address: string;
  getEthereumProvider(): Promise<{
    request(args: { method: string; params: unknown[] }): Promise<unknown>;
  }>;
}

interface PrivyWallets {
  wallets: PrivyWallet[];
  ready: boolean;
}

export function createPrivyAdapter(wallets: PrivyWallets, privyAuth: PrivyAuth): WalletAdapter {
  return {
    getAddress() { /* ... */ },
    async signMessage(message) { /* ... */ },
    isReady() { return wallets.ready && wallets.wallets.length > 0; },
  };
}
```

Key insight: Inline the wallet library types (e.g., `PrivyWallet`, `PrivyAuth`) as minimal interfaces. This avoids a hard `peerDependency` on `@privy-io/react-auth` while still providing type-safe adapters.

## Pattern 3: App-Side Hook Adapter with useRef Stability

**Provenance:** Verified 2026-03-15. Implemented at `web/src/lib/privy-wallet-adapter.ts` in the research app (rickydata_geo_research_papers).

### When to Use

When an app uses React hooks for wallet state (e.g., Privy's `useWallets()`) but needs to produce a stable `WalletAdapter` object that doesn't cause re-renders when wallet state changes.

### Implementation

```typescript
export function usePrivyWalletAdapter(): WalletAdapter {
  const { wallets, ready } = useWallets();
  const { walletAddress, hydrated } = useAuth();

  // Store reactive values in refs so the adapter object is stable
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;

  const readyRef = useRef(ready);
  readyRef.current = ready;

  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  // Empty dependency array = adapter object never changes identity
  const adapter = useMemo<WalletAdapter>(
    () => ({
      getAddress() {
        return normalize(walletAddressRef.current);
      },
      async signMessage(message: string): Promise<string> {
        const address = normalize(walletAddressRef.current);
        if (!address) throw new Error('No Privy wallet connected');
        const currentWallets = walletsRef.current;
        const wallet =
          currentWallets.find((w) => normalize(w.address) === address) ??
          currentWallets[0];
        if (!wallet) throw new Error('No Privy wallet available');
        const provider = await wallet.getEthereumProvider();
        return (await provider.request({
          method: 'personal_sign',
          params: [message, address],
        })) as string;
      },
      isReady() {
        return readyRef.current && walletsRef.current.length > 0 && hydratedRef.current;
      },
    }),
    [], // <-- empty deps: stable object identity
  );

  return adapter;
}
```

### Critical: Why useRef + Empty useMemo Deps

The adapter is passed to `ChatBubbleProvider` via `config`. If the adapter object changed identity on every render, it would cascade re-renders through the provider context. The `useRef` pattern ensures:

1. The adapter object is created once (stable reference)
2. Methods always read current wallet state via refs (fresh data)
3. No unnecessary re-renders when wallet state updates

**Wrong approach:** Using reactive values directly in `useMemo` deps causes the adapter identity to change on every wallet state update, triggering full chat bubble re-renders.

## Known Limitations

- `getAddress()` is not reactive — components must call it when they need the current address, not subscribe to changes
- The SDK-side `createPrivyAdapter` is a simpler factory (no refs needed) because it's called inside render and the return value is used immediately; the app-side hook adapter needs refs because the object must be stable across renders
- `onAddressChange` is optional and not implemented in the Privy adapters — apps that need reactive address updates should use their own wallet hooks for that
