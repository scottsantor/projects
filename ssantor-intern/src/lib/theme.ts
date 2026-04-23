export type BrandTheme = 'block' | 'cash' | 'square';
export type Theme = BrandTheme | 'custom';
export type ColorMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'app-theme';
const COLOR_MODE_KEY = 'app-color-mode';

const THEME_CLASSES = ['theme-cash', 'theme-square', 'theme-custom'] as const;

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'block';
  return (localStorage.getItem(THEME_KEY) as Theme) || 'block';
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;

  THEME_CLASSES.forEach((cls) => root.classList.remove(cls));

  if (theme !== 'block') {
    root.classList.add(`theme-${theme}`);
  }

  localStorage.setItem(THEME_KEY, theme);
}

export function getColorMode(): ColorMode {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem(COLOR_MODE_KEY) as ColorMode) || 'system';
}

export function setColorMode(mode: ColorMode): void {
  const root = document.documentElement;

  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', mode === 'dark');
  }

  localStorage.setItem(COLOR_MODE_KEY, mode);
}

export function toggleDarkMode(): void {
  const isDark = document.documentElement.classList.contains('dark');
  setColorMode(isDark ? 'light' : 'dark');
}

export function initTheme(): void {
  const theme = getTheme();
  const colorMode = getColorMode();

  setTheme(theme);
  setColorMode(colorMode);

  if (colorMode === 'system') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      if (getColorMode() === 'system') {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    });
  }
}
