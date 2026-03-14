/**
 * Hook for tracking terminal input and providing command history autocomplete.
 *
 * Architecture:
 * - On SSH connect, fetches the remote server's shell history files
 *   (~/.bash_history, ~/.zsh_history, fish_history) via a REST endpoint.
 * - When the user enters a command (presses Enter), triggers a re-fetch of
 *   remote history -- but throttled to at most once per 5 seconds.
 * - Keystroke buffering detects the current input prefix client-side.
 * - Autocomplete suggestions are filtered from the cached history array
 *   using prefix matching -- no network call per keystroke.
 *
 * IMPORTANT: The onData handler in TerminalContainer runs synchronously
 * between keystrokes.  React setState is asynchronous, so reading isOpen /
 * selectedIndex from the last-rendered state would be stale after
 * navigateSuggestions() but before the next render.  To solve this, we
 * maintain ref-backed mirrors of the critical fields and expose a
 * getState() function that always returns the synchronous truth.
 *
 * Limitations:
 * - Raw SSH has no clean command boundaries; the input buffer is best-effort.
 * - Line editing (arrow keys, Ctrl+A/E) may cause the buffer to drift.
 *   We reset on Enter/Ctrl+C which handles most cases.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/api/client';

/** Maximum number of suggestions to show in the dropdown. */
const MAX_SUGGESTIONS = 8;

/** Minimum interval between remote history fetches (ms). */
const THROTTLE_MS = 5000;

interface CommandHistoryState {
  suggestions: string[];
  isOpen: boolean;
  selectedIndex: number;
}

