import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { getWsUrl, apiPut } from '@/api/client';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';
import { useTabStore } from '@/store/tabStore';
import { useSessionStore } from '@/store/sessionStore';
import { decryptIfPresent, encrypt } from '@/utils/crypto';
import { TERMINAL_THEMES } from '@/themes/terminal-themes';
import { useCommandHistory } from '@/hooks/useCommandHistory';
import { TerminalAutocomplete } from './TerminalAutocomplete';

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

// Cache terminal instances so the buffer persists when the component is hidden/unmounted
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
  const { terminalTheme, fontSize, cursorStyle, cursorBlink, cursorColor } = useThemeStore();

  // Track the active connectionId so the command history hook can use it.
  const [activeConnectionId, setActiveConnectionId] = useState<string | undefined>(undefined);

  // Command history / autocomplete hook
  const history = useCommandHistory(sessionId, activeConnectionId);

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

    let cached = terminalCache.get(tabId);
    let terminal: Terminal;
    let fitAddon: FitAddon;
    let searchAddon: SearchAddon;

    if (cached) {
      terminal = cached.terminal;
      fitAddon = cached.fitAddon;
      searchAddon = cached.searchAddon;
      terminal.open(containerRef.current);
      fitAddon.fit();
    } else {
      terminal = new Terminal({
        cursorBlink,
        cursorStyle,
        fontSize: fontSize ?? 14,
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
      // Use terminal.input() instead of terminal.paste() to bypass
      // xterm's bracketed paste confirmation dialog for multi-line content.
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
    }

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

    // Connect WebSocket
    const token = useAuthStore.getState().token;
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
    // Extracted as a named function so it can be called both on initial
    // connect and as a fallback when reconnect fails.
    const connectFresh = async () => {
      if (!config) return;

      let password = config.password;
      let sshKey = config.sshKey;

      if (sid && !password && !sshKey) {
        // Saved session — decrypt from E2EE vault
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

      // Send initial terminal size
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        })
      );
    };

    ws.onopen = () => {
      // Send auth message
      ws.send(
        JSON.stringify({
          type: 'auth',
          token,
        })
      );

      if (existingConnectionId) {
        // Try to reconnect to an existing backend SSH session
        attemptedReconnect = true;
        ws.send(
          JSON.stringify({
            type: 'reconnect',
            connection_id: existingConnectionId,
            tab_id: tabId,
          })
        );

        // Send initial terminal size
        ws.send(
          JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          })
        );
      } else if (config) {
        connectFresh().catch((err) => {
          terminal.writeln(`\r\n\x1b[31mConnection error: ${err}\x1b[0m`);
        });
      }
    };

    ws.onmessage = (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);

          // ----- Host key verification prompt -----
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

          // ----- Authentication failure / password retry -----
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
            // If a reconnect attempt failed, silently fall back to a fresh connection
            if (attemptedReconnect && config) {
              attemptedReconnect = false; // prevent infinite loop
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
            // Store the connection_id returned by the backend (used by SFTP)
            useTabStore.getState().updateTab(tabId, {
              isConnected: true,
              connectionId: msg.connection_id,
            });
            // Activate autocomplete history fetching for this connection
            setActiveConnectionId(msg.connection_id);
            if (msg.reconnected) {
              terminal.writeln('\r\n\x1b[32mSession reconnected\x1b[0m\r\n');
            }
            // Offer to save the password if auth succeeded via manual retry
            // on a saved session.
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
            terminal.writeln(`\r\n\x1b[33mDisconnected: ${msg.reason || 'Session ended'}\x1b[0m`);
            useTabStore.getState().updateTab(tabId, { isConnected: false, connectionId: undefined });
            setActiveConnectionId(undefined);
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
              // Buffer output so the shell prompt doesn't clobber the y/n prompt.
              pendingOutput += msg.data;
            } else {
              terminal.write(msg.data);
            }
            useTabStore.getState().updateTab(tabId, { isConnected: true });
          }
        } catch {
          // Plain text data
          terminal.write(data);
          useTabStore.getState().updateTab(tabId, { isConnected: true });
        }
      }
    };

    ws.onerror = () => {
      terminal.writeln('\r\n\x1b[31mWebSocket connection error\x1b[0m');
      useTabStore.getState().updateTab(tabId, { isConnected: false });
    };

    ws.onclose = (event) => {
      terminal.writeln(
        `\r\n\x1b[33mConnection closed${event.reason ? `: ${event.reason}` : ''}\x1b[0m`
      );
      useTabStore.getState().updateTab(tabId, { isConnected: false });
    };

    // ---------------------------------------------------------------
    // WebSocket keepalive — send a ping every 30s and detect stale
    // connections if 3 consecutive pongs are missed.
    // ---------------------------------------------------------------
    let missedPongs = 0;
    let awaitingPong = false;
    const keepaliveInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (awaitingPong) {
        missedPongs++;
        if (missedPongs >= 3) {
          terminal.writeln('\r\n\x1b[31mConnection lost (keepalive timeout)\x1b[0m');
          useTabStore.getState().updateTab(tabId, { isConnected: false });
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
    const dataDisposable = terminal.onData((data) => {
      // ---- Interactive prompt interception ----
      if (promptMode !== null) {
        // Ctrl+C: cancel the prompt
        if (data === '\x03') {
          terminal.writeln('^C');
          if (promptMode.kind === 'password') {
            ws.send(JSON.stringify({ type: 'auth_retry_cancel' }));
          } else if (promptMode.kind === 'host_key') {
            ws.send(JSON.stringify({
              type: 'host_key_response',
              accepted: false,
              key_type: promptMode.keyType,
              fingerprint: promptMode.fingerprint,
            }));
          } else if (promptMode.kind === 'save_password') {
            lastRetryPassword = '';
            // Flush any SSH output that arrived during the prompt.
            if (pendingOutput) {
              terminal.write(pendingOutput);
              pendingOutput = '';
            }
          }
          promptMode = null;
          promptBuffer = '';
          return;
        }

        // Backspace
        if (data === '\x7f' || data === '\b') {
          if (promptBuffer.length > 0) {
            promptBuffer = promptBuffer.slice(0, -1);
            // For host_key prompt, visually erase the character.
            // For password prompt, erase the mask character.
            terminal.write('\b \b');
          }
          return;
        }

        // Enter: submit the prompt
        if (data === '\r' || data === '\n') {
          terminal.writeln('');

          if (promptMode.kind === 'host_key') {
            const answer = promptBuffer.trim().toLowerCase();
            if (answer === 'yes') {
              terminal.writeln(
                `\x1b[33mWarning: Permanently added host key to the list of known hosts.\x1b[0m`
              );
              ws.send(JSON.stringify({
                type: 'host_key_response',
                accepted: true,
                key_type: promptMode.keyType,
                fingerprint: promptMode.fingerprint,
              }));
            } else if (answer === 'no') {
              ws.send(JSON.stringify({
                type: 'host_key_response',
                accepted: false,
                key_type: promptMode.keyType,
                fingerprint: promptMode.fingerprint,
              }));
            } else {
              // Invalid input — re-prompt
              terminal.write('Please type \'yes\' or \'no\': ');
              promptBuffer = '';
              return;
            }
          } else if (promptMode.kind === 'password') {
            lastRetryPassword = promptBuffer;
            ws.send(JSON.stringify({
              type: 'auth_retry',
              password: promptBuffer,
            }));
          } else if (promptMode.kind === 'save_password') {
            const answer = promptBuffer.trim().toLowerCase();
            // Helper to flush buffered SSH output and exit prompt mode.
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
                // Keep promptMode active during the async save so incoming
                // SSH data continues to be buffered until we're done.
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

        // Regular character(s) — accumulate
        // Accept printable characters (handle multi-char paste)
        for (const ch of data) {
          if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126) {
            promptBuffer += ch;
            if (promptMode.kind === 'password') {
              // Mask the input
              terminal.write('*');
            } else {
              // Echo for host_key prompt
              terminal.write(ch);
            }
          }
        }
        return;
      }

      // ---- Autocomplete key interception ----
      const h = historyRef.current;
      const snap = h.getState();

      if (snap.isOpen) {
        // Up arrow: \x1b[A
        if (data === '\x1b[A') {
          h.navigateSuggestions('up');
          return;
        }
        // Down arrow: \x1b[B
        if (data === '\x1b[B') {
          h.navigateSuggestions('down');
          return;
        }
        // Tab or Enter: fill the selected (or top) suggestion
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
            if (selected !== null && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'data', data: '\x15' }));
              ws.send(JSON.stringify({ type: 'data', data: selected }));
              return;
            }
          }
        }
        // Escape: close dropdown
        if (data === '\x1b' || data === '\x1b\x1b') {
          h.closeSuggestions();
          return;
        }
      }

      // --- Normal processing: track keystrokes for history/autocomplete ---
      h.processKeystroke(data);

      // --- Send to SSH ---
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'data',
            data,
          })
        );
      }
    });

    // Handle resize
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'resize',
            cols,
            rows,
          })
        );
      }
    });

    // ResizeObserver to auto-fit terminal
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during transitions
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      mountedRef.current = false;
      clearInterval(keepaliveInterval);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();

      // Close WebSocket but keep terminal alive in cache
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
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

  const themeBg = getTheme().background ?? '#000000';

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
