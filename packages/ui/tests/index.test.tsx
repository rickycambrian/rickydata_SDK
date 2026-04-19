import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button, EmptyState, RelationshipGraph, RickyDataThemeProvider, SearchField } from '../src/index.js';

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
});
