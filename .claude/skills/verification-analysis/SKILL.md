---
name: verification-analysis
description: Run the verification analysis pipeline — predict outcomes, analyze failures, generate remediation suggestions, and display a health dashboard. Use when investigating verification failures, checking system health, or running the full analysis suite.
argument-hint: [predict|remediate|dashboard|full]
allowed-tools: Bash, Read, Glob, Grep
---

# Verification Analysis Pipeline

Run prediction, remediation, and dashboard analysis for the post-deployment verification system across all monitored repos.

**Provenance:** Verified working 2026-03-15. All three modules tested and producing correct output. Commits: prediction_engine (d25cbcd), remediation_engine (cec9101), health_dashboard (945ff8a) in ai_research repo. Prediction engine produces reconciled predictions with honest accuracy assessment. Remediation engine correlates failures with commit changes and generates confidence-rated suggestions. Dashboard aggregates all data into terminal/JSON/markdown output.

## Prerequisites

- The `ai_research` repo must be cloned at `~/Documents/github/ai_research`
- GitHub CLI (`gh`) must be authenticated (used for API calls)
- Python 3.11+ required

## Commands

### Predict verification outcomes

```bash
cd ~/Documents/github/ai_research
python -m src.verification.prediction_engine predict --all     # Predict all 4 repos
python -m src.verification.prediction_engine predict --repo rickycambrian/knowledgeflow_db
python -m src.verification.prediction_engine reconcile         # Match predictions to actual runs
python -m src.verification.prediction_engine accuracy          # Show prediction accuracy report
```

Output: `data/verification/predictions.json`

### Analyze failures and generate remediation suggestions

```bash
cd ~/Documents/github/ai_research
python -m src.verification.remediation_engine analyze          # Analyze all repos
python -m src.verification.remediation_engine analyze --repo rickycambrian/KF-serverless
python -m src.verification.remediation_engine suggest --repo rickycambrian/KF-serverless
```

Output: `data/verification/remediation_suggestions.json`

### Health dashboard

```bash
cd ~/Documents/github/ai_research
python scripts/verification_health_dashboard.py               # Terminal output (default)
python scripts/verification_health_dashboard.py --json        # JSON output
python scripts/verification_health_dashboard.py --markdown    # Markdown output
```

Output: `data/verification/health_dashboard.json` (latest snapshot)

### Full pipeline (run all in sequence)

```bash
cd ~/Documents/github/ai_research
python -m src.verification.prediction_engine predict --all
python -m src.verification.prediction_engine reconcile
python -m src.verification.remediation_engine analyze
python scripts/verification_health_dashboard.py
```

## Architecture

All modules live in `ai_research/src/verification/`:

| Module | File | Purpose |
|--------|------|---------|
| Prediction | `prediction_engine.py` | Pre-run outcome prediction with reconciliation |
| Remediation | `remediation_engine.py` | Failure pattern analysis + remediation suggestions |
| Dashboard | `scripts/verification_health_dashboard.py` | Aggregated health report |
| Accuracy | `accuracy_tracker.py` | Historical accuracy tracking |

Data files in `ai_research/data/verification/`:
- `predictions.json` — recorded predictions with reconciliation status
- `remediation_suggestions.json` — failure analysis and suggestions
- `health_dashboard.json` — latest dashboard snapshot
- `verification_latest.json` — aggregated verification run data
- `accuracy_log.json` — accuracy tracking log

## Monitored Repos

| Repo | Service Type |
|------|-------------|
| `rickycambrian/knowledgeflow_db` | GKE |
| `rickycambrian/rickydata_docs` | Cloud Run |
| `rickycambrian/KF-serverless` | Cloud Run |
| `rickycambrian/canvas-workflows` | Cloud Run |

## Known Limitations

- Prediction accuracy is 50% at initial seeding (equal to trivial "always pass" baseline) — will improve as more data accumulates
- Remediation suggestions require human review — none are auto-fixable yet
- Dashboard JSON output includes a "saved to" line on stderr before the JSON on stdout
- All modules depend on `gh` CLI for GitHub API access
