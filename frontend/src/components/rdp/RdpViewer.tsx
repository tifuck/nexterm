import React, { useEffect, useRef, useState, useCallback } from 'react';
import Guacamole from 'guacamole-common-js';
import { getWsUrl, ensureFreshToken } from '@/api/client';
import { useTabStore } from '@/store/tabStore';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';
import { decryptIfPresent } from '@/utils/crypto';
import { ReconnectOverlay } from '../terminal/ReconnectOverlay';
import { RdpToolbar } from './RdpToolbar';

export interface GuacConnectionConfig {
  protocol: 'rdp' | 'vnc';
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
}

interface RdpViewerProps {
  tabId: string;
  sessionId?: string;
  connectionConfig?: GuacConnectionConfig;
}

/** Debounce delay (ms) before sending a resize instruction to guacd. */
const RESIZE_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Scale modes
// ---------------------------------------------------------------------------

export type ScaleMode = 'fit' | 'fill' | 'stretch' | 'smart';

/** Compute the CSS scale factor for a given mode. */
export function calculateAutoScale(
  containerW: number,
  containerH: number,
  displayW: number,
  displayH: number,
  mode: ScaleMode,
): number {
  if (displayW === 0 || displayH === 0) return 1;
  const scaleX = containerW / displayW;
  const scaleY = containerH / displayH;

  switch (mode) {
    case 'fit':
      // Contain: show entire display, allow upscaling so the display
      // fills as much space as possible while staying fully visible.
      return Math.min(scaleX, scaleY);
    case 'fill':
      // Cover: fill the container, may crop edges
      return Math.max(scaleX, scaleY);
    case 'stretch':
      // Use smaller axis so we can apply asymmetric transform separately.
      // The actual stretching is handled by CSS transform in the display element.
      return Math.min(scaleX, scaleY);
    case 'smart': {
      // Auto-choose between fit and fill: pick whichever wastes less area.
      const fitScale = Math.min(scaleX, scaleY);
      const fitUsedW = displayW * fitScale;
      const fitUsedH = displayH * fitScale;
      const fitWaste = (containerW * containerH) - (fitUsedW * fitUsedH);

      const fillScale = Math.max(scaleX, scaleY);
      // Fill overflows one axis -- crop area is the wasted part
      const fillVisibleW = Math.min(displayW * fillScale, containerW);
      const fillVisibleH = Math.min(displayH * fillScale, containerH);
      const fillWaste = (displayW * fillScale * displayH * fillScale) - (fillVisibleW * fillVisibleH);

      return fitWaste <= fillWaste ? fitScale : fillScale;
    }
  }
}

/**
 * Apply the correct scaling to a Guacamole display given the current mode.
 *
 * Guacamole's display.scale() sets a uniform CSS transform on an inner `display`
 * div, while display.getElement() returns the outer `bounds` div.  For stretch
 * mode we need an *asymmetric* scale, so we override the transform that
 * display.scale() wrote on the inner div directly.
 */
export function applyScaleMode(
  entry: { client: Guacamole.Client; scaleMode: ScaleMode; manualScale: number | null },
  containerW: number,
  containerH: number,
): void {
  const display = entry.client.getDisplay();
  const w = display.getWidth();
  const h = display.getHeight();
  if (w === 0 || h === 0) return;

  // The inner `display` div is the first child of the `bounds` element.
  // Guacamole's display.scale() writes its CSS transform here.
  const boundsEl = display.getElement();
  const displayEl = boundsEl?.firstElementChild as HTMLElement | null;

  // Manual zoom override takes priority
  if (entry.manualScale != null) {
    display.scale(entry.manualScale);
    return;
  }

  if (entry.scaleMode === 'stretch') {
    // Stretch: compute per-axis scale factors and apply an asymmetric
    // CSS transform directly on the inner display div.
    const scaleX = containerW / w;
    const scaleY = containerH / h;

    // We still call display.scale() with the *smaller* axis so that the
    // bounds div dimensions are updated for layout (flex centering).
    // Then we overwrite the inner div's transform with the asymmetric one.
    display.scale(Math.min(scaleX, scaleY));

    if (displayEl) {
      displayEl.style.transform = `scale(${scaleX}, ${scaleY})`;
    }
    // Update bounds to match the full container so flex centers it properly
    if (boundsEl) {
      boundsEl.style.width = `${containerW}px`;
      boundsEl.style.height = `${containerH}px`;
    }
  } else {
    const scale = calculateAutoScale(containerW, containerH, w, h, entry.scaleMode);
    display.scale(scale);
    // If we were previously in stretch mode, display.scale() has already
    // overwritten the inner div's transform with the uniform value.
    // No extra cleanup needed.
  }
}

