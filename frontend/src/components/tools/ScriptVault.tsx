import React, { useState, useCallback } from 'react';
import {
  Code2,
  Play,
  Save,
  Trash2,
  Plus,
  ChevronDown,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  FileCode,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiPost } from '@/api/client';

interface SavedScript {
  id: string;
  name: string;
  script: string;
  interpreter: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exit_status: number;
  timed_out: boolean;
}

const PRESET_SCRIPTS: SavedScript[] = [
  {
    id: 'preset-health',
    name: 'System Health Summary',
    script: `echo "=== System Health Summary ==="
echo "--- Hostname & OS ---"
hostname; uname -srm
cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"'
echo ""
echo "--- Uptime & Load ---"
uptime
echo ""
echo "--- CPU & Memory ---"
nproc 2>/dev/null && echo "cores"
free -h 2>/dev/null || vm_stat 2>/dev/null
echo ""
echo "--- Disk Usage ---"
df -hT 2>/dev/null | grep -v tmpfs | grep -v devtmpfs
echo ""
echo "--- Top 5 CPU Processes ---"
ps aux --sort=-pcpu 2>/dev/null | head -6
echo ""
echo "--- Top 5 Memory Processes ---"
ps aux --sort=-rss 2>/dev/null | head -6`,
    interpreter: 'bash',
  },
  {
    id: 'preset-disk',
    name: 'Disk Usage Report',
    script: `echo "=== Filesystem Usage ==="
df -hT 2>/dev/null | grep -v tmpfs | grep -v devtmpfs
echo ""
echo "=== Top 15 Directories by Size ==="
du -h --max-depth=1 / 2>/dev/null | sort -rh | head -15
echo ""
echo "=== Inode Usage ==="
df -i 2>/dev/null | grep -v tmpfs`,
    interpreter: 'bash',
  },
  {
    id: 'preset-ports',
    name: 'Listening Ports',
    script: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null',
    interpreter: 'bash',
  },
  {
    id: 'preset-large-files',
    name: 'Large Files (>100MB)',
    script: 'find /home /var /tmp -type f -size +100M -exec ls -lh {} \\; 2>/dev/null | sort -k5 -rh | head -20',
    interpreter: 'bash',
  },
  {
    id: 'preset-failed-logins',
    name: 'Recent Failed Logins',
    script: 'lastb 2>/dev/null | head -20 || grep "Failed password" /var/log/auth.log 2>/dev/null | tail -20 || journalctl _SYSTEMD_UNIT=sshd.service --no-pager -n 20 --grep="Failed" 2>/dev/null',
    interpreter: 'bash',
  },
  {
    id: 'preset-security',
    name: 'Security Quick Audit',
    script: `echo "=== Security Quick Audit ==="
echo "--- Users with UID 0 ---"
awk -F: '\$3==0{print \$1}' /etc/passwd
echo ""
echo "--- Passwordless accounts ---"
awk -F: '(\$2=="" || \$2=="!"){print \$1}' /etc/shadow 2>/dev/null
echo ""
echo "--- SSH config highlights ---"
grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port)" /etc/ssh/sshd_config 2>/dev/null
echo ""
echo "--- World-writable files in /etc ---"
find /etc -perm -o+w -type f 2>/dev/null | head -20
echo ""
echo "--- SUID binaries ---"
find /usr -perm -4000 -type f 2>/dev/null | head -20`,
    interpreter: 'bash',
  },
  {
    id: 'preset-docker',
    name: 'Docker Status Overview',
    script: `if command -v docker >/dev/null 2>&1; then
  echo "=== Docker Status ==="
  docker info 2>/dev/null | head -20
  echo ""
  echo "=== Running Containers ==="
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
  echo ""
  echo "=== Disk Usage ==="
  docker system df 2>/dev/null
else
  echo "Docker is not installed"
fi`,
    interpreter: 'bash',
  },
  {
    id: 'preset-ssl',
    name: 'SSL Certificate Check',
    script: `echo "=== SSL Certificates ==="
for cert in /etc/ssl/certs/*.pem /etc/letsencrypt/live/*/cert.pem; do
  [ -f "$cert" ] || continue
  subject=$(openssl x509 -in "$cert" -noout -subject 2>/dev/null | sed 's/subject=//')
  expiry=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
  [ -n "$subject" ] && printf "%-50s  Expires: %s\\n" "$subject" "$expiry"
done 2>/dev/null | head -20
echo ""
echo "(Only showing local certificates. Use openssl s_client for remote checks)"`,
    interpreter: 'bash',
  },
  {
    id: 'preset-zombies',
    name: 'Zombie & Orphan Processes',
    script: `echo "=== Zombie Processes ==="
ps aux 2>/dev/null | awk '\$8 ~ /Z/ {print}' || echo "None found"
echo ""
echo "=== Processes with PPID=1 (orphans adopted by init) ==="
ps -eo pid,ppid,stat,args 2>/dev/null | awk '\$2==1 && \$3!~/Ss?/' | head -20`,
    interpreter: 'bash',
  },
  {
    id: 'preset-failed-units',
    name: 'Systemd Failed Units',
    script: `echo "=== Failed Units ==="
systemctl --failed --no-pager 2>/dev/null || echo "systemctl not available"
echo ""
echo "=== Recent Critical Journal Entries ==="
journalctl -p crit --since "24 hours ago" --no-pager -n 20 2>/dev/null || echo "journalctl not available"`,
    interpreter: 'bash',
  },
  {
    id: 'preset-reboots',
    name: 'Last Reboots & Kernel',
    script: `echo "=== Kernel Info ==="
uname -a
echo ""
echo "=== Last 10 Reboots ==="
last reboot 2>/dev/null | head -10
echo ""
echo "=== Installed Kernels ==="
if command -v rpm >/dev/null 2>&1; then
  rpm -qa kernel 2>/dev/null
elif command -v dpkg >/dev/null 2>&1; then
  dpkg -l 'linux-image-*' 2>/dev/null | grep '^ii'
fi`,
    interpreter: 'bash',
  },
  {
    id: 'preset-dns',
    name: 'DNS Configuration',
    script: 'cat /etc/resolv.conf 2>/dev/null && echo "---" && cat /etc/hosts',
    interpreter: 'bash',
  },
  {
    id: 'preset-memory',
    name: 'Memory Details',
    script: 'free -h && echo "---" && cat /proc/meminfo | head -20',
    interpreter: 'bash',
  },
  {
    id: 'preset-network',
    name: 'Network Interfaces',
    script: 'ip addr show 2>/dev/null || ifconfig 2>/dev/null',
    interpreter: 'bash',
  },
  {
    id: 'preset-crontab',
    name: 'Current User Crontab',
    script: 'crontab -l 2>/dev/null || echo "No crontab for current user"',
    interpreter: 'bash',
  },
];

