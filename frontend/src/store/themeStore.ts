import { create } from 'zustand';
import {
  applyTheme,
  applyThemeVariables,
  buildCustomTheme,
  APP_THEMES,
  type AppThemeName,
  type CustomColors,
} from '@/themes/index';
import { apiGet, apiPut } from '@/api/client';

/** Theme can be any built-in theme key OR the special 'custom' value */
type Theme = AppThemeName | 'custom';

export type CursorStyle = 'block' | 'underline' | 'bar';

interface ThemeState {
  theme: Theme;
  customColors: CustomColors | null;
  terminalTheme: string;
  fontSize: number;
  fontFamily: string;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  cursorColor: string | null;
  _serverSynced: boolean;
  setTheme: (theme: Theme) => void;
  setCustomColors: (colors: CustomColors) => void;
  previewTheme: (theme: Theme) => void;
  revertPreview: () => void;
  setTerminalTheme: (name: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setCursorStyle: (style: CursorStyle) => void;
  setCursorBlink: (blink: boolean) => void;
  setCursorColor: (color: string | null) => void;
  initTheme: () => void;
  loadFromServer: () => Promise<void>;
  applySettings: (settings: Record<string, unknown>) => void;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      return JSON.parse(stored) as T;
    }
  } catch {
    // ignore parse errors
  }
  return fallback;
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

/** Debounced server sync to avoid excessive API calls */
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function syncToServer(settings: Record<string, unknown>): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    apiPut('/api/auth/settings', settings).catch(() => {
      // silent fail - localStorage is the cache
    });
  }, 500);
}

