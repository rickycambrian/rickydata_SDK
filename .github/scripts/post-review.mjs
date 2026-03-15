#!/usr/bin/env node

/**
 * Post rickydata team review findings as a GitHub PR review.
 *
 * Usage: node post-review.mjs <owner/repo> <pr-number>
 *
 * Reads /tmp/review-result.json (output of `rickydata github review --json`)
 * and posts findings as inline PR review comments via the GitHub API.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [repo, prNumber] = process.argv.slice(2);
if (!repo || !prNumber) {
  console.error('Usage: post-review.mjs <owner/repo> <pr-number>');
  process.exit(1);
}

// ── Read results ────────────────────────────────────────────────────────────

let resultJson;
try {
  const raw = readFileSync('/tmp/review-result.json', 'utf-8');
  resultJson = JSON.parse(raw);
} catch (err) {
  console.error('Failed to read /tmp/review-result.json:', err.message);
  // Post a comment indicating failure
  execSync(
    `gh pr comment "${prNumber}" --repo "${repo}" --body "**rickydata review** failed to parse results. Check the Actions log for details."`,
    { stdio: 'inherit' },
  );
  process.exit(1);
}

// ── Extract findings ────────────────────────────────────────────────────────

const parsed = resultJson.parsed ?? {};
const findings = parsed.findings ?? [];
const summary = parsed.summary ?? '';

const SEVERITY_EMOJI = {
  critical: '\u{1F534}',
  major: '\u{1F7E0}',
  minor: '\u{1F7E1}',
  nit: '\u{1F535}',
  praise: '\u{1F49C}',
};

function formatFindingBody(f) {
  const emoji = SEVERITY_EMOJI[f.severity] ?? '';
  let body = `${emoji} **${(f.severity ?? 'info').toUpperCase()}** — ${f.title ?? 'Finding'}\n\n`;
  body += f.body ?? '';
  if (f.suggestion) {
    body += `\n\n**Suggestion:**\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  }
  return body;
}

// ── Get changed files from PR diff for validation ───────────────────────────

let diffFiles = new Set();
try {
  const diff = readFileSync('/tmp/pr.diff', 'utf-8');
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      diffFiles.add(line.slice(6));
    }
  }
} catch {
  // If we can't read the diff, skip file validation
}

// ── Build review payload ────────────────────────────────────────────────────

const comments = [];
const generalFindings = [];

for (const f of findings) {
  const hasValidFile = f.file && f.file !== 'N/A' && f.file !== 'general';
  const fileInDiff = diffFiles.size === 0 || diffFiles.has(f.file);

  if (hasValidFile && fileInDiff && f.line) {
    comments.push({
      path: f.file,
      line: f.line,
      side: 'RIGHT',
      body: formatFindingBody(f),
    });
  } else {
    generalFindings.push(f);
  }
}

// Determine review event
const hasCritical = findings.some(f => f.severity === 'critical');
const hasMajor = findings.some(f => f.severity === 'major');
const event = hasCritical || hasMajor ? 'REQUEST_CHANGES' : 'COMMENT';

// Build summary
const counts = {};
for (const f of findings) {
  counts[f.severity] = (counts[f.severity] ?? 0) + 1;
}

let reviewBody = `## rickydata Team Review\n\n`;
if (summary) {
  reviewBody += `${summary}\n\n`;
}
reviewBody += `### Findings (${findings.length})\n`;
for (const [sev, count] of Object.entries(counts)) {
  reviewBody += `${SEVERITY_EMOJI[sev] ?? ''} **${sev}**: ${count}  \n`;
}

if (generalFindings.length > 0) {
  reviewBody += `\n### General\n`;
  for (const f of generalFindings) {
    reviewBody += `\n${formatFindingBody(f)}\n`;
  }
}

// ── Post review via GitHub API ──────────────────────────────────────────────

if (findings.length === 0) {
  // No findings — just post a comment
  const body = summary
    ? `## rickydata Team Review\n\n${summary}\n\nNo actionable findings.`
    : '## rickydata Team Review\n\nReview completed — no structured findings extracted. Check the Actions log for raw output.';

  execSync(
    `gh pr comment "${prNumber}" --repo "${repo}" --body ${JSON.stringify(body)}`,
    { stdio: 'inherit' },
  );
  console.log('Posted summary comment (no findings).');
  process.exit(0);
}

// Post as a PR review with inline comments
const reviewPayload = {
  body: reviewBody,
  event,
  comments: comments.slice(0, 50), // GitHub API limits to ~60 comments per review
};

try {
  // Get the latest commit SHA for the review
  const prInfoRaw = execSync(`gh pr view "${prNumber}" --repo "${repo}" --json headRefOid`, {
    encoding: 'utf-8',
  });
  const prInfo = JSON.parse(prInfoRaw);
  reviewPayload.commit_id = prInfo.headRefOid;

  const payloadJson = JSON.stringify(reviewPayload);
  execSync(
    `gh api "repos/${repo}/pulls/${prNumber}/reviews" --method POST --input -`,
    { input: payloadJson, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  console.log(`Posted review with ${comments.length} inline comments and ${generalFindings.length} general findings.`);
} catch (err) {
  console.error('Failed to post review, falling back to comment:', err.message);
  // Fallback: post as a regular comment
  execSync(
    `gh pr comment "${prNumber}" --repo "${repo}" --body ${JSON.stringify(reviewBody)}`,
    { stdio: 'inherit' },
  );
}

// ── Update status comment ───────────────────────────────────────────────────

const statusBody = `**rickydata review** complete — ${findings.length} findings (${Object.entries(counts).map(([s, c]) => `${c} ${s}`).join(', ')})`;
execSync(
  `gh pr comment "${prNumber}" --repo "${repo}" --body ${JSON.stringify(statusBody)}`,
  { stdio: 'inherit' },
);
