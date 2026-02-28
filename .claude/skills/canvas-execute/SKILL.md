---
name: canvas-execute
description: Execute a canvas workflow from a local .canvas.json file or by workflow entity ID. Use when the user wants to run, test, or execute a canvas workflow.
disable-model-invocation: true
allowed-tools: Bash, Read
---

Execute a canvas workflow using the rickydata CLI.

## From a local file

```bash
rickydata canvas execute ./path/to/workflow.canvas.json --verbose
```

## From a saved workflow by entity ID

First list available workflows:
```bash
rickydata canvas list
```

Then execute by entity ID:
```bash
rickydata canvas execute <entity-id> --verbose
```

## Options

- `--auto-approve` — skip approval gate prompts
- `--verbose` — show all SSE events including logs and agent text
- `--json` — output the final result as JSON instead of streaming
- `--model <haiku|sonnet|opus>` — override the model for agent nodes

## Check run results

```bash
rickydata canvas runs              # list recent runs
rickydata canvas run <run-id>      # get full details of a run
```

## Arguments

$ARGUMENTS is the workflow file path or entity ID to execute.
