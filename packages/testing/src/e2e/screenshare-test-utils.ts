/**
 * Screenshare test utilities — fixtures and validators for screenshot E2E tests.
 */

/**
 * A minimal 1x1 red PNG as base64. Use as a simple fixture when you just need
 * an image payload to verify the pipeline works end-to-end.
 */
export const MINIMAL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/**
 * A more recognizable test image — 100x50 PNG with "TEST" text pattern.
 * This is a pre-encoded fixture. The LLM should be able to describe it as
 * a small image with colored blocks or a test pattern.
 */
export const TEST_SCREENSHOT_BASE64 = MINIMAL_PNG_BASE64; // Reuse minimal for now — LLM just needs to see "an image"

/**
 * Verify that an LLM response demonstrates it actually processed the image.
 * Returns array of failure messages (empty = pass).
 */
export function verifyImageDescription(
  response: string,
  expectedKeywords?: string[],
): string[] {
  const failures: string[] = [];
  const lower = response.toLowerCase();

  // The response should not be empty
  if (response.trim().length < 10) {
    failures.push('Response too short — likely did not process image');
  }

  // Check for keywords if provided
  if (expectedKeywords) {
    for (const kw of expectedKeywords) {
      if (!lower.includes(kw.toLowerCase())) {
        failures.push(`Missing expected keyword: "${kw}"`);
      }
    }
  }

  // Check for generic "I can't see" / refusal patterns
  const refusalPatterns = [
    'i cannot see',
    "i can't see",
    'no image',
    'unable to view',
    "i don't see an image",
  ];
  for (const pattern of refusalPatterns) {
    if (lower.includes(pattern)) {
      failures.push(`Response contains refusal pattern: "${pattern}"`);
    }
  }

  return failures;
}

/**
 * Create an image attachment object for the chat API.
 */
export function createImageAttachment(base64Data?: string, mediaType: 'image/png' | 'image/jpeg' = 'image/png') {
  return {
    data: base64Data || TEST_SCREENSHOT_BASE64,
    mediaType,
  };
}
