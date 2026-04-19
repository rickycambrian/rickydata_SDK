export type RickyDataThemeName = 'editorialLight' | 'workbenchDark';

export interface RickyDataColorTokens {
  canvas: string;
  canvasMuted: string;
  panel: string;
  panelMuted: string;
  panelStrong: string;
  hairline: string;
  hairlineStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  focusRing: string;
}

export interface RickyDataTypographyTokens {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  sizeXs: string;
  sizeSm: string;
  sizeMd: string;
  sizeLg: string;
  sizeXl: string;
  sizeDisplay: string;
}

export interface RickyDataSpacingTokens {
  xxs: string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
}

export interface RickyDataRadiusTokens {
  sm: string;
  md: string;
  lg: string;
  pill: string;
}

export interface RickyDataMotionTokens {
  easeStandard: string;
  easeEmphasis: string;
  durationFast: string;
  durationNormal: string;
  durationSlow: string;
}

export interface RickyDataShadowTokens {
  soft: string;
  lift: string;
}

export interface RickyDataTheme {
  name: RickyDataThemeName;
  color: RickyDataColorTokens;
  typography: RickyDataTypographyTokens;
  spacing: RickyDataSpacingTokens;
  radius: RickyDataRadiusTokens;
  motion: RickyDataMotionTokens;
  shadow: RickyDataShadowTokens;
}

export type RickyDataTokenMap = Record<`--rd-${string}`, string>;

const sharedTypography: RickyDataTypographyTokens = {
  fontDisplay: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
  fontBody: 'var(--font-body, "DM Sans"), system-ui, sans-serif',
  fontMono: '"SFMono-Regular", "SF Mono", "IBM Plex Mono", "Menlo", monospace',
  sizeXs: '12px',
  sizeSm: '13px',
  sizeMd: '14px',
  sizeLg: '16px',
  sizeXl: '20px',
  sizeDisplay: 'clamp(2.75rem, 4vw, 4.5rem)',
};

const sharedSpacing: RickyDataSpacingTokens = {
  xxs: '4px',
  xs: '8px',
  sm: '12px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
};

const sharedRadius: RickyDataRadiusTokens = {
  sm: '10px',
  md: '16px',
  lg: '24px',
  pill: '999px',
};

const sharedMotion: RickyDataMotionTokens = {
  easeStandard: 'cubic-bezier(0.25, 1, 0.5, 1)',
  easeEmphasis: 'cubic-bezier(0.16, 1, 0.3, 1)',
  durationFast: '100ms',
  durationNormal: '200ms',
  durationSlow: '350ms',
};

export const editorialLightTheme: RickyDataTheme = {
  name: 'editorialLight',
  color: {
    canvas: '#fbf7f2',
    canvasMuted: '#f5efe6',
    panel: '#ffffff',
    panelMuted: '#faf6f0',
    panelStrong: '#efe7dc',
    hairline: '#e7dece',
    hairlineStrong: '#d9ccb9',
    textPrimary: '#221d16',
    textSecondary: '#5b5044',
    textMuted: '#8f7f6d',
    textInverse: '#fffdf9',
    accent: '#c87b14',
    accentHover: '#b56c08',
    accentSoft: '#f5e6d1',
    success: '#5b9b67',
    successSoft: '#eef6ef',
    warning: '#c4932c',
    warningSoft: '#fbf0d9',
    danger: '#b76446',
    dangerSoft: '#faebe4',
    overlay: 'rgba(34, 29, 22, 0.3)',
    focusRing: 'rgba(200, 123, 20, 0.28)',
  },
  typography: sharedTypography,
  spacing: sharedSpacing,
  radius: sharedRadius,
  motion: sharedMotion,
  shadow: {
    soft: '0 18px 40px rgba(102, 79, 53, 0.10)',
    lift: '0 26px 60px rgba(79, 58, 34, 0.16)',
  },
};

export const workbenchDarkTheme: RickyDataTheme = {
  name: 'workbenchDark',
  color: {
    canvas: '#1a1612',
    canvasMuted: '#211b16',
    panel: '#241e19',
    panelMuted: '#2a231d',
    panelStrong: '#322920',
    hairline: '#3f3429',
    hairlineStrong: '#524335',
    textPrimary: '#f2eadf',
    textSecondary: '#cdbfae',
    textMuted: '#9c8f80',
    textInverse: '#1b140e',
    accent: '#cf8630',
    accentHover: '#e0963c',
    accentSoft: 'rgba(207, 134, 48, 0.16)',
    success: '#73b27b',
    successSoft: 'rgba(115, 178, 123, 0.16)',
    warning: '#d1a145',
    warningSoft: 'rgba(209, 161, 69, 0.16)',
    danger: '#d07b62',
    dangerSoft: 'rgba(208, 123, 98, 0.16)',
    overlay: 'rgba(15, 12, 10, 0.55)',
    focusRing: 'rgba(207, 134, 48, 0.3)',
  },
  typography: sharedTypography,
  spacing: sharedSpacing,
  radius: sharedRadius,
  motion: sharedMotion,
  shadow: {
    soft: '0 18px 36px rgba(0, 0, 0, 0.24)',
    lift: '0 28px 68px rgba(0, 0, 0, 0.36)',
  },
};

