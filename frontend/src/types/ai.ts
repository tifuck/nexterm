export interface AISettings {
  provider: string;
  model: string;
  base_url: string;
  has_api_key: boolean;
  api_key_masked?: string;
  is_configured?: boolean;
}

export interface AIFeatures {
  enabled: boolean;
  features: {
    command_generation: boolean;
    error_diagnosis: boolean;
    command_explanation: boolean;
    log_analysis: boolean;
  };
}

export type AIFeatureName = keyof AIFeatures['features'];

export const AI_FEATURE_LABELS: Record<AIFeatureName, { label: string; description: string }> = {
  command_generation: {
    label: 'Command Generation',
    description: 'Generate shell commands from natural language',
  },
  error_diagnosis: {
    label: 'Error Diagnosis',
    description: 'Diagnose terminal errors with AI',
  },
  command_explanation: {
    label: 'Command Explanation',
    description: 'Explain what commands do',
  },
  log_analysis: {
    label: 'Log Analysis',
    description: 'AI-powered log analysis in Log Viewer',
  },
};
