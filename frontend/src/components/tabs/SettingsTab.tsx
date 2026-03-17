import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Palette, Terminal, Info, Minus, Plus, ChevronDown, Check, SlidersHorizontal, RotateCcw, Sparkles, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useThemeStore, type CursorStyle } from '@/store/themeStore';
import { useConfigStore } from '@/store/configStore';
import { useAIStore } from '@/store/aiStore';
import { TERMINAL_THEME_NAMES, TERMINAL_THEMES } from '@/themes/terminal-themes';
import { APP_THEMES, APP_THEME_GROUPS, type AppThemeName, type CustomColors } from '@/themes/index';
import { Toggle } from '@/components/ui/Toggle';
import { AI_FEATURE_LABELS, type AIFeatureName } from '@/types/ai';

/* ---------- Section wrapper ---------- */
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, children, className }) => (
  <div className={`bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-5 mb-4 animate-fade-in overflow-visible relative ${className ?? ''}`}>
    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
      {icon}
      {title}
    </h3>
    <div className="space-y-4">{children}</div>
  </div>
);

/* ---------- Row ---------- */
const Row: React.FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm text-[var(--text-primary)]">{label}</p>
      {description && (
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/* ---------- Select ---------- */
const Select: React.FC<{
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
  >
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);

/* ---------- Color swatch input ---------- */
const ColorPicker: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)] font-mono uppercase">{value}</span>
      <label className="relative w-7 h-7 rounded-md border border-[var(--border)] cursor-pointer overflow-hidden hover:border-[var(--accent)] transition-colors">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
        <span
          className="block w-full h-full rounded-[5px]"
          style={{ backgroundColor: value }}
        />
      </label>
    </div>
  </div>
);

