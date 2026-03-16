import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { getWsUrl, apiPut, apiGet, ensureFreshToken } from '@/api/client';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';
import { useTabStore } from '@/store/tabStore';
import { useSessionStore } from '@/store/sessionStore';
import { decryptIfPresent, encrypt } from '@/utils/crypto';
import { TERMINAL_THEMES } from '@/themes/terminal-themes';
import { useCommandHistory } from '@/hooks/useCommandHistory';
import { TerminalAutocomplete } from './TerminalAutocomplete';
import { ReconnectOverlay } from './ReconnectOverlay';
import AttachSessionDialog from '../sessions/AttachSessionDialog';

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  sshKey?: string;
}

interface TerminalContainerProps {
  tabId: string;
  sessionId?: string;
  connectionConfig?: ConnectionConfig;
}

// ---------------------------------------------------------------------------
// Interactive prompt state (host key verification, password retry)
// ---------------------------------------------------------------------------

type PromptMode =
  | null
  | { kind: 'host_key'; keyType: string; fingerprint: string }
  | { kind: 'password' }
  | { kind: 'save_password'; sessionId: string; password: string };

// Cache terminal instances so the buffer persists when the component is hidden.
// Terminals are NEVER unmounted during layout switches — they stay in the DOM
// and are repositioned via CSS. This cache is only used for persistence across
// the initial mount and for external access (search, fit, etc.).
const terminalCache = new Map<
  string,
  {
    terminal: Terminal;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
  }
>();