export function resolveTheme(
  partialTheme?: Partial<RickyDataTheme> | RickyDataThemeName,
  baseTheme: RickyDataTheme = editorialLightTheme,
): RickyDataTheme {
  if (!partialTheme) {
    return baseTheme;
  }

  if (partialTheme === 'editorialLight') {
    return editorialLightTheme;
  }

  if (partialTheme === 'workbenchDark') {
    return workbenchDarkTheme;
  }

  return {
    ...baseTheme,
    ...partialTheme,
    color: { ...baseTheme.color, ...(partialTheme.color || {}) },
    typography: { ...baseTheme.typography, ...(partialTheme.typography || {}) },
    spacing: { ...baseTheme.spacing, ...(partialTheme.spacing || {}) },
    radius: { ...baseTheme.radius, ...(partialTheme.radius || {}) },
    motion: { ...baseTheme.motion, ...(partialTheme.motion || {}) },
    shadow: { ...baseTheme.shadow, ...(partialTheme.shadow || {}) },
  };
}

function flattenTheme(theme: RickyDataTheme): Record<string, string> {
  return {
    'theme-name': theme.name,
    'color-canvas': theme.color.canvas,
    'color-canvas-muted': theme.color.canvasMuted,
    'color-panel': theme.color.panel,
    'color-panel-muted': theme.color.panelMuted,
    'color-panel-strong': theme.color.panelStrong,
    'color-hairline': theme.color.hairline,
    'color-hairline-strong': theme.color.hairlineStrong,
    'color-text-primary': theme.color.textPrimary,
    'color-text-secondary': theme.color.textSecondary,
    'color-text-muted': theme.color.textMuted,
    'color-text-inverse': theme.color.textInverse,
    'color-accent': theme.color.accent,
    'color-accent-hover': theme.color.accentHover,
    'color-accent-soft': theme.color.accentSoft,
    'color-success': theme.color.success,
    'color-success-soft': theme.color.successSoft,
    'color-warning': theme.color.warning,
    'color-warning-soft': theme.color.warningSoft,
    'color-danger': theme.color.danger,
    'color-danger-soft': theme.color.dangerSoft,
    'color-overlay': theme.color.overlay,
    'color-focus-ring': theme.color.focusRing,
    'font-display': theme.typography.fontDisplay,
    'font-body': theme.typography.fontBody,
    'font-mono': theme.typography.fontMono,
    'font-size-xs': theme.typography.sizeXs,
    'font-size-sm': theme.typography.sizeSm,
    'font-size-md': theme.typography.sizeMd,
    'font-size-lg': theme.typography.sizeLg,
    'font-size-xl': theme.typography.sizeXl,
    'font-size-display': theme.typography.sizeDisplay,
    'space-xxs': theme.spacing.xxs,
    'space-xs': theme.spacing.xs,
    'space-sm': theme.spacing.sm,
    'space-md': theme.spacing.md,
    'space-lg': theme.spacing.lg,
    'space-xl': theme.spacing.xl,
    'space-xxl': theme.spacing.xxl,
    'radius-sm': theme.radius.sm,
    'radius-md': theme.radius.md,
    'radius-lg': theme.radius.lg,
    'radius-pill': theme.radius.pill,
    'ease-standard': theme.motion.easeStandard,
    'ease-emphasis': theme.motion.easeEmphasis,
    'duration-fast': theme.motion.durationFast,
    'duration-normal': theme.motion.durationNormal,
    'duration-slow': theme.motion.durationSlow,
    'shadow-soft': theme.shadow.soft,
    'shadow-lift': theme.shadow.lift,
  };
}

export function createCssVariables(theme: RickyDataTheme): RickyDataTokenMap {
  const vars = flattenTheme(theme);
  const mapped = Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [`--rd-${key}`, value]),
  );
  return mapped as RickyDataTokenMap;
}

export function injectThemeVariables(
  element: HTMLElement,
  theme: Partial<RickyDataTheme> | RickyDataTokenMap | RickyDataThemeName,
): void {
  const resolved = typeof theme === 'string' || !Object.keys(theme).some((key) => key.startsWith('--rd-'))
    ? createCssVariables(resolveTheme(theme as Partial<RickyDataTheme> | RickyDataThemeName))
    : (theme as RickyDataTokenMap);

  for (const [key, value] of Object.entries(resolved)) {
    element.style.setProperty(key, value);
  }
}
