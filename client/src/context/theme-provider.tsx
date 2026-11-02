import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Theme definitions mapping CSS variables to values
const themes: Record<Theme, Record<string, string>> = {
  light: {
    '--color-primary': '197 53% 32%',
    '--color-primary-hover': '197 53% 28%',
    '--color-brand-primary': '#236383',
    '--color-brand-secondary': '#FBAD3F',
    '--color-brand-accent': '#A31C41',
    '--color-brand-muted': '#236383',
    '--color-brand-teal': '#236383',
    '--color-brand-teal-light': '#f0f9ff',
    '--color-brand-teal-hover': '#1a4e66',
    '--color-brand-teal-dark': '#004F59',
  },
  dark: {
    '--color-primary': '210 40% 98%',
    '--color-primary-hover': '210 40% 90%',
    '--color-brand-primary': '#47B3CB',
    '--color-brand-secondary': '#E89A2F',
    '--color-brand-accent': '#FB6C85',
    '--color-brand-muted': '#1e5a75',
    '--color-brand-teal': '#47B3CB',
    '--color-brand-teal-light': '#1a4e66',
    '--color-brand-teal-hover': '#63cce2',
    '--color-brand-teal-dark': '#005f6b',
  },
};

const THEME_STORAGE_KEY = 'theme';

const applyThemeVariables = (theme: Theme) => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const vars = themes[theme];
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
};

const resolveInitialTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'light';
};

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initialTheme = resolveInitialTheme();
    applyThemeVariables(initialTheme);
    return initialTheme;
  });

  const isInitialRender = useRef(true);

  useIsomorphicLayoutEffect(() => {
    applyThemeVariables(theme);
  }, [theme]);

  const persistTheme = (newTheme: Theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    }
  };

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }

    persistTheme(theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState((currentTheme) =>
      currentTheme === newTheme ? currentTheme : newTheme,
    );
  };

  const toggleTheme = () => {
    setThemeState((currentTheme) =>
      currentTheme === 'light' ? 'dark' : 'light',
    );
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export const themeValues = themes;

