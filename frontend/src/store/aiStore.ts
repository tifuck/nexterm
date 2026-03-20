import { create } from 'zustand';
import { apiGet, apiPut } from '@/api/client';
import { useConfigStore } from '@/store/configStore';
import type { AISettings, AIFeatures, AIFeatureName } from '@/types/ai';

const DEFAULT_FEATURES: AIFeatures = {
  enabled: true,
  features: {
    command_generation: true,
    error_diagnosis: true,
    command_explanation: true,
    log_analysis: true,
  },
};

interface AIState {
  settings: AISettings;
  features: AIFeatures;
  isLoading: boolean;

  fetchSettings: () => Promise<void>;
  fetchFeatures: () => Promise<void>;
  fetchAll: () => Promise<void>;

  updateSettings: (data: {
    provider: string;
    api_key?: string;
    clear_api_key?: boolean;
    model?: string;
    base_url?: string;
  }) => Promise<void>;

  updateFeatures: (features: AIFeatures) => Promise<void>;
  setFeatureEnabled: (name: AIFeatureName, enabled: boolean) => Promise<void>;
  setMasterEnabled: (enabled: boolean) => Promise<void>;

  /** Check if a specific AI feature is available (global + user + per-feature). */
  isFeatureEnabled: (name: AIFeatureName) => boolean;
  /** Check if feature is enabled and provider is fully configured. */
  isFeatureUsable: (name: AIFeatureName) => boolean;
}

function isProviderConfigured(settings: AISettings): boolean {
  if (settings.is_configured !== undefined) {
    return settings.is_configured;
  }

  const provider = settings.provider;
  if (!provider) return false;
  if (provider === 'openai' || provider === 'anthropic') {
    return settings.has_api_key;
  }
  if (provider === 'ollama') {
    return true;
  }
  return false;
}

export const useAIStore = create<AIState>((set, get) => ({
  settings: {
    provider: '',
    model: '',
    base_url: '',
    has_api_key: false,
    is_configured: false,
  },
  features: { ...DEFAULT_FEATURES },
  isLoading: false,

  fetchSettings: async () => {
    try {
      const data = await apiGet<AISettings>('/api/ai/settings');
      set({
        settings: {
          provider: data.provider || '',
          model: data.model || '',
          base_url: data.base_url || '',
          has_api_key: data.has_api_key || false,
          api_key_masked: data.api_key_masked,
          is_configured: data.is_configured ?? false,
        },
      });
    } catch {
      // Silently use defaults if fetch fails (AI may be globally disabled)
    }
  },

  fetchFeatures: async () => {
    try {
      const data = await apiGet<AIFeatures>('/api/ai/features');
      set({
        features: {
          enabled: data.enabled ?? true,
          features: { ...DEFAULT_FEATURES.features, ...data.features },
        },
      });
    } catch {
      // Use defaults
    }
  },

  fetchAll: async () => {
    set({ isLoading: true });
    await Promise.all([get().fetchSettings(), get().fetchFeatures()]);
    set({ isLoading: false });
  },

  updateSettings: async (data) => {
    await apiPut('/api/ai/settings', data);
    await get().fetchSettings();
  },

  updateFeatures: async (features) => {
    const result = await apiPut<AIFeatures>('/api/ai/features', features);
    set({
      features: {
        enabled: result.enabled ?? features.enabled,
        features: { ...DEFAULT_FEATURES.features, ...result.features },
      },
    });
  },

  setFeatureEnabled: async (name, enabled) => {
    const current = get().features;
    const updated: AIFeatures = {
      enabled: current.enabled,
      features: { ...current.features, [name]: enabled },
    };
    await get().updateFeatures(updated);
  },

  setMasterEnabled: async (enabled) => {
    const current = get().features;
    const updated: AIFeatures = {
      enabled,
      features: current.features,
    };
    await get().updateFeatures(updated);
  },

  isFeatureEnabled: (name) => {
    const globalEnabled = useConfigStore.getState().aiEnabled;
    if (!globalEnabled) return false;
    const { enabled, features } = get().features;
    if (!enabled) return false;
    return features[name] ?? true;
  },

  isFeatureUsable: (name) => {
    if (!get().isFeatureEnabled(name)) return false;
    return isProviderConfigured(get().settings);
  },
}));