const STORAGE_KEY = 'nexterm_saved_scripts';

function loadSavedScripts(): SavedScript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedScripts(scripts: SavedScript[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
}

interface Props {
  connectionId: string;
}

export const ScriptVault: React.FC<Props> = ({ connectionId }) => {
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>(loadSavedScripts);
  const [activeScript, setActiveScript] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [interpreter, setInterpreter] = useState('bash');
  const [timeout, setScriptTimeout] = useState(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');

  const handleRun = useCallback(async () => {
    if (!activeScript.trim()) return;
    setRunning(true);
    setResult(null);
    setError('');

    try {
      const data = await apiPost(`/api/tools/${connectionId}/scripts/run`, {
        script: activeScript,
        interpreter,
        timeout,
      });
      setResult(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Script execution failed';
      setError(message);
    } finally {
      setRunning(false);
    }
  }, [connectionId, activeScript, interpreter, timeout]);

  const handleSave = () => {
    if (!scriptName.trim() || !activeScript.trim()) return;
    const newScript: SavedScript = {
      id: `custom-${Date.now()}`,
      name: scriptName,
      script: activeScript,
      interpreter,
    };
    const updated = [...savedScripts, newScript];
    setSavedScripts(updated);
    saveSavedScripts(updated);
    setScriptName('');
  };

  const handleDelete = (id: string) => {
    const updated = savedScripts.filter((s) => s.id !== id);
    setSavedScripts(updated);
    saveSavedScripts(updated);
  };

  const handleLoad = (script: SavedScript) => {
    setActiveScript(script.script);
    setInterpreter(script.interpreter);
    setScriptName(script.name);
  };

  return (
    <ToolModal title="Script Vault" icon={<Code2 size={18} />}>
      <div className="flex gap-4 h-[calc(80vh-120px)]">
        {/* Left: script list */}
        <div className="w-56 shrink-0 flex flex-col border-r border-[var(--border)] pr-4">
          {/* Preset scripts */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Presets
            </div>
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {PRESET_SCRIPTS.map((script) => (
                <button
                  key={script.id}
                  onClick={() => handleLoad(script)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <FileCode size={12} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="truncate">{script.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Saved scripts */}
          <div className="flex-1 min-h-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Saved Scripts
            </div>
            <div className="space-y-0.5 overflow-y-auto max-h-[300px]">
              {savedScripts.map((script) => (
                <div
                  key={script.id}
                  className="flex items-center gap-1 group"
                >
                  <button
                    onClick={() => handleLoad(script)}
                    className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <Code2 size={12} className="shrink-0 text-[var(--accent)]" />
                    <span className="truncate">{script.name}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(script.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-all"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              {savedScripts.length === 0 && (
                <div className="px-2 py-3 text-[10px] text-[var(--text-muted)] text-center">
                  No saved scripts yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: editor + output */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor toolbar */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <input
              type="text"
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="Script name..."
              className="flex-1 min-w-[120px] px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />

            <div className="relative">
              <select
                value={interpreter}
                onChange={(e) => setInterpreter(e.target.value)}
                className="appearance-none pl-2 pr-6 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="bash">Bash</option>
                <option value="sh">Shell</option>
                <option value="python3">Python 3</option>
                <option value="python">Python</option>
                <option value="perl">Perl</option>
                <option value="node">Node.js</option>
              </select>
              <ChevronDown
                size={10}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
            </div>

            <div className="flex items-center gap-1">
              <Clock size={10} className="text-[var(--text-muted)]" />
              <input
                type="number"
                value={timeout}
                onChange={(e) => setScriptTimeout(Math.max(1, Math.min(300, Number(e.target.value))))}
                className="w-12 px-1 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] text-center focus:outline-none"
                min={1}
                max={300}
              />
              <span className="text-[10px] text-[var(--text-muted)]">sec</span>
            </div>

            <button
              onClick={handleSave}
              disabled={!scriptName.trim() || !activeScript.trim()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
              title="Save script"
            >
              <Save size={12} />
              Save
            </button>

            <button
              onClick={handleRun}
              disabled={running || !activeScript.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running ? 'Running...' : 'Run'}
            </button>
          </div>

          {/* Script editor */}
          <textarea
            value={activeScript}
            onChange={(e) => setActiveScript(e.target.value)}
            placeholder="# Enter your script here..."
            className="flex-1 min-h-[150px] p-3 rounded-t bg-[#0d1117] border border-[var(--border)] border-b-0 font-mono text-xs text-[#d4d4d8] placeholder:text-gray-600 resize-none focus:outline-none"
            spellCheck={false}
            onKeyDown={(e) => {
              // Ctrl+Enter to run
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleRun();
              }
              // Tab inserts spaces
              if (e.key === 'Tab') {
                e.preventDefault();
                const target = e.target as HTMLTextAreaElement;
                const start = target.selectionStart;
                const end = target.selectionEnd;
                const newVal = activeScript.substring(0, start) + '  ' + activeScript.substring(end);
                setActiveScript(newVal);
                setTimeout(() => {
                  target.selectionStart = target.selectionEnd = start + 2;
                }, 0);
              }
            }}
          />

          {/* Output */}
          <div className="flex-1 min-h-[100px] rounded-b border border-[var(--border)] bg-[#0d1117] overflow-auto">
            {error && (
              <div className="px-3 py-2 text-xs text-[var(--danger)] bg-[var(--danger)]/5">
                {error}
              </div>
            )}

            {result && (
              <div className="text-xs">
                {/* Status bar */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]/50 bg-[var(--bg-secondary)]">
                  {result.timed_out ? (
                    <span className="flex items-center gap-1 text-[var(--danger)]">
                      <Clock size={11} />
                      Timed out
                    </span>
                  ) : result.exit_status === 0 ? (
                    <span className="flex items-center gap-1" style={{ color: 'var(--success)' }}>
                      <CheckCircle size={11} />
                      Exit: 0
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--danger)]">
                      <XCircle size={11} />
                      Exit: {result.exit_status}
                    </span>
                  )}
                </div>

                {/* Stdout */}
                {result.stdout && (
                  <pre className="px-3 py-2 font-mono text-[11px] text-[#d4d4d8] whitespace-pre-wrap break-all">
                    {result.stdout}
                  </pre>
                )}

                {/* Stderr */}
                {result.stderr && (
                  <pre className="px-3 py-2 font-mono text-[11px] text-[#f87171] whitespace-pre-wrap break-all border-t border-[var(--border)]/30">
                    {result.stderr}
                  </pre>
                )}

                {!result.stdout && !result.stderr && !result.timed_out && (
                  <div className="px-3 py-4 text-center text-gray-500">
                    No output
                  </div>
                )}
              </div>
            )}

            {!result && !error && (
              <div className="px-3 py-8 text-center text-gray-600 text-xs">
                Output will appear here. Press Ctrl+Enter to run.
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolModal>
  );
};
