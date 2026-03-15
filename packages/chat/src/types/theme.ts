/** CSS custom property tokens for theming. */
export interface ThemeTokens {
  '--chat-accent': string;
  '--chat-accent-hover': string;
  '--chat-accent-muted': string;
  '--chat-bg': string;
  '--chat-bg-secondary': string;
  '--chat-bg-tertiary': string;
  '--chat-border': string;
  '--chat-border-accent': string;
  '--chat-text': string;
  '--chat-text-secondary': string;
  '--chat-text-muted': string;
  '--chat-error': string;
  '--chat-error-muted': string;
  '--chat-success': string;
  '--chat-warning': string;
  '--chat-warning-muted': string;
  '--chat-radius': string;
  '--chat-radius-lg': string;
  '--chat-font-family': string;
  '--chat-font-size': string;
  [key: `--chat-${string}`]: string;
}

/** Theme configuration passed to the provider. */
export interface ThemeConfig {
  preset?: 'dark' | 'light';
  tokens?: Partial<ThemeTokens>;
}
