import type { ThemeTokens } from '../types/theme.js';

/** Inject CSS custom property tokens onto a DOM element. */
export function injectThemeTokens(element: HTMLElement, tokens: Partial<ThemeTokens>): void {
  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) {
      element.style.setProperty(key, value);
    }
  }
}
