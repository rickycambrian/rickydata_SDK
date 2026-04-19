import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button, EmptyState, OrganizedBubbleAtlas, RelationshipGraph, RickyDataThemeProvider, SearchField } from '../src/index.js';

describe('@rickydata/ui', () => {
  it('renders children with the theme provider', () => {
    render(
      <RickyDataThemeProvider>
        <Button>Publish</Button>
      </RickyDataThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('renders search fields and empty states', () => {
    render(
      <RickyDataThemeProvider>
        <SearchField placeholder="Search papers" />
        <EmptyState title="No papers found" description="Adjust your filters and try again." />
      </RickyDataThemeProvider>,
    );

    expect(screen.getByPlaceholderText('Search papers')).toBeTruthy();
    expect(screen.getByText('No papers found')).toBeTruthy();
  });

  it('renders a relationship graph with filter chips and focus guidance', () => {
    render(
      <RickyDataThemeProvider>
        <RelationshipGraph
          nodes={[
            { id: 'paper-1', label: 'Paper A', kind: 'paper', href: '/paper/1' },
            { id: 'claim-1', label: 'Claim A', kind: 'claim' },
          ]}
          edges={[
            { source: 'paper-1', target: 'claim-1', kind: 'makes_claim', weight: 0.8 },
          ]}
          edgeKinds={{
            makes_claim: { label: 'makes claim', color: '#b76b38' },
          }}
        />
      </RickyDataThemeProvider>,
    );

    expect(screen.getByLabelText('Relationship graph')).toBeTruthy();
    expect(screen.getByText('makes claim')).toBeTruthy();
    expect(screen.getByText('Graph guidance')).toBeTruthy();
  });

  it('renders an organized bubble atlas and exposes node labels', () => {
    render(
      <RickyDataThemeProvider>
        <OrganizedBubbleAtlas
          aria-label="Organized atlas"
          nodes={[
            { id: 'topic-a', label: 'Agentic', x: 240, y: 220, paperCount: 12, claimCount: 48 },
            { id: 'topic-b', label: 'Knowledge graphs', x: 520, y: 260, paperCount: 8, claimCount: 21 },
          ]}
          edges={[
            { source: 'topic-a', target: 'topic-b', weight: 2 },
          ]}
          selectedNodeId="topic-a"
        />
      </RickyDataThemeProvider>,
    );

    expect(screen.getByLabelText('Organized atlas')).toBeTruthy();
    expect(screen.getByText('Agentic')).toBeTruthy();
    expect(screen.getByText('Knowledge graphs')).toBeTruthy();
  });
});
