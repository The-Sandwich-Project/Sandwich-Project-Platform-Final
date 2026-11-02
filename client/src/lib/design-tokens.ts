/**
 * Design System Tokens
 *
 * Centralized design tokens for The Sandwich Project Platform.
 * Use these constants to maintain consistency across the application.
 */

/**
 * Brand Colors
 * Primary palette for brand identity
 */
export const BrandColors = {
  primary: '#236383',
  primaryMuted: '#236383',
  primaryDark: '#1e5a75',
  primaryDarker: '#1A2332',
  teal: '#236383', // was #236383 (retired from the palette)
  tealLight: '#47B3CB',
  tealHover: '#1e5a75',
  tealDark: '#004F59',
  orange: '#FBAD3F',
  orangeDark: '#E89A2F',
  burgundy: '#A31C41',
  navy: '#1A2332',
  darkGray: '#605251',
  lightGray: '#D1D3D4',
} as const;

/**
 * Semantic Colors
 * Colors for specific UI states and feedback
 */
export const SemanticColors = {
  success: '#10b981',      // green-600
  successLight: '#d1fae5', // green-100
  warning: '#f59e0b',      // yellow-500
  warningLight: '#fef3c7', // yellow-100
  error: '#ef4444',        // red-600
  errorLight: '#fee2e2',   // red-100
  info: '#3b82f6',         // blue-600
  infoLight: '#dbeafe',    // blue-100
} as const;

/**
 * Spacing Scale
 * Consistent spacing values following a 4px base unit
 */
export const Spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const;

/**
 * Border Radius
 * Consistent rounding values
 */
export const BorderRadius = {
  none: '0',
  sm: '0.125rem',  // 2px
  md: '0.375rem',  // 6px
  lg: '0.5rem',    // 8px
  xl: '0.75rem',   // 12px
  '2xl': '1rem',   // 16px
  full: '9999px',
} as const;

/**
 * Typography Scale
 * Font sizes and line heights
 */
export const Typography = {
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem', // 36px
  },
  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    black: 900,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

/**
 * Font Families
 */
export const FontFamilies = {
  sans: 'Roboto, sans-serif',
  heading: 'Roboto, sans-serif',
  highlight: 'Lobster, cursive',
} as const;

/**
 * Breakpoints
 * Responsive design breakpoints
 */
export const Breakpoints = {
  xs: '480px',
  sm: '640px',
  md: '768px',   // Mobile breakpoint
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

/**
 * Z-Index Scale
 * Layering system for overlapping elements
 */
export const ZIndex = {
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
} as const;

/**
 * Shadow Levels
 * Consistent elevation system
 */
export const Shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const;

/**
 * Animation Durations
 * Consistent timing for transitions and animations
 */
export const AnimationDurations = {
  fast: '150ms',
  normal: '200ms',
  slow: '300ms',
} as const;

/**
 * Status Badge Colors
 * Consistent colors for different status states
 */
export const StatusColors = {
  pending: {
    bg: '#f3f4f6',     // gray-100
    text: '#374151',   // gray-700
    border: '#d1d5db', // gray-300
  },
  'in-progress': {
    bg: '#dbeafe',     // blue-100
    text: '#1e40af',   // blue-700
    border: '#93c5fd', // blue-300
  },
  completed: {
    bg: '#d1fae5',     // green-100
    text: '#065f46',   // green-700
    border: '#86efac', // green-300
  },
  cancelled: {
    bg: '#fee2e2',     // red-100
    text: '#991b1b',   // red-700
    border: '#fca5a5', // red-300
  },
} as const;

/**
 * Touch Target Sizes
 * Minimum sizes for interactive elements (WCAG 2.1 Level AAA)
 */
export const TouchTargets = {
  minimum: '44px',
  comfortable: '48px',
} as const;

/**
 * Container Max Widths
 * Consistent content widths
 */
export const ContainerWidths = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
  full: '100%',
} as const;

/**
 * Helper function to get spacing value
 */
export function spacing(size: keyof typeof Spacing): string {
  return Spacing[size];
}

/**
 * Helper function to get font size
 */
export function fontSize(size: keyof typeof Typography.fontSize): string {
  return Typography.fontSize[size];
}

/**
 * Helper function to get brand color
 */
export function brandColor(color: keyof typeof BrandColors): string {
  return BrandColors[color];
}

/**
 * Helper function to get semantic color
 */
export function semanticColor(color: keyof typeof SemanticColors): string {
  return SemanticColors[color];
}