/* ---------- Theme select with hover preview ---------- */
const ThemeSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSelectCustom: () => void;
}> = ({ value, onChange, onSelectCustom }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { previewTheme, revertPreview } = useThemeStore();
  const isCustom = value === 'custom';

  const handleSelect = useCallback((themeName: string) => {
    onChange(themeName);
    setIsOpen(false);
  }, [onChange]);

  const handleSelectCustom = useCallback(() => {
    onSelectCustom();
    setIsOpen(false);
  }, [onSelectCustom]);

  const handleMouseEnter = useCallback((themeName: string) => {
    previewTheme(themeName as AppThemeName);
  }, [previewTheme]);

  const handleMouseLeave = useCallback(() => {
    revertPreview();
  }, [revertPreview]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    revertPreview();
  }, [revertPreview]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleClose]);

  const currentTheme = APP_THEMES[value];
  const currentLabel = isCustom ? 'Custom' : (currentTheme?.label ?? value);
  const accentDotColor = isCustom
    ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    : currentTheme?.variables['--accent'];

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none hover:border-[var(--accent)] focus:border-[var(--accent)] transition-colors cursor-pointer min-w-[160px] justify-between"
      >
        <span className="flex items-center gap-2">
          {isCustom ? (
            <SlidersHorizontal size={12} className="text-[var(--accent)] shrink-0" />
          ) : (
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-white/10"
              style={{ backgroundColor: accentDotColor }}
            />
          )}
          {currentLabel}
        </span>
        <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[220px] max-h-[400px] overflow-y-auto rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] shadow-lg z-50 py-1"
          onMouseLeave={handleMouseLeave}
        >
          {APP_THEME_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="mx-2 my-1 border-t border-[var(--border)]" />}
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {group.label}
              </div>
              {group.themes.map((name) => {
                const theme = APP_THEMES[name];
                if (!theme) return null;
                const isSelected = name === value;
                return (
                  <button
                    key={name}
                    onClick={() => handleSelect(name)}
                    onMouseEnter={() => handleMouseEnter(name)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0 border border-white/10"
                      style={{ backgroundColor: theme.variables['--accent'] }}
                    />
                    <span className="flex-1">{theme.label}</span>
                    {isSelected && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
          {/* Custom entry */}
          <div className="mx-2 my-1 border-t border-[var(--border)]" />
          <button
            onClick={handleSelectCustom}
            onMouseEnter={() => {
              if (isCustom) previewTheme('custom' as AppThemeName);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer ${
              isCustom
                ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <SlidersHorizontal size={12} className="shrink-0" />
            <span className="flex-1">Custom</span>
            {isCustom && <Check size={14} className="text-[var(--accent)] shrink-0" />}
          </button>
        </div>
      )}
    </div>
  );
};

/* ---------- Friendly names for terminal themes ---------- */
const themeDisplayNames: Record<string, string> = {
  nextermDark: 'Default Dark',
  pureBlack: 'Pure Black',
  dracula: 'Dracula',
  monokai: 'Monokai',
  nord: 'Nord',
  oneDark: 'One Dark',
  solarizedDark: 'Solarized Dark',
  gruvboxDark: 'Gruvbox Dark',
  tokyoNight: 'Tokyo Night',
};

/* ---------- AI Settings Section ---------- */
const AISettingsSection: React.FC = () => {
  const aiEnabled = useConfigStore((s) => s.aiEnabled);
  const { settings, features, isLoading, fetchAll, updateSettings, setMasterEnabled, setFeatureEnabled } = useAIStore();

  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (aiEnabled) {
      fetchAll().then(() => setLoaded(true));
    }
  }, [aiEnabled, fetchAll]);

  // Sync local state from store once loaded
  useEffect(() => {
    if (loaded) {
      setProvider(settings.provider || '');
      setModel(settings.model || '');
      setBaseUrl(settings.base_url || '');
      setApiKey('');
      setEditingKey(false);
    }
  }, [loaded, settings]);

  const handleSaveSettings = useCallback(async () => {
    setSaving(true);
    try {
      await updateSettings({
        provider,
        api_key: editingKey ? apiKey : undefined,
        model: model || undefined,
        base_url: baseUrl || undefined,
      });
      setEditingKey(false);
      setApiKey('');
    } finally {
      setSaving(false);
    }
  }, [provider, apiKey, model, baseUrl, editingKey, updateSettings]);

  if (!aiEnabled) {
    return (
      <Section title="AI Assistant" icon={<Sparkles size={16} className="text-[var(--text-muted)]" />}>
        <p className="text-xs text-[var(--text-muted)]">
          AI features have been disabled by the administrator.
        </p>
      </Section>
    );
  }

  if (isLoading && !loaded) {
    return (
      <Section title="AI Assistant" icon={<Sparkles size={16} className="text-[var(--accent)]" />}>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          Loading AI settings...
        </div>
      </Section>
    );
  }

  const needsApiKey = provider === 'openai' || provider === 'anthropic';
  const showBaseUrl = provider === 'ollama';
  const masterEnabled = features.enabled;

  return (
    <Section title="AI Assistant" icon={<Sparkles size={16} className="text-[var(--accent)]" />}>
      <Row label="Enable AI Features" description="Master switch for all AI features">
        <Toggle checked={masterEnabled} onChange={setMasterEnabled} />
      </Row>

      {masterEnabled && (
        <>
          {/* Provider config */}
          <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-4">
            <Row label="Provider" description="AI service provider">
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setEditingKey(false); setApiKey(''); }}
                className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                <option value="">Select provider...</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </Row>

            {needsApiKey && (
              <Row label="API Key" description="Required for OpenAI / Anthropic">
                <div className="flex items-center gap-2">
                  {editingKey ? (
                    <div className="flex items-center gap-1.5">
                      <div className="relative">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="sk-..."
                          className="w-48 pl-2.5 pr-8 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                        />
                        <button
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)] font-mono">
                      {settings.has_api_key ? settings.api_key_masked : 'Not set'}
                    </span>
                  )}
                  <button
                    onClick={() => { setEditingKey(!editingKey); setApiKey(''); setShowKey(false); }}
                    className="px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
                  >
                    {editingKey ? 'Cancel' : 'Change'}
                  </button>
                </div>
              </Row>
            )}

            <Row label="Model" description="Model name (leave blank for default)">
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : provider === 'ollama' ? 'llama3.2' : 'gpt-4o-mini'}
                className="w-48 px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono placeholder:text-[var(--text-muted)]"
              />
            </Row>

            {showBaseUrl && (
              <Row label="Base URL" description="Ollama server address">
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-48 px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono placeholder:text-[var(--text-muted)]"
                />
              </Row>
            )}

            {/* Save button */}
            <div className="flex justify-end">
              <button
                onClick={handleSaveSettings}
                disabled={saving || !provider}
                className="px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Save Provider Settings'}
              </button>
            </div>
          </div>

          {/* Feature toggles */}
          <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Features</p>
            {(Object.keys(AI_FEATURE_LABELS) as AIFeatureName[]).map((name) => (
              <Row
                key={name}
                label={AI_FEATURE_LABELS[name].label}
                description={AI_FEATURE_LABELS[name].description}
              >
                <Toggle
                  checked={features.features[name]}
                  onChange={(v) => setFeatureEnabled(name, v)}
                />
              </Row>
            ))}
          </div>
        </>
      )}
    </Section>
  );
};

