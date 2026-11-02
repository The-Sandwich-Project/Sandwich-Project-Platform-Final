import type { Config } from 'tailwindcss';
import { TAILWIND_SCREENS } from './shared/breakpoints';

export default {
  // darkMode disabled per user request
  content: ['./client/index.html', './client/src/**/*.{js,jsx,ts,tsx}'],
  safelist: [
    // Ensure brand colors and sidebar styles used in dynamic contexts are always generated
    'bg-brand-primary',
    'border-brand-primary-dark',
    'ring-brand-primary',
    'text-brand-primary',
    'hover:bg-brand-primary',
    'border-l-4',
    'border-transparent',
    'font-semibold',
    'shadow-sm',
  ],
  theme: {
    screens: TAILWIND_SCREENS,
    extend: {
      fontFamily: {
        sans: ['Roboto', 'sans-serif'],
        'main-heading': ['Roboto', 'sans-serif'],
        'sub-heading': ['Roboto', 'sans-serif'],
        body: ['Roboto', 'sans-serif'],
        highlight: ['Lobster', 'cursive'],
        roboto: ['Roboto', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Premium design system values
        'premium-sm': '8px',
        'premium-md': '12px',
        'premium-lg': '16px',
        'premium-xl': '20px',
        'premium-full': '9999px',
      },
      colors: {
        background: 'hsl(var(--color-background))',
        foreground: 'hsl(var(--color-foreground))',
        card: {
          DEFAULT: 'hsl(var(--color-card))',
          foreground: 'hsl(var(--color-card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--color-popover))',
          foreground: 'hsl(var(--color-popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--color-primary))',
          foreground: 'hsl(var(--color-primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--color-secondary))',
          foreground: 'hsl(var(--color-secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--color-muted))',
          foreground: 'hsl(var(--color-muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent))',
          foreground: 'hsl(var(--color-accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--color-destructive))',
          foreground: 'hsl(var(--color-destructive-foreground))',
        },
        border: 'hsl(var(--color-border))',
        input: 'hsl(var(--color-input))',
        ring: 'hsl(var(--color-ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        brand: {
          primary: '#236383',
          'primary-muted': '#007E8C',
          'primary-dark': '#1e5a75',
          'primary-darker': '#1A2332',
          'primary-light': 'hsl(193 60% 91%)',
          'primary-lighter': 'hsl(193 60% 95%)',
          'primary-soft': 'hsl(193 60% 88%)',
          'primary-border': 'hsl(193 60% 85%)',
          'primary-border-strong': 'hsl(193 60% 75%)',
          teal: '#007E8C',
          'teal-dark': '#006B75',
          orange: '#FBAD3F',
          'orange-dark': '#E89A2F',
          burgundy: '#A31C41',
          'light-blue': '#47B3CB',
          'dark-gray': 'hsl(24 5% 38%)' /* #605251 */,
          'light-gray': 'hsl(0 0% 82%)' /* #D1D3D4 */,
          navy: '#1A2332',
        },
        // TSP color rule: buttons stay quiet, color means STATE.
        //   teal  = the one primary action per area, links
        //   navy  = text, headings, nav
        //   sky   = OK / complete — fill or border only (fails as text on white)
        //   gold  = needs attention, not urgent — fill or border only, pair with an icon
        //   cream = background tint behind gold items
        //   red   = destructive or blocking — pair with an icon
        //   mist  = secondary surfaces
        tsp: {
          teal: '#236383',
          navy: '#114154',
          sky: '#47B3CB',
          gold: '#FBAD3F',
          cream: '#FEF3E2',
          red: '#A31C41',
          'red-tint': '#FAE7ED',
          mist: '#E9EFF3',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config;
