import type { Config } from 'tailwindcss';
import { editorialLightTheme, workbenchDarkTheme, type RickyDataThemeName } from '@rickydata/design-tokens';

export interface RickyDataTailwindOptions {
  defaultTheme?: RickyDataThemeName;
  prefix?: string;
  includeTypography?: boolean;
}

function themeFor(name: RickyDataThemeName = 'editorialLight') {
  return name === 'workbenchDark' ? workbenchDarkTheme : editorialLightTheme;
}

export function createRickyDataTailwindPreset(
  options: RickyDataTailwindOptions = {},
): Config {
  const theme = themeFor(options.defaultTheme);
  const maybePrefix = options.prefix ? `${options.prefix}-` : '';

  return {
    content: [],
    darkMode: 'class',
    theme: {
      extend: {
        fontFamily: options.includeTypography === false
          ? {}
          : {
              display: ['var(--rd-font-display)', 'Georgia', 'serif'],
              body: ['var(--rd-font-body)', 'system-ui', 'sans-serif'],
              mono: ['var(--rd-font-mono)', 'monospace'],
            },
        colors: {
          [`${maybePrefix}rd`]: {
            canvas: 'var(--rd-color-canvas)',
            'canvas-muted': 'var(--rd-color-canvas-muted)',
            panel: 'var(--rd-color-panel)',
            'panel-muted': 'var(--rd-color-panel-muted)',
            'panel-strong': 'var(--rd-color-panel-strong)',
            hairline: 'var(--rd-color-hairline)',
            'hairline-strong': 'var(--rd-color-hairline-strong)',
            accent: 'var(--rd-color-accent)',
            'accent-hover': 'var(--rd-color-accent-hover)',
            'accent-soft': 'var(--rd-color-accent-soft)',
            success: 'var(--rd-color-success)',
            warning: 'var(--rd-color-warning)',
            danger: 'var(--rd-color-danger)',
            text: {
              primary: 'var(--rd-color-text-primary)',
              secondary: 'var(--rd-color-text-secondary)',
              muted: 'var(--rd-color-text-muted)',
              inverse: 'var(--rd-color-text-inverse)',
            },
          },
          surface: {
            50: '#16110c',
            100: '#221b15',
            200: '#3a3026',
            300: '#5c4f42',
            400: '#7a6c5d',
            500: '#988978',
            600: '#b8ab9c',
            700: '#d8cebf',
            800: '#ece3d7',
            900: '#f7f2ea',
            950: '#fbf7f2',
          },
          accent: {
            DEFAULT: 'var(--rd-color-accent)',
            hover: 'var(--rd-color-accent-hover)',
            muted: 'var(--rd-color-accent-soft)',
          },
          success: {
            DEFAULT: 'var(--rd-color-success)',
            muted: 'var(--rd-color-success-soft)',
          },
          warning: {
            DEFAULT: 'var(--rd-color-warning)',
            muted: 'var(--rd-color-warning-soft)',
          },
          error: {
            DEFAULT: 'var(--rd-color-danger)',
            muted: 'var(--rd-color-danger-soft)',
          },
        },
        borderRadius: {
          rd: 'var(--rd-radius-md)',
          'rd-sm': 'var(--rd-radius-sm)',
          'rd-lg': 'var(--rd-radius-lg)',
        },
        boxShadow: {
          'rd-soft': 'var(--rd-shadow-soft)',
          'rd-lift': 'var(--rd-shadow-lift)',
        },
        transitionTimingFunction: {
          'rd-standard': 'var(--rd-ease-standard)',
          'rd-emphasis': 'var(--rd-ease-emphasis)',
        },
        transitionDuration: {
          'rd-fast': 'var(--rd-duration-fast)',
          'rd-normal': 'var(--rd-duration-normal)',
          'rd-slow': 'var(--rd-duration-slow)',
        },
      },
    },
    plugins: [],
  };
}

export const rickydataTailwindPreset = createRickyDataTailwindPreset();
