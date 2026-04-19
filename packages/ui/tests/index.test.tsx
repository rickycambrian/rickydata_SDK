import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button, EmptyState, RickyDataThemeProvider, SearchField } from '../src/index.js';

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
});