// ---------------------------------------------------------------------------
// Custom Tunnel: wraps an already-open WebSocket that has completed the
// JSON handshake and is now in raw Guacamole relay mode.
// ---------------------------------------------------------------------------

class ManagedWebSocketTunnel extends Guacamole.Tunnel {
  // NOTE: Guacamole.Tunnel's constructor assigns no-op instance properties
  // for connect/disconnect/sendMessage/isConnected that shadow any prototype
  // methods defined on subclasses. All overrides MUST be re-assigned as
  // instance properties inside our constructor, AFTER super().

  private ws: WebSocket;

  /** Parse raw Guacamole protocol data and fire oninstruction. */
  processRawMessage: (data: string) => void;

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;

    // ---- Override the no-op instance methods from Guacamole.Tunnel ----

    this.connect = (_data?: string) => {
      // Already connected -- fire state change
      if (this.onstatechange) {
        this.onstatechange(Guacamole.Tunnel.State.OPEN);
      }
    };

    this.disconnect = () => {
      this.state = Guacamole.Tunnel.State.CLOSED;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (this.onstatechange) {
        this.onstatechange(Guacamole.Tunnel.State.CLOSED);
      }
    };

    this.sendMessage = (...elements: unknown[]) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Encode as a Guacamole instruction: "LENGTH.VALUE,LENGTH.VALUE,...;"
      const parts = elements.map((el) => {
        const str = String(el);
        return `${str.length}.${str}`;
      });
      ws.send(parts.join(',') + ';');
    };

    this.isConnected = () => {
      return ws.readyState === WebSocket.OPEN && this.state === Guacamole.Tunnel.State.OPEN;
    };

    // ---- Instruction parser (not a Tunnel base method, safe on prototype) ----

    this.processRawMessage = (data: string) => {
      const instructions = data.split(';');
      for (const instr of instructions) {
        if (!instr.trim()) continue;
        const parts = instr.split(',');
        if (parts.length === 0) continue;

        // Each part is LENGTH.VALUE -- extract just the value
        const decoded = parts.map((part) => {
          const dotIndex = part.indexOf('.');
          if (dotIndex === -1) return part;
          return part.substring(dotIndex + 1);
        });

        const opcode = decoded[0];
        const args = decoded.slice(1);

        if (this.oninstruction) {
          this.oninstruction(opcode, args);
        }
      }
    };

    // ---- WebSocket event handlers ----

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data === 'string') {
        this.processRawMessage(data);
      }
    };

    ws.onclose = () => {
      this.state = Guacamole.Tunnel.State.CLOSED;
      if (this.onstatechange) {
        this.onstatechange(Guacamole.Tunnel.State.CLOSED);
      }
    };

    ws.onerror = () => {
      if (this.onerror) {
        this.onerror(new Guacamole.Status(Guacamole.Status.Code.SERVER_ERROR, 'WebSocket error'));
      }
    };

    // The tunnel is already "open" since the WebSocket handshake completed
    this.state = Guacamole.Tunnel.State.OPEN;
  }
}

// ---------------------------------------------------------------------------
// Cache: preserve Guacamole client instances across CSS show/hide toggling
// ---------------------------------------------------------------------------

interface GuacCacheEntry {
  client: Guacamole.Client;
  tunnel: ManagedWebSocketTunnel;
  keyboard: Guacamole.Keyboard;
  mouse: Guacamole.Mouse | null;
  ws: WebSocket;
  protocol: 'rdp' | 'vnc';
  /** Last clipboard text received from the remote session. */
  remoteClipboard: string;
  /** Manual scale override (null = auto-fit). */
  manualScale: number | null;
  /** Current scale mode (fit, fill, stretch, smart). */
  scaleMode: ScaleMode;
}