export function useCommandHistory(sessionId?: string, connectionId?: string) {
  const inputBuffer = useRef('');
  const [state, setState] = useState<CommandHistoryState>({
    suggestions: [],
    isOpen: false,
    selectedIndex: -1,
  });

  // ---------------------------------------------------------------
  // Ref-backed mirrors of state for synchronous access from onData.
  // These are ALWAYS updated in lockstep with setState calls.
  // ---------------------------------------------------------------
  const isOpenRef = useRef(false);
  const selectedIndexRef = useRef(-1);
  const suggestionsRef = useRef<string[]>([]);

  /** Helper: update both React state and the ref mirrors atomically. */
  const setStateSync = useCallback((next: CommandHistoryState) => {
    isOpenRef.current = next.isOpen;
    selectedIndexRef.current = next.selectedIndex;
    suggestionsRef.current = next.suggestions;
    setState(next);
  }, []);

  // Cached history from the remote server (most-recent first).
  const historyCache = useRef<string[]>([]);

  // Throttle tracking: timestamp of last successful remote fetch.
  const lastFetchTime = useRef(0);
  // If a fetch was requested during throttle window, this flag queues
  // a deferred fetch once the window expires.
  const pendingFetch = useRef(false);
  const deferredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether initial fetch has happened.
  const initialFetchDone = useRef(false);

  // Keep connectionId in a ref so callbacks always have the latest.
  const connectionIdRef = useRef(connectionId);
  connectionIdRef.current = connectionId;

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // -----------------------------------------------------------------
  // Fetch remote history
  // -----------------------------------------------------------------

  const fetchRemoteHistory = useCallback(async () => {
    const connId = connectionIdRef.current;
    if (!connId) return;

    try {
      const result = await apiGet<{ commands: string[] }>(
        `/api/history/${connId}/remote`,
        { lines: 500 },
      );
      if (result.commands && result.commands.length > 0) {
        historyCache.current = result.commands;
      }
      lastFetchTime.current = Date.now();
    } catch {
      // Non-critical -- keep using the existing cache.
    }
  }, []);

  /**
   * Request a remote history refresh, throttled to once per THROTTLE_MS.
   * If called during the throttle window, schedules one deferred fetch
   * for when the window expires.
   */
  const requestHistoryRefresh = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastFetchTime.current;

    if (elapsed >= THROTTLE_MS) {
      fetchRemoteHistory();
    } else {
      if (!pendingFetch.current) {
        pendingFetch.current = true;
        const delay = THROTTLE_MS - elapsed;
        deferredTimerRef.current = setTimeout(() => {
          pendingFetch.current = false;
          deferredTimerRef.current = null;
          fetchRemoteHistory();
        }, delay);
      }
    }
  }, [fetchRemoteHistory]);

  // -----------------------------------------------------------------
  // Initial fetch when connectionId becomes available
  // -----------------------------------------------------------------

  useEffect(() => {
    if (!connectionId) {
      initialFetchDone.current = false;
      return;
    }

    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchRemoteHistory();
    }

    return () => {
      if (deferredTimerRef.current) {
        clearTimeout(deferredTimerRef.current);
        deferredTimerRef.current = null;
        pendingFetch.current = false;
      }
    };
  }, [connectionId, fetchRemoteHistory]);

  // -----------------------------------------------------------------
  // Client-side prefix matching against cached history
  // -----------------------------------------------------------------

  const updateSuggestions = useCallback(() => {
    const prefix = inputBuffer.current;
    if (prefix.length < 1) {
      if (isOpenRef.current) {
        setStateSync({ isOpen: false, suggestions: [], selectedIndex: -1 });
      }
      return;
    }

    const lowerPrefix = prefix.toLowerCase();
    const matches = historyCache.current
      .filter((cmd) => cmd.toLowerCase().startsWith(lowerPrefix) && cmd !== prefix)
      .slice(0, MAX_SUGGESTIONS);

    setStateSync({
      suggestions: matches,
      isOpen: matches.length > 0,
      selectedIndex: -1,
    });
  }, [setStateSync]);

  // -----------------------------------------------------------------
  // Process a keystroke from the terminal's onData handler
  // -----------------------------------------------------------------

  const processKeystroke = useCallback(
    (data: string) => {
      // Enter key (CR or LF)
      if (data === '\r' || data === '\n') {
        const command = inputBuffer.current.trim();
        if (command) {
          // Fire-and-forget: record in local history DB
          apiPost('/api/history', {
            command,
            session_id: sessionIdRef.current,
          }).catch(() => {});

          // Also add to the front of the cache so autocomplete picks it up
          // immediately, before the next remote fetch.
          const cache = historyCache.current;
          const idx = cache.indexOf(command);
          if (idx !== -1) cache.splice(idx, 1);
          cache.unshift(command);

          // Request a throttled remote history refresh.
          requestHistoryRefresh();
        }
        inputBuffer.current = '';
        if (isOpenRef.current) {
          setStateSync({ isOpen: false, suggestions: [], selectedIndex: -1 });
        }
        return;
      }

      // Ctrl+C -- reset buffer
      if (data === '\x03') {
        inputBuffer.current = '';
        if (isOpenRef.current) {
          setStateSync({ isOpen: false, suggestions: [], selectedIndex: -1 });
        }
        return;
      }

      // Backspace (DEL or BS)
      if (data === '\x7f' || data === '\b') {
        inputBuffer.current = inputBuffer.current.slice(0, -1);
        updateSuggestions();
        return;
      }

      // Regular printable character(s) (handle multi-char paste, ignore escape sequences)
      if (data.length >= 1 && !data.startsWith('\x1b')) {
        let appended = false;
        for (const ch of data) {
          if (ch >= ' ' && ch <= '~') {
            inputBuffer.current += ch;
            appended = true;
          }
        }
        if (appended) updateSuggestions();
        return;
      }

      // Escape sequences (arrows, etc.) -- handled by the terminal container
      // for navigation; don't modify buffer.
      // Other control chars -- ignore.
    },
    [updateSuggestions, requestHistoryRefresh, setStateSync],
  );

  // -----------------------------------------------------------------
  // Suggestion navigation
  // -----------------------------------------------------------------

  /** Navigate suggestions up/down. */
  const navigateSuggestions = useCallback((direction: 'up' | 'down') => {
    if (!isOpenRef.current || suggestionsRef.current.length === 0) return;

    const len = suggestionsRef.current.length;
    const cur = selectedIndexRef.current;
    let newIndex: number;
    if (direction === 'up') {
      newIndex = cur <= 0 ? len - 1 : cur - 1;
    } else {
      newIndex = cur >= len - 1 ? 0 : cur + 1;
    }

    // Update ref synchronously first, then schedule React re-render.
    selectedIndexRef.current = newIndex;
    setState((s) => ({ ...s, selectedIndex: newIndex }));
  }, []);

  /** Select the currently highlighted suggestion. Returns the command string or null. */
  const selectSuggestion = useCallback((): string | null => {
    const idx = selectedIndexRef.current;
    const suggestions = suggestionsRef.current;
    if (!isOpenRef.current || idx < 0 || idx >= suggestions.length) {
      return null;
    }

    const selected = suggestions[idx];
    inputBuffer.current = selected;
    setStateSync({ suggestions: [], isOpen: false, selectedIndex: -1 });
    return selected;
  }, [setStateSync]);

  /** Close the suggestions dropdown. */
  const closeSuggestions = useCallback(() => {
    if (isOpenRef.current) {
      setStateSync({ ...state, isOpen: false, selectedIndex: -1 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStateSync]);

  /** Force a re-fetch of remote history (e.g. on reconnect). */
  const refreshHistory = useCallback(() => {
    fetchRemoteHistory();
  }, [fetchRemoteHistory]);

  // -----------------------------------------------------------------
  // Synchronous state reader for the onData handler
  // -----------------------------------------------------------------

  /**
   * Returns the authoritative current state by reading directly from refs.
   * Use this in synchronous contexts (like terminal onData) where React
   * state may not yet reflect the latest navigateSuggestions() call.
   */
  const getState = useCallback(() => ({
    isOpen: isOpenRef.current,
    selectedIndex: selectedIndexRef.current,
    suggestions: suggestionsRef.current,
    inputBuffer: inputBuffer.current,
  }), []);

  return {
    /** Current input buffer content. */
    get inputBuffer() {
      return inputBuffer.current;
    },
    /** Autocomplete suggestions (for rendering -- may lag by one frame). */
    suggestions: state.suggestions,
    /** Whether the dropdown is visible (for rendering). */
    isOpen: state.isOpen,
    /** Currently highlighted index, -1 = none (for rendering). */
    selectedIndex: state.selectedIndex,
    /** Synchronous state snapshot for the onData handler. */
    getState,
    /** Process a keystroke from terminal onData. */
    processKeystroke,
    /** Navigate up/down. */
    navigateSuggestions,
    /** Select the highlighted suggestion. Returns the command or null. */
    selectSuggestion,
    /** Close the dropdown. */
    closeSuggestions,
    /** Force a remote history refresh. */
    refreshHistory,
  };
}
