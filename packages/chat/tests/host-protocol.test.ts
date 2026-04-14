import { describe, expect, it } from 'vitest';
import { buildHostContextMessage, extractHostDirectives } from '../src/host/protocol.js';

describe('host protocol helpers', () => {
  it('extracts highlights and actions from fenced directives', () => {
    const parsed = extractHostDirectives(`
Use the KQL tour example.

\`\`\`rickydata_host
{
  "highlights": [
    { "target": "notebook.examples.kql-graph-tour", "tooltip": "Open this example" }
  ],
  "actions": [
    {
      "proposalId": "proposal-1",
      "actionType": "open_example",
      "description": "Open the KQL graph tour notebook",
      "params": { "path": "examples/kql_graph_tour.rdm" }
    }
  ]
}
\`\`\`
    `);

    expect(parsed.cleanText).toContain('Use the KQL tour example.');
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({
      type: 'ui_highlight',
      data: { target: 'notebook.examples.kql-graph-tour' },
    });
    expect(parsed.events[1]).toMatchObject({
      type: 'agent_action_proposed',
      data: { proposalId: 'proposal-1', actionType: 'open_example' },
    });
  });

  it('builds a structured host context envelope', () => {
    const message = buildHostContextMessage('Show me where to run this query', {
      route: '/notebook',
      view: 'notebook',
      title: 'Demo Notebook',
      visibleTargets: [{ id: 'notebook.run-all', label: 'Run all' }],
    });

    expect(message).toContain('<host_context>');
    expect(message).toContain('"route": "/notebook"');
    expect(message).toContain('Show me where to run this query');
  });

  it('extracts companion events from the host directive envelope', () => {
    const parsed = extractHostDirectives(`
I found the relevant section and queued the next review step.

\`\`\`rickydata_host
{
  "events": [
    {
      "type": "focus_target",
      "data": {
        "id": "section-2",
        "target": "section-card-section-2",
        "anchorId": "section-2",
        "label": "Method"
      }
    },
    {
      "type": "open_panel",
      "data": {
        "panel": "claims",
        "target": {
          "id": "claims-panel",
          "target": "claims-section"
        }
      }
    },
    {
      "type": "review_ready",
      "data": {
        "title": "Claims are ready for review",
        "summary": "Enough grounded material is available.",
        "count": 5
      }
    },
    {
      "type": "app_context",
      "data": {
        "route": "/research/paper-1",
        "stage": "claims_ready",
        "readingMode": "split",
        "activePaperId": "paper-1",
        "activeSectionIds": ["section-2"],
        "visibleAnchors": [
          { "id": "section-2", "kind": "section", "label": "Method" }
        ]
      }
    }
  ]
}
\`\`\`
    `);

    expect(parsed.cleanText).toContain('I found the relevant section');
    expect(parsed.events).toEqual([
      {
        type: 'focus_target',
        data: {
          id: 'section-2',
          target: 'section-card-section-2',
          anchorId: 'section-2',
          label: 'Method',
        },
      },
      {
        type: 'open_panel',
        data: {
          panel: 'claims',
          target: {
            id: 'claims-panel',
            target: 'claims-section',
          },
        },
      },
      {
        type: 'review_ready',
        data: {
          title: 'Claims are ready for review',
          summary: 'Enough grounded material is available.',
          count: 5,
        },
      },
      {
        type: 'app_context',
        data: {
          route: '/research/paper-1',
          stage: 'claims_ready',
          readingMode: 'split',
          activePaperId: 'paper-1',
          activePaperTitle: undefined,
          activeSectionIds: ['section-2'],
          visibleAnchors: [
            { id: 'section-2', kind: 'section', label: 'Method', target: undefined, sectionId: undefined, page: undefined, textPreview: undefined, metadata: undefined },
          ],
          selectionText: undefined,
          hoverTarget: null,
          pointer: null,
          scrollDepth: undefined,
          pendingReviewCount: undefined,
          reviewReady: undefined,
          packageReady: undefined,
          threadId: null,
          sessionId: null,
          metadata: undefined,
        },
      },
    ]);
  });
});
