/**
 * Trace theme tokens — CSS custom properties for TraceViewer and TraceTimeline.
 * Follows the same pattern as @rickydata/chat theme tokens.
 */

export interface TraceThemeTokens {
  '--trace-bg': string;
  '--trace-bg-secondary': string;
  '--trace-bg-hover': string;
  '--trace-border': string;
  '--trace-text': string;
  '--trace-text-secondary': string;
  '--trace-text-muted': string;
  '--trace-font-family': string;
  '--trace-font-size': string;
  '--trace-font-mono': string;
  '--trace-radius': string;
  // Event type colors
  '--trace-color-session': string;
  '--trace-color-message': string;
  '--trace-color-tool': string;
  '--trace-color-sse': string;
  '--trace-color-error': string;
  '--trace-color-action': string;
  '--trace-color-custom': string;
  '--trace-color-done': string;
}

export const darkTokens: TraceThemeTokens = {
  '--trace-bg': '#0f0f0f',
  '--trace-bg-secondary': '#1a1a1a',
  '--trace-bg-hover': '#262626',
  '--trace-border': '#333333',
  '--trace-text': '#f5f5f5',
  '--trace-text-secondary': '#a3a3a3',
  '--trace-text-muted': '#737373',
  '--trace-font-family': 'system-ui, -apple-system, sans-serif',
  '--trace-font-size': '12px',
  '--trace-font-mono': "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  '--trace-radius': '4px',
  '--trace-color-session': '#a78bfa',
  '--trace-color-message': '#60a5fa',
  '--trace-color-tool': '#38bdf8',
  '--trace-color-sse': '#34d399',
  '--trace-color-error': '#f87171',
  '--trace-color-action': '#fbbf24',
  '--trace-color-custom': '#94a3b8',
  '--trace-color-done': '#4ade80',
};

/** Inject trace theme tokens onto a DOM element. */
export function injectTraceTheme(element: HTMLElement, tokens: Partial<TraceThemeTokens>): void {
  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      element.style.setProperty(key, value);
    }
  }
}
