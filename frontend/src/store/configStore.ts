import { create } from 'zustand';
import { apiGet } from '../api/client';

interface AppConfig {
  app_name: string;
  registration_enabled: boolean;
  ai_enabled: boolean;
  metrics_enabled: boolean;
  guacd_enabled: boolean;
  version: string;
}

interface ConfigState {
  appName: string;
  registrationEnabled: boolean;
  aiEnabled: boolean;
  metricsEnabled: boolean;
  guacdEnabled: boolean;
  version: string;
  isLoaded: boolean;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  appName: 'TERMINAL',
  registrationEnabled: true,
  aiEnabled: true,
  metricsEnabled: true,
  guacdEnabled: false,
  version: '',
  isLoaded: false,

  fetchConfig: async () => {
    try {
      const data = await apiGet<AppConfig>('/api/config');
      set({
        appName: data.app_name,
        registrationEnabled: data.registration_enabled,
        aiEnabled: data.ai_enabled,
        metricsEnabled: data.metrics_enabled,
        guacdEnabled: data.guacd_enabled,
        version: data.version,
        isLoaded: true,
      });
      // Update the document title to match the configured app name
      document.title = data.app_name;
    } catch {
      // Use defaults if config fetch fails
      set({ isLoaded: true });
    }
  },
}));
