---
name: improvement-cycle
description: Run the verification system continuous improvement cycle. Use when checking system health trends, recalibrating predictions, or running the full 8-stage pipeline.
allowed-tools: Bash, Read, Grep, Glob
disable-model-invocation: true
---

# Continuous Improvement Cycle

Run the full 8-stage improvement pipeline for the post-deployment verification system.

**Provenance:** Verified working 2026-03-15. Ran `python scripts/run_improvement_cycle.py --skip-github` — 8/8 stages completed in 2.8s (Cycle #31). All 359 verification tests pass. Modules: improvement_tracker.py, remediation_tracker.py, prediction_engine.py `recalibrate()`. Test files: tests/test_verification/test_improvement_tracker.py, test_remediation_tracker.py, test_prediction_recalibration.py, test_improvement_cycle.py.

## Prerequisites

- The `ai_research` repo must be cloned at `~/Documents/github/ai_research`
- GitHub CLI (`gh`) must be authenticated (unless using `--skip-github`)
- Python 3.11+ required

## Commands

### Full cycle (default: 7-day lookback)

```bash
cd ~/Documents/github/ai_research && python scripts/run_improvement_cycle.py
```

### Local-only (no GitHub API calls)

```bash
cd ~/Documents/github/ai_research && python scripts/run_improvement_cycle.py --skip-github
```

### Custom lookback window

```bash
cd ~/Documents/github/ai_research && python scripts/run_improvement_cycle.py --days 14
```

### JSON output

```bash
cd ~/Documents/github/ai_research && python scripts/run_improvement_cycle.py --json
```

### Verbose logging

```bash
cd ~/Documents/github/ai_research && python scripts/run_improvement_cycle.py --verbose
```

## 8 Stages

| # | Stage | What It Does | Skippable |
|---|-------|-------------|-----------|
| 1 | aggregate | Fetch verification runs from GitHub Actions | `--skip-github` |
| 2 | predict | Generate predictions for all repos | `--skip-github` |
| 3 | reconcile | Match predictions against actual outcomes | `--skip-github` |
| 4 | recalibrate | Bayesian update of prediction factor weights | No |
| 5 | remediate | Analyze failures, generate remediation suggestions | No |
| 6 | resolve | Seed/update remediation lifecycle, auto-verify fixes | No |
| 7 | dashboard | Generate health dashboard | No |
| 8 | track | Record KPIs, compute trend, produce cycle report | No |

Each stage continues on failure — partial results are better than none.

## Key Modules

| Module | File | Purpose |
|--------|------|---------|
| Improvement Tracker | `src/verification/improvement_tracker.py` | KPI computation, cycle recording, trend analysis |
| Remediation Tracker | `src/verification/remediation_tracker.py` | Suggestion lifecycle (suggested -> verified -> closed) |
| Prediction Engine | `src/verification/prediction_engine.py` | `recalibrate()` — Bayesian factor weight updates |
| Cycle Runner | `scripts/run_improvement_cycle.py` | Orchestrates the 8-stage pipeline |

## Data Files Produced

All in `ai_research/data/verification/`:

- `improvement_history.json` — cycle-over-cycle KPIs and trend data
- `calibration.json` — prediction factor weights (updated by recalibrate)
- `remediation_lifecycle.json` — suggestion lifecycle tracking
- `health_dashboard.json` — latest dashboard snapshot

## Output

The cycle produces an ASCII report with:
- Stage completion summary (N/8 completed)
- KPIs: failure rate, prediction accuracy (with inflation warnings), calibration gap
- Repo health: healthy/degraded/critical counts
- Remediation: open/implemented suggestion counts
- Trend assessment: improving/stable/declining (requires 3+ cycles)

## Known Limitations

- `--skip-github` skips stages 1-3 (aggregate, predict, reconcile) — uses cached data
- Prediction accuracy starts at 50% (trivial baseline) and improves with data
- Accuracy is honestly flagged when inflated by retrospective seeds
- File locking uses `fcntl.flock` — works on Unix/macOS only
- Trend requires 3+ cycles of history to compute
