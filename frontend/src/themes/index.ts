export interface AppTheme {
  name: string;
  label: string;
  group: 'core' | 'super-dark' | 'monochrome' | 'color-scheme';
  variables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helper: build a super-dark theme from just an accent color + its hover shade
// All super-dark themes share the same near-black surface palette; only accent
// and protocol colors change.
// ---------------------------------------------------------------------------
function superDark(
  name: string,
  label: string,
  accent: string,
  accentHover: string,
  accentMuted: string,
  accentContrast: string,
  protocols: Record<string, string>,
): AppTheme {
  return {
    name,
    label,
    group: 'super-dark',
    variables: {
      '--bg-primary': '#030303',
      '--bg-secondary': '#080808',
      '--bg-tertiary': '#0e0e0e',
      '--bg-surface': '#131313',
      '--bg-hover': '#181818',
      '--bg-active': '#1e1e1e',
      '--bg-input': '#0a0a0a',
      '--bg-modal': '#080808',
      '--bg-tooltip': '#181818',
      '--text-primary': '#d4d4d4',
      '--text-secondary': '#858585',
      '--text-tertiary': '#5e5e5e',
      '--text-muted': '#404040',
      '--text-accent': accent,
      '--border-primary': '#1a1a1a',
      '--border-secondary': '#242424',
      '--border-focus': accent,
      '--border': '#1a1a1a',
      '--accent': accent,
      '--accent-hover': accentHover,
      '--accent-muted': accentMuted,
      '--danger': '#f85149',
      '--danger-hover': '#da3633',
      '--warning': '#f0b429',
      '--success': '#3fb950',
      '--accent-contrast': accentContrast,
      '--protocol-ssh': protocols.ssh ?? accent,
      '--protocol-rdp': protocols.rdp ?? '#ff9800',
      '--protocol-vnc': protocols.vnc ?? '#ab47bc',
      '--protocol-telnet': protocols.telnet ?? '#66bb6a',
      '--protocol-ftp': protocols.ftp ?? '#fdd835',
      '--scrollbar-track': '#030303',
      '--scrollbar-thumb': '#1a1a1a',
      '--scrollbar-thumb-hover': '#242424',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.7)',
    },
  };
}

