import { create } from 'zustand';

export interface SystemMetrics {
  cpu_percent: number;
  mem_total: number;
  mem_used: number;
  mem_percent: number;
  disk_total: number;
  disk_used: number;
  disk_percent: number;
  load_avg: number[];
  uptime: number;
  os_name: string;
  net_rx?: number;
  net_tx?: number;
}

interface MetricsState {
  metrics: SystemMetrics | null;
  isVisible: boolean;
  connectionId: string | null;
  setMetrics: (metrics: SystemMetrics) => void;
  clearMetrics: () => void;
  setVisible: (visible: boolean) => void;
  setConnectionId: (id: string | null) => void;
}

export const useMetricsStore = create<MetricsState>((set) => ({
  metrics: null,
  isVisible: true,
  connectionId: null,
  setMetrics: (metrics) => set({ metrics }),
  clearMetrics: () => set({ metrics: null }),
  setVisible: (isVisible) => set({ isVisible }),
  setConnectionId: (connectionId) => set({ connectionId }),
}));
