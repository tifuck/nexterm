import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  FileText,
  Search,
  X,
  Play,
  Pause,
  Sparkles,
  AlertTriangle,
  AlertOctagon,
  Info,
  RefreshCw,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost, getWsUrl, ensureFreshToken, sendWsAuth } from '@/api/client';
import { useAIStore } from '@/store/aiStore';

interface LogEntry {
  timestamp: string;
  unit: string;
  priority: string;
  message: string;
}

interface Props {
  connectionId: string;
}

export const LogViewer: React.FC<Props> = ({ connectionId }) => {
  const logAnalysisEnabled = useAIStore((s) => s.isFeatureUsable('log_analysis'));
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [availableUnits, setAvailableUnits] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [searchPattern, setSearchPattern] = useState('');
  const [lineCount, setLineCount] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tailing, setTailing] = useState(false);
  const [tailLines, setTailLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);

  // AI analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    summary: string;
    error_count: number;
    warning_count: number;
    insights: string[];
  } | null>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedUnit) params.set('unit', selectedUnit);
      if (searchPattern) params.set('pattern', searchPattern);
      params.set('lines', String(lineCount));

      const data = await apiGet(`/api/tools/${connectionId}/logs?${params}`);
      setEntries(data.entries || []);
      if (data.available_units?.length > 0) {
        setAvailableUnits(data.available_units);
      }
      setError('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch logs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connectionId, selectedUnit, searchPattern, lineCount]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [entries, tailLines, autoScroll]);

  // Live tailing via WebSocket
  const startTailing = useCallback(async () => {
    await ensureFreshToken();
    const wsUrl = getWsUrl('/ws/tools');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      sendWsAuth(ws);
      ws.send(
        JSON.stringify({
          type: 'start_log_tail',
          connection_id: connectionId,
          unit: selectedUnit,
          pattern: searchPattern,
          lines: 50,
        })
      );
      setTailing(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log_batch' && msg.lines) {
          setTailLines((prev) => [...prev, ...msg.lines].slice(-2000));
        } else if (msg.type === 'log_line' && msg.data) {
          setTailLines((prev) => [...prev, msg.data].slice(-2000));
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setTailing(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setTailing(false);
    };
  }, [connectionId, selectedUnit, searchPattern]);

  const stopTailing = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop_log_tail' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setTailing(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleAnalyze = async () => {
    // Collect visible log text
    let logText = '';
    if (tailing && tailLines.length > 0) {
      logText = tailLines.slice(-200).join('\n');
    } else {
      logText = entries
        .slice(-200)
        .map((e) => `${e.timestamp} ${e.unit} ${e.message}`)
        .join('\n');
    }

    if (!logText.trim()) {
      setError('No log content to analyze');
      return;
    }

    setAnalyzing(true);
    try {
      const data = await apiPost(`/api/tools/${connectionId}/logs/analyze`, {
        log_text: logText,
        context: selectedUnit ? `Service: ${selectedUnit}` : '',
      });
      setAnalysis(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
    } finally {
      setAnalyzing(false);
    }
  };

  // Count errors/warnings in current view
  const errorCount = entries.filter(
    (e) => e.priority === '3' || e.priority === '2' || e.priority === '1' || e.priority === '0'
  ).length;
  const warningCount = entries.filter((e) => e.priority === '4').length;

  return (
    <ToolModal title="Log Viewer" icon={<FileText size={18} />}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Unit selector */}
        <div className="relative">
          <select
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value);
              setTailLines([]);
            }}
            className="appearance-none pl-2 pr-6 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] min-w-[150px]"
          >
            <option value="">All units</option>
            {availableUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[150px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchPattern}
            onChange={(e) => setSearchPattern(e.target.value)}
            placeholder="Filter pattern..."
            className="w-full pl-8 pr-8 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchLogs();
            }}
          />
          {searchPattern && (
            <button
              onClick={() => setSearchPattern('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Actions */}
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={tailing ? stopTailing : startTailing}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors ${
            tailing
              ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
              : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {tailing ? <Pause size={12} /> : <Play size={12} />}
          {tailing ? 'Stop' : 'Tail'}
        </button>

        {logAnalysisEnabled && (
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-50"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            AI Analyze
          </button>
        )}

        {/* Counters */}
        <div className="flex items-center gap-2 ml-auto text-[10px]">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-[var(--danger)]">
              <AlertOctagon size={10} />
              {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: 'var(--warning, #f59e0b)' }}>
              <AlertTriangle size={10} />
              {warningCount}
            </span>
          )}
          <span className="text-[var(--text-muted)]">
            {tailing ? tailLines.length : entries.length} lines
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 text-[var(--danger)] text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* AI Analysis panel */}
      {analysis && (
        <div className="mb-3 p-3 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">AI Analysis</span>
            <button
              onClick={() => setAnalysis(null)}
              className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-2">{analysis.summary}</p>
          <div className="flex gap-3 mb-2 text-[10px]">
            <span className="text-[var(--danger)]">Errors: {analysis.error_count}</span>
            <span style={{ color: 'var(--warning, #f59e0b)' }}>Warnings: {analysis.warning_count}</span>
          </div>
          {analysis.insights.length > 0 && (
            <ul className="space-y-1">
              {analysis.insights.map((insight, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <Info size={10} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  {insight}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Log output */}
      <div
        ref={logContainerRef}
        className="overflow-auto rounded border border-[var(--border)] bg-[#0d1117] font-mono text-[11px] leading-relaxed"
        style={{ maxHeight: 'calc(80vh - 280px)', minHeight: '200px' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(atBottom);
        }}
      >
        {/* Static log entries */}
        {!tailing &&
          entries.map((entry, i) => (
            <LogLine key={i} entry={entry} />
          ))}

        {/* Tailing lines */}
        {tailing &&
          tailLines.map((line, i) => (
            <div
              key={i}
              className="px-3 py-0.5 hover:bg-white/5 whitespace-pre-wrap break-all"
              style={{
                color: getLineColor(line),
              }}
            >
              {line}
            </div>
          ))}

        {!tailing && entries.length === 0 && !loading && (
          <div className="px-3 py-8 text-center text-gray-500">No log entries found</div>
        )}
        {loading && (
          <div className="px-3 py-8 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading logs...
          </div>
        )}
      </div>
    </ToolModal>
  );
};

/* ---- Helpers ---- */

const LogLine: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const priorityColor = getPriorityColor(entry.priority);
  return (
    <div
      className="px-3 py-0.5 hover:bg-white/5 flex gap-2 whitespace-pre-wrap break-all"
      style={{ color: priorityColor }}
    >
      {entry.timestamp && (
        <span className="text-gray-500 shrink-0 tabular-nums">{entry.timestamp}</span>
      )}
      {entry.unit && (
        <span className="text-blue-400 shrink-0 max-w-[180px] truncate">{entry.unit}</span>
      )}
      <span className="flex-1">{entry.message}</span>
    </div>
  );
};

function getPriorityColor(priority: string): string {
  switch (priority) {
    case '0':
    case '1':
    case '2':
      return '#f87171'; // emergency, alert, critical -> red
    case '3':
      return '#fb923c'; // error -> orange
    case '4':
      return '#fbbf24'; // warning -> yellow
    case '5':
      return '#a3a3a3'; // notice -> gray
    case '6':
      return '#d4d4d8'; // info -> light gray
    case '7':
      return '#737373'; // debug -> dim
    default:
      return '#d4d4d8';
  }
}

function getLineColor(line: string): string {
  const lower = line.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('fatal') ||
    lower.includes('fail') ||
    lower.includes('crit')
  )
    return '#f87171';
  if (lower.includes('warn')) return '#fbbf24';
  if (lower.includes('debug')) return '#737373';
  return '#d4d4d8';
}
