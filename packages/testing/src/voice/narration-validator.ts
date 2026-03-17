/**
 * Validates that voice narration text is plain — no markdown, HTML, or emoji.
 * Re-declares VoicePhase locally to avoid React peer dep.
 */

import type { VoicePhase } from './types.js';

const MARKDOWN_PATTERNS = [
  /\*\*.+?\*\*/,   // bold
  /`.+?`/,          // inline code
  /\[.+?\]\(.+?\)/, // links
  /^#{1,6}\s/m,      // headers
  /^[-*]\s/m,        // unordered lists
  /^\d+\.\s/m,       // ordered lists
  /^>\s/m,           // blockquotes
  /```/,             // code blocks
];

const HTML_PATTERN = /<[a-z][^>]*>/i;
const EMOJI_PATTERN = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

/** Check that narration text contains no markdown. Returns failure message or null. */
export function assertNoMarkdown(text: string): string | null {
  for (const pattern of MARKDOWN_PATTERNS) {
    if (pattern.test(text)) {
      return `Narration contains markdown: "${text.slice(0, 80)}"`;
    }
  }
  if (HTML_PATTERN.test(text)) {
    return `Narration contains HTML: "${text.slice(0, 80)}"`;
  }
  if (EMOJI_PATTERN.test(text)) {
    return `Narration contains emoji: "${text.slice(0, 80)}"`;
  }
  return null;
}

/** Valid phase transitions map. */
const VALID_TRANSITIONS: Record<VoicePhase, VoicePhase[]> = {
  idle: ['connecting'],
  connecting: ['listening', 'idle'],
  listening: ['thinking', 'idle'],
  thinking: ['speaking', 'using_tools', 'listening', 'idle'],
  using_tools: ['speaking', 'thinking', 'idle'],
  speaking: ['listening', 'thinking', 'idle'],
};

/**
 * Assert that a phase transition is valid.
 * Returns failure message or null.
 */
export function assertPhaseTransition(
  from: VoicePhase,
  to: VoicePhase,
  context?: string,
): string | null {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    const ctx = context ? ` (${context})` : '';
    return `Invalid phase transition: ${from} → ${to}${ctx}`;
  }
  return null;
}
