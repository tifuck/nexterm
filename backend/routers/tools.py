"""Server tools REST API for remote server management."""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.services.ssh_proxy import ssh_proxy
from backend.schemas.tools import (
    ProcessListResponse,
    ProcessInfo,
    KillRequest,
    ServiceListResponse,
    ServiceInfo,
    ServiceActionRequest,
    SystemInfoResponse,
    LogResponse,
    LogEntry,
    LogAnalyzeRequest,
    LogAnalyzeResponse,
    ScriptRunRequest,
    ScriptRunResponse,
    SecurityScanResponse,
    OpenPort,
    FailedLogin,
    UserPrivilege,
    MalwareScanResponse,
    FirewallStatus,
    FirewallRule,
    FirewallRuleAdd,
    FirewallRuleDelete,
    PackageManagerInfo,
    PackageUpdatesResponse,
    PackageUpdateInfo,
    PackageSearchResult,
    PackageInfo,
    PackageActionRequest,
    DockerInfo,
    DockerContainer,
    DockerContainersResponse,
    DockerContainerAction,
    DockerImage,
    DockerImagesResponse,
    DockerLogsRequest,
    WireGuardStatusResponse,
    WireGuardInterface,
    WireGuardPeer,
    WireGuardKeyPair,
    WireGuardCreateConfig,
    WireGuardAddPeer,
    WireGuardRemovePeer,
    CronJob,
    CronListResponse,
    CronJobAdd,
    CronJobDelete,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools", tags=["tools"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _verify_connection(connection_id: str, current_user: User):
    """Verify the connection exists and belongs to the current user."""
    conn = await ssh_proxy.get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


def _sanitize_shell(value: str) -> str:
    """Sanitize a string for safe use in shell commands.

    Strips backticks, $() subshell syntax, newlines, and other
    dangerous characters to prevent command injection.
    """
    import re
    # Remove backticks, $(...), newlines, carriage returns, null bytes
    value = value.replace("`", "").replace("\n", " ").replace("\r", "").replace("\0", "")
    value = re.sub(r"\$\(", "(", value)
    value = re.sub(r"\$\{", "{", value)
    # Also strip semicolons, pipes, ampersands for extra safety
    value = value.replace(";", "").replace("|", "").replace("&", "")
    # Strip single/double quotes
    value = value.replace('"', "").replace("'", "")
    return value.strip()


async def _run(connection_id: str, command: str, timeout: int = 10) -> dict:
    """Run a command and return result, raising on error."""
    result = await ssh_proxy.run_command(connection_id, command, timeout=timeout)
    if "error" in result and result["error"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# ---------------------------------------------------------------------------
# System info
# ---------------------------------------------------------------------------

SYSTEM_INFO_SCRIPT = r"""
sh -c '
OS=$(uname -s)
hostname=$(hostname 2>/dev/null || echo "unknown")
kernel=$(uname -r 2>/dev/null || echo "unknown")
arch=$(uname -m 2>/dev/null || echo "unknown")
os_name="Unknown"
os_version=""

case "$OS" in
Linux)
  if [ -f /etc/os-release ]; then
    while IFS="=" read key val; do
      case "$key" in
        PRETTY_NAME) os_name=$(echo "$val" | tr -d "\"") ;;
        VERSION_ID) os_version=$(echo "$val" | tr -d "\"") ;;
      esac
    done < /etc/os-release
  fi
  ;;
Darwin)
  os_name="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
  ;;
*)
  os_name=$(uname -sr)
  ;;
esac

# CPU info
cpu_model=""
cpu_cores=0
cpu_threads=0
if [ -f /proc/cpuinfo ]; then
  cpu_model=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed "s/^ //")
  cpu_cores=$(grep -c "^processor" /proc/cpuinfo 2>/dev/null || echo 0)
  cpu_threads=$cpu_cores
  phys=$(grep "^core id" /proc/cpuinfo 2>/dev/null | sort -u | wc -l)
  [ "$phys" -gt 0 ] 2>/dev/null && cpu_cores=$phys
elif [ "$OS" = "Darwin" ]; then
  cpu_model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
  cpu_cores=$(sysctl -n hw.physicalcpu 2>/dev/null || echo 0)
  cpu_threads=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 0)
fi

# Memory
mem_total=""
if [ -f /proc/meminfo ]; then
  mt=$(grep "^MemTotal:" /proc/meminfo | awk "{print \$2}")
  mem_total="${mt} kB"
elif [ "$OS" = "Darwin" ]; then
  mb=$(sysctl -n hw.memsize 2>/dev/null)
  mem_total="${mb} B"
fi

# Uptime
uptime_s=0
if [ -f /proc/uptime ]; then
  read upt _ < /proc/uptime
  uptime_s=${upt%%.*}
elif [ "$OS" = "Darwin" ]; then
  boot_sec=$(sysctl -n kern.boottime 2>/dev/null | awk -F"[ ,=]+" "{print \$4}")
  now=$(date +%s)
  uptime_s=$((now-boot_sec))
fi

# Format uptime
days=$((uptime_s/86400))
hours=$(( (uptime_s%86400)/3600 ))
mins=$(( (uptime_s%3600)/60 ))
if [ "$days" -gt 0 ]; then
  uptime_fmt="${days}d ${hours}h ${mins}m"
else
  uptime_fmt="${hours}h ${mins}m"
fi

# GPU
gpu_info=""
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_info=$(nvidia-smi --query-gpu=name,temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
fi

# Escape strings for JSON (backslashes first, then quotes, then control chars)
_json_esc() { printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g'; }
hn_esc=$(_json_esc "$hostname")
km_esc=$(_json_esc "$kernel")
on_esc=$(_json_esc "$os_name")
ov_esc=$(_json_esc "$os_version")
cm_esc=$(_json_esc "$cpu_model")
mt_esc=$(_json_esc "$mem_total")
uf_esc=$(_json_esc "$uptime_fmt")
gi_esc=$(_json_esc "$gpu_info")

printf "{\"hostname\":\"%s\",\"kernel\":\"%s\",\"os_name\":\"%s\",\"os_version\":\"%s\",\"architecture\":\"%s\",\"cpu_model\":\"%s\",\"cpu_cores\":%s,\"cpu_threads\":%s,\"total_memory\":\"%s\",\"uptime\":\"%s\",\"uptime_seconds\":%s,\"gpu_info\":\"%s\"}\n" \
  "$hn_esc" "$km_esc" "$on_esc" "$ov_esc" "$arch" "$cm_esc" "${cpu_cores:-0}" "${cpu_threads:-0}" "$mt_esc" "$uf_esc" "${uptime_s:-0}" "$gi_esc"
' 2>/dev/null || echo '{"error":"failed to collect system info"}'
"""

BLOCK_DEVICES_SCRIPT = r"""
lsblk -Jbo NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL 2>/dev/null || echo '{"blockdevices":[]}'
"""


@router.get("/{connection_id}/system-info", response_model=SystemInfoResponse)
async def get_system_info(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get system hardware, kernel, and OS info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, SYSTEM_INFO_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()
    if not stdout:
        raise HTTPException(status_code=500, detail="Empty response from server")

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse system info")

    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])

    # Get block devices separately
    try:
        blk_result = await _run(connection_id, BLOCK_DEVICES_SCRIPT, timeout=5)
        blk_stdout = blk_result.get("stdout", "").strip()
        if blk_stdout:
            blk_data = json.loads(blk_stdout)
            data["block_devices"] = blk_data.get("blockdevices", [])
    except Exception:
        data["block_devices"] = []

    return SystemInfoResponse(**data)


# ---------------------------------------------------------------------------
# Processes
# ---------------------------------------------------------------------------

PROCESSES_SCRIPT = r"""
ps aux --sort=-pcpu 2>/dev/null | head -200 | awk 'NR>1 {
  cmd=""; for(i=11;i<=NF;i++){cmd=cmd (i>11?" ":"") $i}
  gsub(/\\/, "\\\\", cmd)
  gsub(/"/, "\\\"", cmd)
  gsub(/\t/, " ", cmd)
  gsub(/\r/, "", cmd)
  printf "{\"pid\":%s,\"user\":\"%s\",\"cpu_percent\":%s,\"mem_percent\":%s,\"vsz\":%s,\"rss\":%s,\"tty\":\"%s\",\"stat\":\"%s\",\"start\":\"%s\",\"time\":\"%s\",\"command\":\"%s\"}\n",$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,cmd
}'
"""


@router.get("/{connection_id}/processes", response_model=ProcessListResponse)
async def list_processes(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List running processes sorted by CPU usage."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, PROCESSES_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    processes = []
    if stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                proc = json.loads(line)
                processes.append(ProcessInfo(**proc))
            except (json.JSONDecodeError, Exception):
                continue

    return ProcessListResponse(processes=processes, total=len(processes))


@router.post("/{connection_id}/processes/{pid}/kill")
async def kill_process(
    connection_id: str,
    pid: int,
    request: KillRequest,
    current_user: User = Depends(get_current_user),
):
    """Send a signal to a process."""
    await _verify_connection(connection_id, current_user)

    cmd = f"kill -{request.signal} {pid} 2>&1; echo $?"
    result = await _run(connection_id, cmd, timeout=5)
    stdout = result.get("stdout", "").strip()
    lines = stdout.split("\n")
    exit_code = lines[-1].strip() if lines else "1"

    if exit_code != "0":
        error_msg = "\n".join(lines[:-1]) if len(lines) > 1 else f"Failed to kill process {pid}"
        raise HTTPException(status_code=400, detail=error_msg)

    return {"message": f"Signal {request.signal} sent to process {pid}"}


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

SERVICES_SCRIPT = r"""
if command -v systemctl >/dev/null 2>&1; then
  echo "INIT:systemd"
  systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null | awk '{
    name=$1; load=$2; active=$3; sub=$4
    desc=""
    for(i=5;i<=NF;i++){desc=desc (i>5?" ":"") $i}
    gsub(/\\/, "\\\\", desc)
    gsub(/"/, "\\\"", desc)
    printf "{\"name\":\"%s\",\"load_state\":\"%s\",\"active_state\":\"%s\",\"sub_state\":\"%s\",\"description\":\"%s\"}\n", name, load, active, sub, desc
  }'
elif command -v service >/dev/null 2>&1; then
  echo "INIT:sysvinit"
  service --status-all 2>/dev/null | while read -r bracket status bracket2 name; do
    if [ "$status" = "+" ]; then
      active="active"; sub="running"
    elif [ "$status" = "-" ]; then
      active="inactive"; sub="dead"
    else
      active="unknown"; sub="unknown"
    fi
    printf '{"name":"%s.service","load_state":"loaded","active_state":"%s","sub_state":"%s","description":""}\n' \
      "$name" "$active" "$sub"
  done
else
  echo "INIT:unknown"
fi
"""


@router.get("/{connection_id}/services", response_model=ServiceListResponse)
async def list_services(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List system services."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, SERVICES_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    services = []
    init_system = "unknown"

    if stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.startswith("INIT:"):
                init_system = line[5:]
                continue
            try:
                svc = json.loads(line)
                services.append(ServiceInfo(**svc))
            except (json.JSONDecodeError, Exception):
                continue

    return ServiceListResponse(services=services, init_system=init_system)


@router.post("/{connection_id}/services/{service_name}/{action}")
async def service_action(
    connection_id: str,
    service_name: str,
    action: str,
    current_user: User = Depends(get_current_user),
):
    """Perform an action on a service (start/stop/restart/enable/disable/reload)."""
    await _verify_connection(connection_id, current_user)

    valid_actions = {"start", "stop", "restart", "enable", "disable", "reload"}
    if action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")

    # Sanitize service name
    if not service_name.replace(".", "").replace("-", "").replace("_", "").replace("@", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid service name")

    cmd = f"sudo systemctl {action} {service_name} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()

    lines = stdout.split("\n")
    exit_line = ""
    output_lines = []
    for line in lines:
        if line.startswith("EXIT:"):
            exit_line = line
        else:
            output_lines.append(line)

    exit_code = exit_line.replace("EXIT:", "").strip() if exit_line else "1"

    if exit_code != "0":
        error_msg = "\n".join(output_lines) or f"Failed to {action} {service_name}"
        raise HTTPException(status_code=400, detail=error_msg)

    return {"message": f"Service {service_name} {action} successful"}


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

AVAILABLE_UNITS_SCRIPT = r"""
journalctl --field=_SYSTEMD_UNIT 2>/dev/null | head -100 || echo ""
"""


@router.get("/{connection_id}/logs", response_model=LogResponse)
async def get_logs(
    connection_id: str,
    unit: str = Query(default="", description="Systemd unit to filter by"),
    lines: int = Query(default=100, ge=1, le=5000, description="Number of lines"),
    pattern: str = Query(default="", description="Grep pattern for filtering"),
    priority: str = Query(default="", description="Priority level (emerg,alert,crit,err,warning,notice,info,debug)"),
    since: str = Query(default="", description="Show logs since (e.g. '1 hour ago', '2024-01-01')"),
    current_user: User = Depends(get_current_user),
):
    """Query system logs via journalctl."""
    await _verify_connection(connection_id, current_user)

    # Build journalctl command
    cmd_parts = ["journalctl", "--no-pager", "-o", "json", f"-n {lines}"]
    if unit:
        safe_unit = _sanitize_shell(unit)
        cmd_parts.append(f'-u "{safe_unit}"')
    if priority:
        safe_priority = _sanitize_shell(priority)
        cmd_parts.append(f"-p {safe_priority}")
    if since:
        safe_since = _sanitize_shell(since)
        cmd_parts.append(f'--since "{safe_since}"')
    if pattern:
        safe_pattern = _sanitize_shell(pattern)
        cmd_parts.append(f'--grep="{safe_pattern}"')

    cmd = " ".join(cmd_parts) + " 2>/dev/null"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()

    entries = []
    if stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                ts = raw.get("__REALTIME_TIMESTAMP", "")
                if ts:
                    # Convert microseconds to readable timestamp
                    try:
                        from datetime import datetime, timezone
                        ts_sec = int(ts) / 1_000_000
                        dt = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
                        ts = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except (ValueError, OSError):
                        pass
                entries.append(LogEntry(
                    timestamp=str(ts),
                    unit=raw.get("_SYSTEMD_UNIT", raw.get("SYSLOG_IDENTIFIER", "")),
                    priority=str(raw.get("PRIORITY", "")),
                    message=raw.get("MESSAGE", ""),
                ))
            except json.JSONDecodeError:
                # Non-JSON line, treat as plain text
                entries.append(LogEntry(message=line))

    # Get available units
    available_units: list[str] = []
    try:
        units_result = await _run(connection_id, AVAILABLE_UNITS_SCRIPT, timeout=5)
        units_stdout = units_result.get("stdout", "").strip()
        if units_stdout:
            available_units = [u.strip() for u in units_stdout.split("\n") if u.strip()]
    except Exception:
        pass

    return LogResponse(entries=entries, total=len(entries), available_units=available_units)


@router.post("/{connection_id}/logs/analyze", response_model=LogAnalyzeResponse)
async def analyze_logs(
    connection_id: str,
    request: LogAnalyzeRequest,
    current_user: User = Depends(get_current_user),
):
    """Analyze logs using AI for insights."""
    await _verify_connection(connection_id, current_user)

    # Count errors and warnings in the log text
    log_text = request.log_text
    error_count = 0
    warning_count = 0
    for line in log_text.split("\n"):
        lower = line.lower()
        if any(w in lower for w in ["error", "fail", "fatal", "crit", "panic"]):
            error_count += 1
        if any(w in lower for w in ["warn", "warning", "deprecated"]):
            warning_count += 1

    # Try AI analysis
    try:
        from backend.routers.ai import get_ai_client, call_ai

        settings = await get_ai_client(current_user)

        system_prompt = """You are a Linux system administrator analyzing server logs. Provide:
1. A concise summary of what's happening in these logs (2-3 sentences)
2. Key insights as a JSON array of strings

Respond in this exact JSON format:
{"summary": "...", "insights": ["insight 1", "insight 2", ...]}

Focus on:
- Root causes of errors
- Patterns or recurring issues
- Security concerns
- Performance implications
- Recommended actions"""

        user_prompt = f"Analyze these server logs:\n\n```\n{log_text[:10000]}\n```"
        if request.context:
            user_prompt += f"\n\nAdditional context: {request.context}"

        ai_response = await call_ai(settings, system_prompt, user_prompt)

        # Try to parse structured response
        try:
            ai_data = json.loads(ai_response)
            return LogAnalyzeResponse(
                summary=ai_data.get("summary", ai_response),
                error_count=error_count,
                warning_count=warning_count,
                insights=ai_data.get("insights", []),
            )
        except json.JSONDecodeError:
            return LogAnalyzeResponse(
                summary=ai_response,
                error_count=error_count,
                warning_count=warning_count,
                insights=[],
            )
    except HTTPException:
        # AI not configured; return basic analysis
        return LogAnalyzeResponse(
            summary=f"Found {error_count} error(s) and {warning_count} warning(s) in {len(log_text.split(chr(10)))} log lines. Configure AI in Settings for deeper analysis.",
            error_count=error_count,
            warning_count=warning_count,
            insights=[],
        )
    except Exception as e:
        logger.error(f"AI log analysis error: {e}")
        return LogAnalyzeResponse(
            summary=f"AI analysis failed: {str(e)}. Found {error_count} error(s) and {warning_count} warning(s).",
            error_count=error_count,
            warning_count=warning_count,
            insights=[],
        )


# ---------------------------------------------------------------------------
# Script execution
# ---------------------------------------------------------------------------

@router.post("/{connection_id}/scripts/run", response_model=ScriptRunResponse)
async def run_script(
    connection_id: str,
    request: ScriptRunRequest,
    current_user: User = Depends(get_current_user),
):
    """Execute a script on the remote server."""
    await _verify_connection(connection_id, current_user)

    # Build the command with the specified interpreter
    # Use a heredoc to pass the script content safely
    import base64
    encoded = base64.b64encode(request.script.encode()).decode()
    cmd = f'echo "{encoded}" | (base64 -d 2>/dev/null || base64 -D 2>/dev/null) | {request.interpreter}'

    try:
        result = await ssh_proxy.run_command(
            connection_id, cmd, timeout=request.timeout
        )

        if "error" in result and result["error"]:
            # Check if it's a timeout
            if "timeout" in str(result["error"]).lower():
                return ScriptRunResponse(
                    stdout="",
                    stderr=result["error"],
                    exit_status=-1,
                    timed_out=True,
                )
            return ScriptRunResponse(
                stdout="",
                stderr=result["error"],
                exit_status=-1,
            )

        return ScriptRunResponse(
            stdout=result.get("stdout", ""),
            stderr=result.get("stderr", ""),
            exit_status=result.get("exit_status", -1),
        )
    except Exception as e:
        logger.error(f"Script execution error: {e}")
        return ScriptRunResponse(
            stdout="",
            stderr=str(e),
            exit_status=-1,
        )


# ===========================================================================
# Phase 2: Security, Firewall, Packages
# ===========================================================================


# ---------------------------------------------------------------------------
# Security scan
# ---------------------------------------------------------------------------

OPEN_PORTS_SCRIPT = r"""
(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | awk 'NR>1 {
  split($4, a, ":")
  port = a[length(a)]
  addr = $4
  proto = $1
  state = $1
  pid_proc = $NF
  gsub(/"/, "\\\"", pid_proc)
  if (port ~ /^[0-9]+$/) {
    printf "{\"protocol\":\"%s\",\"local_address\":\"%s\",\"port\":%s,\"pid\":\"\",\"process\":\"%s\",\"state\":\"LISTEN\"}\n", proto, addr, port, pid_proc
  }
}'
"""

FAILED_LOGINS_SCRIPT = r"""
sh -c '
# Try journalctl first, fallback to log files
if command -v journalctl >/dev/null 2>&1; then
  journalctl _SYSTEMD_UNIT=sshd.service --no-pager -n 200 --grep="Failed|Invalid" -o short-iso 2>/dev/null | tail -50 | while IFS= read -r line; do
    date=$(echo "$line" | awk "{print \$1}")
    user=$(echo "$line" | grep -oP "(?:Failed password for( invalid user)?|Invalid user) \K\S+" || echo "unknown")
    source=$(echo "$line" | grep -oP "from \K\S+" || echo "unknown")
    printf "{\"date\":\"%s\",\"user\":\"%s\",\"source\":\"%s\",\"service\":\"sshd\"}\n" "$date" "$user" "$source"
  done
elif [ -f /var/log/auth.log ]; then
  grep -i "failed\|invalid" /var/log/auth.log 2>/dev/null | tail -50 | while IFS= read -r line; do
    date=$(echo "$line" | awk "{print \$1,\$2,\$3}")
    user=$(echo "$line" | grep -oP "(?:Failed password for( invalid user)?|Invalid user) \K\S+" || echo "unknown")
    source=$(echo "$line" | grep -oP "from \K\S+" || echo "unknown")
    printf "{\"date\":\"%s\",\"user\":\"%s\",\"source\":\"%s\",\"service\":\"sshd\"}\n" "$date" "$user" "$source"
  done
elif [ -f /var/log/secure ]; then
  grep -i "failed\|invalid" /var/log/secure 2>/dev/null | tail -50 | while IFS= read -r line; do
    date=$(echo "$line" | awk "{print \$1,\$2,\$3}")
    user=$(echo "$line" | grep -oP "(?:Failed password for( invalid user)?|Invalid user) \K\S+" || echo "unknown")
    source=$(echo "$line" | grep -oP "from \K\S+" || echo "unknown")
    printf "{\"date\":\"%s\",\"user\":\"%s\",\"source\":\"%s\",\"service\":\"sshd\"}\n" "$date" "$user" "$source"
  done
fi
' 2>/dev/null
"""

USERS_SCRIPT = r"""
sh -c '
while IFS=: read -r username pw uid gid gecos home shell; do
  # Skip system users with high UIDs or nologin shells unless UID is 0
  if [ "$uid" -ge 1000 ] || [ "$uid" -eq 0 ]; then
    groups=$(groups "$username" 2>/dev/null | cut -d: -f2 | sed "s/^ //;s/ /,/g")
    has_sudo="false"
    # Check if user is in sudo/wheel group or has sudoers entry
    echo "$groups" | grep -qwE "sudo|wheel|admin" && has_sudo="true"
    [ -f /etc/sudoers ] && grep -q "^${username} " /etc/sudoers 2>/dev/null && has_sudo="true"

    groups_json=$(echo "$groups" | tr "," "\n" | awk "NF{printf \"%s\\\"%s\\\"\",sep,\$0; sep=\",\"}")

    un_esc=$(printf "%s" "$username" | sed "s/\"/\\\\\"/g")
    home_esc=$(printf "%s" "$home" | sed "s/\"/\\\\\"/g")
    shell_esc=$(printf "%s" "$shell" | sed "s/\"/\\\\\"/g")

    printf "{\"username\":\"%s\",\"uid\":%s,\"gid\":%s,\"groups\":[%s],\"shell\":\"%s\",\"has_sudo\":%s,\"home\":\"%s\"}\n" \
      "$un_esc" "$uid" "$gid" "$groups_json" "$shell_esc" "$has_sudo" "$home_esc"
  fi
done < /etc/passwd
' 2>/dev/null
"""

SSH_CONFIG_SCRIPT = r"""
sh -c '
if [ -f /etc/ssh/sshd_config ]; then
  permit_root=$(grep -i "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null | awk "{print \$2}" | head -1)
  password_auth=$(grep -i "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null | awk "{print \$2}" | head -1)
  pubkey_auth=$(grep -i "^PubkeyAuthentication" /etc/ssh/sshd_config 2>/dev/null | awk "{print \$2}" | head -1)
  port=$(grep -i "^Port " /etc/ssh/sshd_config 2>/dev/null | awk "{print \$2}" | head -1)
  max_auth=$(grep -i "^MaxAuthTries" /etc/ssh/sshd_config 2>/dev/null | awk "{print \$2}" | head -1)
  printf "{\"permit_root_login\":\"%s\",\"password_auth\":\"%s\",\"pubkey_auth\":\"%s\",\"port\":\"%s\",\"max_auth_tries\":\"%s\"}\n" \
    "${permit_root:-not set}" "${password_auth:-not set}" "${pubkey_auth:-not set}" "${port:-22}" "${max_auth:-not set}"
else
  echo "{}"
fi
' 2>/dev/null
"""


@router.get("/{connection_id}/security-scan", response_model=SecurityScanResponse)
async def security_scan(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Run a comprehensive security scan."""
    await _verify_connection(connection_id, current_user)

    # Run all scans in parallel-ish (sequential but fast)
    open_ports: list[OpenPort] = []
    failed_logins: list[FailedLogin] = []
    users: list[UserPrivilege] = []
    ssh_config: dict = {}

    # Open ports
    try:
        result = await _run(connection_id, OPEN_PORTS_SCRIPT, timeout=10)
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    open_ports.append(OpenPort(**json.loads(line)))
                except Exception:
                    continue
    except Exception as e:
        logger.debug(f"Open ports scan error: {e}")

    # Failed logins
    try:
        result = await _run(connection_id, FAILED_LOGINS_SCRIPT, timeout=10)
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    failed_logins.append(FailedLogin(**json.loads(line)))
                except Exception:
                    continue
    except Exception as e:
        logger.debug(f"Failed logins scan error: {e}")

    # Users
    try:
        result = await _run(connection_id, USERS_SCRIPT, timeout=10)
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    users.append(UserPrivilege(**json.loads(line)))
                except Exception:
                    continue
    except Exception as e:
        logger.debug(f"Users scan error: {e}")

    # SSH config
    try:
        result = await _run(connection_id, SSH_CONFIG_SCRIPT, timeout=5)
        stdout = result.get("stdout", "").strip()
        if stdout:
            try:
                ssh_config = json.loads(stdout)
            except json.JSONDecodeError:
                pass
    except Exception as e:
        logger.debug(f"SSH config scan error: {e}")

    # Check if malware scanners are available
    malware_check = await _run(
        connection_id,
        "command -v clamscan >/dev/null 2>&1 && echo 'clamav' || (command -v rkhunter >/dev/null 2>&1 && echo 'rkhunter' || echo 'none')",
        timeout=5,
    )
    malware_available = malware_check.get("stdout", "").strip() != "none"

    return SecurityScanResponse(
        open_ports=open_ports,
        failed_logins=failed_logins,
        users=users,
        ssh_config=ssh_config,
        malware_scan_available=malware_available,
    )


@router.post("/{connection_id}/malware-scan", response_model=MalwareScanResponse)
async def malware_scan(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Run a malware scan using available tools (clamav or rkhunter)."""
    await _verify_connection(connection_id, current_user)

    # Detect available tool
    detect = await _run(
        connection_id,
        "command -v clamscan >/dev/null 2>&1 && echo 'clamav' || (command -v rkhunter >/dev/null 2>&1 && echo 'rkhunter' || echo 'none')",
        timeout=5,
    )
    tool = detect.get("stdout", "").strip()

    if tool == "none":
        return MalwareScanResponse(
            tool="none",
            status="not_available",
            output="No malware scanner found. Install ClamAV (clamscan) or rkhunter.",
            threats_found=0,
        )

    if tool == "clamav":
        # Quick scan of common directories
        result = await ssh_proxy.run_command(
            connection_id,
            "clamscan --infected --recursive --max-filesize=10M --max-scansize=100M /tmp /var/tmp /home 2>&1 | tail -30",
            timeout=120,
        )
        stdout = result.get("stdout", "")
        threats = 0
        for line in stdout.split("\n"):
            if "Infected files:" in line:
                try:
                    threats = int(line.split(":")[-1].strip())
                except ValueError:
                    pass
        return MalwareScanResponse(
            tool="clamav",
            status="completed",
            output=stdout,
            threats_found=threats,
        )
    else:
        # rkhunter
        result = await ssh_proxy.run_command(
            connection_id,
            "sudo rkhunter --check --skip-keypress --report-warnings-only 2>&1 | tail -50",
            timeout=120,
        )
        stdout = result.get("stdout", "")
        threats = sum(1 for line in stdout.split("\n") if "Warning:" in line)
        return MalwareScanResponse(
            tool="rkhunter",
            status="completed",
            output=stdout,
            threats_found=threats,
        )


# ---------------------------------------------------------------------------
# Firewall
# ---------------------------------------------------------------------------

FIREWALL_STATUS_SCRIPT = r"""
sh -c '
if command -v ufw >/dev/null 2>&1; then
  echo "BACKEND:ufw"
  status=$(sudo ufw status verbose 2>/dev/null)
  if echo "$status" | grep -q "Status: active"; then
    echo "ACTIVE:true"
  else
    echo "ACTIVE:false"
  fi
  # Extract defaults
  def_in=$(echo "$status" | grep "Default:" | head -1 | grep -oP "incoming\)\s*\K\w+" || echo "")
  def_out=$(echo "$status" | grep "Default:" | head -1 | grep -oP "outgoing\)\s*\K\w+" || echo "")
  [ -z "$def_in" ] && def_in=$(echo "$status" | grep -oP "Default:.*deny \(incoming\)" >/dev/null && echo "deny" || echo "")
  echo "DEFAULTS:${def_in}:${def_out}"
  # Rules
  echo "RULES_START"
  sudo ufw status numbered 2>/dev/null | grep "^\[" | while IFS= read -r line; do
    num=$(echo "$line" | grep -oP "^\[\s*\K\d+")
    rest=$(echo "$line" | sed 's/^\[\s*[0-9]*\]\s*//')
    action=$(echo "$rest" | awk "{print \$1}")
    direction=$(echo "$rest" | awk "{print \$2}")
    raw_esc=$(printf "%s" "$rest" | sed "s/\"/\\\\\"/g")
    printf "{\"number\":%s,\"action\":\"%s\",\"direction\":\"%s\",\"raw\":\"%s\"}\n" "$num" "$action" "$direction" "$raw_esc"
  done
  echo "RULES_END"
elif command -v firewall-cmd >/dev/null 2>&1; then
  echo "BACKEND:firewalld"
  state=$(sudo firewall-cmd --state 2>/dev/null)
  if [ "$state" = "running" ]; then
    echo "ACTIVE:true"
  else
    echo "ACTIVE:false"
  fi
  echo "DEFAULTS::"
  echo "RULES_START"
  sudo firewall-cmd --list-all 2>/dev/null | grep -E "^\s+(services|ports|rich rules):" | while IFS= read -r line; do
    raw_esc=$(printf "%s" "$line" | sed "s/^\s*//;s/\"/\\\\\"/g")
    printf "{\"number\":0,\"action\":\"allow\",\"direction\":\"in\",\"raw\":\"%s\"}\n" "$raw_esc"
  done
  echo "RULES_END"
elif command -v iptables >/dev/null 2>&1; then
  echo "BACKEND:iptables"
  echo "ACTIVE:true"
  echo "DEFAULTS::"
  echo "RULES_START"
  sudo iptables -L -n --line-numbers 2>/dev/null | grep -E "^[0-9]" | while IFS= read -r line; do
    num=$(echo "$line" | awk "{print \$1}")
    action=$(echo "$line" | awk "{print \$2}")
    raw_esc=$(printf "%s" "$line" | sed "s/\"/\\\\\"/g")
    printf "{\"number\":%s,\"action\":\"%s\",\"direction\":\"in\",\"raw\":\"%s\"}\n" "$num" "$action" "$raw_esc"
  done
  echo "RULES_END"
else
  echo "BACKEND:none"
  echo "ACTIVE:false"
  echo "DEFAULTS::"
  echo "RULES_START"
  echo "RULES_END"
fi
' 2>/dev/null
"""


@router.get("/{connection_id}/firewall", response_model=FirewallStatus)
async def get_firewall_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get firewall status and rules."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, FIREWALL_STATUS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    backend = ""
    active = False
    rules: list[FirewallRule] = []
    default_incoming = ""
    default_outgoing = ""
    in_rules = False

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("BACKEND:"):
            backend = line.split(":", 1)[1]
        elif line.startswith("ACTIVE:"):
            active = line.split(":", 1)[1] == "true"
        elif line.startswith("DEFAULTS:"):
            parts = line.split(":", 2)
            if len(parts) >= 3:
                default_incoming = parts[1]
                default_outgoing = parts[2]
        elif line == "RULES_START":
            in_rules = True
        elif line == "RULES_END":
            in_rules = False
        elif in_rules and line:
            try:
                rules.append(FirewallRule(**json.loads(line)))
            except Exception:
                continue

    return FirewallStatus(
        backend=backend,
        active=active,
        rules=rules,
        default_incoming=default_incoming,
        default_outgoing=default_outgoing,
    )


@router.post("/{connection_id}/firewall/toggle")
async def toggle_firewall(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Enable or disable the firewall."""
    await _verify_connection(connection_id, current_user)

    # Detect backend and current state
    detect = await _run(
        connection_id,
        "command -v ufw >/dev/null 2>&1 && echo 'ufw' || (command -v firewall-cmd >/dev/null 2>&1 && echo 'firewalld' || echo 'none')",
        timeout=5,
    )
    backend = detect.get("stdout", "").strip()

    if backend == "ufw":
        # Check current state
        status = await _run(connection_id, "sudo ufw status 2>/dev/null", timeout=5)
        is_active = "Status: active" in status.get("stdout", "")
        if is_active:
            cmd = "echo 'y' | sudo ufw disable 2>&1; echo EXIT:$?"
        else:
            cmd = "echo 'y' | sudo ufw enable 2>&1; echo EXIT:$?"
    elif backend == "firewalld":
        status = await _run(connection_id, "sudo firewall-cmd --state 2>/dev/null", timeout=5)
        is_active = status.get("stdout", "").strip() == "running"
        if is_active:
            cmd = "sudo systemctl stop firewalld 2>&1; echo EXIT:$?"
        else:
            cmd = "sudo systemctl start firewalld 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="No supported firewall found (ufw or firewalld)")

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to toggle firewall: {stdout}")

    return {"message": "Firewall toggled successfully"}


@router.post("/{connection_id}/firewall/add-rule")
async def add_firewall_rule(
    connection_id: str,
    request: FirewallRuleAdd,
    current_user: User = Depends(get_current_user),
):
    """Add a firewall rule."""
    await _verify_connection(connection_id, current_user)

    # Sanitize inputs
    port = _sanitize_shell(request.port)
    source = _sanitize_shell(request.source)

    detect = await _run(
        connection_id,
        "command -v ufw >/dev/null 2>&1 && echo 'ufw' || (command -v firewall-cmd >/dev/null 2>&1 && echo 'firewalld' || echo 'none')",
        timeout=5,
    )
    backend = detect.get("stdout", "").strip()

    if backend == "ufw":
        parts = ["sudo", "ufw"]
        parts.append(request.action)
        if request.direction == "out":
            parts.append("out")
        if source != "any":
            parts.append(f"from {source}")
        parts.append(f"to any port {port}")
        if request.protocol != "any":
            parts.append(f"proto {request.protocol}")
        cmd = " ".join(parts) + " 2>&1; echo EXIT:$?"
    elif backend == "firewalld":
        if request.action in ("allow",):
            cmd = f"sudo firewall-cmd --permanent --add-port={port}/{request.protocol} 2>&1 && sudo firewall-cmd --reload 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo firewall-cmd --permanent --remove-port={port}/{request.protocol} 2>&1 && sudo firewall-cmd --reload 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="No supported firewall found")

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to add rule: {stdout}")

    return {"message": "Firewall rule added"}


@router.post("/{connection_id}/firewall/delete-rule")
async def delete_firewall_rule(
    connection_id: str,
    request: FirewallRuleDelete,
    current_user: User = Depends(get_current_user),
):
    """Delete a firewall rule by number."""
    await _verify_connection(connection_id, current_user)

    detect = await _run(
        connection_id,
        "command -v ufw >/dev/null 2>&1 && echo 'ufw' || (command -v firewall-cmd >/dev/null 2>&1 && echo 'firewalld' || echo 'none')",
        timeout=5,
    )
    backend = detect.get("stdout", "").strip()

    if backend == "ufw":
        cmd = f"echo 'y' | sudo ufw delete {request.rule_number} 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="Rule deletion by number only supported for ufw")

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to delete rule: {stdout}")

    return {"message": "Firewall rule deleted"}


# ---------------------------------------------------------------------------
# Package management
# ---------------------------------------------------------------------------

DETECT_PKG_MANAGER_SCRIPT = r"""
sh -c '
os_id=""
os_name=""
os_version=""
if [ -f /etc/os-release ]; then
  while IFS="=" read key val; do
    case "$key" in
      ID) os_id=$(echo "$val" | tr -d "\"") ;;
      PRETTY_NAME) os_name=$(echo "$val" | tr -d "\"") ;;
      VERSION_ID) os_version=$(echo "$val" | tr -d "\"") ;;
    esac
  done < /etc/os-release
fi

if command -v apt >/dev/null 2>&1; then
  echo "apt|${os_id}|${os_name}|${os_version}"
elif command -v dnf >/dev/null 2>&1; then
  echo "dnf|${os_id}|${os_name}|${os_version}"
elif command -v yum >/dev/null 2>&1; then
  echo "yum|${os_id}|${os_name}|${os_version}"
elif command -v pacman >/dev/null 2>&1; then
  echo "pacman|${os_id}|${os_name}|${os_version}"
elif command -v apk >/dev/null 2>&1; then
  echo "apk|${os_id}|${os_name}|${os_version}"
elif command -v zypper >/dev/null 2>&1; then
  echo "zypper|${os_id}|${os_name}|${os_version}"
else
  echo "unknown|${os_id}|${os_name}|${os_version}"
fi
' 2>/dev/null
"""


@router.get("/{connection_id}/packages/detect", response_model=PackageManagerInfo)
async def detect_package_manager(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Detect the system's package manager and OS info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    stdout = result.get("stdout", "").strip()
    parts = stdout.split("|", 3) if stdout else []

    return PackageManagerInfo(
        manager=parts[0] if len(parts) > 0 else "unknown",
        os_id=parts[1] if len(parts) > 1 else "",
        os_name=parts[2] if len(parts) > 2 else "",
        os_version=parts[3] if len(parts) > 3 else "",
    )


@router.get("/{connection_id}/packages/updates", response_model=PackageUpdatesResponse)
async def check_updates(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Check for available package updates."""
    await _verify_connection(connection_id, current_user)

    # Detect manager
    detect = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    manager = detect.get("stdout", "").strip().split("|")[0]

    updates: list[PackageUpdateInfo] = []
    security_count = 0

    if manager == "apt":
        # Update cache first
        await ssh_proxy.run_command(connection_id, "sudo apt update -qq 2>/dev/null", timeout=60)
        result = await _run(
            connection_id,
            "apt list --upgradable 2>/dev/null | tail -n +2",
            timeout=30,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                # Format: package/source version arch [upgradable from: old_version]
                parts = line.split()
                if len(parts) >= 2:
                    name_source = parts[0].split("/")
                    name = name_source[0]
                    new_ver = parts[1] if len(parts) > 1 else ""
                    old_ver = ""
                    if "upgradable from:" in line:
                        old_ver = line.split("upgradable from:")[-1].strip().rstrip("]")
                    if "-security" in line:
                        security_count += 1
                    updates.append(PackageUpdateInfo(
                        name=name,
                        current_version=old_ver,
                        new_version=new_ver,
                    ))

    elif manager in ("dnf", "yum"):
        # dnf check-update returns exit code 100 when updates are available,
        # so we use ssh_proxy.run_command directly to avoid _run() raising on error
        result = await ssh_proxy.run_command(
            connection_id,
            f"sudo {manager} check-update --quiet 2>/dev/null | head -200",
            timeout=60,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line or line.startswith("Last metadata"):
                    continue
                parts = line.split()
                if len(parts) >= 2:
                    updates.append(PackageUpdateInfo(
                        name=parts[0],
                        new_version=parts[1] if len(parts) > 1 else "",
                    ))

    elif manager == "pacman":
        result = await _run(
            connection_id,
            "checkupdates 2>/dev/null || pacman -Qu 2>/dev/null",
            timeout=30,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                parts = line.strip().split()
                if len(parts) >= 2:
                    updates.append(PackageUpdateInfo(
                        name=parts[0],
                        current_version=parts[1] if len(parts) > 1 else "",
                        new_version=parts[-1] if len(parts) > 2 else "",
                    ))

    elif manager == "apk":
        result = await _run(
            connection_id,
            "apk version -l '<' 2>/dev/null",
            timeout=30,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                parts = line.strip().split()
                if len(parts) >= 1:
                    updates.append(PackageUpdateInfo(name=parts[0]))

    elif manager == "zypper":
        result = await ssh_proxy.run_command(
            connection_id,
            "zypper -q list-updates 2>/dev/null | tail -n +3 | head -200",
            timeout=60,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line or line.startswith("-"):
                    continue
                # Format: S | Repository | Name | Current Version | Available Version | Arch
                cols = [c.strip() for c in line.split("|")]
                if len(cols) >= 5:
                    updates.append(PackageUpdateInfo(
                        name=cols[2],
                        current_version=cols[3],
                        new_version=cols[4],
                    ))

    return PackageUpdatesResponse(
        manager=manager,
        updates=updates,
        total=len(updates),
        security_updates=security_count,
    )


@router.get("/{connection_id}/packages/search", response_model=PackageSearchResult)
async def search_packages(
    connection_id: str,
    query: str = Query(..., min_length=1, max_length=100, description="Search query"),
    current_user: User = Depends(get_current_user),
):
    """Search for packages."""
    await _verify_connection(connection_id, current_user)

    # Sanitize query
    safe_query = _sanitize_shell(query)

    detect = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    manager = detect.get("stdout", "").strip().split("|")[0]

    packages: list[PackageInfo] = []

    if manager == "apt":
        result = await _run(
            connection_id,
            f'apt-cache search "{safe_query}" 2>/dev/null | head -50',
            timeout=15,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                parts = line.split(" - ", 1)
                packages.append(PackageInfo(
                    name=parts[0].strip(),
                    description=parts[1].strip() if len(parts) > 1 else "",
                ))

    elif manager in ("dnf", "yum"):
        result = await _run(
            connection_id,
            f'{manager} search "{safe_query}" 2>/dev/null | head -50',
            timeout=15,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line or line.startswith("=") or line.startswith("Last metadata"):
                    continue
                parts = line.split(" : ", 1)
                if len(parts) >= 1:
                    name_arch = parts[0].strip()
                    packages.append(PackageInfo(
                        name=name_arch.split(".")[0] if "." in name_arch else name_arch,
                        description=parts[1].strip() if len(parts) > 1 else "",
                    ))

    elif manager == "pacman":
        result = await _run(
            connection_id,
            f'pacman -Ss "{safe_query}" 2>/dev/null | head -50',
            timeout=15,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            lines = stdout.split("\n")
            i = 0
            while i < len(lines):
                line = lines[i].strip()
                if line.startswith("extra/") or line.startswith("core/") or line.startswith("community/"):
                    parts = line.split()
                    name = parts[0].split("/")[-1] if "/" in parts[0] else parts[0]
                    version = parts[1] if len(parts) > 1 else ""
                    desc = lines[i + 1].strip() if i + 1 < len(lines) else ""
                    packages.append(PackageInfo(name=name, version=version, description=desc))
                    i += 2
                else:
                    i += 1

    elif manager == "apk":
        result = await _run(
            connection_id,
            f'apk search -v "{safe_query}" 2>/dev/null | head -50',
            timeout=15,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line:
                    continue
                parts = line.split(" - ", 1)
                packages.append(PackageInfo(
                    name=parts[0].strip(),
                    description=parts[1].strip() if len(parts) > 1 else "",
                ))

    elif manager == "zypper":
        result = await _run(
            connection_id,
            f'zypper search "{safe_query}" 2>/dev/null | tail -n +5 | head -50',
            timeout=15,
        )
        stdout = result.get("stdout", "").strip()
        if stdout:
            for line in stdout.split("\n"):
                line = line.strip()
                if not line or line.startswith("-"):
                    continue
                # Format: S | Name | Summary | Type
                cols = [c.strip() for c in line.split("|")]
                if len(cols) >= 3:
                    status = "installed" if cols[0].strip() == "i" else "available"
                    packages.append(PackageInfo(
                        name=cols[1],
                        description=cols[2] if len(cols) > 2 else "",
                        status=status,
                    ))

    return PackageSearchResult(packages=packages, total=len(packages))


@router.post("/{connection_id}/packages/action")
async def package_action(
    connection_id: str,
    request: PackageActionRequest,
    current_user: User = Depends(get_current_user),
):
    """Install, remove, or purge a package."""
    await _verify_connection(connection_id, current_user)

    # Sanitize package name
    pkg = request.package_name
    if not all(c.isalnum() or c in "-._+:" for c in pkg):
        raise HTTPException(status_code=400, detail="Invalid package name")

    detect = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    manager = detect.get("stdout", "").strip().split("|")[0]

    action = request.action

    if manager == "apt":
        if action == "install":
            cmd = f"sudo DEBIAN_FRONTEND=noninteractive apt install -y {pkg} 2>&1; echo EXIT:$?"
        elif action == "remove":
            cmd = f"sudo DEBIAN_FRONTEND=noninteractive apt remove -y {pkg} 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo DEBIAN_FRONTEND=noninteractive apt purge -y {pkg} 2>&1; echo EXIT:$?"
    elif manager in ("dnf", "yum"):
        if action == "install":
            cmd = f"sudo {manager} install -y {pkg} 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo {manager} remove -y {pkg} 2>&1; echo EXIT:$?"
    elif manager == "pacman":
        if action == "install":
            cmd = f"sudo pacman -S --noconfirm {pkg} 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo pacman -R --noconfirm {pkg} 2>&1; echo EXIT:$?"
    elif manager == "apk":
        if action == "install":
            cmd = f"sudo apk add {pkg} 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo apk del {pkg} 2>&1; echo EXIT:$?"
    elif manager == "zypper":
        if action == "install":
            cmd = f"sudo zypper install -y {pkg} 2>&1; echo EXIT:$?"
        else:
            cmd = f"sudo zypper remove -y {pkg} 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported package manager: {manager}")

    result = await ssh_proxy.run_command(connection_id, cmd, timeout=120)
    stdout = result.get("stdout", "")
    stderr = result.get("stderr", "")

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_msg = stderr or stdout.replace("EXIT:0", "").replace("EXIT:1", "")
        raise HTTPException(status_code=400, detail=f"Package {action} failed: {error_msg[-500:]}")

    return {"message": f"Package '{pkg}' {action} completed successfully"}


@router.post("/{connection_id}/packages/upgrade-all")
async def upgrade_all_packages(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Upgrade all packages."""
    await _verify_connection(connection_id, current_user)

    detect = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    manager = detect.get("stdout", "").strip().split("|")[0]

    if manager == "apt":
        cmd = "sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y 2>&1; echo EXIT:$?"
    elif manager == "dnf":
        cmd = "sudo dnf upgrade -y 2>&1; echo EXIT:$?"
    elif manager == "yum":
        cmd = "sudo yum update -y 2>&1; echo EXIT:$?"
    elif manager == "pacman":
        cmd = "sudo pacman -Syu --noconfirm 2>&1; echo EXIT:$?"
    elif manager == "apk":
        cmd = "sudo apk upgrade 2>&1; echo EXIT:$?"
    elif manager == "zypper":
        cmd = "sudo zypper update -y 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported package manager: {manager}")

    result = await ssh_proxy.run_command(connection_id, cmd, timeout=300)
    stdout = result.get("stdout", "")

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    # Return last 50 lines of output
    output_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
    summary = "\n".join(output_lines[-50:])

    return {
        "message": "Upgrade completed" if exit_code == "0" else "Upgrade may have issues",
        "success": exit_code == "0",
        "output": summary,
    }


# ===========================================================================
# Phase 3: Docker, WireGuard, Cron
# ===========================================================================


# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

DOCKER_INFO_SCRIPT = r"""
sh -c '
if command -v docker >/dev/null 2>&1; then
  ver=$(docker --version 2>/dev/null | awk "{print \$3}" | tr -d ",")
  running=$(docker info --format "{{.ContainersRunning}}" 2>/dev/null || echo 0)
  paused=$(docker info --format "{{.ContainersPaused}}" 2>/dev/null || echo 0)
  stopped=$(docker info --format "{{.ContainersStopped}}" 2>/dev/null || echo 0)
  images=$(docker info --format "{{.Images}}" 2>/dev/null || echo 0)
  driver=$(docker info --format "{{.Driver}}" 2>/dev/null || echo "")
  api=$(docker info --format "{{.ServerVersion}}" 2>/dev/null || echo "")
  printf "{\"installed\":true,\"version\":\"%s\",\"api_version\":\"%s\",\"containers_running\":%s,\"containers_paused\":%s,\"containers_stopped\":%s,\"images\":%s,\"storage_driver\":\"%s\"}\n" \
    "$ver" "$api" "${running:-0}" "${paused:-0}" "${stopped:-0}" "${images:-0}" "$driver"
else
  echo "{\"installed\":false}"
fi
' 2>/dev/null
"""

DOCKER_PS_SCRIPT = r"""
docker ps -a --format '{{json .}}' 2>/dev/null
"""

DOCKER_IMAGES_SCRIPT = r"""
docker images --format '{{json .}}' 2>/dev/null
"""


@router.get("/{connection_id}/docker/info", response_model=DockerInfo)
async def get_docker_info(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get Docker daemon info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_INFO_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()
    if not stdout:
        return DockerInfo(installed=False)

    try:
        data = json.loads(stdout)
        return DockerInfo(**data)
    except (json.JSONDecodeError, Exception):
        return DockerInfo(installed=False)


@router.get("/{connection_id}/docker/containers", response_model=DockerContainersResponse)
async def list_docker_containers(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker containers."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_PS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    containers: list[DockerContainer] = []
    if stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                # docker ps --format '{{json .}}' uses capitalized keys
                containers.append(DockerContainer(
                    id=raw.get("ID", raw.get("id", "")),
                    name=raw.get("Names", raw.get("name", "")),
                    image=raw.get("Image", raw.get("image", "")),
                    status=raw.get("Status", raw.get("status", "")),
                    state=raw.get("State", raw.get("state", "")),
                    created=raw.get("CreatedAt", raw.get("created", "")),
                    ports=raw.get("Ports", raw.get("ports", "")),
                    size=raw.get("Size", raw.get("size", "")),
                ))
            except (json.JSONDecodeError, Exception):
                continue

    return DockerContainersResponse(containers=containers, total=len(containers))


@router.post("/{connection_id}/docker/containers/{container_id}/action")
async def docker_container_action(
    connection_id: str,
    container_id: str,
    request: DockerContainerAction,
    current_user: User = Depends(get_current_user),
):
    """Perform an action on a Docker container."""
    await _verify_connection(connection_id, current_user)

    # Sanitize container ID (hex or name)
    if not all(c.isalnum() or c in "-_." for c in container_id):
        raise HTTPException(status_code=400, detail="Invalid container ID")

    action = request.action
    if action == "remove":
        cmd = f"docker rm -f {container_id} 2>&1; echo EXIT:$?"
    else:
        cmd = f"docker {action} {container_id} 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=30)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or f"Failed to {action} container")

    return {"message": f"Container {container_id} {action} successful"}


@router.get("/{connection_id}/docker/containers/{container_id}/logs")
async def get_docker_container_logs(
    connection_id: str,
    container_id: str,
    tail: int = Query(default=100, ge=1, le=5000),
    current_user: User = Depends(get_current_user),
):
    """Get Docker container logs."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_." for c in container_id):
        raise HTTPException(status_code=400, detail="Invalid container ID")

    cmd = f"docker logs --tail {tail} --timestamps {container_id} 2>&1"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "")

    return {"logs": stdout, "container_id": container_id}


@router.get("/{connection_id}/docker/images", response_model=DockerImagesResponse)
async def list_docker_images(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker images."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_IMAGES_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    images: list[DockerImage] = []
    if stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                # docker images --format '{{json .}}' uses capitalized keys
                images.append(DockerImage(
                    id=raw.get("ID", raw.get("id", "")),
                    repository=raw.get("Repository", raw.get("repository", "")),
                    tag=raw.get("Tag", raw.get("tag", "")),
                    size=raw.get("Size", raw.get("size", "")),
                    created=raw.get("CreatedSince", raw.get("created", "")),
                ))
            except (json.JSONDecodeError, Exception):
                continue

    return DockerImagesResponse(images=images, total=len(images))


@router.delete("/{connection_id}/docker/images/{image_id}")
async def delete_docker_image(
    connection_id: str,
    image_id: str,
    current_user: User = Depends(get_current_user),
):
    """Delete a Docker image."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_./:" for c in image_id):
        raise HTTPException(status_code=400, detail="Invalid image ID")

    cmd = f"docker rmi {image_id} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=30)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to delete image")

    return {"message": f"Image {image_id} deleted"}


# ---------------------------------------------------------------------------
# WireGuard
# ---------------------------------------------------------------------------

WIREGUARD_STATUS_SCRIPT = r"""
sh -c '
if command -v wg >/dev/null 2>&1; then
  ver=$(wg --version 2>/dev/null | awk "{print \$2}" || echo "unknown")
  echo "INSTALLED:true"
  echo "VERSION:${ver}"

  # List interfaces
  ifaces=$(sudo wg show interfaces 2>/dev/null)
  if [ -z "$ifaces" ]; then
    echo "INTERFACES_END"
  else
    for iface in $ifaces; do
      echo "IFACE_START:${iface}"

      # Get interface details
      pubkey=$(sudo wg show "$iface" public-key 2>/dev/null || echo "")
      listen=$(sudo wg show "$iface" listen-port 2>/dev/null || echo "")

      # Get address from ip command
      addr=$(ip -4 addr show "$iface" 2>/dev/null | grep -oP "inet \K[0-9./]+" | head -1)
      [ -z "$addr" ] && addr=$(ip -6 addr show "$iface" 2>/dev/null | grep -oP "inet6 \K[0-9a-f:/]+" | head -1)

      # Check if active
      state=$(ip link show "$iface" 2>/dev/null | grep -oP "state \K\w+")
      active="false"
      [ "$state" = "UP" ] || [ "$state" = "UNKNOWN" ] && active="true"

      echo "IFACE_INFO:${pubkey}|${listen}|${addr}|${active}"

      # Get peers
      sudo wg show "$iface" dump 2>/dev/null | tail -n +2 | while IFS="$(printf '\t')" read -r pk psk ep aip hs rx tx ka; do
        hs_fmt=""
        if [ "$hs" != "0" ] && [ -n "$hs" ]; then
          hs_fmt=$(date -d "@$hs" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r "$hs" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "$hs")
        fi
        # Convert bytes to human readable
        rx_h=$(numfmt --to=iec "$rx" 2>/dev/null || echo "${rx}B")
        tx_h=$(numfmt --to=iec "$tx" 2>/dev/null || echo "${tx}B")
        ka_str=""
        [ "$ka" != "off" ] && [ -n "$ka" ] && ka_str="${ka}s"
        printf "PEER:%s|%s|%s|%s|%s|%s|%s\n" "$pk" "$ep" "$aip" "$hs_fmt" "$rx_h" "$tx_h" "$ka_str"
      done

      echo "IFACE_END"
    done
    echo "INTERFACES_END"
  fi
else
  echo "INSTALLED:false"
  echo "INTERFACES_END"
fi
' 2>/dev/null
"""


@router.get("/{connection_id}/wireguard", response_model=WireGuardStatusResponse)
async def get_wireguard_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get WireGuard status and interfaces."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, WIREGUARD_STATUS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    installed = False
    version = ""
    interfaces: list[WireGuardInterface] = []
    current_iface: dict | None = None
    current_peers: list[WireGuardPeer] = []

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("INSTALLED:"):
            installed = line.split(":", 1)[1] == "true"
        elif line.startswith("VERSION:"):
            version = line.split(":", 1)[1]
        elif line.startswith("IFACE_START:"):
            iface_name = line.split(":", 1)[1]
            current_iface = {"name": iface_name}
            current_peers = []
        elif line.startswith("IFACE_INFO:") and current_iface is not None:
            parts = line.split(":", 1)[1].split("|", 3)
            current_iface["public_key"] = parts[0] if len(parts) > 0 else ""
            current_iface["listening_port"] = parts[1] if len(parts) > 1 else ""
            current_iface["address"] = parts[2] if len(parts) > 2 else ""
            current_iface["active"] = parts[3] == "true" if len(parts) > 3 else False
        elif line.startswith("PEER:") and current_iface is not None:
            parts = line.split(":", 1)[1].split("|", 6)
            current_peers.append(WireGuardPeer(
                public_key=parts[0] if len(parts) > 0 else "",
                endpoint=parts[1] if len(parts) > 1 else "",
                allowed_ips=parts[2] if len(parts) > 2 else "",
                latest_handshake=parts[3] if len(parts) > 3 else "",
                transfer_rx=parts[4] if len(parts) > 4 else "",
                transfer_tx=parts[5] if len(parts) > 5 else "",
                persistent_keepalive=parts[6] if len(parts) > 6 else "",
            ))
        elif line == "IFACE_END" and current_iface is not None:
            interfaces.append(WireGuardInterface(
                **current_iface,
                peers=current_peers,
            ))
            current_iface = None
            current_peers = []

    return WireGuardStatusResponse(
        installed=installed,
        version=version,
        interfaces=interfaces,
    )


@router.post("/{connection_id}/wireguard/{interface}/toggle")
async def toggle_wireguard_interface(
    connection_id: str,
    interface: str,
    current_user: User = Depends(get_current_user),
):
    """Bring a WireGuard interface up or down."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_" for c in interface):
        raise HTTPException(status_code=400, detail="Invalid interface name")

    # Check current state
    state_result = await _run(
        connection_id,
        f"ip link show {interface} 2>/dev/null | grep -oP 'state \\K\\w+'",
        timeout=5,
    )
    current_state = state_result.get("stdout", "").strip()
    is_up = current_state in ("UP", "UNKNOWN")

    if is_up:
        cmd = f"sudo wg-quick down {interface} 2>&1; echo EXIT:$?"
    else:
        cmd = f"sudo wg-quick up {interface} 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or f"Failed to toggle {interface}")

    action = "down" if is_up else "up"
    return {"message": f"Interface {interface} brought {action}"}


@router.post("/{connection_id}/wireguard/generate-keypair", response_model=WireGuardKeyPair)
async def generate_wireguard_keypair(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Generate a WireGuard key pair on the remote server."""
    await _verify_connection(connection_id, current_user)

    cmd = "privkey=$(wg genkey 2>/dev/null) && pubkey=$(echo \"$privkey\" | wg pubkey 2>/dev/null) && printf '%s\\n%s' \"$privkey\" \"$pubkey\""
    result = await _run(connection_id, cmd, timeout=5)
    stdout = result.get("stdout", "").strip()

    lines = stdout.split("\n")
    if len(lines) < 2:
        raise HTTPException(status_code=500, detail="Failed to generate key pair")

    return WireGuardKeyPair(private_key=lines[0].strip(), public_key=lines[1].strip())


@router.post("/{connection_id}/wireguard/create-config")
async def create_wireguard_config(
    connection_id: str,
    request: WireGuardCreateConfig,
    current_user: User = Depends(get_current_user),
):
    """Create a WireGuard interface config file in /etc/wireguard/."""
    await _verify_connection(connection_id, current_user)

    iface = request.interface_name
    if not all(c.isalnum() or c in "-_" for c in iface):
        raise HTTPException(status_code=400, detail="Invalid interface name")

    # Sanitize private key (base64 chars only)
    import re
    if not re.match(r'^[A-Za-z0-9+/=]+$', request.private_key):
        raise HTTPException(status_code=400, detail="Invalid private key format")

    # Build config content
    config_lines = [
        "[Interface]",
        f"PrivateKey = {request.private_key}",
        f"Address = {_sanitize_shell(request.address)}",
        f"ListenPort = {request.listen_port}",
    ]
    config_content = "\\n".join(config_lines)

    cmd = f'printf "{config_content}\\n" | sudo tee /etc/wireguard/{iface}.conf > /dev/null 2>&1 && sudo chmod 600 /etc/wireguard/{iface}.conf 2>&1; echo EXIT:$?'
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to create config: {stdout}")

    return {"message": f"WireGuard config created for {iface}"}


@router.post("/{connection_id}/wireguard/{interface}/add-peer")
async def add_wireguard_peer(
    connection_id: str,
    interface: str,
    request: WireGuardAddPeer,
    current_user: User = Depends(get_current_user),
):
    """Add a peer to a WireGuard interface."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_" for c in interface):
        raise HTTPException(status_code=400, detail="Invalid interface name")

    import re
    if not re.match(r'^[A-Za-z0-9+/=]+$', request.public_key):
        raise HTTPException(status_code=400, detail="Invalid public key format")

    allowed_ips = _sanitize_shell(request.allowed_ips)

    parts = [f"sudo wg set {interface} peer {request.public_key} allowed-ips {allowed_ips}"]
    if request.endpoint:
        endpoint = _sanitize_shell(request.endpoint)
        parts[0] += f" endpoint {endpoint}"
    if request.persistent_keepalive > 0:
        parts[0] += f" persistent-keepalive {request.persistent_keepalive}"

    cmd = parts[0] + " 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to add peer")

    return {"message": f"Peer added to {interface}"}


@router.post("/{connection_id}/wireguard/{interface}/remove-peer")
async def remove_wireguard_peer(
    connection_id: str,
    interface: str,
    request: WireGuardRemovePeer,
    current_user: User = Depends(get_current_user),
):
    """Remove a peer from a WireGuard interface."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_" for c in interface):
        raise HTTPException(status_code=400, detail="Invalid interface name")

    import re
    if not re.match(r'^[A-Za-z0-9+/=]+$', request.public_key):
        raise HTTPException(status_code=400, detail="Invalid public key format")

    cmd = f"sudo wg set {interface} peer {request.public_key} remove 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to remove peer")

    return {"message": f"Peer removed from {interface}"}


# ---------------------------------------------------------------------------
# Cron
# ---------------------------------------------------------------------------

CRON_LIST_SCRIPT = r"""
sh -c '
user=$(whoami)
echo "USER:${user}"

# User crontab
echo "USER_CRON_START"
  crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | cat -n | while IFS="$(printf '\t')" read -r num line; do
  num=$(echo "$num" | tr -d " ")
  sched=$(echo "$line" | awk "{print \$1,\$2,\$3,\$4,\$5}")
  cmd=$(echo "$line" | awk "{for(i=6;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
  cmd_esc=$(printf "%s" "$cmd" | sed "s/\"/\\\\\"/g")
  raw_esc=$(printf "%s" "$line" | sed "s/\"/\\\\\"/g")
  printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":%s,\"raw\":\"%s\"}\n" \
    "$sched" "$cmd_esc" "$user" "$num" "$raw_esc"
done
echo "USER_CRON_END"

# System crontab entries
echo "SYSTEM_CRON_START"
if [ -f /etc/crontab ]; then
  grep -v "^#" /etc/crontab 2>/dev/null | grep -v "^$" | grep -v "^SHELL\|^PATH\|^MAILTO\|^HOME" | while IFS= read -r line; do
    sched=$(echo "$line" | awk "{print \$1,\$2,\$3,\$4,\$5}")
    cron_user=$(echo "$line" | awk "{print \$6}")
    cmd=$(echo "$line" | awk "{for(i=7;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
    cmd_esc=$(printf "%s" "$cmd" | sed "s/\"/\\\\\"/g")
    raw_esc=$(printf "%s" "$line" | sed "s/\"/\\\\\"/g")
    printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":0,\"raw\":\"%s\"}\n" \
      "$sched" "$cmd_esc" "$cron_user" "$raw_esc"
  done
fi
# /etc/cron.d/* files
for f in /etc/cron.d/*; do
  [ -f "$f" ] || continue
  grep -v "^#" "$f" 2>/dev/null | grep -v "^$" | grep -v "^SHELL\|^PATH\|^MAILTO\|^HOME" | while IFS= read -r line; do
    sched=$(echo "$line" | awk "{print \$1,\$2,\$3,\$4,\$5}")
    cron_user=$(echo "$line" | awk "{print \$6}")
    cmd=$(echo "$line" | awk "{for(i=7;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
    cmd_esc=$(printf "%s" "$cmd" | sed "s/\"/\\\\\"/g")
    raw_esc=$(printf "%s" "$line" | sed "s/\"/\\\\\"/g")
    printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":0,\"raw\":\"%s\"}\n" \
      "$sched" "$cmd_esc" "$cron_user" "$raw_esc"
  done
done
echo "SYSTEM_CRON_END"
' 2>/dev/null
"""


@router.get("/{connection_id}/cron", response_model=CronListResponse)
async def list_cron_jobs(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List cron jobs for the current user and system."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, CRON_LIST_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    user = ""
    user_jobs: list[CronJob] = []
    system_jobs: list[CronJob] = []
    section = ""

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("USER:"):
            user = line.split(":", 1)[1]
        elif line == "USER_CRON_START":
            section = "user"
        elif line == "USER_CRON_END":
            section = ""
        elif line == "SYSTEM_CRON_START":
            section = "system"
        elif line == "SYSTEM_CRON_END":
            section = ""
        elif section in ("user", "system") and line.startswith("{"):
            try:
                job = CronJob(**json.loads(line))
                if section == "user":
                    user_jobs.append(job)
                else:
                    system_jobs.append(job)
            except (json.JSONDecodeError, Exception):
                continue

    return CronListResponse(
        jobs=user_jobs,
        total=len(user_jobs),
        user=user,
        system_jobs=system_jobs,
    )


@router.post("/{connection_id}/cron/add")
async def add_cron_job(
    connection_id: str,
    request: CronJobAdd,
    current_user: User = Depends(get_current_user),
):
    """Add a cron job to the current user's crontab."""
    await _verify_connection(connection_id, current_user)

    # Sanitize schedule to prevent shell injection (command is passed via base64)
    schedule = _sanitize_shell(request.schedule)

    # Encode the full cron line via base64 to avoid any shell expansion
    import base64
    cron_line = f"{schedule} {request.command}"
    encoded_line = base64.b64encode(cron_line.encode()).decode()

    # Append to crontab using base64 decode to prevent shell interpretation
    cmd = f'(crontab -l 2>/dev/null; echo "{encoded_line}" | base64 -d 2>/dev/null || echo "{encoded_line}" | base64 -D 2>/dev/null) | crontab - 2>&1; echo EXIT:$?'
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to add cron job")

    return {"message": "Cron job added successfully"}


@router.post("/{connection_id}/cron/delete")
async def delete_cron_job(
    connection_id: str,
    request: CronJobDelete,
    current_user: User = Depends(get_current_user),
):
    """Delete a cron job by line number from the current user's crontab."""
    await _verify_connection(connection_id, current_user)

    line_num = request.line_number

    # Remove the specific line from crontab using a temp file to avoid race conditions
    cmd = f'_tmpf=$(mktemp) && crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | sed "{line_num}d" > "$_tmpf" && '
    cmd += f'(crontab -l 2>/dev/null | grep "^#"; cat "$_tmpf") | crontab - 2>&1; rm -f "$_tmpf"; echo EXIT:$?'
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to delete cron job")

    return {"message": "Cron job deleted successfully"}