export const TerminalContainer: React.FC<TerminalContainerProps> = ({
  tabId,
  sessionId,
  connectionConfig,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(false);
  const connectionConfigRef = useRef(connectionConfig);
  const sessionIdRef = useRef(sessionId);
  const reconnectKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { terminalTheme, fontSize, cursorStyle, cursorBlink, cursorColor } = useThemeStore();

  // Track the active connectionId so the command history hook can use it.
  const [activeConnectionId, setActiveConnectionId] = useState<string | undefined>(undefined);

  // Reconnect overlay state
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Attach-to-existing-session dialog state
  const [attachDialog, setAttachDialog] = useState<{
    connections: { connection_id: string; created_at: string }[];
  } | null>(null);
  const attachResolveRef = useRef<((action: { type: 'attach'; connectionId: string } | { type: 'new' } | { type: 'cancel' }) => void) | null>(null);

  // Stable callback for the history hook to read the terminal buffer.
  const getTerminal = useCallback(() => getTerminalInstance(tabId), [tabId]);

  // Command history / autocomplete hook
  const history = useCommandHistory(sessionId, activeConnectionId, getTerminal);

  // Keep a ref to history so the onData closure always sees the latest.
  const historyRef = useRef(history);
  historyRef.current = history;

  // Keep refs in sync with latest props (used by the mount effect)
  connectionConfigRef.current = connectionConfig;
  sessionIdRef.current = sessionId;

  // Auto-focus terminal when this tab becomes active
  const activeTab = useTabStore((s) => s.activeTab);
  useEffect(() => {
    if (activeTab !== tabId) return;
    const cached = terminalCache.get(tabId);
    if (!cached) return;
    const timer = setTimeout(() => cached.terminal.focus(), 50);
    return () => clearTimeout(timer);
  }, [activeTab, tabId]);

  const getTheme = useCallback(() => {
    const base = TERMINAL_THEMES[terminalTheme] ?? TERMINAL_THEMES.nextermDark;
    if (cursorColor) {
      return { ...base, cursor: cursorColor };
    }
    return base;
  }, [terminalTheme, cursorColor]);

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    let terminal: Terminal;
    let fitAddon: FitAddon;
    let searchAddon: SearchAddon;

    // Use half the default font size on mobile viewports to fit more content
    const isMobile = window.innerWidth < 640;
    const defaultFontSize = isMobile ? 7 : 14;

    terminal = new Terminal({
      cursorBlink,
      cursorStyle,
      fontSize: fontSize ?? defaultFontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: getTheme(),
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    fitAddon = new FitAddon();
    searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    // Intercept Ctrl+V / Cmd+V for reliable clipboard paste
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) (terminal as any).input(text, true);
        }).catch(() => {
          // Clipboard access denied — fall through to default behavior
        });
        return false;
      }
      return true;
    });

    terminalCache.set(tabId, { terminal, fitAddon, searchAddon });

    // ---------------------------------------------------------------
    // Interactive prompt state — mutable refs so the onData closure
    // always sees the latest values without re-subscribing.
    // ---------------------------------------------------------------
    let promptMode: PromptMode = null;
    let promptBuffer = '';
    // Track the password entered during auth_retry so we can offer to save it.
    let lastRetryPassword = '';
    // Buffer SSH output that arrives while the save_password prompt is active
    // so the shell prompt doesn't clobber it.
    let pendingOutput = '';

    // Variables accessible by both the async init and the synchronous cleanup.
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let resizeDisposable: { dispose(): void } | null = null;

    // ---------------------------------------------------------------
    // Async WebSocket initialization — ensures the JWT is fresh before
    // opening the connection so we never send an expired token.
    // ---------------------------------------------------------------
    const initConnection = async () => {
      // Layer 2: pre-flight token refresh
      await ensureFreshToken();

      const token = localStorage.getItem('token');
      const config = connectionConfigRef.current;
      const sid = sessionIdRef.current;
      const wsUrl = getWsUrl('/ws/ssh');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Check if tab already has a connectionId (e.g. restored from persistence)
      const existingConnectionId = useTabStore.getState().tabs.find((t) => t.id === tabId)?.connectionId;

      // Track whether we attempted a reconnect so we can fall back to fresh connect
      let attemptedReconnect = false;

      // Create a fresh SSH connection using the saved session credentials.
      const connectFresh = async () => {
        if (!config) return;

        let password = config.password;
        let sshKey = config.sshKey;

        if (sid && !password && !sshKey) {
          const cryptoKey = useAuthStore.getState().cryptoKey;
          if (!cryptoKey) {
            terminal.writeln('\r\n\x1b[31mError: No encryption key available — please re-login\x1b[0m');
            return;
          }
          try {
            const creds = await useSessionStore.getState().fetchCredentials(sid);
            [password, sshKey] = await Promise.all([
              decryptIfPresent(creds.encrypted_password, cryptoKey),
              decryptIfPresent(creds.encrypted_ssh_key, cryptoKey),
            ]);
          } catch (err) {
            terminal.writeln(`\r\n\x1b[31mError decrypting credentials: ${err}\x1b[0m`);
            return;
          }
        }

        ws.send(
          JSON.stringify({
            type: 'connect',
            sessionId: sid,
            host: config.host,
            port: config.port,
            username: config.username,
            password,
            sshKey,
          })
        );

        ws.send(
          JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          })
        );
      };

      // Check for active connections on the same saved session and offer
      // to attach, then either reconnect or connect fresh.
      const connectWithAttachCheck = async () => {
        if (!config) return;

        if (sid) {
          try {
            const activeConns = await apiGet<{ connection_id: string; created_at: string }[]>(
              `/api/sessions/${sid}/active`
            );
            if (activeConns && activeConns.length > 0) {
              const action = await new Promise<
                { type: 'attach'; connectionId: string } | { type: 'new' } | { type: 'cancel' }
              >((resolve) => {
                attachResolveRef.current = resolve;
                setAttachDialog({ connections: activeConns });
              });

              setAttachDialog(null);
              attachResolveRef.current = null;

              if (action.type === 'attach') {
                ws.send(JSON.stringify({
                  type: 'reconnect',
                  connection_id: action.connectionId,
                  tab_id: tabId,
                }));
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols: terminal.cols,
                  rows: terminal.rows,
                }));
                return;
              }

              if (action.type === 'cancel') {
                return;
              }
            }
          } catch {
            // If the API call fails, silently proceed with fresh connection
          }
        }

        await connectFresh();
      };

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            token,
          })
        );

        if (existingConnectionId) {
          attemptedReconnect = true;
          ws.send(
            JSON.stringify({
              type: 'reconnect',
              connection_id: existingConnectionId,
              tab_id: tabId,
            })
          );

          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        } else if (config) {
          connectWithAttachCheck().catch((err) => {
            terminal.writeln(`\r\n\x1b[31mConnection error: ${err}\x1b[0m`);
          });
        }
      };

      ws.onmessage = (event) => {
        const data = event.data;
        if (typeof data === 'string') {
          try {
            const msg = JSON.parse(data);

            if (msg.type === 'host_key_verify') {
              const { host, port, key_type, fingerprint, status } = msg;
              if (status === 'changed') {
                terminal.writeln('\r\n\x1b[31m@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\x1b[0m');
                terminal.writeln('\x1b[31m@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\x1b[0m');
                terminal.writeln('\x1b[31m@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\x1b[0m');
                terminal.writeln('\x1b[31mIT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\x1b[0m');
                terminal.writeln('\x1b[31mSomeone could be eavesdropping on you right now (man-in-the-middle attack)!\x1b[0m');
                terminal.writeln(`\x1b[31mThe ${key_type} host key for ${host}:${port} has changed.\x1b[0m`);
              } else {
                terminal.writeln(`\r\nThe authenticity of host '\x1b[1m${host}:${port}\x1b[0m' can't be established.`);
              }
              terminal.writeln(`${key_type} key fingerprint is \x1b[1m${fingerprint}\x1b[0m.`);
              terminal.write('Are you sure you want to continue connecting (yes/no)? ');

              promptMode = { kind: 'host_key', keyType: key_type, fingerprint };
              promptBuffer = '';
              return;
            }

            if (msg.type === 'auth_failed') {
              const remaining: number = msg.attempts_remaining ?? 0;
              terminal.writeln(`\r\n\x1b[31m${msg.message || 'Permission denied'}, please try again.\x1b[0m`);
              if (remaining > 0) {
                terminal.write('Password: ');
                promptMode = { kind: 'password' };
                promptBuffer = '';
              } else {
                terminal.writeln(`\x1b[31mPermission denied (${MAX_AUTH_DISPLAY} failed attempts).\x1b[0m`);
                useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
              }
              return;
            }

            if (msg.type === 'error') {
              if (attemptedReconnect && config) {
                attemptedReconnect = false;
                useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
                terminal.writeln('\r\n\x1b[33mReconnecting...\x1b[0m');
                connectFresh().catch((err) => {
                  terminal.writeln(`\r\n\x1b[31mConnection error: ${err}\x1b[0m`);
                });
              } else {
                terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
                useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
              }
            } else if (msg.type === 'connected') {
              useTabStore.getState().updateTab(tabId, {
                isConnected: true,
                connectionId: msg.connection_id,
              });
              setActiveConnectionId(msg.connection_id);
              setDisconnectReason(null);
              setIsReconnecting(false);
              if (msg.reconnected) {
                terminal.writeln('\r\n\x1b[32mSession reconnected\x1b[0m\r\n');
              }
              if (msg.auth_was_retry && msg.session_id && lastRetryPassword) {
                promptMode = {
                  kind: 'save_password',
                  sessionId: msg.session_id,
                  password: lastRetryPassword,
                };
                promptBuffer = '';
                terminal.write('\r\nSave password for this session? [y/n]: ');
              }
            } else if (msg.type === 'disconnected') {
              const reason = msg.reason || 'Session ended';
              terminal.writeln(`\r\n\x1b[33mDisconnected: ${reason}\x1b[0m`);
              useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
              setActiveConnectionId(undefined);
              setDisconnectReason(reason);
            } else if (msg.type === 'status') {
              terminal.writeln(`\r\n\x1b[33m${msg.message}\x1b[0m`);
              if (msg.message?.toLowerCase().includes('connected')) {
                useTabStore.getState().updateTab(tabId, { isConnected: true });
              }
            } else if (msg.type === 'pong') {
              awaitingPong = false;
              missedPongs = 0;
            } else if (msg.type === 'data') {
              if (promptMode?.kind === 'save_password') {
                pendingOutput += msg.data;
              } else {
                terminal.write(msg.data);
                historyRef.current.onServerOutput(msg.data);
              }
              useTabStore.getState().updateTab(tabId, { isConnected: true });
            }
          } catch {
            terminal.write(data);
            useTabStore.getState().updateTab(tabId, { isConnected: true });
          }
        }
      };

      ws.onerror = () => {
        terminal.writeln('\r\n\x1b[31mWebSocket connection error\x1b[0m');
        useTabStore.getState().updateTab(tabId, { isConnected: false });
        setActiveConnectionId(undefined);
        setDisconnectReason('WebSocket connection error');
      };

      ws.onclose = (event) => {
        // Layer 3: if the backend rejected the token (code 4001), refresh
        // it in the background so the next reconnect attempt will succeed.
        if (event.code === 4001) {
          ensureFreshToken();
        }
        const reason = event.reason ? `Connection closed: ${event.reason}` : 'Connection closed';
        terminal.writeln(`\r\n\x1b[33m${reason}\x1b[0m`);
        useTabStore.getState().updateTab(tabId, { isConnected: false });
        setActiveConnectionId(undefined);
        setDisconnectReason(reason);
      };

      // ---------------------------------------------------------------
      // WebSocket keepalive
      // ---------------------------------------------------------------
      let missedPongs = 0;
      let awaitingPong = false;
      keepaliveInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (awaitingPong) {
          missedPongs++;
          if (missedPongs >= 3) {
            terminal.writeln('\r\n\x1b[31mConnection lost (keepalive timeout)\x1b[0m');
            useTabStore.getState().updateTab(tabId, { isConnected: false });
            setDisconnectReason('Connection lost (keepalive timeout)');
            ws.close();
            return;
          }
        }
        awaitingPong = true;
        ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);

      // ---------------------------------------------------------------
      // Terminal data -> WebSocket (with prompt and autocomplete handling)
      // ---------------------------------------------------------------
      dataDisposable = terminal.onData((data) => {
        // Use wsRef.current so this handler always targets the latest
        // WebSocket (including after reconnection replaces it).
        const activeWs = wsRef.current;

        // ---- Interactive prompt interception ----
        if (promptMode !== null) {
          if (data === '\x03') {
            terminal.writeln('^C');
            if (promptMode.kind === 'password') {
              activeWs?.send(JSON.stringify({ type: 'auth_retry_cancel' }));
            } else if (promptMode.kind === 'host_key') {
              activeWs?.send(JSON.stringify({
                type: 'host_key_response',
                accepted: false,
                key_type: promptMode.keyType,
                fingerprint: promptMode.fingerprint,
              }));
            } else if (promptMode.kind === 'save_password') {
              lastRetryPassword = '';
              if (pendingOutput) {
                terminal.write(pendingOutput);
                pendingOutput = '';
              }
            }
            promptMode = null;
            promptBuffer = '';
            return;
          }

          if (data === '\x7f' || data === '\b') {
            if (promptBuffer.length > 0) {
              promptBuffer = promptBuffer.slice(0, -1);
              terminal.write('\b \b');
            }
            return;
          }

          if (data === '\r' || data === '\n') {
            terminal.writeln('');

            if (promptMode.kind === 'host_key') {
              const answer = promptBuffer.trim().toLowerCase();
              if (answer === 'yes') {
                terminal.writeln(
                  `\x1b[33mWarning: Permanently added host key to the list of known hosts.\x1b[0m`
                );
                activeWs?.send(JSON.stringify({
                  type: 'host_key_response',
                  accepted: true,
                  key_type: promptMode.keyType,
                  fingerprint: promptMode.fingerprint,
                }));
              } else if (answer === 'no') {
                activeWs?.send(JSON.stringify({
                  type: 'host_key_response',
                  accepted: false,
                  key_type: promptMode.keyType,
                  fingerprint: promptMode.fingerprint,
                }));
              } else {
                terminal.write('Please type \'yes\' or \'no\': ');
                promptBuffer = '';
                return;
              }
            } else if (promptMode.kind === 'password') {
              lastRetryPassword = promptBuffer;
              activeWs?.send(JSON.stringify({
                type: 'auth_retry',
                password: promptBuffer,
              }));
            } else if (promptMode.kind === 'save_password') {
              const answer = promptBuffer.trim().toLowerCase();
              const finishSavePrompt = () => {
                promptMode = null;
                if (pendingOutput) {
                  terminal.write(pendingOutput);
                  pendingOutput = '';
                }
              };
              lastRetryPassword = '';
              if (answer === 'y' || answer === 'yes') {
                const cryptoKey = useAuthStore.getState().cryptoKey;
                if (cryptoKey) {
                  const saveSessionId = promptMode.sessionId;
                  const savePassword = promptMode.password;
                  encrypt(savePassword, cryptoKey).then((encrypted) => {
                    return apiPut(`/api/sessions/${saveSessionId}`, {
                      encrypted_password: encrypted,
                    }).then(() => {
                      terminal.writeln('\x1b[32mPassword saved.\x1b[0m');
                    }).catch((err) => {
                      terminal.writeln(`\x1b[31mFailed to save password: ${err}\x1b[0m`);
                    });
                  }).catch((err) => {
                    terminal.writeln(`\x1b[31mEncryption error: ${err}\x1b[0m`);
                  }).finally(() => {
                    finishSavePrompt();
                  });
                } else {
                  terminal.writeln('\x1b[31mNo encryption key available — password not saved.\x1b[0m');
                  finishSavePrompt();
                }
              } else {
                terminal.writeln('\x1b[33mPassword not saved.\x1b[0m');
                finishSavePrompt();
              }
              promptBuffer = '';
              return;
            }

            promptMode = null;
            promptBuffer = '';
            return;
          }

          for (const ch of data) {
            if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126) {
              promptBuffer += ch;
              if (promptMode.kind === 'password') {
                terminal.write('*');
              } else {
                terminal.write(ch);
              }
            }
          }
          return;
        }

        // ---- Check connection state ----
        // If the SSH session is disconnected, suppress autocomplete and
        // skip sending data so the user isn't confused by ghost input.
        const currentTab = useTabStore.getState().tabs.find(t => t.id === tabId);
        const connected = currentTab?.isConnected ?? false;

        // ---- Autocomplete key interception ----
        const h = historyRef.current;

        if (connected) {
          const snap = h.getState();

          if (snap.isOpen) {
            if (data === '\x1b[A') {
              h.navigateSuggestions('up');
              return;
            }
            if (data === '\x1b[B') {
              h.navigateSuggestions('down');
              return;
            }
            if (data === '\t' || data === '\r' || data === '\n') {
              const shouldFill =
                data === '\t'
                  ? snap.suggestions.length > 0
                  : snap.selectedIndex >= 0;

              if (shouldFill) {
                if (snap.selectedIndex < 0) {
                  h.navigateSuggestions('down');
                }
                const selected = h.selectSuggestion();
                if (selected !== null && activeWs && activeWs.readyState === WebSocket.OPEN) {
                  activeWs.send(JSON.stringify({ type: 'data', data: '\x15' }));
                  activeWs.send(JSON.stringify({ type: 'data', data: selected }));
                  return;
                }
              }
            }
            if (data === '\x1b' || data === '\x1b\x1b') {
              h.closeSuggestions();
              return;
            }
          }

          h.processKeystroke(data);

          if (data.length >= 1 && !data.startsWith('\x1b') && data.charCodeAt(0) >= 32) {
            h.onKeystrokeSent(data);
          }
        } else {
          // Disconnected — close any open autocomplete dropdown.
          h.closeSuggestions();
        }

        if (activeWs && activeWs.readyState === WebSocket.OPEN) {
          activeWs.send(
            JSON.stringify({
              type: 'data',
              data,
            })
          );
        }
      });

      // Handle resize — also uses wsRef.current for reconnection support
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        const currentWs = wsRef.current;
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
          currentWs.send(
            JSON.stringify({
              type: 'resize',
              cols,
              rows,
            })
          );
        }
      });
    };

    // ResizeObserver to auto-fit terminal
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during transitions
      }
    });
    resizeObserver.observe(containerRef.current);

    // Kick off async connection setup
    initConnection();

    return () => {
      mountedRef.current = false;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (reconnectKeepaliveRef.current) clearInterval(reconnectKeepaliveRef.current);
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      resizeObserver.disconnect();

      // Close WebSocket — terminal buffer stays in cache
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Update theme when it changes
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (cached) {
      cached.terminal.options.theme = getTheme();
    }
  }, [tabId, getTheme]);

  // Update font size when it changes
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (cached && fontSize) {
      cached.terminal.options.fontSize = fontSize;
      cached.fitAddon.fit();
    }
  }, [tabId, fontSize]);

  // Update cursor settings when they change
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (cached) {
      cached.terminal.options.cursorStyle = cursorStyle;
    }
  }, [tabId, cursorStyle]);

  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (cached) {
      cached.terminal.options.cursorBlink = cursorBlink;
    }
  }, [tabId, cursorBlink]);

  // Handle autocomplete suggestion selection via double-click/tap.
  // Fills the command into the terminal without executing it.
  const handleSuggestionSelect = useCallback((command: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Clear current input line, then type the selected command
    ws.send(JSON.stringify({ type: 'data', data: '\x15' }));
    ws.send(JSON.stringify({ type: 'data', data: command }));

    // Close the autocomplete dropdown
    historyRef.current.closeSuggestions();
  }, []);

  // Reconnect handler — creates a new WebSocket and reconnects or connects fresh
  const handleReconnect = useCallback(async () => {
    setIsReconnecting(true);
    setDisconnectReason(null);

    // Close old WebSocket if still lingering
    const oldWs = wsRef.current;
    if (oldWs && (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING)) {
      oldWs.close();
    }

    mountedRef.current = false;

    // Layer 2: pre-flight token refresh before opening a new WebSocket
    await ensureFreshToken();

    const token = localStorage.getItem('token');
    const config = connectionConfigRef.current;
    const sid = sessionIdRef.current;
    const cached = terminalCache.get(tabId);
    if (!cached) {
      setIsReconnecting(false);
      return;
    }
    const terminal = cached.terminal;

    const wsUrl = getWsUrl('/ws/ssh');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const connectionId = useTabStore.getState().tabs.find((t) => t.id === tabId)?.connectionId;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));

      if (connectionId) {
        ws.send(JSON.stringify({
          type: 'reconnect',
          connection_id: connectionId,
          tab_id: tabId,
        }));
        ws.send(JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }));
      } else if (config) {
        const doConnect = async () => {
          let password = config.password;
          let sshKey = config.sshKey;

          if (sid && !password && !sshKey) {
            const cryptoKey = useAuthStore.getState().cryptoKey;
            if (cryptoKey) {
              try {
                const creds = await useSessionStore.getState().fetchCredentials(sid);
                [password, sshKey] = await Promise.all([
                  decryptIfPresent(creds.encrypted_password, cryptoKey),
                  decryptIfPresent(creds.encrypted_ssh_key, cryptoKey),
                ]);
              } catch {
                // ignore
              }
            }
          }

          ws.send(JSON.stringify({
            type: 'connect',
            sessionId: sid,
            host: config.host,
            port: config.port,
            username: config.username,
            password,
            sshKey,
          }));
          ws.send(JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          }));
        };
        doConnect().catch(() => {
          terminal.writeln('\r\n\x1b[31mReconnection failed\x1b[0m');
          setIsReconnecting(false);
          setDisconnectReason('Reconnection failed');
        });
      }
    };

    ws.onmessage = (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);

          if (msg.type === 'connected') {
            useTabStore.getState().updateTab(tabId, {
              isConnected: true,
              connectionId: msg.connection_id,
            });
            setActiveConnectionId(msg.connection_id);
            setDisconnectReason(null);
            setIsReconnecting(false);
            if (msg.reconnected) {
              terminal.writeln('\r\n\x1b[32mSession reconnected\x1b[0m\r\n');
            }
          } else if (msg.type === 'error') {
            if (connectionId && config) {
              useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
              terminal.writeln('\r\n\x1b[33mSession expired, creating new connection...\x1b[0m');
              ws.send(JSON.stringify({
                type: 'connect',
                sessionId: sid,
                host: config.host,
                port: config.port,
                username: config.username,
              }));
            } else {
              terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
              setIsReconnecting(false);
              setDisconnectReason(msg.message || 'Reconnection failed');
            }
          } else if (msg.type === 'disconnected') {
            const reason = msg.reason || 'Session ended';
            terminal.writeln(`\r\n\x1b[33mDisconnected: ${reason}\x1b[0m`);
            useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
            setActiveConnectionId(undefined);
            setIsReconnecting(false);
            setDisconnectReason(reason);
          } else if (msg.type === 'data') {
            terminal.write(msg.data);
            useTabStore.getState().updateTab(tabId, { isConnected: true });
          } else if (msg.type === 'pong') {
            // keepalive response
          }
        } catch {
          terminal.write(data);
        }
      }
    };

    ws.onerror = () => {
      terminal.writeln('\r\n\x1b[31mReconnection error\x1b[0m');
      setIsReconnecting(false);
      setDisconnectReason('Reconnection error');
    };

    ws.onclose = (event) => {
      // Layer 3: refresh token in background on auth rejection so the
      // next reconnect attempt starts with a valid token.
      if (event.code === 4001) {
        ensureFreshToken();
      }
      if (!disconnectReason) {
        setIsReconnecting(false);
      }
    };

    // Set up keepalive on the new WebSocket, tracked via ref for cleanup
    if (reconnectKeepaliveRef.current) {
      clearInterval(reconnectKeepaliveRef.current);
    }
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    reconnectKeepaliveRef.current = keepalive;

    ws.addEventListener('close', () => {
      clearInterval(keepalive);
      if (reconnectKeepaliveRef.current === keepalive) {
        reconnectKeepaliveRef.current = null;
      }
    });
  }, [tabId, disconnectReason]);

  // Attach dialog callbacks
  const handleAttach = useCallback((connectionId: string) => {
    attachResolveRef.current?.({ type: 'attach', connectionId });
  }, []);

  const handleNewConnection = useCallback(() => {
    attachResolveRef.current?.({ type: 'new' });
  }, []);

  const handleCancelAttach = useCallback(() => {
    attachResolveRef.current?.({ type: 'cancel' });
  }, []);

  const themeBg = getTheme().background ?? '#000000';
  const tabTitle = useTabStore.getState().tabs.find((t) => t.id === tabId)?.title || '';

  return (
    <>
      <div
        ref={containerRef}
        className="w-full h-full pt-[5px] pr-[5px] pb-[5px] pl-[10px]"
        data-tab-id={tabId}
        style={{ backgroundColor: themeBg }}
      />
      <TerminalAutocomplete
        tabId={tabId}
        suggestions={history.suggestions}
        selectedIndex={history.selectedIndex}
        isOpen={history.isOpen}
        inputPrefix={history.inputBuffer}
        onSelect={handleSuggestionSelect}
      />
      {disconnectReason && (
        <ReconnectOverlay
          reason={disconnectReason}
          onReconnect={handleReconnect}
          isReconnecting={isReconnecting}
        />
      )}
      <AttachSessionDialog
        isOpen={!!attachDialog}
        sessionName={tabTitle}
        connections={attachDialog?.connections || []}
        onAttach={handleAttach}
        onNewConnection={handleNewConnection}
        onCancel={handleCancelAttach}
      />
    </>
  );
};

// Display constant for max auth retries message
const MAX_AUTH_DISPLAY = 3;

// Utility to clean up a terminal from the cache when a tab is permanently closed
export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.terminal.dispose();
    terminalCache.delete(tabId);
  }
}

// Utility to destroy all cached terminals (e.g. on logout)
export function destroyAllTerminals(): void {
  for (const [, cached] of terminalCache) {
    cached.terminal.dispose();
  }
  terminalCache.clear();
}

// Utility to get the search addon for a terminal (used by TerminalToolbar)
export function getTerminalSearchAddon(tabId: string): SearchAddon | null {
  return terminalCache.get(tabId)?.searchAddon ?? null;
}

// Utility to get the fit addon for zoom operations
export function getTerminalFitAddon(tabId: string): FitAddon | null {
  return terminalCache.get(tabId)?.fitAddon ?? null;
}

// Utility to get the terminal instance
export function getTerminalInstance(tabId: string): Terminal | null {
  return terminalCache.get(tabId)?.terminal ?? null;
}

export default TerminalContainer;