/** Apply the current theme (handles both built-in and custom) */
function applyCurrentTheme(theme: Theme, customColors: CustomColors | null): void {
  if (theme === 'custom' && customColors) {
    const vars = buildCustomTheme(customColors);
    applyThemeVariables(vars);
  } else if (theme !== 'custom' && APP_THEMES[theme]) {
    applyTheme(theme);
  } else {
    // Fallback if custom but no colors saved yet
    applyTheme('dark');
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: loadFromStorage<Theme>('nexterm_theme', 'dark'),
  customColors: loadFromStorage<CustomColors | null>('nexterm_custom_theme', null),
  terminalTheme: loadFromStorage<string>('nexterm_terminal_theme', 'nextermDark'),
  fontSize: loadFromStorage<number>('nexterm_font_size', 14),
  fontFamily: loadFromStorage<string>('nexterm_font_family', "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"),
  cursorStyle: loadFromStorage<CursorStyle>('nexterm_cursor_style', 'block'),
  cursorBlink: loadFromStorage<boolean>('nexterm_cursor_blink', true),
  cursorColor: loadFromStorage<string | null>('nexterm_cursor_color', null),
  _serverSynced: false,

  initTheme: () => {
    const theme = loadFromStorage<Theme>('nexterm_theme', 'dark');
    const customColors = loadFromStorage<CustomColors | null>('nexterm_custom_theme', null);
    applyCurrentTheme(theme, customColors);
  },

  /** Load settings from server (called after auth) and override localStorage cache */
  loadFromServer: async () => {
    if (get()._serverSynced) return;
    try {
      const settings = await apiGet<Record<string, unknown>>('/api/auth/settings');
      if (settings && typeof settings === 'object') {
        get().applySettings(settings);
        set({ _serverSynced: true });
      }
    } catch {
      // Use localStorage fallback
    }
  },

  /** Apply settings from server response (also called from authStore after login/checkAuth) */
  applySettings: (settings: Record<string, unknown>) => {
    const updates: Partial<ThemeState> = {};

    // Load custom colors first so they are available when applying theme
    if (settings.customTheme && typeof settings.customTheme === 'object') {
      const ct = settings.customTheme as Record<string, unknown>;
      if (typeof ct.accent === 'string' && typeof ct.bgPrimary === 'string' && typeof ct.bgSecondary === 'string') {
        const customColors: CustomColors = {
          accent: ct.accent,
          bgPrimary: ct.bgPrimary,
          bgSecondary: ct.bgSecondary,
        };
        updates.customColors = customColors;
        saveToStorage('nexterm_custom_theme', customColors);
      }
    }

    if (settings.theme && typeof settings.theme === 'string') {
      const theme = settings.theme as Theme;
      updates.theme = theme;
      saveToStorage('nexterm_theme', theme);
      const cc = updates.customColors ?? get().customColors;
      applyCurrentTheme(theme, cc);
    }
    if (settings.terminalTheme && typeof settings.terminalTheme === 'string') {
      updates.terminalTheme = settings.terminalTheme;
      saveToStorage('nexterm_terminal_theme', settings.terminalTheme);
    }
    if (settings.fontSize && typeof settings.fontSize === 'number') {
      updates.fontSize = settings.fontSize;
      saveToStorage('nexterm_font_size', settings.fontSize);
    }
    if (settings.fontFamily && typeof settings.fontFamily === 'string') {
      updates.fontFamily = settings.fontFamily;
      saveToStorage('nexterm_font_family', settings.fontFamily);
    }
    if (settings.cursorStyle && typeof settings.cursorStyle === 'string') {
      updates.cursorStyle = settings.cursorStyle as CursorStyle;
      saveToStorage('nexterm_cursor_style', settings.cursorStyle);
    }
    if (typeof settings.cursorBlink === 'boolean') {
      updates.cursorBlink = settings.cursorBlink;
      saveToStorage('nexterm_cursor_blink', settings.cursorBlink);
    }
    if (settings.cursorColor !== undefined) {
      const color = typeof settings.cursorColor === 'string' ? settings.cursorColor : null;
      updates.cursorColor = color;
      saveToStorage('nexterm_cursor_color', color);
    }

    if (Object.keys(updates).length > 0) {
      set(updates as Partial<ThemeState>);
    }
  },

  setTheme: (theme: Theme) => {
    saveToStorage('nexterm_theme', theme);
    const customColors = get().customColors;
    applyCurrentTheme(theme, customColors);
    set({ theme });
    syncToServer({ theme });
  },

  setCustomColors: (colors: CustomColors) => {
    saveToStorage('nexterm_custom_theme', colors);
    saveToStorage('nexterm_theme', 'custom');
    const vars = buildCustomTheme(colors);
    applyThemeVariables(vars);
    set({ customColors: colors, theme: 'custom' });
    syncToServer({ theme: 'custom', customTheme: colors });
  },

  previewTheme: (theme: Theme) => {
    if (theme === 'custom') {
      const cc = get().customColors;
      if (cc) {
        const vars = buildCustomTheme(cc);
        applyThemeVariables(vars);
      }
    } else if (APP_THEMES[theme]) {
      applyTheme(theme);
    }
  },

  revertPreview: () => {
    const { theme, customColors } = get();
    applyCurrentTheme(theme, customColors);
  },

  setTerminalTheme: (name: string) => {
    saveToStorage('nexterm_terminal_theme', name);
    set({ terminalTheme: name });
    syncToServer({ terminalTheme: name });
  },

  setFontSize: (size: number) => {
    saveToStorage('nexterm_font_size', size);
    set({ fontSize: size });
    syncToServer({ fontSize: size });
  },

  setFontFamily: (family: string) => {
    saveToStorage('nexterm_font_family', family);
    set({ fontFamily: family });
    syncToServer({ fontFamily: family });
  },

  setCursorStyle: (style: CursorStyle) => {
    saveToStorage('nexterm_cursor_style', style);
    set({ cursorStyle: style });
    syncToServer({ cursorStyle: style });
  },

  setCursorBlink: (blink: boolean) => {
    saveToStorage('nexterm_cursor_blink', blink);
    set({ cursorBlink: blink });
    syncToServer({ cursorBlink: blink });
  },

  setCursorColor: (color: string | null) => {
    saveToStorage('nexterm_cursor_color', color);
    set({ cursorColor: color });
    syncToServer({ cursorColor: color });
  },
}));
