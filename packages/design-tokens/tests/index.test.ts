import {
  createCssVariables,
  editorialLightTheme,
  injectThemeVariables,
  resolveTheme,
  workbenchDarkTheme,
} from '../src/index.js';

describe('@rickydata/design-tokens', () => {
  it('creates semantic CSS variables from a theme', () => {
    const vars = createCssVariables(editorialLightTheme);
    expect(vars['--rd-color-canvas']).toBe('#fbf7f2');
    expect(vars['--rd-font-size-display']).toContain('clamp');
  });

  it('resolves partial theme overrides against a base theme', () => {
    const theme = resolveTheme({
      color: {
        accent: '#000000',
      },
    });

    expect(theme.color.accent).toBe('#000000');
    expect(theme.color.canvas).toBe(editorialLightTheme.color.canvas);
  });

  it('injects variables into a DOM element', () => {
    const element = {
      style: {
        setProperty: vi.fn(),
      },
    } as unknown as HTMLElement;

    injectThemeVariables(element, workbenchDarkTheme);

    expect(element.style.setProperty).toHaveBeenCalledWith('--rd-color-canvas', '#1a1612');
  });
});
