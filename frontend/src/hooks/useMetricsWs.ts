import { useEffect, useRef } from 'react';
import { getWsUrl, ensureFreshToken } from '@/api/client';
import { useTabStore } from '@/store/tabStore';
import { useMetricsStore } from '@/store/metricsStore';

/**
 * Manages a single metrics WebSocket that follows the active tab's SSH connection.
 *
 * - Opens a WS to /ws/metrics when an SSH/telnet tab with a connectionId is active.
 * - Subscribes to the active connection's metrics and updates the metricsStore.
 * - Unsubscribes / clears metrics when the active tab changes or disconnects.
 * - Reconnects automatically if the WebSocket drops while a connection is active.
 */
export function useMetricsWs(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTab = useTabStore((s) => s.activeTab);
  const tabs = useTabStore((s) => s.tabs);

  // Derive the connectionId for the currently active SSH/telnet tab
  const current = tabs.find((t) => t.id === activeTab);
  const isSessionTab =
    current && current.type !== 'home' && current.type !== 'editor' && current.type !== 'settings';
  const connectionId = isSessionTab && current.isConnected ? current.connectionId ?? null : null;

  useEffect(() => {
    const { setMetrics, clearMetrics, setConnectionId } = useMetricsStore.getState();

    function cleanup() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        // Remove handlers to prevent reconnect on intentional close
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        wsRef.current = null;
      }
      subscribedIdRef.current = null;
      clearMetrics();
      setConnectionId(null);
    }

    // If no active session connection, tear down everything
    if (!connectionId) {
      cleanup();
      return;
    }

    // If already subscribed to this connection, nothing to do
    if (subscribedIdRef.current === connectionId && wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Tear down any existing WS before opening a new one
    cleanup();

    async function connect() {
      await ensureFreshToken();
      const wsUrl = getWsUrl('/ws/metrics');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Token is already in the URL query param via getWsUrl, but send subscribe
        ws.send(JSON.stringify({ type: 'subscribe', connection_id: connectionId }));
        subscribedIdRef.current = connectionId;
        setConnectionId(connectionId);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'metrics' && msg.data) {
            setMetrics(msg.data);
          }
        } catch {
          // Ignore unparseable messages
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onclose = () => {
        wsRef.current = null;
        subscribedIdRef.current = null;
        // Auto-reconnect after a short delay if we still want metrics
        reconnectTimerRef.current = setTimeout(() => {
          // Re-check if we still have a valid connection before reconnecting
          const store = useTabStore.getState();
          const tab = store.tabs.find((t) => t.id === store.activeTab);
          if (tab?.isConnected && tab.connectionId === connectionId) {
            connect();
          }
        }, 3000);
      };
    }

    connect();

    return () => {
      cleanup();
    };
  }, [connectionId]);
}