export const APP_THEMES: Record<string, AppTheme> = {
  // ==========================================================================
  // CORE THEMES
  // ==========================================================================

  dark: {
    name: 'dark',
    label: 'Dark',
    group: 'core',
    variables: {
      '--bg-primary': '#050505',
      '--bg-secondary': '#0a0a0a',
      '--bg-tertiary': '#111111',
      '--bg-surface': '#161616',
      '--bg-hover': '#1a1a1a',
      '--bg-active': '#222222',
      '--bg-input': '#0d0d0d',
      '--bg-modal': '#0a0a0a',
      '--bg-tooltip': '#1a1a1a',
      '--text-primary': '#e0e0e0',
      '--text-secondary': '#8b949e',
      '--text-tertiary': '#6b7280',
      '--text-muted': '#4b5563',
      '--text-accent': '#00e5ff',
      '--border-primary': '#1e1e1e',
      '--border-secondary': '#2a2a2a',
      '--border-focus': '#00e5ff',
      '--border': '#1e1e1e',
      '--accent': '#00e5ff',
      '--accent-hover': '#00c8e0',
      '--accent-muted': 'rgba(0, 229, 255, 0.15)',
      '--danger': '#f85149',
      '--danger-hover': '#da3633',
      '--warning': '#f0b429',
      '--success': '#3fb950',
      '--accent-contrast': '#050505',
      '--protocol-ssh': '#00e5ff',
      '--protocol-rdp': '#ff9800',
      '--protocol-vnc': '#ab47bc',
      '--protocol-telnet': '#66bb6a',
      '--protocol-ftp': '#fdd835',
      '--scrollbar-track': '#050505',
      '--scrollbar-thumb': '#1e1e1e',
      '--scrollbar-thumb-hover': '#2a2a2a',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.6)',
    },
  },

  midnight: {
    name: 'midnight',
    label: 'Midnight',
    group: 'core',
    variables: {
      '--bg-primary': '#070b14',
      '--bg-secondary': '#0b1022',
      '--bg-tertiary': '#0f1530',
      '--bg-surface': '#131a3a',
      '--bg-hover': '#1a2148',
      '--bg-active': '#202856',
      '--bg-input': '#0a0f20',
      '--bg-modal': '#0b1022',
      '--bg-tooltip': '#1a2148',
      '--text-primary': '#dce4f0',
      '--text-secondary': '#7b8db8',
      '--text-tertiary': '#5a6d96',
      '--text-muted': '#3d4f78',
      '--text-accent': '#6e9eff',
      '--border-primary': '#172040',
      '--border-secondary': '#1f2b55',
      '--border-focus': '#6e9eff',
      '--border': '#172040',
      '--accent': '#6e9eff',
      '--accent-hover': '#5a8ae6',
      '--accent-muted': 'rgba(110, 158, 255, 0.15)',
      '--danger': '#ff6b6b',
      '--danger-hover': '#e55a5a',
      '--warning': '#ffc145',
      '--success': '#51cf66',
      '--accent-contrast': '#070b14',
      '--protocol-ssh': '#6e9eff',
      '--protocol-rdp': '#ffab40',
      '--protocol-vnc': '#ce93d8',
      '--protocol-telnet': '#81c784',
      '--protocol-ftp': '#fff176',
      '--scrollbar-track': '#070b14',
      '--scrollbar-thumb': '#172040',
      '--scrollbar-thumb-hover': '#1f2b55',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.6)',
    },
  },

  amoled: {
    name: 'amoled',
    label: 'AMOLED Black',
    group: 'core',
    variables: {
      '--bg-primary': '#000000',
      '--bg-secondary': '#050505',
      '--bg-tertiary': '#0a0a0a',
      '--bg-surface': '#0f0f0f',
      '--bg-hover': '#141414',
      '--bg-active': '#1a1a1a',
      '--bg-input': '#050505',
      '--bg-modal': '#050505',
      '--bg-tooltip': '#141414',
      '--text-primary': '#e0e0e0',
      '--text-secondary': '#8b949e',
      '--text-tertiary': '#6b7280',
      '--text-muted': '#4b5563',
      '--text-accent': '#00e5ff',
      '--border-primary': '#151515',
      '--border-secondary': '#1e1e1e',
      '--border-focus': '#00e5ff',
      '--border': '#151515',
      '--accent': '#00e5ff',
      '--accent-hover': '#00c8e0',
      '--accent-muted': 'rgba(0, 229, 255, 0.12)',
      '--danger': '#f85149',
      '--danger-hover': '#da3633',
      '--warning': '#f0b429',
      '--success': '#3fb950',
      '--accent-contrast': '#000000',
      '--protocol-ssh': '#00e5ff',
      '--protocol-rdp': '#ff9800',
      '--protocol-vnc': '#ab47bc',
      '--protocol-telnet': '#66bb6a',
      '--protocol-ftp': '#fdd835',
      '--scrollbar-track': '#000000',
      '--scrollbar-thumb': '#151515',
      '--scrollbar-thumb-hover': '#1e1e1e',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.8)',
    },
  },

  light: {
    name: 'light',
    label: 'Light',
    group: 'core',
    variables: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f6f8fa',
      '--bg-tertiary': '#eef1f5',
      '--bg-surface': '#ffffff',
      '--bg-hover': '#e8ecf0',
      '--bg-active': '#dde2e8',
      '--bg-input': '#ffffff',
      '--bg-modal': '#ffffff',
      '--bg-tooltip': '#24292f',
      '--text-primary': '#1f2328',
      '--text-secondary': '#57606a',
      '--text-tertiary': '#768390',
      '--text-muted': '#a0a8b4',
      '--text-accent': '#0969da',
      '--border-primary': '#d0d7de',
      '--border-secondary': '#e1e4e8',
      '--border-focus': '#0969da',
      '--border': '#d0d7de',
      '--accent': '#0969da',
      '--accent-hover': '#0757b5',
      '--accent-muted': 'rgba(9, 105, 218, 0.1)',
      '--danger': '#cf222e',
      '--danger-hover': '#a40e26',
      '--warning': '#bf8700',
      '--success': '#1a7f37',
      '--accent-contrast': '#ffffff',
      '--protocol-ssh': '#0969da',
      '--protocol-rdp': '#e36209',
      '--protocol-vnc': '#8250df',
      '--protocol-telnet': '#1a7f37',
      '--protocol-ftp': '#9a6700',
      '--scrollbar-track': '#f6f8fa',
      '--scrollbar-thumb': '#d0d7de',
      '--scrollbar-thumb-hover': '#b8bfc6',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.1)',
    },
  },

  // ==========================================================================
  // SUPER DARK ACCENT VARIANTS
  // Near-black backgrounds with different accent colors
  // ==========================================================================

  ember: superDark(
    'ember', 'Ember',
    '#f59e0b', '#d97706', 'rgba(245, 158, 11, 0.12)', '#030303',
    { ssh: '#f59e0b', rdp: '#ef4444', vnc: '#a78bfa', telnet: '#34d399', ftp: '#fbbf24' },
  ),

  crimson: superDark(
    'crimson', 'Crimson',
    '#ef4444', '#dc2626', 'rgba(239, 68, 68, 0.12)', '#ffffff',
    { ssh: '#ef4444', rdp: '#f97316', vnc: '#c084fc', telnet: '#4ade80', ftp: '#fbbf24' },
  ),

  vapor: superDark(
    'vapor', 'Vapor',
    '#a78bfa', '#8b5cf6', 'rgba(167, 139, 250, 0.12)', '#030303',
    { ssh: '#a78bfa', rdp: '#fb923c', vnc: '#f472b6', telnet: '#34d399', ftp: '#fde047' },
  ),

  matrix: superDark(
    'matrix', 'Matrix',
    '#22c55e', '#16a34a', 'rgba(34, 197, 94, 0.12)', '#030303',
    { ssh: '#22c55e', rdp: '#f97316', vnc: '#a78bfa', telnet: '#2dd4bf', ftp: '#facc15' },
  ),

  frost: superDark(
    'frost', 'Frost',
    '#38bdf8', '#0ea5e9', 'rgba(56, 189, 248, 0.12)', '#030303',
    { ssh: '#38bdf8', rdp: '#fb923c', vnc: '#c084fc', telnet: '#4ade80', ftp: '#fde047' },
  ),

  rose: superDark(
    'rose', 'Rose',
    '#f472b6', '#ec4899', 'rgba(244, 114, 182, 0.12)', '#030303',
    { ssh: '#f472b6', rdp: '#fb923c', vnc: '#c084fc', telnet: '#34d399', ftp: '#fde047' },
  ),

  // ==========================================================================
  // MONOCHROME THEMES
  // No color accent -- pure greyscale or near-greyscale
  // ==========================================================================

  ash: {
    name: 'ash',
    label: 'Ash',
    group: 'monochrome',
    variables: {
      '--bg-primary': '#0a0a0a',
      '--bg-secondary': '#0f0f0f',
      '--bg-tertiary': '#161616',
      '--bg-surface': '#1c1c1c',
      '--bg-hover': '#222222',
      '--bg-active': '#2a2a2a',
      '--bg-input': '#111111',
      '--bg-modal': '#0f0f0f',
      '--bg-tooltip': '#222222',
      '--text-primary': '#d4d4d4',
      '--text-secondary': '#8a8a8a',
      '--text-tertiary': '#666666',
      '--text-muted': '#444444',
      '--text-accent': '#c0c0c0',
      '--border-primary': '#222222',
      '--border-secondary': '#2e2e2e',
      '--border-focus': '#888888',
      '--border': '#222222',
      '--accent': '#909090',
      '--accent-hover': '#a0a0a0',
      '--accent-muted': 'rgba(144, 144, 144, 0.12)',
      '--danger': '#d4504a',
      '--danger-hover': '#bb3e38',
      '--warning': '#c9a227',
      '--success': '#5a9a5a',
      '--accent-contrast': '#0a0a0a',
      '--protocol-ssh': '#a0a0a0',
      '--protocol-rdp': '#b0b0b0',
      '--protocol-vnc': '#909090',
      '--protocol-telnet': '#c0c0c0',
      '--protocol-ftp': '#808080',
      '--scrollbar-track': '#0a0a0a',
      '--scrollbar-thumb': '#222222',
      '--scrollbar-thumb-hover': '#2e2e2e',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.6)',
    },
  },

  graphite: {
    name: 'graphite',
    label: 'Graphite',
    group: 'monochrome',
    variables: {
      '--bg-primary': '#121210',
      '--bg-secondary': '#181816',
      '--bg-tertiary': '#1f1f1c',
      '--bg-surface': '#262623',
      '--bg-hover': '#2c2c28',
      '--bg-active': '#333330',
      '--bg-input': '#151513',
      '--bg-modal': '#181816',
      '--bg-tooltip': '#2c2c28',
      '--text-primary': '#ccc8c0',
      '--text-secondary': '#8a8880',
      '--text-tertiary': '#686660',
      '--text-muted': '#484644',
      '--text-accent': '#b8b4aa',
      '--border-primary': '#262623',
      '--border-secondary': '#333330',
      '--border-focus': '#8a8880',
      '--border': '#262623',
      '--accent': '#9a968e',
      '--accent-hover': '#aca8a0',
      '--accent-muted': 'rgba(154, 150, 142, 0.12)',
      '--danger': '#c45550',
      '--danger-hover': '#aa4440',
      '--warning': '#b09530',
      '--success': '#6a8a50',
      '--accent-contrast': '#121210',
      '--protocol-ssh': '#a0a098',
      '--protocol-rdp': '#b0a898',
      '--protocol-vnc': '#988888',
      '--protocol-telnet': '#90a088',
      '--protocol-ftp': '#a8a080',
      '--scrollbar-track': '#121210',
      '--scrollbar-thumb': '#262623',
      '--scrollbar-thumb-hover': '#333330',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.6)',
    },
  },

  silver: {
    name: 'silver',
    label: 'Silver',
    group: 'monochrome',
    variables: {
      '--bg-primary': '#f2f2f2',
      '--bg-secondary': '#e8e8e8',
      '--bg-tertiary': '#dfdfdf',
      '--bg-surface': '#f2f2f2',
      '--bg-hover': '#d5d5d5',
      '--bg-active': '#cccccc',
      '--bg-input': '#f2f2f2',
      '--bg-modal': '#eeeeee',
      '--bg-tooltip': '#333333',
      '--text-primary': '#1a1a1a',
      '--text-secondary': '#555555',
      '--text-tertiary': '#777777',
      '--text-muted': '#999999',
      '--text-accent': '#333333',
      '--border-primary': '#cccccc',
      '--border-secondary': '#d8d8d8',
      '--border-focus': '#666666',
      '--border': '#cccccc',
      '--accent': '#555555',
      '--accent-hover': '#444444',
      '--accent-muted': 'rgba(85, 85, 85, 0.1)',
      '--danger': '#b42b2b',
      '--danger-hover': '#961e1e',
      '--warning': '#946b00',
      '--success': '#1a7a35',
      '--accent-contrast': '#ffffff',
      '--protocol-ssh': '#444444',
      '--protocol-rdp': '#666666',
      '--protocol-vnc': '#555555',
      '--protocol-telnet': '#4a4a4a',
      '--protocol-ftp': '#777777',
      '--scrollbar-track': '#e8e8e8',
      '--scrollbar-thumb': '#cccccc',
      '--scrollbar-thumb-hover': '#bbbbbb',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.08)',
    },
  },

  // ==========================================================================
  // COLOR SCHEME THEMES
  // Classic / well-known editor & terminal color schemes
  // ==========================================================================

  nord: {
    name: 'nord',
    label: 'Nord',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#2e3440',
      '--bg-secondary': '#3b4252',
      '--bg-tertiary': '#434c5e',
      '--bg-surface': '#4c566a',
      '--bg-hover': '#4c566a',
      '--bg-active': '#5a657a',
      '--bg-input': '#3b4252',
      '--bg-modal': '#3b4252',
      '--bg-tooltip': '#4c566a',
      '--text-primary': '#eceff4',
      '--text-secondary': '#d8dee9',
      '--text-tertiary': '#a5b1c2',
      '--text-muted': '#6b7b95',
      '--text-accent': '#88c0d0',
      '--border-primary': '#4c566a',
      '--border-secondary': '#5a657a',
      '--border-focus': '#88c0d0',
      '--border': '#4c566a',
      '--accent': '#88c0d0',
      '--accent-hover': '#7ab4c4',
      '--accent-muted': 'rgba(136, 192, 208, 0.15)',
      '--danger': '#bf616a',
      '--danger-hover': '#a9545c',
      '--warning': '#ebcb8b',
      '--success': '#a3be8c',
      '--accent-contrast': '#2e3440',
      '--protocol-ssh': '#88c0d0',
      '--protocol-rdp': '#d08770',
      '--protocol-vnc': '#b48ead',
      '--protocol-telnet': '#a3be8c',
      '--protocol-ftp': '#ebcb8b',
      '--scrollbar-track': '#2e3440',
      '--scrollbar-thumb': '#4c566a',
      '--scrollbar-thumb-hover': '#5a657a',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.4)',
    },
  },

  dracula: {
    name: 'dracula',
    label: 'Dracula',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#282a36',
      '--bg-secondary': '#21222c',
      '--bg-tertiary': '#2d2f3d',
      '--bg-surface': '#343746',
      '--bg-hover': '#3a3d4e',
      '--bg-active': '#44475a',
      '--bg-input': '#21222c',
      '--bg-modal': '#21222c',
      '--bg-tooltip': '#44475a',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#c0c0d0',
      '--text-tertiary': '#8b8da3',
      '--text-muted': '#6272a4',
      '--text-accent': '#bd93f9',
      '--border-primary': '#44475a',
      '--border-secondary': '#515470',
      '--border-focus': '#bd93f9',
      '--border': '#44475a',
      '--accent': '#bd93f9',
      '--accent-hover': '#a87de8',
      '--accent-muted': 'rgba(189, 147, 249, 0.15)',
      '--danger': '#ff5555',
      '--danger-hover': '#e04848',
      '--warning': '#f1fa8c',
      '--success': '#50fa7b',
      '--accent-contrast': '#282a36',
      '--protocol-ssh': '#bd93f9',
      '--protocol-rdp': '#ffb86c',
      '--protocol-vnc': '#ff79c6',
      '--protocol-telnet': '#50fa7b',
      '--protocol-ftp': '#f1fa8c',
      '--scrollbar-track': '#282a36',
      '--scrollbar-thumb': '#44475a',
      '--scrollbar-thumb-hover': '#515470',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  solarized: {
    name: 'solarized',
    label: 'Solarized Dark',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#002b36',
      '--bg-secondary': '#073642',
      '--bg-tertiary': '#0a3f4c',
      '--bg-surface': '#0d4856',
      '--bg-hover': '#0f5260',
      '--bg-active': '#125c6b',
      '--bg-input': '#073642',
      '--bg-modal': '#073642',
      '--bg-tooltip': '#0d4856',
      '--text-primary': '#fdf6e3',
      '--text-secondary': '#93a1a1',
      '--text-tertiary': '#839496',
      '--text-muted': '#586e75',
      '--text-accent': '#b58900',
      '--border-primary': '#0d4856',
      '--border-secondary': '#125c6b',
      '--border-focus': '#b58900',
      '--border': '#0d4856',
      '--accent': '#b58900',
      '--accent-hover': '#a07800',
      '--accent-muted': 'rgba(181, 137, 0, 0.15)',
      '--danger': '#dc322f',
      '--danger-hover': '#c42725',
      '--warning': '#cb4b16',
      '--success': '#859900',
      '--accent-contrast': '#fdf6e3',
      '--protocol-ssh': '#b58900',
      '--protocol-rdp': '#cb4b16',
      '--protocol-vnc': '#6c71c4',
      '--protocol-telnet': '#859900',
      '--protocol-ftp': '#d33682',
      '--scrollbar-track': '#002b36',
      '--scrollbar-thumb': '#0d4856',
      '--scrollbar-thumb-hover': '#125c6b',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  monokai: {
    name: 'monokai',
    label: 'Monokai',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#272822',
      '--bg-secondary': '#1e1f1a',
      '--bg-tertiary': '#2d2e27',
      '--bg-surface': '#3a3b32',
      '--bg-hover': '#3e3f36',
      '--bg-active': '#49483e',
      '--bg-input': '#1e1f1a',
      '--bg-modal': '#1e1f1a',
      '--bg-tooltip': '#49483e',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#c0bfac',
      '--text-tertiary': '#90908a',
      '--text-muted': '#6b6b65',
      '--text-accent': '#f92672',
      '--border-primary': '#3a3b32',
      '--border-secondary': '#49483e',
      '--border-focus': '#f92672',
      '--border': '#3a3b32',
      '--accent': '#f92672',
      '--accent-hover': '#e01e65',
      '--accent-muted': 'rgba(249, 38, 114, 0.15)',
      '--danger': '#f92672',
      '--danger-hover': '#e01e65',
      '--warning': '#e6db74',
      '--success': '#a6e22e',
      '--accent-contrast': '#ffffff',
      '--protocol-ssh': '#f92672',
      '--protocol-rdp': '#fd971f',
      '--protocol-vnc': '#ae81ff',
      '--protocol-telnet': '#a6e22e',
      '--protocol-ftp': '#e6db74',
      '--scrollbar-track': '#272822',
      '--scrollbar-thumb': '#3a3b32',
      '--scrollbar-thumb-hover': '#49483e',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  tokyoNight: {
    name: 'tokyoNight',
    label: 'Tokyo Night',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#1a1b26',
      '--bg-secondary': '#16161e',
      '--bg-tertiary': '#1e1f2e',
      '--bg-surface': '#24253a',
      '--bg-hover': '#292a40',
      '--bg-active': '#2f3048',
      '--bg-input': '#16161e',
      '--bg-modal': '#16161e',
      '--bg-tooltip': '#24253a',
      '--text-primary': '#c0caf5',
      '--text-secondary': '#a9b1d6',
      '--text-tertiary': '#7982a9',
      '--text-muted': '#545c7e',
      '--text-accent': '#7aa2f7',
      '--border-primary': '#292a40',
      '--border-secondary': '#33354a',
      '--border-focus': '#7aa2f7',
      '--border': '#292a40',
      '--accent': '#7aa2f7',
      '--accent-hover': '#6a92e7',
      '--accent-muted': 'rgba(122, 162, 247, 0.15)',
      '--danger': '#f7768e',
      '--danger-hover': '#e0687f',
      '--warning': '#e0af68',
      '--success': '#9ece6a',
      '--accent-contrast': '#1a1b26',
      '--protocol-ssh': '#7aa2f7',
      '--protocol-rdp': '#ff9e64',
      '--protocol-vnc': '#bb9af7',
      '--protocol-telnet': '#9ece6a',
      '--protocol-ftp': '#e0af68',
      '--scrollbar-track': '#1a1b26',
      '--scrollbar-thumb': '#292a40',
      '--scrollbar-thumb-hover': '#33354a',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  catppuccin: {
    name: 'catppuccin',
    label: 'Catppuccin Mocha',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#1e1e2e',
      '--bg-secondary': '#181825',
      '--bg-tertiary': '#25253a',
      '--bg-surface': '#2c2c44',
      '--bg-hover': '#31314a',
      '--bg-active': '#383850',
      '--bg-input': '#181825',
      '--bg-modal': '#181825',
      '--bg-tooltip': '#2c2c44',
      '--text-primary': '#cdd6f4',
      '--text-secondary': '#a6adc8',
      '--text-tertiary': '#7f849c',
      '--text-muted': '#585b70',
      '--text-accent': '#89b4fa',
      '--border-primary': '#313244',
      '--border-secondary': '#3b3c50',
      '--border-focus': '#89b4fa',
      '--border': '#313244',
      '--accent': '#89b4fa',
      '--accent-hover': '#74a8f7',
      '--accent-muted': 'rgba(137, 180, 250, 0.15)',
      '--danger': '#f38ba8',
      '--danger-hover': '#e57a97',
      '--warning': '#f9e2af',
      '--success': '#a6e3a1',
      '--accent-contrast': '#1e1e2e',
      '--protocol-ssh': '#89b4fa',
      '--protocol-rdp': '#fab387',
      '--protocol-vnc': '#cba6f7',
      '--protocol-telnet': '#a6e3a1',
      '--protocol-ftp': '#f9e2af',
      '--scrollbar-track': '#1e1e2e',
      '--scrollbar-thumb': '#313244',
      '--scrollbar-thumb-hover': '#3b3c50',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  gruvbox: {
    name: 'gruvbox',
    label: 'Gruvbox Dark',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#282828',
      '--bg-secondary': '#1d2021',
      '--bg-tertiary': '#2e2e2c',
      '--bg-surface': '#3c3836',
      '--bg-hover': '#42403d',
      '--bg-active': '#504945',
      '--bg-input': '#1d2021',
      '--bg-modal': '#1d2021',
      '--bg-tooltip': '#504945',
      '--text-primary': '#ebdbb2',
      '--text-secondary': '#bdae93',
      '--text-tertiary': '#928374',
      '--text-muted': '#665c54',
      '--text-accent': '#fe8019',
      '--border-primary': '#3c3836',
      '--border-secondary': '#504945',
      '--border-focus': '#fe8019',
      '--border': '#3c3836',
      '--accent': '#fe8019',
      '--accent-hover': '#e57212',
      '--accent-muted': 'rgba(254, 128, 25, 0.15)',
      '--danger': '#fb4934',
      '--danger-hover': '#cc241d',
      '--warning': '#fabd2f',
      '--success': '#b8bb26',
      '--accent-contrast': '#282828',
      '--protocol-ssh': '#fe8019',
      '--protocol-rdp': '#fb4934',
      '--protocol-vnc': '#d3869b',
      '--protocol-telnet': '#b8bb26',
      '--protocol-ftp': '#fabd2f',
      '--scrollbar-track': '#282828',
      '--scrollbar-thumb': '#3c3836',
      '--scrollbar-thumb-hover': '#504945',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },

  oneDark: {
    name: 'oneDark',
    label: 'One Dark',
    group: 'color-scheme',
    variables: {
      '--bg-primary': '#282c34',
      '--bg-secondary': '#21252b',
      '--bg-tertiary': '#2c313c',
      '--bg-surface': '#333842',
      '--bg-hover': '#383e4a',
      '--bg-active': '#3e4452',
      '--bg-input': '#21252b',
      '--bg-modal': '#21252b',
      '--bg-tooltip': '#3e4452',
      '--text-primary': '#abb2bf',
      '--text-secondary': '#8b929e',
      '--text-tertiary': '#6b727e',
      '--text-muted': '#4b5263',
      '--text-accent': '#61afef',
      '--border-primary': '#3e4452',
      '--border-secondary': '#4b5263',
      '--border-focus': '#61afef',
      '--border': '#3e4452',
      '--accent': '#61afef',
      '--accent-hover': '#519fdf',
      '--accent-muted': 'rgba(97, 175, 239, 0.15)',
      '--danger': '#e06c75',
      '--danger-hover': '#c85a63',
      '--warning': '#e5c07b',
      '--success': '#98c379',
      '--accent-contrast': '#282c34',
      '--protocol-ssh': '#61afef',
      '--protocol-rdp': '#d19a66',
      '--protocol-vnc': '#c678dd',
      '--protocol-telnet': '#98c379',
      '--protocol-ftp': '#e5c07b',
      '--scrollbar-track': '#282c34',
      '--scrollbar-thumb': '#3e4452',
      '--scrollbar-thumb-hover': '#4b5263',
      '--shadow': '0 4px 24px rgba(0, 0, 0, 0.5)',
    },
  },
};

export type AppThemeName = keyof typeof APP_THEMES;

export const APP_THEME_NAMES = Object.keys(APP_THEMES) as AppThemeName[];

/** Ordered list for the theme picker UI, grouped by category */
export const APP_THEME_GROUPS: { label: string; themes: AppThemeName[] }[] = [
  {
    label: 'Core',
    themes: ['dark', 'midnight', 'amoled', 'light'],
  },
  {
    label: 'Super Dark',
    themes: ['ember', 'crimson', 'vapor', 'matrix', 'frost', 'rose'],
  },
  {
    label: 'Monochrome',
    themes: ['ash', 'graphite', 'silver'],
  },
  {
    label: 'Color Schemes',
    themes: ['nord', 'dracula', 'solarized', 'monokai', 'tokyoNight', 'catppuccin', 'gruvbox', 'oneDark'],
  },
];

export function applyTheme(themeName: AppThemeName): void {
  const theme = APP_THEMES[themeName];
  if (!theme) {
    console.warn(`Theme "${themeName}" not found, falling back to dark`);
    applyTheme('dark');
    return;
  }

  const root = document.documentElement;
  for (const [property, value] of Object.entries(theme.variables)) {
    root.style.setProperty(property, value);
  }

  root.setAttribute('data-theme', themeName);
}

export function applyThemeVariables(variables: Record<string, string>): void {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(variables)) {
    root.style.setProperty(property, value);
  }
  root.setAttribute('data-theme', 'custom');
}

export function getThemeVariable(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

// ---------------------------------------------------------------------------
// Custom theme builder -- derives all 33 CSS variables from 3 user-chosen colors
// ---------------------------------------------------------------------------

export interface CustomColors {
  accent: string;
  bgPrimary: string;
  bgSecondary: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Relative luminance (WCAG 2.0) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lighten or darken a hex color by an amount (-255 to 255) */
function adjustBrightness(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
}

/** Darken a hex color by a factor (0-1, where 0 = same, 1 = black) */
function darken(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - factor), g * (1 - factor), b * (1 - factor));
}

/** Mix two hex colors */
function mixColors(hex1: string, hex2: string, weight: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const w = weight;
  return rgbToHex(
    r1 * (1 - w) + r2 * w,
    g1 * (1 - w) + g2 * w,
    b1 * (1 - w) + b2 * w,
  );
}

/** Build all 33 CSS variables from 3 user-chosen colors */
export function buildCustomTheme(colors: CustomColors): Record<string, string> {
  const { accent, bgPrimary, bgSecondary } = colors;
  const lum = luminance(bgPrimary);
  const isDark = lum < 0.2;
  const isLight = lum > 0.4;

  // Derive step offset for surface hierarchy
  const step = isDark ? 8 : -8;

  // Tertiary: between primary and secondary, nudged lighter/darker
  const bgTertiary = adjustBrightness(bgPrimary, step * 2);
  const bgSurface = adjustBrightness(bgSecondary, step * 2);
  const bgHover = adjustBrightness(bgPrimary, step * 3);
  const bgActive = adjustBrightness(bgPrimary, step * 4);
  const bgInput = mixColors(bgPrimary, bgSecondary, 0.3);
  const bgModal = bgSecondary;
  const bgTooltip = isDark ? adjustBrightness(bgPrimary, step * 3) : '#24292f';

  // Text hierarchy based on background luminance
  let textPrimary: string, textSecondary: string, textTertiary: string, textMuted: string;
  if (isLight) {
    textPrimary = '#1f2328';
    textSecondary = '#57606a';
    textTertiary = '#768390';
    textMuted = '#a0a8b4';
  } else if (isDark) {
    textPrimary = '#e0e0e0';
    textSecondary = '#8b949e';
    textTertiary = '#6b7280';
    textMuted = '#4b5563';
  } else {
    // Mid-range background
    textPrimary = '#e8e8e8';
    textSecondary = '#a0a0a0';
    textTertiary = '#787878';
    textMuted = '#585858';
  }

  // Border colors: derived from secondary, nudged
  const borderPrimary = isDark
    ? adjustBrightness(bgSecondary, 14)
    : adjustBrightness(bgSecondary, -14);
  const borderSecondary = isDark
    ? adjustBrightness(borderPrimary, 8)
    : adjustBrightness(borderPrimary, -8);

  // Accent derivatives
  const accentHover = darken(accent, 0.12);
  const [ar, ag, ab] = hexToRgb(accent);
  const accentMuted = `rgba(${ar}, ${ag}, ${ab}, ${isDark ? 0.12 : 0.1})`;
  const accentLum = luminance(accent);
  const accentContrast = accentLum > 0.4 ? bgPrimary : '#ffffff';

  // Status colors adjusted for background
  let danger: string, dangerHover: string, warning: string, success: string;
  if (isLight) {
    danger = '#cf222e';
    dangerHover = '#a40e26';
    warning = '#bf8700';
    success = '#1a7f37';
  } else {
    danger = '#f85149';
    dangerHover = '#da3633';
    warning = '#f0b429';
    success = '#3fb950';
  }

  // Protocol colors: tinted variations of the accent
  const protocolSsh = accent;
  const protocolRdp = isDark ? '#ff9800' : '#e36209';
  const protocolVnc = isDark ? '#ab47bc' : '#8250df';
  const protocolTelnet = isDark ? '#66bb6a' : '#1a7f37';
  const protocolFtp = isDark ? '#fdd835' : '#9a6700';

  // Scrollbar
  const scrollTrack = bgPrimary;
  const scrollThumb = borderPrimary;
  const scrollThumbHover = borderSecondary;

  // Shadow
  const shadow = isDark
    ? '0 4px 24px rgba(0, 0, 0, 0.6)'
    : isLight
      ? '0 4px 24px rgba(0, 0, 0, 0.1)'
      : '0 4px 24px rgba(0, 0, 0, 0.4)';

  return {
    '--bg-primary': bgPrimary,
    '--bg-secondary': bgSecondary,
    '--bg-tertiary': bgTertiary,
    '--bg-surface': bgSurface,
    '--bg-hover': bgHover,
    '--bg-active': bgActive,
    '--bg-input': bgInput,
    '--bg-modal': bgModal,
    '--bg-tooltip': bgTooltip,
    '--text-primary': textPrimary,
    '--text-secondary': textSecondary,
    '--text-tertiary': textTertiary,
    '--text-muted': textMuted,
    '--text-accent': accent,
    '--border-primary': borderPrimary,
    '--border-secondary': borderSecondary,
    '--border-focus': accent,
    '--border': borderPrimary,
    '--accent': accent,
    '--accent-hover': accentHover,
    '--accent-muted': accentMuted,
    '--danger': danger,
    '--danger-hover': dangerHover,
    '--warning': warning,
    '--success': success,
    '--accent-contrast': accentContrast,
    '--protocol-ssh': protocolSsh,
    '--protocol-rdp': protocolRdp,
    '--protocol-vnc': protocolVnc,
    '--protocol-telnet': protocolTelnet,
    '--protocol-ftp': protocolFtp,
    '--scrollbar-track': scrollTrack,
    '--scrollbar-thumb': scrollThumb,
    '--scrollbar-thumb-hover': scrollThumbHover,
    '--shadow': shadow,
  };
}

export { TERMINAL_THEMES, TERMINAL_THEME_NAMES } from './terminal-themes';
export type { TerminalThemeName } from './terminal-themes';
