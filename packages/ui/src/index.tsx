'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  createCssVariables,
  editorialLightTheme,
  resolveTheme,
  type RickyDataTheme,
  type RickyDataThemeName,
} from '@rickydata/design-tokens';
export {
  OrganizedBubbleAtlas,
  type OrganizedBubbleAtlasEdge,
  type OrganizedBubbleAtlasNode,
  type OrganizedBubbleAtlasProps,
} from './OrganizedBubbleAtlas';
export {
  RelationshipGraph,
  type RelationshipGraphEdge,
  type RelationshipGraphEdgeKindAppearance,
  type RelationshipGraphNode,
  type RelationshipGraphNodeKindAppearance,
  type RelationshipGraphProps,
} from './RelationshipGraph';

export interface RickyDataThemeProviderProps {
  theme?: RickyDataThemeName | Partial<RickyDataTheme>;
  children: ReactNode;
  className?: string;
}

const ThemeContext = createContext<RickyDataTheme>(editorialLightTheme);

function styleFromTheme(theme: RickyDataTheme): CSSProperties {
  return createCssVariables(theme) as CSSProperties;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function uiFontStyle(weight: CSSProperties['fontWeight'] = 500): CSSProperties {
  return {
    fontFamily: 'var(--rd-font-body)',
    fontWeight: weight,
  };
}

export function RickyDataThemeProvider({
  theme,
  children,
  className,
}: RickyDataThemeProviderProps) {
  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  const styles = useMemo(() => styleFromTheme(resolvedTheme), [resolvedTheme]);

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <div
        className={cx('rd-theme-root', className)}
        data-rd-theme={resolvedTheme.name}
        style={{
          ...styles,
          backgroundColor: 'var(--rd-color-canvas)',
          color: 'var(--rd-color-text-primary)',
        }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useRickyDataTheme() {
  return useContext(ThemeContext);
}

function baseInteractiveStyle(): CSSProperties {
  return {
    transitionProperty: 'background-color, border-color, color, box-shadow, transform',
    transitionDuration: 'var(--rd-duration-normal)',
    transitionTimingFunction: 'var(--rd-ease-standard)',
  };
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  leadingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  style,
  children,
  ...props
}: ButtonProps) {
  const palette: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
    primary: {
      backgroundColor: 'var(--rd-color-accent)',
      border: '1px solid var(--rd-color-accent)',
      color: 'var(--rd-color-text-inverse)',
      boxShadow: 'var(--rd-shadow-soft)',
    },
    secondary: {
      backgroundColor: 'var(--rd-color-panel)',
      border: '1px solid var(--rd-color-hairline)',
      color: 'var(--rd-color-text-primary)',
    },
    ghost: {
      backgroundColor: 'transparent',
      border: '1px solid transparent',
      color: 'var(--rd-color-text-secondary)',
    },
  };

  return (
    <button
      type="button"
      {...props}
      style={{
        ...baseInteractiveStyle(),
        ...uiFontStyle(600),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        borderRadius: 'var(--rd-radius-sm)',
        padding: size === 'sm' ? '8px 12px' : '10px 16px',
        fontSize: size === 'sm' ? 'var(--rd-font-size-sm)' : 'var(--rd-font-size-md)',
        cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.55 : 1,
        ...palette[variant],
        ...style,
      }}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, children, style, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      style={{
        ...baseInteractiveStyle(),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '36px',
        height: '36px',
        borderRadius: 'var(--rd-radius-sm)',
        border: '1px solid var(--rd-color-hairline)',
        backgroundColor: 'var(--rd-color-panel)',
        color: 'var(--rd-color-text-secondary)',
        cursor: props.disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'muted' | 'accent';
}

export function Card({ tone = 'default', style, children, ...props }: CardProps) {
  const toneStyle: Record<NonNullable<CardProps['tone']>, CSSProperties> = {
    default: {
      backgroundColor: 'var(--rd-color-panel)',
      border: '1px solid var(--rd-color-hairline)',
    },
    muted: {
      backgroundColor: 'var(--rd-color-panel-muted)',
      border: '1px solid var(--rd-color-hairline)',
    },
    accent: {
      backgroundColor: 'var(--rd-color-accent-soft)',
      border: '1px solid var(--rd-color-hairline-strong)',
    },
  };

  return (
    <div
      {...props}
      style={{
        borderRadius: 'var(--rd-radius-md)',
        padding: '16px',
        boxShadow: 'var(--rd-shadow-soft)',
        ...toneStyle[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Panel({ title, subtitle, actions, children, style, ...props }: PanelProps) {
  return (
    <Card
      {...props}
      style={{
        padding: '18px',
        ...style,
      }}
    >
      {(title || subtitle || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
          <div>
            {title && (
              <h3 style={{ margin: 0, fontFamily: 'var(--rd-font-display)', fontSize: 'var(--rd-font-size-xl)', fontWeight: 600 }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p style={{ ...uiFontStyle(500), margin: title ? '4px 0 0 0' : 0, color: 'var(--rd-color-text-secondary)', fontSize: 'var(--rd-font-size-sm)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Card>
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

export function Badge({ tone = 'neutral', style, children, ...props }: BadgeProps) {
  const palette: Record<NonNullable<BadgeProps['tone']>, CSSProperties> = {
    neutral: { backgroundColor: 'var(--rd-color-panel-strong)', color: 'var(--rd-color-text-secondary)' },
    accent: { backgroundColor: 'var(--rd-color-accent-soft)', color: 'var(--rd-color-accent)' },
    success: { backgroundColor: 'var(--rd-color-success-soft)', color: 'var(--rd-color-success)' },
    warning: { backgroundColor: 'var(--rd-color-warning-soft)', color: 'var(--rd-color-warning)' },
    danger: { backgroundColor: 'var(--rd-color-danger-soft)', color: 'var(--rd-color-danger)' },
  };

  return (
    <span
      {...props}
      style={{
        ...uiFontStyle(600),
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        borderRadius: 'var(--rd-radius-pill)',
        padding: '4px 10px',
        fontSize: '11px',
        letterSpacing: '0.02em',
        ...palette[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, style, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      {...props}
      style={{
        ...baseInteractiveStyle(),
        ...uiFontStyle(500),
        borderRadius: 'var(--rd-radius-pill)',
        padding: '7px 12px',
        fontSize: 'var(--rd-font-size-xs)',
        border: selected ? '1px solid var(--rd-color-accent)' : '1px solid var(--rd-color-hairline)',
        backgroundColor: selected ? 'var(--rd-color-accent-soft)' : 'var(--rd-color-panel)',
        color: selected ? 'var(--rd-color-accent)' : 'var(--rd-color-text-secondary)',
        cursor: props.disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export interface SearchFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  endAdornment?: ReactNode;
}

export function SearchField({ endAdornment, style, ...props }: SearchFieldProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        borderRadius: 'var(--rd-radius-sm)',
        border: '1px solid var(--rd-color-hairline)',
        backgroundColor: 'var(--rd-color-panel)',
        padding: '0 12px',
        minHeight: '40px',
        boxShadow: 'var(--rd-shadow-soft)',
        ...style,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--rd-color-text-muted)' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
      </svg>
      <input
        {...props}
        style={{
          ...uiFontStyle(500),
          border: 0,
          outline: 'none',
          backgroundColor: 'transparent',
          color: 'var(--rd-color-text-primary)',
          width: '100%',
          fontSize: 'var(--rd-font-size-sm)',
        }}
      />
      {endAdornment}
    </div>
  );
}

export interface TabsProps {
  tabs: Array<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}

export function Tabs({ tabs, value, onChange }: TabsProps) {
  return (
    <div style={{ display: 'inline-flex', gap: '6px', borderRadius: 'var(--rd-radius-pill)', backgroundColor: 'var(--rd-color-panel-strong)', padding: '4px' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          style={{
            ...uiFontStyle(600),
            border: 0,
            borderRadius: 'var(--rd-radius-pill)',
            padding: '8px 12px',
            backgroundColor: tab.id === value ? 'var(--rd-color-panel)' : 'transparent',
            color: tab.id === value ? 'var(--rd-color-text-primary)' : 'var(--rd-color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
      <button type="button" onClick={onClose} aria-label="Close drawer" style={{ position: 'absolute', inset: 0, border: 0, backgroundColor: 'var(--rd-color-overlay)' }} />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 'min(480px, 100vw)',
          backgroundColor: 'var(--rd-color-panel)',
          borderLeft: '1px solid var(--rd-color-hairline)',
          boxShadow: 'var(--rd-shadow-lift)',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--rd-font-display)', fontSize: 'var(--rd-font-size-xl)' }}>{title}</h3>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface SplitPaneProps {
  primary: ReactNode;
  secondary: ReactNode;
  secondaryWidth?: string;
}

export function SplitPane({
  primary,
  secondary,
  secondaryWidth = '360px',
}: SplitPaneProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) minmax(280px, ${secondaryWidth})`, gap: '20px' }}>
      <div>{primary}</div>
      <div>{secondary}</div>
    </div>
  );
}

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

export function Skeleton({ width = '100%', height = '14px', style, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      style={{
        width,
        height,
        borderRadius: '999px',
        background: 'linear-gradient(90deg, rgba(215,202,184,0.65) 0%, rgba(244,237,226,0.95) 50%, rgba(215,202,184,0.65) 100%)',
        backgroundSize: '200% 100%',
        ...style,
      }}
    />
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card tone="muted" style={{ textAlign: 'left' }}>
      <p style={{ ...uiFontStyle(700), margin: 0, fontSize: '11px', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--rd-color-accent)' }}>
        Nothing here yet
      </p>
      <h3 style={{ margin: '10px 0 0 0', fontFamily: 'var(--rd-font-display)', fontSize: 'var(--rd-font-size-xl)' }}>{title}</h3>
      <p style={{ ...uiFontStyle(500), margin: '10px 0 0 0', color: 'var(--rd-color-text-secondary)', maxWidth: '58ch' }}>{description}</p>
      {action ? <div style={{ marginTop: '16px' }}>{action}</div> : null}
    </Card>
  );
}

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

export function Kbd({ style, children, ...props }: KbdProps) {
  return (
    <kbd
      {...props}
      style={{
        ...uiFontStyle(600),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        padding: '4px 7px',
        borderRadius: '10px',
        border: '1px solid var(--rd-color-hairline)',
        backgroundColor: 'var(--rd-color-panel)',
        color: 'var(--rd-color-text-secondary)',
        fontSize: '11px',
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
      <div>
        {eyebrow && (
          <p style={{ ...uiFontStyle(700), margin: 0, fontSize: '11px', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--rd-color-accent)' }}>
            {eyebrow}
          </p>
        )}
        <h1 style={{ margin: eyebrow ? '10px 0 0 0' : 0, fontFamily: 'var(--rd-font-display)', fontSize: 'var(--rd-font-size-display)', lineHeight: 0.96 }}>
          {title}
        </h1>
        {description && (
          <p style={{ ...uiFontStyle(500), margin: '12px 0 0 0', color: 'var(--rd-color-text-secondary)', maxWidth: '62ch', fontSize: 'var(--rd-font-size-md)', lineHeight: 1.65 }}>
            {description}
          </p>
        )}
      </div>
      {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{actions}</div> : null}
    </div>
  );
}

export function useDrawerState(defaultOpen = false) {
  return useState(defaultOpen);
}