const guacCache = new Map<string, GuacCacheEntry>();

/** Get the Guacamole cache entry for a tab (used by toolbar). */
export function getGuacEntry(tabId: string): GuacCacheEntry | undefined {
  return guacCache.get(tabId);
}

/** Destroy and clean up a cached Guacamole viewer. Called on tab close. */
export function destroyRdpViewer(tabId: string): void {
  const entry = guacCache.get(tabId);
  if (entry) {
    try { if (entry.keyboard) entry.keyboard.reset(); } catch { /* ignore */ }
    try { entry.client.disconnect(); } catch { /* ignore */ }
    try {
      if (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING) {
        entry.ws.close();
      }
    } catch { /* ignore */ }
    guacCache.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RdpViewer: React.FC<RdpViewerProps> = ({
  tabId,
  sessionId,
  connectionConfig,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const connectionConfigRef = useRef(connectionConfig);
  const sessionIdRef = useRef(sessionId);
  const disconnectReasonRef = useRef<string | null>(null);
  const protocolRef = useRef<'rdp' | 'vnc'>('rdp');

  const [disconnectReason, setDisconnectReasonState] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Connecting...');
  const [isConnected, setIsConnected] = useState(false);

  // Keep ref and state in sync so closures can read the current value
  const setDisconnectReason = useCallback((reason: string | null) => {
    disconnectReasonRef.current = reason;
    setDisconnectReasonState(reason);
  }, []);

  // Keep refs in sync with latest props
  connectionConfigRef.current = connectionConfig;
  sessionIdRef.current = sessionId;

  // Build the Guacamole connection
  const initConnection = useCallback(async () => {
    if (!containerRef.current) return;

    // Destroy any previous cached entry for this tab
    destroyRdpViewer(tabId);

    setStatusMessage('Connecting...');
    setIsConnected(false);
    setDisconnectReason(null);

    // Ensure fresh JWT
    await ensureFreshToken();

    const config = connectionConfigRef.current;
    const sid = sessionIdRef.current;

    if (!config && !sid) {
      setStatusMessage('No connection configuration');
      return;
    }

    // Resolve credentials
    let host = config?.host || '';
    let port = config?.port || 3389;
    const username = config?.username || '';
    let password = config?.password;
    const domain = config?.domain || '';
    const protocol = config?.protocol || 'rdp';
    protocolRef.current = protocol;
    let width = config?.width || 0;
    let height = config?.height || 0;

    // If we have a saved session, decrypt credentials
    if (sid && !password) {
      const cryptoKey = useAuthStore.getState().cryptoKey;
      if (cryptoKey) {
        try {
          const creds = await useSessionStore.getState().fetchCredentials(sid);
          password = await decryptIfPresent(creds.encrypted_password, cryptoKey) || undefined;
        } catch {
          // Proceed without credentials
        }
      }
    }

    // For saved sessions without inline config, resolve from session data
    if (sid && !host) {
      const sessions = useSessionStore.getState().sessions;
      const saved = sessions.find((s) => s.id === sid);
      if (saved) {
        host = saved.host;
        port = saved.port;
      }
    }

    // Use container dimensions for auto resolution
    if (!width || !height) {
      const rect = containerRef.current.getBoundingClientRect();
      width = Math.round(rect.width) || 1024;
      height = Math.round(rect.height) || 768;
    }

    // Open the WebSocket
    const wsUrl = getWsUrl('/ws/guacamole');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatusMessage('Authenticating...');

      // Send auth
      const token = localStorage.getItem('token');
      ws.send(JSON.stringify({ type: 'auth', token }));

      // Send connect
      setStatusMessage('Starting remote session...');
      ws.send(JSON.stringify({
        type: 'connect',
        protocol,
        host,
        port,
        username,
        password,
        domain,
        width,
        height,
        dpi: Math.round(window.devicePixelRatio * 96) || 96,
        sessionId: sid,
        tab_id: tabId,
      }));
    };

    // Buffer for raw guacd instructions that arrive before we finish
    // processing the "connected" JSON message and set up the tunnel.
    const earlyGuacMessages: string[] = [];

    ws.onmessage = (event) => {
      const data = event.data;
      if (typeof data !== 'string') return;

      // During Phase 1, we receive JSON messages from our backend.
      // However, once the backend starts the relay, raw Guacamole
      // instructions may arrive interleaved with (or before we process)
      // the "connected" message. Buffer those for replay.
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'authenticated') {
          return;
        }

        if (msg.type === 'connected') {
          // Phase 1 complete -- the WS is now in raw Guacamole relay mode
          setStatusMessage('');
          setIsConnected(true);
          setDisconnectReason(null);
          setIsReconnecting(false);

          useTabStore.getState().updateTab(tabId, {
            isConnected: true,
            connectionId: msg.connection_id,
          });

          // Create custom tunnel wrapping this WebSocket.
          // This immediately takes over ws.onmessage.
          const tunnel = new ManagedWebSocketTunnel(ws);

          // Create Guacamole client (sets up tunnel.oninstruction internally)
          const client = new Guacamole.Client(tunnel);

          // Mount the display
          const displayEl = client.getDisplay().getElement();
          displayEl.style.cursor = 'none'; // Use software cursor from guacd
          if (containerRef.current) {
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(displayEl);
          }

          // Mouse is deferred until the display has non-zero dimensions
          // (after the first `size` instruction from guacd). Attaching
          // to a 0x0 element would receive no events. We must attach to
          // the display element (not the container) so coordinates are
          // relative to the display, matching what sendMouseState expects.
          let mouse: Guacamole.Mouse | null = null;
          const savedMode = (localStorage.getItem(`rdp_scale_${tabId}`) as ScaleMode) || 'fit';
          const cacheEntry: GuacCacheEntry = {
            client, tunnel,
            keyboard: null as unknown as Guacamole.Keyboard,
            mouse: null, ws,
            protocol,
            remoteClipboard: '',
            manualScale: null,
            scaleMode: savedMode,
          };

          // Set up keyboard input (attached to document so it works
          // even when the canvas doesn't have explicit focus).
          // We must let the browser handle keys when a form element is
          // focused, otherwise inputs/dialogs become un-typeable.
          const keyboard = new Guacamole.Keyboard(document);
          keyboard.onkeydown = (keysym: number) => {
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)) {
              return true; // Let the browser handle this key normally
            }
            client.sendKeyEvent(1, keysym);
            return false;
          };
          keyboard.onkeyup = (keysym: number) => {
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)) {
              return;
            }
            client.sendKeyEvent(0, keysym);
          };
          cacheEntry.keyboard = keyboard;

          // Handle clipboard from remote session (remote -> local)
          client.onclipboard = (stream: Guacamole.InputStream, mimetype: string) => {
            if (mimetype !== 'text/plain') return;
            const reader = new Guacamole.StringReader(stream);
            let clipData = '';
            reader.ontext = (text: string) => { clipData += text; };
            reader.onend = () => {
              cacheEntry.remoteClipboard = clipData;
              // Attempt to auto-write to local clipboard (requires focus + permissions)
              try {
                if (document.hasFocus()) {
                  navigator.clipboard.writeText(clipData).catch(() => { /* permission denied or unavailable */ });
                }
              } catch { /* ignore */ }
            };
          };

          // Handle client errors
          client.onerror = (status: Guacamole.Status) => {
            const errMsg = status.message || `Error code: ${status.code}`;
            setDisconnectReason(errMsg);
            setIsConnected(false);
            useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
          };

          // Handle client state changes
          client.onstatechange = (state: Guacamole.Client.State) => {
            if (state === Guacamole.Client.State.DISCONNECTED) {
              if (!disconnectReasonRef.current) {
                setDisconnectReason('Remote session ended');
              }
              setIsConnected(false);
              useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
            }
          };

          // Detect tunnel close (WebSocket dropped by backend/network).
          // Guacamole.Client does NOT listen to tunnel.onstatechange,
          // so without this the UI would never know the connection died.
          tunnel.onstatechange = (state: number) => {
            if (state === Guacamole.Tunnel.State.CLOSED) {
              if (!disconnectReasonRef.current) {
                setDisconnectReason('Connection closed');
              }
              setIsConnected(false);
              useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
            }
          };

          // Handle display resize from remote and lazily attach mouse
          client.getDisplay().onresize = (_w: number, _h: number) => {
            const container = containerRef.current;
            if (!container) return;

            applyScaleMode(cacheEntry, container.offsetWidth, container.offsetHeight);

            // Attach mouse to the display element on first resize
            // (now that it has real dimensions and can receive events)
            if (!mouse) {
              const display = client.getDisplay();
              mouse = new Guacamole.Mouse(display.getElement());
              const sendMouseEvent: Guacamole.Event.TargetListener = (e) => {
                client.sendMouseState((e as Guacamole.Mouse.Event).state, true);
              };
              mouse.onEach(['mousedown', 'mousemove', 'mouseup'], sendMouseEvent);
              cacheEntry.mouse = mouse;
            }
          };

          // Signal the client that the tunnel is ready (no-op connect
          // since the tunnel is already open, but fires state change)
          client.connect();

          // Replay any guacd instructions that arrived before the tunnel
          // was set up. The Guacamole.Client has now registered its
          // oninstruction handler, so these will be processed correctly.
          for (const buffered of earlyGuacMessages) {
            tunnel.processRawMessage(buffered);
          }

          // Cache for later cleanup
          guacCache.set(tabId, cacheEntry);

          return;
        }

        if (msg.type === 'error') {
          setStatusMessage('');
          setDisconnectReason(msg.message || 'Connection failed');
          setIsConnected(false);
          useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
          return;
        }

        if (msg.type === 'pong') {
          return;
        }
      } catch {
        // Not valid JSON -- this is a raw Guacamole instruction that
        // arrived before we finished processing "connected". Buffer it
        // so it can be replayed once the tunnel and client are ready.
        earlyGuacMessages.push(data);
      }
    };

    ws.onerror = () => {
      setStatusMessage('');
      setDisconnectReason('WebSocket connection error');
      setIsConnected(false);
    };

    ws.onclose = (event) => {
      if (event.code === 4001) {
        ensureFreshToken();
      }
      setStatusMessage('');
      // Read from the ref, not the stale closure variable
      if (!disconnectReasonRef.current) {
        setDisconnectReason('Connection closed');
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Initialize on mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    initConnection();

    return () => {
      mountedRef.current = false;
      // Don't destroy -- keep in cache for CSS show/hide toggling.
      // Cleanup happens via destroyRdpViewer when the tab is closed.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Handle container resize -- rescale display immediately (CSS) and
  // send a debounced sendSize() so the remote resolution adapts.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      const cached = guacCache.get(tabId);
      if (!cached) return;

      const display = cached.client.getDisplay();
      const w = display.getWidth();
      const h = display.getHeight();
      if (w === 0 || h === 0) return;

      const containerW = container.offsetWidth;
      const containerH = container.offsetHeight;
      if (containerW === 0 || containerH === 0) return;

      // Immediate CSS scale using current mode
      applyScaleMode(cached, containerW, containerH);

      // Debounced: tell guacd to actually change the remote resolution
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Only send if the container size actually differs from the remote display
        const curW = display.getWidth();
        const curH = display.getHeight();
        if (containerW !== curW || containerH !== curH) {
          cached.client.sendSize(containerW, containerH);
        }
      }, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [tabId]);

  // Reconnect handler
  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true);
    destroyRdpViewer(tabId);
    mountedRef.current = false;
    await initConnection();
    mountedRef.current = true;
    setIsReconnecting(false);
  }, [tabId, initConnection]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black" data-rdp-tab-id={tabId}>
      {/* Status overlay */}
      {statusMessage && !isConnected && !disconnectReason && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--text-secondary)]">{statusMessage}</span>
          </div>
        </div>
      )}

      {/* Guacamole display container */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        style={{ cursor: isConnected ? 'none' : 'default' }}
      />

      {/* Protocol controls toolbar */}
      {isConnected && (
        <RdpToolbar tabId={tabId} protocol={protocolRef.current} />
      )}

      {/* Reconnect overlay */}
      {disconnectReason && (
        <ReconnectOverlay
          reason={disconnectReason}
          onReconnect={handleReconnect}
          isReconnecting={isReconnecting}
        />
      )}
    </div>
  );
};

export default RdpViewer;