/* ---------- Main ---------- */
const SettingsTab: React.FC = () => {
  const {
    theme, customColors, terminalTheme, fontSize, fontFamily,
    cursorStyle, cursorBlink, cursorColor,
    setTheme, setCustomColors, setTerminalTheme, setFontSize, setFontFamily,
    setCursorStyle, setCursorBlink, setCursorColor,
  } = useThemeStore();

  /** Seed custom colors from the current theme when switching to Custom */
  const handleSelectCustom = useCallback(() => {
    // If already custom with saved colors, just switch to it
    const existing = useThemeStore.getState().customColors;
    if (existing) {
      setTheme('custom' as AppThemeName);
      return;
    }
    // Seed from the current theme's variables
    const current = useThemeStore.getState().theme;
    const source = APP_THEMES[current];
    const seed: CustomColors = source
      ? { accent: source.variables['--accent'], bgPrimary: source.variables['--bg-primary'], bgSecondary: source.variables['--bg-secondary'] }
      : { accent: '#00e5ff', bgPrimary: '#050505', bgSecondary: '#0a0a0a' };
    setCustomColors(seed);
  }, [setTheme, setCustomColors]);

  const handleCustomColorChange = useCallback((key: keyof CustomColors, value: string) => {
    const current = useThemeStore.getState().customColors;
    const base: CustomColors = current ?? { accent: '#00e5ff', bgPrimary: '#050505', bgSecondary: '#0a0a0a' };
    setCustomColors({ ...base, [key]: value });
  }, [setCustomColors]);

  const fontFamilies = [
    { value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", label: 'JetBrains Mono' },
    { value: "'Fira Code', 'Cascadia Code', monospace", label: 'Fira Code' },
    { value: "'Cascadia Code', Consolas, monospace", label: 'Cascadia Code' },
    { value: "Menlo, Monaco, monospace", label: 'Menlo / Monaco' },
    { value: "'Courier New', Courier, monospace", label: 'Courier New' },
    { value: "monospace", label: 'System Monospace' },
  ];

  const isCustom = theme === 'custom';

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto py-10 px-4">
      <div className="w-full max-w-xl">
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-6">Settings</h1>

        {/* Appearance */}
        <Section title="Appearance" icon={<Palette size={16} className="text-[var(--accent)]" />} className="z-10">
          <Row label="App Theme" description="Overall application color scheme">
            <ThemeSelect
              value={theme}
              onChange={(v) => setTheme(v as AppThemeName)}
              onSelectCustom={handleSelectCustom}
            />
          </Row>
          {isCustom && customColors && (
            <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
              <ColorPicker
                label="Accent"
                value={customColors.accent}
                onChange={(v) => handleCustomColorChange('accent', v)}
              />
              <ColorPicker
                label="Primary Background"
                value={customColors.bgPrimary}
                onChange={(v) => handleCustomColorChange('bgPrimary', v)}
              />
              <ColorPicker
                label="Secondary Background"
                value={customColors.bgSecondary}
                onChange={(v) => handleCustomColorChange('bgSecondary', v)}
              />
            </div>
          )}
        </Section>

        {/* Terminal */}
        <Section title="Terminal" icon={<Terminal size={16} className="text-[var(--accent)]" />}>
          <Row label="Terminal Theme" description="Color scheme for the terminal emulator">
            <Select
              value={terminalTheme}
              options={TERMINAL_THEME_NAMES.map((name) => ({
                value: name,
                label: themeDisplayNames[name] || name,
              }))}
              onChange={setTerminalTheme}
            />
          </Row>

          <Row label="Font Size" description="Terminal text size in pixels">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFontSize(Math.max(8, fontSize - 1))}
                className="p-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors active:scale-95"
              >
                <Minus size={14} />
              </button>
              <span className="text-sm text-[var(--text-primary)] w-8 text-center tabular-nums">
                {fontSize}
              </span>
              <button
                onClick={() => setFontSize(Math.min(32, fontSize + 1))}
                className="p-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors active:scale-95"
              >
                <Plus size={14} />
              </button>
            </div>
          </Row>

          <Row label="Font Family" description="Monospace font used in the terminal">
            <Select
              value={fontFamily}
              options={fontFamilies}
              onChange={setFontFamily}
            />
          </Row>

          <Row label="Cursor Style" description="Shape of the terminal cursor">
            <Select
              value={cursorStyle}
              options={[
                { value: 'block', label: 'Block' },
                { value: 'underline', label: 'Underline' },
                { value: 'bar', label: 'Bar' },
              ]}
              onChange={(v) => setCursorStyle(v as CursorStyle)}
            />
          </Row>

          <Row label="Cursor Blink" description="Whether the cursor blinks in the terminal">
            <button
              onClick={() => setCursorBlink(!cursorBlink)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                cursorBlink ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border)]'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  cursorBlink ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </Row>

          <Row label="Cursor Color" description="Custom cursor color (overrides theme default)">
            <div className="flex items-center gap-2">
              {cursorColor && (
                <button
                  onClick={() => setCursorColor(null)}
                  title="Reset to theme default"
                  className="p-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors active:scale-95"
                >
                  <RotateCcw size={14} />
                </button>
              )}
              <label className="relative w-7 h-7 rounded-md border border-[var(--border)] cursor-pointer overflow-hidden hover:border-[var(--accent)] transition-colors">
                <input
                  type="color"
                  value={cursorColor ?? (TERMINAL_THEMES[terminalTheme]?.cursor ?? '#ffffff')}
                  onChange={(e) => setCursorColor(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
                <span
                  className="block w-full h-full rounded-[5px]"
                  style={{ backgroundColor: cursorColor ?? (TERMINAL_THEMES[terminalTheme]?.cursor ?? '#ffffff') }}
                />
              </label>
              {!cursorColor && (
                <span className="text-xs text-[var(--text-muted)]">Theme default</span>
              )}
            </div>
          </Row>

          <Row label="Scrollback Lines" description="Number of lines kept in the terminal scroll buffer">
            <span className="text-sm text-[var(--text-muted)]">10,000</span>
          </Row>
        </Section>

        {/* AI Assistant */}
        <AISettingsSection />

        {/* About */}
        <Section title="About" icon={<Info size={16} className="text-[var(--accent)]" />}>
          <Row label="Version" description="Current build version">
            <span className="text-sm text-[var(--text-muted)]">0.1.0</span>
          </Row>
          <Row label="Runtime" description="Backend framework">
            <span className="text-sm text-[var(--text-muted)]">FastAPI + Python</span>
          </Row>
          <Row label="Terminal" description="Terminal emulator library">
            <span className="text-sm text-[var(--text-muted)]">xterm.js</span>
          </Row>
        </Section>
      </div>
    </div>
  );
};

export default SettingsTab;
