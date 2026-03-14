"""Server tools REST API for remote server management."""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from backend.config import config
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
    FirewallOverview,
    FirewallBackendInfo,
    ClientIpResponse,
    UfwRule,
    UfwStatus,
    UfwRuleAdd,
    UfwRuleEdit,
    UfwRuleDelete,
    UfwDefaultsUpdate,
    IptablesRule,
    IptablesStatus,
    IptablesRuleAdd,
    IptablesRuleDelete,
    IptablesPolicyUpdate,
    FirewalldRule,
    FirewalldStatus,
    FirewalldRuleAdd,
    FirewalldRuleDelete,
    FirewallSafetyWarning,
    FirewallSafetyCheck,
    FirewallSafetyRequest,
    PackageManagerInfo,
    PackageUpdatesResponse,
    PackageUpdateInfo,
    PackageSearchResult,
    PackageInfo,
    PackageActionRequest,
    PackageCheckRequest,
    PackageCheckResponse,
    DockerInstallCheck,
    DockerInfo,
    DockerContainer,
    DockerContainersResponse,
    DockerContainerAction,
    DockerImage,
    DockerImagesResponse,
    DockerLogsRequest,
    DockerPullImage,
    DockerNetwork,
    DockerNetworksResponse,
    DockerNetworkCreate,
    DockerVolume,
    DockerVolumesResponse,
    DockerVolumeCreate,
    DockerComposeProject,
    DockerComposeProjectsResponse,
    DockerComposeAction,
    DockerComposeFileRequest,
    DockerComposeFileSave,
    WireGuardStatusResponse,
    WireGuardClient,
    WireGuardInstallCheck,
    WireGuardAddClient,
    WireGuardClientConfig,
    WireGuardRemoveClient,
    WireGuardToggleClient,
    WireGuardKeyPair,
    CronJob,
    CronListResponse,
    CronJobAdd,
    CronJobUpdate,
    CronJobDelete,
    CronJobToggle,
    CronHistoryEntry,
    CronHistoryResponse,
    ServiceDetailResponse,
    ServiceLogEntry,
    ServiceLogsResponse,
    ServiceUnitFileResponse,
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

# Escape strings for JSON — use double-quoted sed to avoid breaking
# the outer sh -c single-quoted block (single quotes cannot be nested).
_json_esc() { printf "%s" "$1" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g" | tr "\t" " "; }
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
  # Get list of all service units with their properties in one pass
  systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null | while IFS= read -r line; do
    name=$(echo "$line" | awk '{print $1}')
    load=$(echo "$line" | awk '{print $2}')
    active=$(echo "$line" | awk '{print $3}')
    sub=$(echo "$line" | awk '{print $4}')
    desc=$(echo "$line" | awk '{for(i=5;i<=NF;i++) printf "%s ",$i; print ""}' | sed 's/ $//')
    desc=$(printf '%s' "$desc" | sed 's/\\/\\\\/g; s/"/\\"/g')

    # Get extra properties for this service
    props=$(systemctl show "$name" --no-pager --property=UnitFileState,Type,MainPID,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp 2>/dev/null)
    enabled=$(echo "$props" | grep '^UnitFileState=' | cut -d= -f2-)
    stype=$(echo "$props" | grep '^Type=' | cut -d= -f2-)
    mpid=$(echo "$props" | grep '^MainPID=' | cut -d= -f2-)
    memraw=$(echo "$props" | grep '^MemoryCurrent=' | cut -d= -f2-)
    cpuraw=$(echo "$props" | grep '^CPUUsageNSec=' | cut -d= -f2-)
    started=$(echo "$props" | grep '^ActiveEnterTimestamp=' | cut -d= -f2-)

    # Convert memory from bytes to human-readable
    mem=""
    if [ -n "$memraw" ] && [ "$memraw" != "[not set]" ] && [ "$memraw" -gt 0 ] 2>/dev/null; then
      if [ "$memraw" -ge 1073741824 ]; then
        mem="$(awk "BEGIN{printf \"%.1f\", $memraw/1073741824}")G"
      elif [ "$memraw" -ge 1048576 ]; then
        mem="$(awk "BEGIN{printf \"%.1f\", $memraw/1048576}")M"
      elif [ "$memraw" -ge 1024 ]; then
        mem="$(awk "BEGIN{printf \"%.0f\", $memraw/1024}")K"
      else
        mem="${memraw}B"
      fi
    fi

    # Convert CPU from nanoseconds to human-readable
    cpu=""
    if [ -n "$cpuraw" ] && [ "$cpuraw" != "[not set]" ] && [ "$cpuraw" -gt 0 ] 2>/dev/null; then
      cpu_ms=$(awk "BEGIN{printf \"%.0f\", $cpuraw/1000000}")
      if [ "$cpu_ms" -ge 60000 ]; then
        cpu="$(awk "BEGIN{printf \"%.1f\", $cpu_ms/60000}")min"
      elif [ "$cpu_ms" -ge 1000 ]; then
        cpu="$(awk "BEGIN{printf \"%.1f\", $cpu_ms/1000}")s"
      else
        cpu="${cpu_ms}ms"
      fi
    fi

    # Compute uptime if active
    uptime=""
    if [ "$active" = "active" ] && [ -n "$started" ] && [ "$started" != "" ]; then
      start_epoch=$(date -d "$started" +%s 2>/dev/null)
      if [ -n "$start_epoch" ]; then
        now_epoch=$(date +%s)
        diff=$((now_epoch - start_epoch))
        if [ "$diff" -ge 86400 ]; then
          uptime="$(( diff / 86400 ))d $(( (diff % 86400) / 3600 ))h"
        elif [ "$diff" -ge 3600 ]; then
          uptime="$(( diff / 3600 ))h $(( (diff % 3600) / 60 ))m"
        elif [ "$diff" -ge 60 ]; then
          uptime="$(( diff / 60 ))m $(( diff % 60 ))s"
        else
          uptime="${diff}s"
        fi
      fi
    fi

    started_esc=$(printf '%s' "$started" | sed 's/"/\\"/g')

    printf '{"name":"%s","load_state":"%s","active_state":"%s","sub_state":"%s","description":"%s","enabled":"%s","service_type":"%s","main_pid":%s,"memory":"%s","cpu":"%s","started_at":"%s","uptime":"%s"}\n' \
      "$name" "$load" "$active" "$sub" "$desc" "$enabled" "$stype" "${mpid:-0}" "$mem" "$cpu" "$started_esc" "$uptime"
  done
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
    printf '{"name":"%s.service","load_state":"loaded","active_state":"%s","sub_state":"%s","description":"","enabled":"","service_type":"","main_pid":0,"memory":"","cpu":"","started_at":"","uptime":""}\n' \
      "$name" "$active" "$sub"
  done
else
  echo "INIT:unknown"
fi
"""


SERVICE_DETAIL_SCRIPT_TEMPLATE = 'systemctl show {name} --no-pager 2>/dev/null'

SERVICE_LOGS_SCRIPT_TEMPLATE = 'journalctl -u {name} --no-pager -n {lines} --output=short-iso 2>/dev/null || echo "JOURNALCTL_UNAVAILABLE"'

SERVICE_UNIT_FILE_SCRIPT_TEMPLATE = 'systemctl cat {name} 2>/dev/null; echo "UNIT_EXIT:$?"'


@router.get("/{connection_id}/services", response_model=ServiceListResponse)
async def list_services(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List system services with extended info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, SERVICES_SCRIPT, timeout=30)
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

    running = sum(1 for s in services if s.active_state == "active")
    failed = sum(1 for s in services if s.active_state == "failed")
    inactive = sum(1 for s in services if s.active_state == "inactive")
    enabled_count = sum(1 for s in services if s.enabled in ("enabled", "enabled-runtime"))

    return ServiceListResponse(
        services=services,
        init_system=init_system,
        total=len(services),
        running=running,
        failed=failed,
        inactive=inactive,
        enabled_count=enabled_count,
    )


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


@router.get("/{connection_id}/services/{service_name}/detail", response_model=ServiceDetailResponse)
async def get_service_detail(
    connection_id: str,
    service_name: str,
    current_user: User = Depends(get_current_user),
):
    """Get detailed information about a specific systemd service."""
    await _verify_connection(connection_id, current_user)

    if not service_name.replace(".", "").replace("-", "").replace("_", "").replace("@", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid service name")

    cmd = SERVICE_DETAIL_SCRIPT_TEMPLATE.format(name=_sanitize_shell(service_name))
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    props = {}
    for line in stdout.split("\n"):
        if "=" in line:
            key, _, value = line.partition("=")
            props[key.strip()] = value.strip()

    def split_list(val: str) -> list[str]:
        return [v.strip() for v in val.split() if v.strip()] if val else []

    return ServiceDetailResponse(
        name=service_name,
        description=props.get("Description", ""),
        load_state=props.get("LoadState", ""),
        active_state=props.get("ActiveState", ""),
        sub_state=props.get("SubState", ""),
        enabled=props.get("UnitFileState", ""),
        service_type=props.get("Type", ""),
        main_pid=int(props.get("MainPID", "0") or "0"),
        exec_main_pid=int(props.get("ExecMainPID", "0") or "0"),
        memory_current=props.get("MemoryCurrent", ""),
        cpu_usage=props.get("CPUUsageNSec", ""),
        tasks_current=props.get("TasksCurrent", ""),
        restart_policy=props.get("Restart", ""),
        restart_count=int(props.get("NRestarts", "0") or "0"),
        started_at=props.get("ActiveEnterTimestamp", ""),
        active_enter=props.get("ActiveEnterTimestamp", ""),
        inactive_enter=props.get("InactiveEnterTimestamp", ""),
        unit_file_path=props.get("UnitFilePreset", ""),
        fragment_path=props.get("FragmentPath", ""),
        wants=split_list(props.get("Wants", "")),
        required_by=split_list(props.get("RequiredBy", "")),
        after=split_list(props.get("After", "")),
        before=split_list(props.get("Before", "")),
        environment=split_list(props.get("Environment", "")),
        exec_start=props.get("ExecStart", ""),
        user=props.get("User", ""),
        group=props.get("Group", ""),
        working_directory=props.get("WorkingDirectory", ""),
        root_directory=props.get("RootDirectory", ""),
        properties=props,
    )


@router.get("/{connection_id}/services/{service_name}/logs", response_model=ServiceLogsResponse)
async def get_service_logs(
    connection_id: str,
    service_name: str,
    lines: int = Query(default=100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
):
    """Get recent journal log entries for a service."""
    await _verify_connection(connection_id, current_user)

    if not service_name.replace(".", "").replace("-", "").replace("_", "").replace("@", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid service name")

    cmd = SERVICE_LOGS_SCRIPT_TEMPLATE.format(
        name=_sanitize_shell(service_name),
        lines=min(lines, 1000),
    )
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()

    log_entries: list[ServiceLogEntry] = []
    if stdout and "JOURNALCTL_UNAVAILABLE" not in stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Parse ISO format: 2024-01-15T10:30:00+0000 hostname unit[pid]: message
            parts = line.split(" ", 3)
            timestamp = parts[0] if len(parts) > 0 else ""
            message = parts[3] if len(parts) > 3 else parts[-1] if parts else line
            log_entries.append(ServiceLogEntry(
                timestamp=timestamp,
                message=message,
                priority="",
            ))

    return ServiceLogsResponse(
        lines=log_entries,
        unit=service_name,
        total=len(log_entries),
    )


@router.get("/{connection_id}/services/{service_name}/unit-file", response_model=ServiceUnitFileResponse)
async def get_service_unit_file(
    connection_id: str,
    service_name: str,
    current_user: User = Depends(get_current_user),
):
    """Get the unit file contents for a service."""
    await _verify_connection(connection_id, current_user)

    if not service_name.replace(".", "").replace("-", "").replace("_", "").replace("@", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid service name")

    cmd = SERVICE_UNIT_FILE_SCRIPT_TEMPLATE.format(name=_sanitize_shell(service_name))
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    content = ""
    path = ""
    for line in stdout.split("\n"):
        if line.startswith("UNIT_EXIT:"):
            continue
        if line.startswith("# /") and not content:
            path = line[2:].strip()
            content += line + "\n"
        else:
            content += line + "\n"

    return ServiceUnitFileResponse(
        path=path,
        content=content.strip(),
        unit=service_name,
    )


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
LOG=""
DATEFMT="iso"

# Try journalctl first with both unit names (sshd.service for RHEL, ssh.service for Debian/Ubuntu)
if command -v journalctl >/dev/null 2>&1; then
  LOG=$(journalctl _SYSTEMD_UNIT=sshd.service --no-pager -n 500 -o short-iso 2>/dev/null | grep -iE "Failed password|Invalid user" | tail -200)
  if [ -z "$LOG" ]; then
    LOG=$(journalctl _SYSTEMD_UNIT=ssh.service --no-pager -n 500 -o short-iso 2>/dev/null | grep -iE "Failed password|Invalid user" | tail -200)
  fi
fi

# Fallback to log files if journalctl produced nothing
if [ -z "$LOG" ] && [ -f /var/log/auth.log ]; then
  LOG=$(grep -iE "Failed password|Invalid user" /var/log/auth.log 2>/dev/null | tail -200)
  DATEFMT="syslog"
fi
if [ -z "$LOG" ] && [ -f /var/log/secure ]; then
  LOG=$(grep -iE "Failed password|Invalid user" /var/log/secure 2>/dev/null | tail -200)
  DATEFMT="syslog"
fi

[ -z "$LOG" ] && exit 0

echo "$LOG" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  # Extract username (POSIX sed, no grep -oP)
  user=$(echo "$line" | sed -n "s/.*Failed password for invalid user \([^ ]*\).*/\1/p")
  [ -z "$user" ] && user=$(echo "$line" | sed -n "s/.*Failed password for \([^ ]*\).*/\1/p")
  [ -z "$user" ] && user=$(echo "$line" | sed -n "s/.*Invalid user \([^ ]*\).*/\1/p")
  [ -z "$user" ] && user="unknown"
  # Extract source IP (POSIX sed)
  source=$(echo "$line" | sed -n "s/.*from \([^ ]*\).*/\1/p")
  [ -z "$source" ] && source="unknown"
  # Extract date based on log format
  if [ "$DATEFMT" = "iso" ]; then
    date=$(echo "$line" | awk "{print \$1}")
  else
    date=$(echo "$line" | awk "{print \$1,\$2,\$3}")
  fi
  printf "{\"date\":\"%s\",\"user\":\"%s\",\"source\":\"%s\",\"service\":\"sshd\"}\n" "$date" "$user" "$source"
done
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
# Firewall: Client IP
# ---------------------------------------------------------------------------

@router.get("/client-ip", response_model=ClientIpResponse)
async def get_client_ip(request: Request):
    """Return the IP address of the visitor making the request."""
    ip = ""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    if not ip:
        ip = request.headers.get("x-real-ip", "").strip()
    if not ip and request.client:
        ip = request.client.host
    return ClientIpResponse(ip=ip or "unknown")


# ---------------------------------------------------------------------------
# Firewall: Overview
# ---------------------------------------------------------------------------

FIREWALL_OVERVIEW_SCRIPT = r"""
sh -c '
# --- UFW ---
if command -v ufw >/dev/null 2>&1; then
  ufw_ver=$(ufw version 2>/dev/null | head -1 | grep -oP "[0-9]+\.[0-9]+[0-9.]*" || echo "")
  ufw_status=$(sudo ufw status verbose 2>/dev/null)
  ufw_active="false"
  ufw_rules=0
  ufw_def_in=""
  ufw_def_out=""
  if echo "$ufw_status" | grep -q "Status: active"; then
    ufw_active="true"
  fi
  ufw_rules=$(sudo ufw status numbered 2>/dev/null | grep -c "^\[" || echo "0")
  ufw_def_in=$(echo "$ufw_status" | grep "Default:" | head -1 | sed -n "s/.*Default: \([a-z]*\) (incoming).*/\1/p")
  ufw_def_out=$(echo "$ufw_status" | grep "Default:" | head -1 | sed -n "s/.*, \([a-z]*\) (outgoing).*/\1/p")
  printf "UFW_INFO:%s|%s|%s|%s|%s\n" "$ufw_ver" "$ufw_active" "$ufw_rules" "$ufw_def_in" "$ufw_def_out"
else
  echo "UFW_INFO:not_installed"
fi

# --- iptables ---
if command -v iptables >/dev/null 2>&1; then
  ipt_ver=$(iptables --version 2>/dev/null | grep -oP "[0-9]+\.[0-9]+[0-9.]*" || echo "")
  ipt_rules=$(sudo iptables -L INPUT -n --line-numbers 2>/dev/null | grep -c "^[0-9]" || echo "0")
  ipt_rules=$((ipt_rules + $(sudo iptables -L OUTPUT -n --line-numbers 2>/dev/null | grep -c "^[0-9]" || echo "0")))
  ipt_rules=$((ipt_rules + $(sudo iptables -L FORWARD -n --line-numbers 2>/dev/null | grep -c "^[0-9]" || echo "0")))
  ipt_pol_in=$(sudo iptables -L INPUT -n 2>/dev/null | head -1 | grep -oP "\(policy \K[A-Z]+" || echo "")
  ipt_pol_out=$(sudo iptables -L OUTPUT -n 2>/dev/null | head -1 | grep -oP "\(policy \K[A-Z]+" || echo "")
  printf "IPTABLES_INFO:%s|%s|%s|%s\n" "$ipt_ver" "$ipt_rules" "$ipt_pol_in" "$ipt_pol_out"
else
  echo "IPTABLES_INFO:not_installed"
fi

# --- firewalld ---
if command -v firewall-cmd >/dev/null 2>&1; then
  fwd_ver=$(sudo firewall-cmd --version 2>/dev/null || echo "")
  fwd_state=$(sudo firewall-cmd --state 2>/dev/null || echo "not running")
  fwd_active="false"
  [ "$fwd_state" = "running" ] && fwd_active="true"
  fwd_rules=0
  if [ "$fwd_active" = "true" ]; then
    fwd_rules=$(sudo firewall-cmd --list-all 2>/dev/null | grep -cE "^\s+(services|ports|rich rules):" || echo "0")
  fi
  fwd_zone=$(sudo firewall-cmd --get-default-zone 2>/dev/null || echo "")
  printf "FIREWALLD_INFO:%s|%s|%s|%s\n" "$fwd_ver" "$fwd_active" "$fwd_rules" "$fwd_zone"
else
  echo "FIREWALLD_INFO:not_installed"
fi

# --- Server IPs ---
public_ip=$(wget -T 5 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || curl -m 5 -4Ls "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || echo "")
printf "PUBLIC_IP:%s\n" "$public_ip"

echo "LOCAL_IPS_START"
ip -4 addr show 2>/dev/null | grep "inet " | awk "{print \$2}" | cut -d/ -f1 | grep -v "^127\." | while read -r lip; do
  echo "$lip"
done
echo "LOCAL_IPS_END"

# --- SSH port ---
ssh_port=$(ss -tlnp 2>/dev/null | grep -E "sshd|dropbear" | head -1 | grep -oP ":\K[0-9]+" | head -1 || echo "22")
[ -z "$ssh_port" ] && ssh_port="22"
printf "SSH_PORT:%s\n" "$ssh_port"
' 2>/dev/null
"""


@router.get("/{connection_id}/firewall/overview", response_model=FirewallOverview)
async def get_firewall_overview(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Detect all firewall backends, their status, and server network info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, FIREWALL_OVERVIEW_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    backends: list[FirewallBackendInfo] = []
    server_public_ip = ""
    server_local_ips: list[str] = []
    ssh_port = 22
    in_local_ips = False
    primary_backend = ""

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("UFW_INFO:"):
            val = line.split(":", 1)[1]
            if val == "not_installed":
                backends.append(FirewallBackendInfo(name="ufw", installed=False))
            else:
                parts = val.split("|")
                active = parts[1] == "true" if len(parts) > 1 else False
                b = FirewallBackendInfo(
                    name="ufw",
                    installed=True,
                    active=active,
                    version=parts[0] if parts else "",
                    rules_count=int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0,
                    default_incoming=parts[3] if len(parts) > 3 else "",
                    default_outgoing=parts[4] if len(parts) > 4 else "",
                )
                backends.append(b)
                if active and not primary_backend:
                    primary_backend = "ufw"
        elif line.startswith("IPTABLES_INFO:"):
            val = line.split(":", 1)[1]
            if val == "not_installed":
                backends.append(FirewallBackendInfo(name="iptables", installed=False))
            else:
                parts = val.split("|")
                rules_count = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
                b = FirewallBackendInfo(
                    name="iptables",
                    installed=True,
                    active=True,
                    version=parts[0] if parts else "",
                    rules_count=rules_count,
                    default_incoming=parts[2] if len(parts) > 2 else "",
                    default_outgoing=parts[3] if len(parts) > 3 else "",
                )
                backends.append(b)
                if not primary_backend and rules_count > 0:
                    primary_backend = "iptables"
        elif line.startswith("FIREWALLD_INFO:"):
            val = line.split(":", 1)[1]
            if val == "not_installed":
                backends.append(FirewallBackendInfo(name="firewalld", installed=False))
            else:
                parts = val.split("|")
                active = parts[1] == "true" if len(parts) > 1 else False
                b = FirewallBackendInfo(
                    name="firewalld",
                    installed=True,
                    active=active,
                    version=parts[0] if parts else "",
                    rules_count=int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0,
                    default_incoming=parts[3] if len(parts) > 3 else "",
                )
                backends.append(b)
                if active and not primary_backend:
                    primary_backend = "firewalld"
        elif line.startswith("PUBLIC_IP:"):
            server_public_ip = line.split(":", 1)[1]
        elif line == "LOCAL_IPS_START":
            in_local_ips = True
        elif line == "LOCAL_IPS_END":
            in_local_ips = False
        elif in_local_ips and line:
            server_local_ips.append(line)
        elif line.startswith("SSH_PORT:"):
            try:
                ssh_port = int(line.split(":", 1)[1])
            except ValueError:
                ssh_port = 22

    # If no primary backend was set, pick first active one
    if not primary_backend:
        for b in backends:
            if b.installed and b.active:
                primary_backend = b.name
                break

    return FirewallOverview(
        backends=backends,
        primary_backend=primary_backend,
        server_public_ip=server_public_ip,
        server_local_ips=server_local_ips,
        dashboard_port=config.port,
        ssh_port=ssh_port,
    )


# ---------------------------------------------------------------------------
# Firewall: UFW
# ---------------------------------------------------------------------------

UFW_STATUS_SCRIPT = r"""
sh -c '
if ! command -v ufw >/dev/null 2>&1; then
  echo "ERROR:UFW is not installed"
  exit 0
fi
ufw_ver=$(ufw version 2>/dev/null | head -1 | grep -oP "[0-9]+\.[0-9]+[0-9.]*" || echo "")
printf "VERSION:%s\n" "$ufw_ver"

status=$(sudo ufw status verbose 2>/dev/null)
if echo "$status" | grep -q "Status: active"; then
  echo "ACTIVE:true"
else
  echo "ACTIVE:false"
fi

# Logging level
log_level=$(echo "$status" | grep "^Logging:" | sed "s/^Logging: //" || echo "")
printf "LOGGING:%s\n" "$log_level"

# Defaults
def_in=$(echo "$status" | grep "Default:" | head -1 | sed -n "s/.*Default: \([a-z]*\) (incoming).*/\1/p")
def_out=$(echo "$status" | grep "Default:" | head -1 | sed -n "s/.*, \([a-z]*\) (outgoing).*/\1/p")
def_routed=$(echo "$status" | grep "Default:" | head -1 | sed -n "s/.*, \([a-z]*\) (routed).*/\1/p")
printf "DEFAULTS:%s|%s|%s\n" "$def_in" "$def_out" "$def_routed"

echo "RULES_START"
sudo ufw status numbered 2>/dev/null | grep "^\[" | while IFS= read -r line; do
  num=$(echo "$line" | grep -oP "^\[\s*\K\d+")
  rest=$(echo "$line" | sed "s/^\[\s*[0-9]*\]\s*//")
  v6="false"
  echo "$rest" | grep -q "(v6)" && v6="true"

  # Parse action
  action=$(echo "$rest" | awk "{print \$1}" | tr "[:upper:]" "[:lower:]")

  # Parse direction
  direction="in"
  echo "$rest" | grep -qi "out" && direction="out"

  # Parse protocol from the raw line
  proto=""
  if echo "$rest" | grep -qi "/tcp"; then
    proto="tcp"
  elif echo "$rest" | grep -qi "/udp"; then
    proto="udp"
  fi

  # Extract port
  port=""
  if echo "$rest" | grep -qP "\d+(/tcp|/udp)?"; then
    port=$(echo "$rest" | grep -oP "\d+([:/]\d+)?(?=/tcp|/udp| )" | head -1)
  fi
  [ -z "$port" ] && port=$(echo "$rest" | grep -oP "^\S+" | grep -oP "\d+([:/]\d+)?" | head -1)

  # Extract from IP
  from_ip="Anywhere"
  if echo "$rest" | grep -q "from"; then
    from_ip=$(echo "$rest" | sed -n "s/.*from \([^ ]*\).*/\1/p")
  fi

  # Extract comment
  comment=""
  if echo "$rest" | grep -q "# "; then
    comment=$(echo "$rest" | sed "s/.*# //")
  fi

  raw_esc=$(printf "%s" "$rest" | sed "s/\"/\\\\\"/g")
  from_esc=$(printf "%s" "$from_ip" | sed "s/\"/\\\\\"/g")
  comment_esc=$(printf "%s" "$comment" | sed "s/\"/\\\\\"/g")
  printf "{\"number\":%s,\"action\":\"%s\",\"direction\":\"%s\",\"protocol\":\"%s\",\"port\":\"%s\",\"from_ip\":\"%s\",\"to_ip\":\"any\",\"v6\":%s,\"raw\":\"%s\",\"comment\":\"%s\"}\n" \
    "$num" "$action" "$direction" "$proto" "$port" "$from_esc" "$v6" "$raw_esc" "$comment_esc"
done
echo "RULES_END"
' 2>/dev/null
"""


@router.get("/{connection_id}/firewall/ufw/status", response_model=UfwStatus)
async def get_ufw_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get full UFW status and rules."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, UFW_STATUS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=400, detail=stdout.split("ERROR:", 1)[1])

    version = ""
    active = False
    logging_level = ""
    default_incoming = ""
    default_outgoing = ""
    default_routed = ""
    rules: list[UfwRule] = []
    in_rules = False

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("VERSION:"):
            version = line.split(":", 1)[1]
        elif line.startswith("ACTIVE:"):
            active = line.split(":", 1)[1] == "true"
        elif line.startswith("LOGGING:"):
            logging_level = line.split(":", 1)[1]
        elif line.startswith("DEFAULTS:"):
            parts = line.split(":", 1)[1].split("|")
            default_incoming = parts[0] if len(parts) > 0 else ""
            default_outgoing = parts[1] if len(parts) > 1 else ""
            default_routed = parts[2] if len(parts) > 2 else ""
        elif line == "RULES_START":
            in_rules = True
        elif line == "RULES_END":
            in_rules = False
        elif in_rules and line:
            try:
                rules.append(UfwRule(**json.loads(line)))
            except Exception:
                continue

    return UfwStatus(
        active=active,
        version=version,
        logging=logging_level,
        default_incoming=default_incoming,
        default_outgoing=default_outgoing,
        default_routed=default_routed,
        rules=rules,
    )


@router.post("/{connection_id}/firewall/ufw/toggle")
async def toggle_ufw(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Enable or disable UFW."""
    await _verify_connection(connection_id, current_user)

    status = await _run(connection_id, "sudo ufw status 2>/dev/null", timeout=5)
    is_active = "Status: active" in status.get("stdout", "")
    if is_active:
        cmd = "echo 'y' | sudo ufw disable 2>&1; echo EXIT:$?"
    else:
        cmd = "echo 'y' | sudo ufw enable 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to toggle UFW: {clean}")

    return {"message": f"UFW {'disabled' if is_active else 'enabled'} successfully"}


@router.post("/{connection_id}/firewall/ufw/add-rule")
async def add_ufw_rule(
    connection_id: str,
    request: UfwRuleAdd,
    current_user: User = Depends(get_current_user),
):
    """Add a UFW rule."""
    await _verify_connection(connection_id, current_user)

    port = _sanitize_shell(request.port)
    from_ip = _sanitize_shell(request.from_ip)
    to_ip = _sanitize_shell(request.to_ip)
    comment = _sanitize_shell(request.comment)

    parts = ["sudo", "ufw"]
    parts.append(request.action)
    if request.direction == "out":
        parts.append("out")
    if from_ip and from_ip != "any":
        parts.append(f"from {from_ip}")
    if port:
        if to_ip and to_ip != "any":
            parts.append(f"to {to_ip}")
            parts.append(f"port {port}")
        else:
            parts.append(f"to any port {port}")
        if request.protocol != "any":
            parts.append(f"proto {request.protocol}")
    elif to_ip and to_ip != "any":
        parts.append(f"to {to_ip}")
    if comment:
        parts.append(f"comment '{comment}'")
    cmd = " ".join(parts) + " 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to add rule: {clean}")

    return {"message": "UFW rule added"}


@router.post("/{connection_id}/firewall/ufw/edit-rule")
async def edit_ufw_rule(
    connection_id: str,
    request: UfwRuleEdit,
    current_user: User = Depends(get_current_user),
):
    """Edit a UFW rule by deleting it and re-adding with new values."""
    await _verify_connection(connection_id, current_user)

    port = _sanitize_shell(request.port)
    from_ip = _sanitize_shell(request.from_ip)
    to_ip = _sanitize_shell(request.to_ip)
    comment = _sanitize_shell(request.comment)

    # Step 1: Delete the old rule
    del_cmd = f"echo 'y' | sudo ufw delete {request.rule_number} 2>&1; echo EXIT:$?"
    del_result = await _run(connection_id, del_cmd, timeout=10)
    del_stdout = del_result.get("stdout", "").strip()
    del_exit, del_clean = _parse_exit_code(del_stdout)

    if del_exit != "0":
        raise HTTPException(status_code=400, detail=f"Failed to delete old rule: {del_clean}")

    # Step 2: Add the new rule
    parts = ["sudo", "ufw"]
    parts.append(request.action)
    if request.direction == "out":
        parts.append("out")
    if from_ip and from_ip != "any":
        parts.append(f"from {from_ip}")
    if port:
        if to_ip and to_ip != "any":
            parts.append(f"to {to_ip}")
            parts.append(f"port {port}")
        else:
            parts.append(f"to any port {port}")
        if request.protocol != "any":
            parts.append(f"proto {request.protocol}")
    elif to_ip and to_ip != "any":
        parts.append(f"to {to_ip}")
    if comment:
        parts.append(f"comment '{comment}'")
    add_cmd = " ".join(parts) + " 2>&1; echo EXIT:$?"

    add_result = await _run(connection_id, add_cmd, timeout=10)
    add_stdout = add_result.get("stdout", "").strip()
    add_exit, add_clean = _parse_exit_code(add_stdout)

    if add_exit != "0":
        raise HTTPException(status_code=400, detail=f"Deleted old rule but failed to add new one: {add_clean}")

    return {"message": "UFW rule updated"}


@router.post("/{connection_id}/firewall/ufw/delete-rule")
async def delete_ufw_rule(
    connection_id: str,
    request: UfwRuleDelete,
    current_user: User = Depends(get_current_user),
):
    """Delete a UFW rule by number."""
    await _verify_connection(connection_id, current_user)

    cmd = f"echo 'y' | sudo ufw delete {request.rule_number} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to delete rule: {clean}")

    return {"message": "UFW rule deleted"}


@router.post("/{connection_id}/firewall/ufw/defaults")
async def update_ufw_defaults(
    connection_id: str,
    request: UfwDefaultsUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update UFW default policies."""
    await _verify_connection(connection_id, current_user)

    cmd = f"sudo ufw default {request.incoming} incoming 2>&1 && sudo ufw default {request.outgoing} outgoing 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to update defaults: {clean}")

    return {"message": "UFW defaults updated"}


@router.post("/{connection_id}/firewall/ufw/reset")
async def reset_ufw(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Reset UFW to factory defaults."""
    await _verify_connection(connection_id, current_user)

    cmd = "echo 'y' | sudo ufw reset 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to reset UFW: {clean}")

    return {"message": "UFW reset to defaults"}


# ---------------------------------------------------------------------------
# Firewall: iptables
# ---------------------------------------------------------------------------

IPTABLES_STATUS_SCRIPT = r"""
sh -c '
if ! command -v iptables >/dev/null 2>&1; then
  echo "ERROR:iptables is not installed"
  exit 0
fi

# Chain policies
pol_in=$(sudo iptables -L INPUT -n 2>/dev/null | head -1 | grep -oP "\(policy \K[A-Z]+" || echo "ACCEPT")
pol_out=$(sudo iptables -L OUTPUT -n 2>/dev/null | head -1 | grep -oP "\(policy \K[A-Z]+" || echo "ACCEPT")
pol_fwd=$(sudo iptables -L FORWARD -n 2>/dev/null | head -1 | grep -oP "\(policy \K[A-Z]+" || echo "ACCEPT")
printf "POLICIES:%s|%s|%s\n" "$pol_in" "$pol_out" "$pol_fwd"

echo "RULES_START"
for chain in INPUT OUTPUT FORWARD; do
  sudo iptables -L "$chain" -n --line-numbers -v 2>/dev/null | tail -n +3 | while IFS= read -r line; do
    [ -z "$line" ] && continue
    num=$(echo "$line" | awk "{print \$1}")
    target=$(echo "$line" | awk "{print \$4}")
    proto=$(echo "$line" | awk "{print \$5}")
    in_if=$(echo "$line" | awk "{print \$7}")
    out_if=$(echo "$line" | awk "{print \$8}")
    src=$(echo "$line" | awk "{print \$9}")
    dst=$(echo "$line" | awk "{print \$10}")
    extra=$(echo "$line" | awk "{for(i=11;i<=NF;i++) printf \"%s \", \$i; print \"\"}" | sed "s/ *$//")
    # Extract dport from extra
    dport=$(echo "$extra" | grep -oP "dpt:\K[0-9:]+" || echo "")
    raw_esc=$(printf "%s" "$line" | sed "s/\"/\\\\\"/g")
    extra_esc=$(printf "%s" "$extra" | sed "s/\"/\\\\\"/g")
    printf "{\"chain\":\"%s\",\"number\":%s,\"target\":\"%s\",\"protocol\":\"%s\",\"source\":\"%s\",\"destination\":\"%s\",\"port\":\"%s\",\"in_interface\":\"%s\",\"out_interface\":\"%s\",\"extra\":\"%s\",\"raw\":\"%s\"}\n" \
      "$chain" "$num" "$target" "$proto" "$src" "$dst" "$dport" "$in_if" "$out_if" "$extra_esc" "$raw_esc"
  done
done
echo "RULES_END"
' 2>/dev/null
"""


@router.get("/{connection_id}/firewall/iptables/status", response_model=IptablesStatus)
async def get_iptables_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get iptables status for filter table (INPUT/OUTPUT/FORWARD)."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, IPTABLES_STATUS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=400, detail=stdout.split("ERROR:", 1)[1])

    policy_input = "ACCEPT"
    policy_output = "ACCEPT"
    policy_forward = "ACCEPT"
    rules: list[IptablesRule] = []
    in_rules = False

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("POLICIES:"):
            parts = line.split(":", 1)[1].split("|")
            policy_input = parts[0] if len(parts) > 0 else "ACCEPT"
            policy_output = parts[1] if len(parts) > 1 else "ACCEPT"
            policy_forward = parts[2] if len(parts) > 2 else "ACCEPT"
        elif line == "RULES_START":
            in_rules = True
        elif line == "RULES_END":
            in_rules = False
        elif in_rules and line:
            try:
                rules.append(IptablesRule(**json.loads(line)))
            except Exception:
                continue

    return IptablesStatus(
        active=True,
        policy_input=policy_input,
        policy_output=policy_output,
        policy_forward=policy_forward,
        rules=rules,
    )


@router.post("/{connection_id}/firewall/iptables/add-rule")
async def add_iptables_rule(
    connection_id: str,
    request: IptablesRuleAdd,
    current_user: User = Depends(get_current_user),
):
    """Add an iptables rule."""
    await _verify_connection(connection_id, current_user)

    source = _sanitize_shell(request.source)
    destination = _sanitize_shell(request.destination)
    port = _sanitize_shell(request.port)

    parts = ["sudo", "iptables"]
    if request.position > 0:
        parts.extend(["-I", request.chain, str(request.position)])
    else:
        parts.extend(["-A", request.chain])
    parts.extend(["-p", request.protocol])
    if source and source != "0.0.0.0/0":
        parts.extend(["-s", source])
    if destination and destination != "0.0.0.0/0":
        parts.extend(["-d", destination])
    if port and request.protocol in ("tcp", "udp"):
        parts.extend(["--dport", port])
    parts.extend(["-j", request.target])
    cmd = " ".join(parts) + " 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to add iptables rule: {clean}")

    return {"message": "iptables rule added"}


@router.post("/{connection_id}/firewall/iptables/delete-rule")
async def delete_iptables_rule(
    connection_id: str,
    request: IptablesRuleDelete,
    current_user: User = Depends(get_current_user),
):
    """Delete an iptables rule by chain and rule number."""
    await _verify_connection(connection_id, current_user)

    cmd = f"sudo iptables -D {request.chain} {request.rule_number} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to delete iptables rule: {clean}")

    return {"message": "iptables rule deleted"}


@router.post("/{connection_id}/firewall/iptables/policy")
async def set_iptables_policy(
    connection_id: str,
    request: IptablesPolicyUpdate,
    current_user: User = Depends(get_current_user),
):
    """Set the default policy for an iptables chain."""
    await _verify_connection(connection_id, current_user)

    cmd = f"sudo iptables -P {request.chain} {request.policy} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to set policy: {clean}")

    return {"message": f"{request.chain} policy set to {request.policy}"}


# ---------------------------------------------------------------------------
# Firewall: firewalld
# ---------------------------------------------------------------------------

FIREWALLD_STATUS_SCRIPT = r"""
sh -c '
if ! command -v firewall-cmd >/dev/null 2>&1; then
  echo "ERROR:firewalld is not installed"
  exit 0
fi

fwd_ver=$(sudo firewall-cmd --version 2>/dev/null || echo "")
printf "VERSION:%s\n" "$fwd_ver"

fwd_state=$(sudo firewall-cmd --state 2>/dev/null || echo "not running")
if [ "$fwd_state" = "running" ]; then
  echo "ACTIVE:true"
else
  echo "ACTIVE:false"
  exit 0
fi

default_zone=$(sudo firewall-cmd --get-default-zone 2>/dev/null || echo "")
printf "DEFAULT_ZONE:%s\n" "$default_zone"

echo "ZONES_START"
sudo firewall-cmd --get-active-zones 2>/dev/null | grep -v "^\s" | while read -r zone; do
  echo "$zone"
done
echo "ZONES_END"

echo "RULES_START"
# Get all rules from the default zone
zone="$default_zone"
# Services
for svc in $(sudo firewall-cmd --zone="$zone" --list-services 2>/dev/null); do
  svc_esc=$(printf "%s" "$svc" | sed "s/\"/\\\\\"/g")
  printf "{\"zone\":\"%s\",\"type\":\"service\",\"value\":\"%s\",\"permanent\":true,\"raw\":\"service: %s\"}\n" "$zone" "$svc_esc" "$svc_esc"
done
# Ports
for pt in $(sudo firewall-cmd --zone="$zone" --list-ports 2>/dev/null); do
  pt_esc=$(printf "%s" "$pt" | sed "s/\"/\\\\\"/g")
  printf "{\"zone\":\"%s\",\"type\":\"port\",\"value\":\"%s\",\"permanent\":true,\"raw\":\"port: %s\"}\n" "$zone" "$pt_esc" "$pt_esc"
done
# Rich rules
sudo firewall-cmd --zone="$zone" --list-rich-rules 2>/dev/null | while IFS= read -r rr; do
  [ -z "$rr" ] && continue
  rr_esc=$(printf "%s" "$rr" | sed "s/\"/\\\\\"/g")
  printf "{\"zone\":\"%s\",\"type\":\"rich-rule\",\"value\":\"%s\",\"permanent\":true,\"raw\":\"rich rule: %s\"}\n" "$zone" "$rr_esc" "$rr_esc"
done
# Sources
for src in $(sudo firewall-cmd --zone="$zone" --list-sources 2>/dev/null); do
  src_esc=$(printf "%s" "$src" | sed "s/\"/\\\\\"/g")
  printf "{\"zone\":\"%s\",\"type\":\"source\",\"value\":\"%s\",\"permanent\":true,\"raw\":\"source: %s\"}\n" "$zone" "$src_esc" "$src_esc"
done
echo "RULES_END"
' 2>/dev/null
"""


@router.get("/{connection_id}/firewall/firewalld/status", response_model=FirewalldStatus)
async def get_firewalld_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get firewalld status, zones, and rules."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, FIREWALLD_STATUS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=400, detail=stdout.split("ERROR:", 1)[1])

    version = ""
    active = False
    default_zone = ""
    active_zones: list[str] = []
    rules: list[FirewalldRule] = []
    in_zones = False
    in_rules = False

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("VERSION:"):
            version = line.split(":", 1)[1]
        elif line.startswith("ACTIVE:"):
            active = line.split(":", 1)[1] == "true"
        elif line.startswith("DEFAULT_ZONE:"):
            default_zone = line.split(":", 1)[1]
        elif line == "ZONES_START":
            in_zones = True
        elif line == "ZONES_END":
            in_zones = False
        elif in_zones and line:
            active_zones.append(line)
        elif line == "RULES_START":
            in_rules = True
        elif line == "RULES_END":
            in_rules = False
        elif in_rules and line:
            try:
                rules.append(FirewalldRule(**json.loads(line)))
            except Exception:
                continue

    return FirewalldStatus(
        active=active,
        version=version,
        default_zone=default_zone,
        active_zones=active_zones,
        rules=rules,
    )


@router.post("/{connection_id}/firewall/firewalld/toggle")
async def toggle_firewalld(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Start or stop firewalld."""
    await _verify_connection(connection_id, current_user)

    status = await _run(connection_id, "sudo firewall-cmd --state 2>/dev/null", timeout=5)
    is_active = status.get("stdout", "").strip() == "running"

    if is_active:
        cmd = "sudo systemctl stop firewalld 2>&1; echo EXIT:$?"
    else:
        cmd = "sudo systemctl start firewalld 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to toggle firewalld: {clean}")

    return {"message": f"firewalld {'stopped' if is_active else 'started'} successfully"}


@router.post("/{connection_id}/firewall/firewalld/add-rule")
async def add_firewalld_rule(
    connection_id: str,
    request: FirewalldRuleAdd,
    current_user: User = Depends(get_current_user),
):
    """Add a firewalld rule (port, service, rich-rule, or source)."""
    await _verify_connection(connection_id, current_user)

    value = _sanitize_shell(request.value)
    zone = _sanitize_shell(request.zone) if request.zone else ""
    zone_flag = f"--zone={zone}" if zone else ""
    permanent = "--permanent" if request.permanent else ""

    if request.type == "port":
        cmd = f"sudo firewall-cmd {zone_flag} {permanent} --add-port={value} 2>&1; echo EXIT:$?"
    elif request.type == "service":
        cmd = f"sudo firewall-cmd {zone_flag} {permanent} --add-service={value} 2>&1; echo EXIT:$?"
    elif request.type == "rich-rule":
        cmd = f'sudo firewall-cmd {zone_flag} {permanent} --add-rich-rule=\'{value}\' 2>&1; echo EXIT:$?'
    elif request.type == "source":
        cmd = f"sudo firewall-cmd {zone_flag} {permanent} --add-source={value} 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="Invalid rule type")

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to add rule: {clean}")

    # Reload if permanent
    if request.permanent:
        await _run(connection_id, "sudo firewall-cmd --reload 2>/dev/null", timeout=5)

    return {"message": "firewalld rule added"}


@router.post("/{connection_id}/firewall/firewalld/delete-rule")
async def delete_firewalld_rule(
    connection_id: str,
    request: FirewalldRuleDelete,
    current_user: User = Depends(get_current_user),
):
    """Remove a firewalld rule."""
    await _verify_connection(connection_id, current_user)

    value = _sanitize_shell(request.value)
    zone = _sanitize_shell(request.zone) if request.zone else ""
    zone_flag = f"--zone={zone}" if zone else ""

    if request.type == "port":
        cmd = f"sudo firewall-cmd {zone_flag} --permanent --remove-port={value} 2>&1; echo EXIT:$?"
    elif request.type == "service":
        cmd = f"sudo firewall-cmd {zone_flag} --permanent --remove-service={value} 2>&1; echo EXIT:$?"
    elif request.type == "rich-rule":
        cmd = f'sudo firewall-cmd {zone_flag} --permanent --remove-rich-rule=\'{value}\' 2>&1; echo EXIT:$?'
    elif request.type == "source":
        cmd = f"sudo firewall-cmd {zone_flag} --permanent --remove-source={value} 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="Invalid rule type")

    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to delete rule: {clean}")

    # Reload
    await _run(connection_id, "sudo firewall-cmd --reload 2>/dev/null", timeout=5)

    return {"message": "firewalld rule deleted"}


@router.post("/{connection_id}/firewall/firewalld/reload")
async def reload_firewalld(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Reload firewalld configuration."""
    await _verify_connection(connection_id, current_user)

    cmd = "sudo firewall-cmd --reload 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=f"Failed to reload firewalld: {clean}")

    return {"message": "firewalld reloaded"}


# ---------------------------------------------------------------------------
# Firewall: Safety checks
# ---------------------------------------------------------------------------

@router.post("/{connection_id}/firewall/safety-check", response_model=FirewallSafetyCheck)
async def firewall_safety_check(
    connection_id: str,
    request: FirewallSafetyRequest,
    current_user: User = Depends(get_current_user),
):
    """Validate a proposed firewall action for safety issues."""
    await _verify_connection(connection_id, current_user)

    warnings: list[FirewallSafetyWarning] = []
    action = request.action
    backend = request.backend
    details = request.details

    # Get current state for context
    overview_result = await _run(connection_id, FIREWALL_OVERVIEW_SCRIPT, timeout=15)
    overview_stdout = overview_result.get("stdout", "").strip()

    # Parse minimal info from overview
    ssh_port = 22
    for line in overview_stdout.split("\n"):
        line = line.strip()
        if line.startswith("SSH_PORT:"):
            try:
                ssh_port = int(line.split(":", 1)[1])
            except ValueError:
                pass

    dashboard_port = config.port

    if action == "enable_firewall":
        # Check: enabling firewall with no rules
        rules_count = details.get("rules_count", 0)
        if rules_count == 0:
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="no_rules",
                message="Enabling the firewall with no allow rules will block ALL incoming traffic.",
                suggestion="Add whitelist rules for your IP and essential ports (SSH, dashboard) before enabling.",
            ))

        # Check: dashboard port not whitelisted
        dashboard_port_allowed = details.get("dashboard_port_allowed", False)
        if not dashboard_port_allowed:
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="lockout_dashboard",
                message=f"Port {dashboard_port} (dashboard) is not whitelisted. You may lose access to this panel.",
                suggestion=f"Add an allow rule for port {dashboard_port} before enabling the firewall.",
            ))

        # Check: SSH port not whitelisted
        ssh_port_allowed = details.get("ssh_port_allowed", False)
        if not ssh_port_allowed:
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="lockout_ssh",
                message=f"Port {ssh_port} (SSH) is not whitelisted. SSH connections will be blocked.",
                suggestion=f"Add an allow rule for port {ssh_port} before enabling the firewall.",
            ))

    elif action == "disable_firewall":
        warnings.append(FirewallSafetyWarning(
            level="warning",
            code="disabling_firewall",
            message="Disabling the firewall will expose all ports to the network.",
            suggestion="Consider keeping the firewall active with appropriate rules instead.",
        ))

    elif action == "add_deny_rule":
        deny_port = str(details.get("port", ""))
        if deny_port == str(dashboard_port):
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="deny_dashboard_port",
                message=f"Adding a deny rule for port {dashboard_port} will block access to this dashboard.",
                suggestion="Remove or modify this rule if you need continued access to the management panel.",
            ))
        if deny_port == str(ssh_port):
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="deny_ssh_port",
                message=f"Adding a deny rule for port {ssh_port} will block SSH access to this server.",
                suggestion="Ensure you have alternative access (console, IPMI) before proceeding.",
            ))

    elif action == "delete_allow_rule":
        del_port = str(details.get("port", ""))
        remaining_rules = details.get("remaining_allow_rules", 1)
        is_active = details.get("firewall_active", False)

        if del_port == str(dashboard_port) and is_active:
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="delete_dashboard_allow",
                message=f"Deleting the allow rule for port {dashboard_port} may lock you out of this dashboard.",
                suggestion="Ensure you have another way to access the server before deleting this rule.",
            ))
        if del_port == str(ssh_port) and is_active:
            warnings.append(FirewallSafetyWarning(
                level="critical",
                code="delete_ssh_allow",
                message=f"Deleting the allow rule for port {ssh_port} may block your SSH access.",
                suggestion="Ensure you have console access before removing SSH allow rules.",
            ))
        if remaining_rules <= 1 and is_active:
            warnings.append(FirewallSafetyWarning(
                level="warning",
                code="last_allow_rule",
                message="This is the last allow rule. Deleting it will block all incoming traffic.",
                suggestion="Consider disabling the firewall first or adding replacement rules.",
            ))

    elif action == "change_default_policy":
        new_incoming = details.get("incoming", "")
        allow_rules = details.get("allow_rules_count", 0)

        if new_incoming in ("deny", "reject", "drop", "DROP"):
            if allow_rules == 0:
                warnings.append(FirewallSafetyWarning(
                    level="critical",
                    code="deny_all_no_allows",
                    message="Setting default incoming to deny/drop with no allow rules will block ALL traffic.",
                    suggestion="Add allow rules for SSH and the dashboard port before changing the default policy.",
                ))

            dashboard_allowed = details.get("dashboard_port_allowed", False)
            if not dashboard_allowed:
                warnings.append(FirewallSafetyWarning(
                    level="critical",
                    code="policy_lockout_dashboard",
                    message=f"Default deny with no allow rule for port {dashboard_port} will lock you out.",
                    suggestion=f"Add 'allow {dashboard_port}/tcp' before changing the default policy.",
                ))

            ssh_allowed = details.get("ssh_port_allowed", False)
            if not ssh_allowed:
                warnings.append(FirewallSafetyWarning(
                    level="critical",
                    code="policy_lockout_ssh",
                    message=f"Default deny with no allow rule for port {ssh_port} will block SSH.",
                    suggestion=f"Add 'allow {ssh_port}/tcp' before changing the default policy.",
                ))

    # General suggestion: SSH rate limiting
    if action in ("enable_firewall", "add_allow_rule"):
        ssh_rate_limited = details.get("ssh_rate_limited", False)
        if not ssh_rate_limited:
            warnings.append(FirewallSafetyWarning(
                level="info",
                code="ssh_no_rate_limit",
                message=f"SSH port {ssh_port} does not have rate limiting enabled.",
                suggestion=f"Consider using 'limit' instead of 'allow' for port {ssh_port} to protect against brute-force attacks.",
            ))

    return FirewallSafetyCheck(
        safe=not any(w.level == "critical" for w in warnings),
        warnings=warnings,
    )


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

    # Sanitize package name(s) — supports space-separated bundles
    pkg = request.package_name
    pkg_parts = pkg.split()
    for part in pkg_parts:
        if not all(c.isalnum() or c in "-._+:" for c in part):
            raise HTTPException(status_code=400, detail=f"Invalid package name: {part}")
    pkg = " ".join(pkg_parts)

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


@router.post("/{connection_id}/packages/check-installed", response_model=PackageCheckResponse)
async def check_installed_packages(
    connection_id: str,
    request: PackageCheckRequest,
    current_user: User = Depends(get_current_user),
):
    """Check which packages from a list are already installed."""
    await _verify_connection(connection_id, current_user)

    # Validate and deduplicate package names
    seen = set()
    clean_packages = []
    for pkg in request.packages:
        pkg = pkg.strip()
        if not pkg or pkg in seen:
            continue
        if not all(c.isalnum() or c in "-._+:" for c in pkg):
            raise HTTPException(status_code=400, detail=f"Invalid package name: {pkg}")
        seen.add(pkg)
        clean_packages.append(pkg)

    if not clean_packages:
        return PackageCheckResponse(installed={})

    detect = await _run(connection_id, DETECT_PKG_MANAGER_SCRIPT, timeout=5)
    manager = detect.get("stdout", "").strip().split("|")[0]

    installed = {}
    pkg_list = " ".join(clean_packages)

    if manager == "apt":
        cmd = f"dpkg-query -W -f='${{Package}}|${{Status}}\\n' {pkg_list} 2>/dev/null; true"
        result = await ssh_proxy.run_command(connection_id, cmd, timeout=15)
        stdout = result.get("stdout", "")
        installed_set = set()
        for line in stdout.strip().split("\n"):
            line = line.strip()
            if "|" in line and "install ok installed" in line:
                name = line.split("|")[0].strip()
                installed_set.add(name)
        for pkg in clean_packages:
            installed[pkg] = pkg in installed_set

    elif manager in ("dnf", "yum", "zypper"):
        cmd = f"rpm -q {pkg_list} 2>/dev/null; true"
        result = await ssh_proxy.run_command(connection_id, cmd, timeout=15)
        stdout = result.get("stdout", "")
        not_installed_set = set()
        for line in stdout.strip().split("\n"):
            line = line.strip()
            if "is not installed" in line:
                # "package XXX is not installed"
                for pkg in clean_packages:
                    if pkg in line:
                        not_installed_set.add(pkg)
        for pkg in clean_packages:
            installed[pkg] = pkg not in not_installed_set

    elif manager == "pacman":
        cmd = f"pacman -Q {pkg_list} 2>/dev/null; true"
        result = await ssh_proxy.run_command(connection_id, cmd, timeout=15)
        stdout = result.get("stdout", "")
        installed_set = set()
        for line in stdout.strip().split("\n"):
            parts = line.strip().split()
            if len(parts) >= 2:
                installed_set.add(parts[0])
        for pkg in clean_packages:
            installed[pkg] = pkg in installed_set

    elif manager == "apk":
        cmd = f"apk info -e {pkg_list} 2>/dev/null; true"
        result = await ssh_proxy.run_command(connection_id, cmd, timeout=15)
        stdout = result.get("stdout", "")
        installed_set = set()
        for line in stdout.strip().split("\n"):
            name = line.strip()
            if name:
                installed_set.add(name)
        for pkg in clean_packages:
            installed[pkg] = pkg in installed_set

    else:
        # Unknown manager — mark all as unknown/false
        for pkg in clean_packages:
            installed[pkg] = False

    return PackageCheckResponse(installed=installed)


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
# Docker — comprehensive container management
# ---------------------------------------------------------------------------

DOCKER_CHECK_SCRIPT = r"""
bash -c '
os=""
os_version=""
supported="false"
reason=""

if [ -f /etc/os-release ]; then
  os=$(grep "PRETTY_NAME" /etc/os-release | cut -d "\"" -f 2)
  os_version=$(grep "VERSION_ID" /etc/os-release | cut -d "\"" -f 2)
fi
[ -z "$os" ] && os=$(uname -s)

# Docker supports Ubuntu, Debian, CentOS, Fedora, RHEL, SLES, Raspbian
distro=""
if grep -qs "ubuntu" /etc/os-release; then distro="ubuntu"; supported="true"
elif [ -e /etc/debian_version ]; then distro="debian"; supported="true"
elif [ -e /etc/centos-release ] || [ -e /etc/almalinux-release ] || [ -e /etc/rocky-release ]; then distro="centos"; supported="true"
elif [ -e /etc/fedora-release ]; then distro="fedora"; supported="true"
elif grep -qs "rhel" /etc/os-release; then distro="rhel"; supported="true"
else reason="Unsupported distribution for Docker install script"; fi

already="false"
command -v docker >/dev/null 2>&1 && already="true"

curl_avail="false"
command -v curl >/dev/null 2>&1 && curl_avail="true"

has_systemd="false"
command -v systemctl >/dev/null 2>&1 && has_systemd="true"

printf "SUPPORTED:%s\n" "$supported"
printf "OS:%s\n" "$os"
printf "OS_VERSION:%s\n" "$os_version"
printf "ALREADY_INSTALLED:%s\n" "$already"
printf "REASON:%s\n" "$reason"
printf "CURL_AVAILABLE:%s\n" "$curl_avail"
printf "HAS_SYSTEMD:%s\n" "$has_systemd"
' 2>/dev/null
"""

DOCKER_INFO_SCRIPT = r"""
bash -c '
if ! command -v docker >/dev/null 2>&1; then
  echo "INSTALLED:false"
  exit 0
fi

daemon_running="false"
docker info >/dev/null 2>&1 && daemon_running="true"

ver=$(docker --version 2>/dev/null | awk "{print \$3}" | tr -d ",")
api=$(docker info --format "{{.ServerVersion}}" 2>/dev/null || echo "")
running=$(docker info --format "{{.ContainersRunning}}" 2>/dev/null || echo "0")
paused=$(docker info --format "{{.ContainersPaused}}" 2>/dev/null || echo "0")
stopped=$(docker info --format "{{.ContainersStopped}}" 2>/dev/null || echo "0")
images=$(docker info --format "{{.Images}}" 2>/dev/null || echo "0")
driver=$(docker info --format "{{.Driver}}" 2>/dev/null || echo "")
root_dir=$(docker info --format "{{.DockerRootDir}}" 2>/dev/null || echo "")
os_type=$(docker info --format "{{.OSType}}" 2>/dev/null || echo "")
arch=$(docker info --format "{{.Architecture}}" 2>/dev/null || echo "")

echo "INSTALLED:true"
echo "DAEMON_RUNNING:${daemon_running}"
echo "VERSION:${ver}"
echo "API_VERSION:${api}"
echo "CONTAINERS_RUNNING:${running:-0}"
echo "CONTAINERS_PAUSED:${paused:-0}"
echo "CONTAINERS_STOPPED:${stopped:-0}"
echo "IMAGES_COUNT:${images:-0}"
echo "STORAGE_DRIVER:${driver}"
echo "DOCKER_ROOT:${root_dir}"
echo "OS_TYPE:${os_type}"
echo "ARCHITECTURE:${arch}"

# Disk usage
if [ "$daemon_running" = "true" ]; then
  docker system df --format "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null | while IFS="$(printf "\t")" read -r dtype dsize dreclaim; do
    echo "DISK:${dtype}|${dsize}|${dreclaim}"
  done
  total=$(docker system df 2>/dev/null | tail -1 | awk "{print \$NF}" || echo "")
  echo "DISK_TOTAL:${total}"
fi

# Network & volume counts
net_count=$(docker network ls -q 2>/dev/null | wc -l | tr -d " ")
vol_count=$(docker volume ls -q 2>/dev/null | wc -l | tr -d " ")
echo "NETWORKS_COUNT:${net_count:-0}"
echo "VOLUMES_COUNT:${vol_count:-0}"

# Compose
compose_installed="false"
compose_version=""
if docker compose version >/dev/null 2>&1; then
  compose_installed="true"
  compose_version=$(docker compose version --short 2>/dev/null || echo "")
elif command -v docker-compose >/dev/null 2>&1; then
  compose_installed="true"
  compose_version=$(docker-compose version --short 2>/dev/null || echo "")
fi
echo "COMPOSE_INSTALLED:${compose_installed}"
echo "COMPOSE_VERSION:${compose_version}"
echo "DOCKER_INFO_END"
' 2>/dev/null
"""

DOCKER_PS_WITH_STATS_SCRIPT = r"""
bash -c '
# Get container list as JSON
echo "CONTAINERS_START"
docker ps -a --format "{{json .}}" 2>/dev/null
echo "CONTAINERS_END"

# Get stats for running containers
echo "STATS_START"
docker stats --no-stream --format "{{json .}}" 2>/dev/null
echo "STATS_END"

# Get compose labels for containers
echo "LABELS_START"
docker ps -a --format "{{.ID}}|{{.Label \"com.docker.compose.project\"}}|{{.Label \"com.docker.compose.service\"}}" 2>/dev/null
echo "LABELS_END"
' 2>/dev/null
"""

DOCKER_IMAGES_SCRIPT = r"""
docker images --format '{{json .}}' 2>/dev/null
"""

DOCKER_NETWORKS_SCRIPT = r"""
bash -c '
docker network ls --format "{{json .}}" 2>/dev/null | while read -r line; do
  id=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get(\"ID\",\"\"))" 2>/dev/null || echo "")
  if [ -n "$id" ]; then
    subnet=$(docker network inspect "$id" --format "{{range .IPAM.Config}}{{.Subnet}}{{end}}" 2>/dev/null || echo "")
    gateway=$(docker network inspect "$id" --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>/dev/null || echo "")
    containers=$(docker network inspect "$id" --format "{{len .Containers}}" 2>/dev/null || echo "0")
    internal=$(docker network inspect "$id" --format "{{.Internal}}" 2>/dev/null || echo "false")
    echo "NET:${line}|${subnet}|${gateway}|${containers}|${internal}"
  fi
done
echo "NETWORKS_END"
' 2>/dev/null
"""

DOCKER_VOLUMES_SCRIPT = r"""
bash -c '
docker volume ls --format "{{json .}}" 2>/dev/null | while read -r line; do
  name=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get(\"Name\",\"\"))" 2>/dev/null || echo "")
  if [ -n "$name" ]; then
    mp=$(docker volume inspect "$name" --format "{{.Mountpoint}}" 2>/dev/null || echo "")
    created=$(docker volume inspect "$name" --format "{{.CreatedAt}}" 2>/dev/null || echo "")
    size=$(sudo du -sh "$mp" 2>/dev/null | cut -f1 || echo "—")
    echo "VOL:${line}|${mp}|${created}|${size}"
  fi
done
echo "VOLUMES_END"
' 2>/dev/null
"""

DOCKER_COMPOSE_LS_SCRIPT = r"""
bash -c '
if docker compose version >/dev/null 2>&1; then
  docker compose ls --format json 2>/dev/null || docker compose ls 2>/dev/null
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose ls --format json 2>/dev/null || echo "[]"
else
  echo "[]"
fi
' 2>/dev/null
"""

DOCKER_UNINSTALL_SCRIPT = r"""
bash -c '
set -e

os=""
if grep -qs "ubuntu" /etc/os-release; then os="ubuntu"
elif [ -e /etc/debian_version ]; then os="debian"
elif [ -e /etc/centos-release ] || [ -e /etc/almalinux-release ] || [ -e /etc/rocky-release ]; then os="centos"
elif [ -e /etc/fedora-release ]; then os="fedora"
elif grep -qs "rhel" /etc/os-release; then os="rhel"
fi

echo ">>> Stopping Docker service..."
sudo systemctl stop docker.service 2>/dev/null || true
sudo systemctl stop docker.socket 2>/dev/null || true
sudo systemctl stop containerd.service 2>/dev/null || true
sudo systemctl disable docker.service 2>/dev/null || true
sudo systemctl disable docker.socket 2>/dev/null || true
sudo systemctl disable containerd.service 2>/dev/null || true

echo ">>> Removing Docker packages..."
if [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
  sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras 2>/dev/null || true
  sudo apt-get autoremove -y 2>/dev/null || true
elif [ "$os" = "centos" ] || [ "$os" = "fedora" ] || [ "$os" = "rhel" ]; then
  sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras 2>/dev/null || true
  sudo yum remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
fi

echo ">>> Removing Docker data directories..."
sudo rm -rf /var/lib/docker
sudo rm -rf /var/lib/containerd
sudo rm -f /etc/apt/sources.list.d/docker.list 2>/dev/null
sudo rm -f /etc/apt/keyrings/docker.asc 2>/dev/null
sudo rm -f /etc/yum.repos.d/docker-ce.repo 2>/dev/null

echo ">>> Verifying removal..."
if ! command -v docker >/dev/null 2>&1; then
  echo "DOCKER_UNINSTALL_SUCCESS"
else
  echo "DOCKER_UNINSTALL_FAILED"
fi
' 2>&1
"""


def _parse_exit_code(stdout: str) -> tuple[str, str]:
    """Extract exit code and clean output from command stdout."""
    exit_code = "1"
    clean_lines = []
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()
        else:
            clean_lines.append(line)
    return exit_code, "\n".join(clean_lines).strip()


@router.get("/{connection_id}/docker/check", response_model=DockerInstallCheck)
async def check_docker(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Pre-install check for Docker."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_CHECK_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    data: dict = {
        "supported": False, "os": "", "os_version": "",
        "already_installed": False, "reason": "",
        "curl_available": False, "has_systemd": False,
    }

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("SUPPORTED:"):
            data["supported"] = line.split(":", 1)[1] == "true"
        elif line.startswith("OS:"):
            data["os"] = line.split(":", 1)[1]
        elif line.startswith("OS_VERSION:"):
            data["os_version"] = line.split(":", 1)[1]
        elif line.startswith("ALREADY_INSTALLED:"):
            data["already_installed"] = line.split(":", 1)[1] == "true"
        elif line.startswith("REASON:"):
            data["reason"] = line.split(":", 1)[1]
        elif line.startswith("CURL_AVAILABLE:"):
            data["curl_available"] = line.split(":", 1)[1] == "true"
        elif line.startswith("HAS_SYSTEMD:"):
            data["has_systemd"] = line.split(":", 1)[1] == "true"

    return DockerInstallCheck(**data)


@router.get("/{connection_id}/docker/info", response_model=DockerInfo)
async def get_docker_info(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get comprehensive Docker daemon info."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_INFO_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    data: dict = {
        "installed": False, "version": "", "api_version": "",
        "containers_running": 0, "containers_paused": 0, "containers_stopped": 0,
        "images_count": 0, "storage_driver": "", "docker_root": "",
        "os_type": "", "architecture": "", "daemon_running": False,
        "disk_usage_images": "", "disk_usage_containers": "",
        "disk_usage_volumes": "", "disk_usage_buildcache": "",
        "disk_usage_total": "",
        "networks_count": 0, "volumes_count": 0,
        "compose_installed": False, "compose_version": "",
    }

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("INSTALLED:"):
            data["installed"] = line.split(":", 1)[1] == "true"
        elif line.startswith("DAEMON_RUNNING:"):
            data["daemon_running"] = line.split(":", 1)[1] == "true"
        elif line.startswith("VERSION:"):
            data["version"] = line.split(":", 1)[1]
        elif line.startswith("API_VERSION:"):
            data["api_version"] = line.split(":", 1)[1]
        elif line.startswith("CONTAINERS_RUNNING:"):
            data["containers_running"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("CONTAINERS_PAUSED:"):
            data["containers_paused"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("CONTAINERS_STOPPED:"):
            data["containers_stopped"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("IMAGES_COUNT:"):
            data["images_count"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("STORAGE_DRIVER:"):
            data["storage_driver"] = line.split(":", 1)[1]
        elif line.startswith("DOCKER_ROOT:"):
            data["docker_root"] = line.split(":", 1)[1]
        elif line.startswith("OS_TYPE:"):
            data["os_type"] = line.split(":", 1)[1]
        elif line.startswith("ARCHITECTURE:"):
            data["architecture"] = line.split(":", 1)[1]
        elif line.startswith("DISK:"):
            parts = line.split(":", 1)[1].split("|")
            dtype = parts[0].strip().lower() if len(parts) > 0 else ""
            dsize = parts[1].strip() if len(parts) > 1 else ""
            if "image" in dtype:
                data["disk_usage_images"] = dsize
            elif "container" in dtype:
                data["disk_usage_containers"] = dsize
            elif "volume" in dtype or "local volume" in dtype:
                data["disk_usage_volumes"] = dsize
            elif "build" in dtype:
                data["disk_usage_buildcache"] = dsize
        elif line.startswith("DISK_TOTAL:"):
            data["disk_usage_total"] = line.split(":", 1)[1]
        elif line.startswith("NETWORKS_COUNT:"):
            data["networks_count"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("VOLUMES_COUNT:"):
            data["volumes_count"] = int(line.split(":", 1)[1] or "0")
        elif line.startswith("COMPOSE_INSTALLED:"):
            data["compose_installed"] = line.split(":", 1)[1] == "true"
        elif line.startswith("COMPOSE_VERSION:"):
            data["compose_version"] = line.split(":", 1)[1]

    return DockerInfo(**data)


@router.get("/{connection_id}/docker/containers", response_model=DockerContainersResponse)
async def list_docker_containers(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker containers with resource stats."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_PS_WITH_STATS_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    containers: list[DockerContainer] = []
    stats_map: dict[str, dict] = {}
    labels_map: dict[str, dict] = {}

    in_containers = False
    in_stats = False
    in_labels = False

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line == "CONTAINERS_START":
            in_containers = True
            continue
        elif line == "CONTAINERS_END":
            in_containers = False
            continue
        elif line == "STATS_START":
            in_stats = True
            continue
        elif line == "STATS_END":
            in_stats = False
            continue
        elif line == "LABELS_START":
            in_labels = True
            continue
        elif line == "LABELS_END":
            in_labels = False
            continue

        if in_stats:
            try:
                raw = json.loads(line)
                cid = raw.get("ID", raw.get("Container", ""))[:12]
                stats_map[cid] = raw
            except (json.JSONDecodeError, Exception):
                continue
        elif in_labels:
            parts = line.split("|", 2)
            if len(parts) >= 3:
                cid = parts[0][:12]
                labels_map[cid] = {
                    "compose_project": parts[1],
                    "compose_service": parts[2],
                }
        elif in_containers:
            try:
                raw = json.loads(line)
                cid = raw.get("ID", raw.get("id", ""))
                cid_short = cid[:12]
                stat = stats_map.get(cid_short, {})
                label = labels_map.get(cid_short, {})
                containers.append(DockerContainer(
                    id=cid,
                    name=raw.get("Names", raw.get("name", "")),
                    image=raw.get("Image", raw.get("image", "")),
                    status=raw.get("Status", raw.get("status", "")),
                    state=raw.get("State", raw.get("state", "")),
                    created=raw.get("CreatedAt", raw.get("created", "")),
                    ports=raw.get("Ports", raw.get("ports", "")),
                    size=raw.get("Size", raw.get("size", "")),
                    cpu_percent=stat.get("CPUPerc", ""),
                    mem_usage=stat.get("MemUsage", "").split("/")[0].strip() if "/" in stat.get("MemUsage", "") else stat.get("MemUsage", ""),
                    mem_limit=stat.get("MemUsage", "").split("/")[1].strip() if "/" in stat.get("MemUsage", "") else "",
                    mem_percent=stat.get("MemPerc", ""),
                    net_io=stat.get("NetIO", ""),
                    block_io=stat.get("BlockIO", ""),
                    pids=stat.get("PIDs", ""),
                    compose_project=label.get("compose_project", ""),
                    compose_service=label.get("compose_service", ""),
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

    if not all(c.isalnum() or c in "-_." for c in container_id):
        raise HTTPException(status_code=400, detail="Invalid container ID")

    action = request.action
    if action == "remove":
        cmd = f"docker rm -f {container_id} 2>&1; echo EXIT:$?"
    else:
        cmd = f"docker {action} {container_id} 2>&1; echo EXIT:$?"

    result = await _run(connection_id, cmd, timeout=30)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or f"Failed to {action} container")

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
    return {"logs": result.get("stdout", ""), "container_id": container_id}


@router.get("/{connection_id}/docker/containers/{container_id}/inspect")
async def inspect_docker_container(
    connection_id: str,
    container_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get detailed Docker container inspect data."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_." for c in container_id):
        raise HTTPException(status_code=400, detail="Invalid container ID")

    cmd = f"docker inspect {container_id} 2>/dev/null"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    try:
        data = json.loads(stdout)
        if isinstance(data, list) and len(data) > 0:
            return data[0]
        return data
    except (json.JSONDecodeError, Exception):
        raise HTTPException(status_code=400, detail="Failed to inspect container")


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
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to delete image")

    return {"message": f"Image {image_id} deleted"}


@router.get("/{connection_id}/docker/networks", response_model=DockerNetworksResponse)
async def list_docker_networks(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker networks."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_NETWORKS_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    networks: list[DockerNetwork] = []
    for line in stdout.split("\n"):
        line = line.strip()
        if not line or line == "NETWORKS_END":
            continue
        if line.startswith("NET:"):
            raw_parts = line[4:].split("|", 4)
            try:
                raw = json.loads(raw_parts[0]) if raw_parts else {}
                networks.append(DockerNetwork(
                    id=raw.get("ID", ""),
                    name=raw.get("Name", ""),
                    driver=raw.get("Driver", ""),
                    scope=raw.get("Scope", ""),
                    subnet=raw_parts[1] if len(raw_parts) > 1 else "",
                    gateway=raw_parts[2] if len(raw_parts) > 2 else "",
                    containers_count=int(raw_parts[3]) if len(raw_parts) > 3 and raw_parts[3].isdigit() else 0,
                    internal=raw_parts[4] == "true" if len(raw_parts) > 4 else False,
                ))
            except (json.JSONDecodeError, Exception):
                continue

    return DockerNetworksResponse(networks=networks, total=len(networks))


@router.post("/{connection_id}/docker/networks/create")
async def create_docker_network(
    connection_id: str,
    request: DockerNetworkCreate,
    current_user: User = Depends(get_current_user),
):
    """Create a Docker network."""
    await _verify_connection(connection_id, current_user)

    name = _sanitize_shell(request.name)
    driver = _sanitize_shell(request.driver)
    subnet_flag = ""
    if request.subnet:
        subnet = _sanitize_shell(request.subnet)
        subnet_flag = f" --subnet {subnet}"

    cmd = f"docker network create --driver {driver}{subnet_flag} {name} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to create network")

    return {"message": f"Network '{name}' created"}


@router.delete("/{connection_id}/docker/networks/{network_id}")
async def delete_docker_network(
    connection_id: str,
    network_id: str,
    current_user: User = Depends(get_current_user),
):
    """Remove a Docker network."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_." for c in network_id):
        raise HTTPException(status_code=400, detail="Invalid network ID")

    cmd = f"docker network rm {network_id} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to remove network")

    return {"message": f"Network {network_id} removed"}


@router.get("/{connection_id}/docker/volumes", response_model=DockerVolumesResponse)
async def list_docker_volumes(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker volumes."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_VOLUMES_SCRIPT, timeout=20)
    stdout = result.get("stdout", "").strip()

    volumes: list[DockerVolume] = []
    for line in stdout.split("\n"):
        line = line.strip()
        if not line or line == "VOLUMES_END":
            continue
        if line.startswith("VOL:"):
            raw_parts = line[4:].split("|", 3)
            try:
                raw = json.loads(raw_parts[0]) if raw_parts else {}
                volumes.append(DockerVolume(
                    name=raw.get("Name", ""),
                    driver=raw.get("Driver", ""),
                    mountpoint=raw_parts[1] if len(raw_parts) > 1 else "",
                    created=raw_parts[2] if len(raw_parts) > 2 else "",
                    size=raw_parts[3] if len(raw_parts) > 3 else "",
                ))
            except (json.JSONDecodeError, Exception):
                continue

    return DockerVolumesResponse(volumes=volumes, total=len(volumes))


@router.post("/{connection_id}/docker/volumes/create")
async def create_docker_volume(
    connection_id: str,
    request: DockerVolumeCreate,
    current_user: User = Depends(get_current_user),
):
    """Create a Docker volume."""
    await _verify_connection(connection_id, current_user)

    name = _sanitize_shell(request.name)
    driver = _sanitize_shell(request.driver)
    cmd = f"docker volume create --driver {driver} {name} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to create volume")

    return {"message": f"Volume '{name}' created"}


@router.delete("/{connection_id}/docker/volumes/{volume_name}")
async def delete_docker_volume(
    connection_id: str,
    volume_name: str,
    current_user: User = Depends(get_current_user),
):
    """Remove a Docker volume."""
    await _verify_connection(connection_id, current_user)

    if not all(c.isalnum() or c in "-_." for c in volume_name):
        raise HTTPException(status_code=400, detail="Invalid volume name")

    cmd = f"docker volume rm {volume_name} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to remove volume")

    return {"message": f"Volume {volume_name} removed"}


@router.get("/{connection_id}/docker/compose/projects", response_model=DockerComposeProjectsResponse)
async def list_compose_projects(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """List Docker Compose projects."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_COMPOSE_LS_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    projects: list[DockerComposeProject] = []
    if stdout:
        try:
            raw_list = json.loads(stdout)
            if isinstance(raw_list, list):
                for raw in raw_list:
                    status_str = raw.get("Status", "")
                    running = 0
                    total = 0
                    # Status format: "running(2)" or "running(1), exited(1)"
                    import re
                    for m in re.finditer(r'(\w+)\((\d+)\)', status_str):
                        count = int(m.group(2))
                        total += count
                        if m.group(1) == "running":
                            running = count

                    projects.append(DockerComposeProject(
                        name=raw.get("Name", ""),
                        status=status_str,
                        config_files=raw.get("ConfigFiles", ""),
                        running_count=running,
                        total_count=total,
                    ))
        except (json.JSONDecodeError, Exception):
            pass

    return DockerComposeProjectsResponse(projects=projects, total=len(projects))


@router.post("/{connection_id}/docker/compose/action")
async def docker_compose_action(
    connection_id: str,
    request: DockerComposeAction,
    current_user: User = Depends(get_current_user),
):
    """Perform a Docker Compose action on a project."""
    await _verify_connection(connection_id, current_user)

    project_dir = _sanitize_shell(request.project_dir)
    action = request.action

    if action == "up":
        cmd = f"cd {project_dir} && docker compose up -d 2>&1; echo EXIT:$?"
    elif action == "down":
        cmd = f"cd {project_dir} && docker compose down 2>&1; echo EXIT:$?"
    elif action == "restart":
        cmd = f"cd {project_dir} && docker compose restart 2>&1; echo EXIT:$?"
    elif action == "pull":
        cmd = f"cd {project_dir} && docker compose pull 2>&1; echo EXIT:$?"
    elif action == "build":
        cmd = f"cd {project_dir} && docker compose build 2>&1; echo EXIT:$?"
    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    result = await _run(connection_id, cmd, timeout=120)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or f"Failed to {action} compose project")

    return {"message": f"Compose {action} successful", "output": clean}


@router.post("/{connection_id}/docker/compose/file/read")
async def read_compose_file(
    connection_id: str,
    request: DockerComposeFileRequest,
    current_user: User = Depends(get_current_user),
):
    """Read a Docker Compose file."""
    await _verify_connection(connection_id, current_user)

    path = _sanitize_shell(request.path)
    cmd = f"cat {path} 2>/dev/null"
    result = await _run(connection_id, cmd, timeout=5)
    stdout = result.get("stdout", "")

    if not stdout:
        raise HTTPException(status_code=404, detail="Compose file not found or empty")

    return {"content": stdout, "path": path}


@router.post("/{connection_id}/docker/compose/file/save")
async def save_compose_file(
    connection_id: str,
    request: DockerComposeFileSave,
    current_user: User = Depends(get_current_user),
):
    """Save a Docker Compose file."""
    await _verify_connection(connection_id, current_user)

    import base64
    path = _sanitize_shell(request.path)
    content_b64 = base64.b64encode(request.content.encode()).decode()
    cmd = f"echo '{content_b64}' | base64 -d > {path} 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()
    exit_code, clean = _parse_exit_code(stdout)

    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to save compose file")

    return {"message": "Compose file saved", "path": path}


@router.post("/{connection_id}/docker/uninstall")
async def uninstall_docker(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Remove Docker completely from the server."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, DOCKER_UNINSTALL_SCRIPT, timeout=120)
    stdout = result.get("stdout", "").strip()

    if "DOCKER_UNINSTALL_SUCCESS" in stdout:
        return {"message": "Docker removed successfully", "success": True, "output": stdout}
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Uninstall may have failed. Output:\n{stdout}",
        )


# ---------------------------------------------------------------------------
# WireGuard — Nyr-style server management
# ---------------------------------------------------------------------------

import re as _re

WG_CHECK_SCRIPT = r"""
bash -c '
# Detect OS
os=""
os_version=""
supported="false"
reason=""

if grep -qs "ubuntu" /etc/os-release; then
  os="ubuntu"
  os_version=$(grep "VERSION_ID" /etc/os-release | cut -d "\"" -f 2 | tr -d ".")
  if [ "$os_version" -ge 2204 ] 2>/dev/null; then supported="true"; else reason="Ubuntu 22.04+ required"; fi
elif [ -e /etc/debian_version ]; then
  os="debian"
  os_version=$(grep -oE "[0-9]+" /etc/debian_version | head -1)
  if grep -q "/sid" /etc/debian_version; then reason="Debian Testing/Unstable unsupported"
  elif [ "$os_version" -ge 11 ] 2>/dev/null; then supported="true"
  else reason="Debian 11+ required"; fi
elif [ -e /etc/almalinux-release ] || [ -e /etc/rocky-release ] || [ -e /etc/centos-release ]; then
  os="centos"
  os_version=$(grep -shoE "[0-9]+" /etc/almalinux-release /etc/rocky-release /etc/centos-release 2>/dev/null | head -1)
  if [ "$os_version" -ge 9 ] 2>/dev/null; then supported="true"; else reason="RHEL/CentOS/Alma/Rocky 9+ required"; fi
elif [ -e /etc/fedora-release ]; then
  os="fedora"
  os_version=$(grep -oE "[0-9]+" /etc/fedora-release | head -1)
  supported="true"
else
  reason="Unsupported distribution"
fi

# Pretty OS name
os_pretty="$os"
if [ -f /etc/os-release ]; then
  os_pretty=$(grep "PRETTY_NAME" /etc/os-release | cut -d "\"" -f 2)
fi

# Check if already installed
already="false"
[ -e /etc/wireguard/wg0.conf ] && already="true"

# Detect container / BoringTun need
is_container="false"
needs_boringtun="false"
if systemd-detect-virt -cq 2>/dev/null; then
  is_container="true"
  if ! grep -q "^wireguard " /proc/modules 2>/dev/null; then
    needs_boringtun="true"
    if [ "$(uname -m)" != "x86_64" ]; then
      reason="Containerized non-x86_64 unsupported for BoringTun"
      supported="false"
    fi
  fi
fi

# Get public IP
public_ip=$(wget -T 5 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || curl -m 5 -4Ls "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || echo "")

# Get local IPs
local_ips=""
for lip in $(ip -4 addr | grep inet | grep -vE "127(\.[0-9]{1,3}){3}" | cut -d "/" -f 1 | grep -oE "[0-9]{1,3}(\.[0-9]{1,3}){3}"); do
  [ -n "$local_ips" ] && local_ips="${local_ips},"
  local_ips="${local_ips}${lip}"
done

# IPv6
has_ipv6="false"
ipv6_addr=""
v6=$(ip -6 addr | grep "inet6 [23]" | cut -d "/" -f 1 | grep -oE "([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}" | head -1)
if [ -n "$v6" ]; then
  has_ipv6="true"
  ipv6_addr="$v6"
fi

printf "SUPPORTED:%s\n" "$supported"
printf "OS:%s\n" "$os_pretty"
printf "OS_VERSION:%s\n" "$os_version"
printf "ALREADY_INSTALLED:%s\n" "$already"
printf "PUBLIC_IP:%s\n" "$public_ip"
printf "LOCAL_IPS:%s\n" "$local_ips"
printf "HAS_IPV6:%s\n" "$has_ipv6"
printf "IPV6_ADDR:%s\n" "$ipv6_addr"
printf "IS_CONTAINER:%s\n" "$is_container"
printf "NEEDS_BORINGTUN:%s\n" "$needs_boringtun"
printf "REASON:%s\n" "$reason"
' 2>/dev/null
"""

WG_STATUS_SCRIPT = r"""
bash -c '
if ! command -v wg >/dev/null 2>&1 || [ ! -e /etc/wireguard/wg0.conf ]; then
  echo "INSTALLED:false"
  exit 0
fi

ver=$(wg --version 2>/dev/null | awk "{print \$2}" || echo "unknown")
echo "INSTALLED:true"
echo "VERSION:${ver}"

# Server interface info
pubkey=$(sudo wg show wg0 public-key 2>/dev/null || echo "")
listen=$(sudo wg show wg0 listen-port 2>/dev/null || echo "")
addr=$(ip -4 addr show wg0 2>/dev/null | grep -oP "inet \K[0-9./]+" | head -1)
[ -z "$addr" ] && addr=$(ip -6 addr show wg0 2>/dev/null | grep -oP "inet6 \K[0-9a-f:/]+" | head -1)

state=$(ip link show wg0 2>/dev/null | grep -oP "state \K\w+" || echo "DOWN")
active="false"
[ "$state" = "UP" ] || [ "$state" = "UNKNOWN" ] && active="true"

# Get endpoint from config comment
endpoint=$(grep "^# ENDPOINT" /etc/wireguard/wg0.conf 2>/dev/null | cut -d " " -f 3)

# Public IP for display
public_ip=$(wget -T 3 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || curl -m 3 -4Ls "http://ip1.dynupdate.no-ip.com/" 2>/dev/null || echo "")

printf "SERVER_INFO:%s|%s|%s|%s|%s|%s\n" "$pubkey" "$listen" "$addr" "$active" "$endpoint" "$public_ip"

# Parse named clients from config (BEGIN_PEER / END_PEER markers)
# Also detect disabled clients (commented-out blocks)
now=$(date +%s)
current_name=""
while IFS= read -r line; do
  if echo "$line" | grep -q "^# BEGIN_PEER "; then
    current_name=$(echo "$line" | sed "s/^# BEGIN_PEER //")
    echo "CLIENT_START:${current_name}:enabled"
  elif echo "$line" | grep -q "^# DISABLED_BEGIN_PEER "; then
    current_name=$(echo "$line" | sed "s/^# DISABLED_BEGIN_PEER //")
    echo "CLIENT_START:${current_name}:disabled"
  elif echo "$line" | grep -q "^# END_PEER \|^# DISABLED_END_PEER "; then
    echo "CLIENT_END"
    current_name=""
  fi
done < /etc/wireguard/wg0.conf

# Get live peer stats from wg show dump
total_rx=0
total_tx=0
sudo wg show wg0 dump 2>/dev/null | tail -n +2 | while IFS="$(printf "\t")" read -r pk psk ep aip hs rx tx ka; do
  hs_fmt=""
  has_recent="false"
  if [ "$hs" != "0" ] && [ -n "$hs" ]; then
    hs_fmt=$(date -d "@$hs" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -r "$hs" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "$hs")
    age=$((now - hs))
    [ "$age" -lt 180 ] && has_recent="true"
  fi
  rx_h=$(numfmt --to=iec "$rx" 2>/dev/null || echo "${rx}B")
  tx_h=$(numfmt --to=iec "$tx" 2>/dev/null || echo "${tx}B")
  ka_str=""
  [ "$ka" != "off" ] && [ -n "$ka" ] && ka_str="${ka}s"

  # Find client name for this public key
  client_name=$(grep -B1 "PublicKey = " /etc/wireguard/wg0.conf 2>/dev/null | grep -B1 "$pk" | grep -oP "BEGIN_PEER \K.*" | head -1)
  [ -z "$client_name" ] && client_name="unknown"

  printf "LIVE_PEER:%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$client_name" "$pk" "$ep" "$aip" "$hs_fmt" "$rx_h" "$tx_h" "$ka_str" "$has_recent"
done

# Total transfer
sudo wg show wg0 transfer 2>/dev/null | while IFS="$(printf "\t")" read -r pk rx tx; do
  total_rx=$((total_rx + rx))
  total_tx=$((total_tx + tx))
done
trx=$(sudo wg show wg0 transfer 2>/dev/null | awk -F"\t" "{s+=\$2} END {print s+0}")
ttx=$(sudo wg show wg0 transfer 2>/dev/null | awk -F"\t" "{s+=\$3} END {print s+0}")
trx_h=$(numfmt --to=iec "$trx" 2>/dev/null || echo "${trx}B")
ttx_h=$(numfmt --to=iec "$ttx" 2>/dev/null || echo "${ttx}B")
printf "TOTAL_TRANSFER:%s|%s\n" "$trx_h" "$ttx_h"
echo "STATUS_END"
' 2>/dev/null
"""


def _build_wg_install_script(
    endpoint: str, port: int, dns: str, first_client: str,
    local_ip: str, ipv6_addr: str,
) -> str:
    """Build a non-interactive WireGuard install script mirroring the Nyr installer."""
    # Sanitize all inputs
    endpoint = _sanitize_shell(endpoint)
    dns = _sanitize_shell(dns)
    first_client = _sanitize_shell(first_client)
    local_ip = _sanitize_shell(local_ip)
    ipv6_addr = _sanitize_shell(ipv6_addr)

    return f"""bash -c '
set -e

# Detect OS
os=""
if grep -qs "ubuntu" /etc/os-release; then os="ubuntu"
elif [ -e /etc/debian_version ]; then os="debian"
elif [ -e /etc/almalinux-release ] || [ -e /etc/rocky-release ] || [ -e /etc/centos-release ]; then os="centos"
elif [ -e /etc/fedora-release ]; then os="fedora"
else echo "ERROR: Unsupported OS"; exit 1; fi

# BoringTun detection
use_boringtun=0
if systemd-detect-virt -cq 2>/dev/null; then
  if ! grep -q "^wireguard " /proc/modules 2>/dev/null; then
    use_boringtun=1
  fi
fi

ip="{local_ip}"
if [ -z "$ip" ]; then
  ip=$(ip -4 addr | grep inet | grep -vE "127(\\.[0-9]{{1,3}}){{3}}" | cut -d "/" -f 1 | grep -oE "[0-9]{{1,3}}(\\.[0-9]{{1,3}}){{3}}" | head -1)
fi

ip6="{ipv6_addr}"
port={port}
client="{first_client}"
dns="{dns}"
public_ip="{endpoint}"

echo ">>> Installing WireGuard packages..."

if [ "$use_boringtun" -eq 0 ]; then
  if [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y wireguard qrencode
  elif [ "$os" = "centos" ]; then
    dnf install -y epel-release
    dnf install -y wireguard-tools qrencode
  elif [ "$os" = "fedora" ]; then
    dnf install -y wireguard-tools qrencode
    mkdir -p /etc/wireguard/
  fi
else
  echo ">>> Container detected, installing BoringTun..."
  if [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y qrencode ca-certificates
    apt-get install -y wireguard-tools --no-install-recommends
  elif [ "$os" = "centos" ]; then
    dnf install -y epel-release
    dnf install -y wireguard-tools qrencode ca-certificates tar
  elif [ "$os" = "fedora" ]; then
    dnf install -y wireguard-tools qrencode ca-certificates tar
    mkdir -p /etc/wireguard/
  fi
  {{ wget -qO- https://wg.nyr.be/1/latest/download 2>/dev/null || curl -sL https://wg.nyr.be/1/latest/download; }} | tar xz -C /usr/local/sbin/ --wildcards "boringtun-*/boringtun" --strip-components 1 || true
  mkdir -p /etc/systemd/system/wg-quick@wg0.service.d/ 2>/dev/null
  printf "[Service]\\nEnvironment=WG_QUICK_USERSPACE_IMPLEMENTATION=boringtun\\nEnvironment=WG_SUDO=1\\n" > /etc/systemd/system/wg-quick@wg0.service.d/boringtun.conf
fi

echo ">>> Configuring firewall..."
# Install firewall if needed
if ! systemctl is-active --quiet firewalld.service && ! command -v iptables >/dev/null 2>&1; then
  if [ "$os" = "centos" ] || [ "$os" = "fedora" ]; then
    dnf install -y firewalld
    systemctl enable --now firewalld.service
  elif [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
    apt-get install -y iptables
  fi
fi

echo ">>> Generating server keys..."
server_privkey=$(wg genkey)
server_pubkey=$(echo "$server_privkey" | wg pubkey)

echo ">>> Creating server config..."
ipv6_line=""
[ -n "$ip6" ] && ipv6_line=", fddd:2c4:2c4:2c4::1/64"

cat > /etc/wireguard/wg0.conf << WGEOF
# Do not alter the commented lines
# They are used by wireguard-install
# ENDPOINT $public_ip

[Interface]
Address = 10.7.0.1/24${{ipv6_line}}
PrivateKey = $server_privkey
ListenPort = $port

WGEOF
chmod 600 /etc/wireguard/wg0.conf

echo ">>> Enabling IP forwarding..."
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-wireguard-forward.conf
echo 1 > /proc/sys/net/ipv4/ip_forward
if [ -n "$ip6" ]; then
  echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.d/99-wireguard-forward.conf
  echo 1 > /proc/sys/net/ipv6/conf/all/forwarding
fi

echo ">>> Setting up firewall rules..."
if systemctl is-active --quiet firewalld.service; then
  firewall-cmd --add-port="${{port}}"/udp
  firewall-cmd --zone=trusted --add-source=10.7.0.0/24
  firewall-cmd --permanent --add-port="${{port}}"/udp
  firewall-cmd --permanent --zone=trusted --add-source=10.7.0.0/24
  firewall-cmd --direct --add-rule ipv4 nat POSTROUTING 0 -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to "$ip"
  firewall-cmd --permanent --direct --add-rule ipv4 nat POSTROUTING 0 -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to "$ip"
  if [ -n "$ip6" ]; then
    firewall-cmd --zone=trusted --add-source=fddd:2c4:2c4:2c4::/64
    firewall-cmd --permanent --zone=trusted --add-source=fddd:2c4:2c4:2c4::/64
    firewall-cmd --direct --add-rule ipv6 nat POSTROUTING 0 -s fddd:2c4:2c4:2c4::/64 ! -d fddd:2c4:2c4:2c4::/64 -j SNAT --to "$ip6"
    firewall-cmd --permanent --direct --add-rule ipv6 nat POSTROUTING 0 -s fddd:2c4:2c4:2c4::/64 ! -d fddd:2c4:2c4:2c4::/64 -j SNAT --to "$ip6"
  fi
else
  iptables_path=$(command -v iptables)
  ip6tables_path=$(command -v ip6tables)
  if [ "$(systemd-detect-virt 2>/dev/null)" = "openvz" ] && readlink -f "$(command -v iptables)" | grep -q "nft" && command -v iptables-legacy >/dev/null 2>&1; then
    iptables_path=$(command -v iptables-legacy)
    ip6tables_path=$(command -v ip6tables-legacy)
  fi
  cat > /etc/systemd/system/wg-iptables.service << IPTEOF
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=$iptables_path -w 5 -t nat -A POSTROUTING -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to $ip
ExecStart=$iptables_path -w 5 -I INPUT -p udp --dport $port -j ACCEPT
ExecStart=$iptables_path -w 5 -I FORWARD -s 10.7.0.0/24 -j ACCEPT
ExecStart=$iptables_path -w 5 -I FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
ExecStop=$iptables_path -w 5 -t nat -D POSTROUTING -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to $ip
ExecStop=$iptables_path -w 5 -D INPUT -p udp --dport $port -j ACCEPT
ExecStop=$iptables_path -w 5 -D FORWARD -s 10.7.0.0/24 -j ACCEPT
ExecStop=$iptables_path -w 5 -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
IPTEOF

  if [ -n "$ip6" ]; then
    cat >> /etc/systemd/system/wg-iptables.service << IPTEOF6
ExecStart=$ip6tables_path -w 5 -t nat -A POSTROUTING -s fddd:2c4:2c4:2c4::/64 ! -d fddd:2c4:2c4:2c4::/64 -j SNAT --to $ip6
ExecStart=$ip6tables_path -w 5 -I FORWARD -s fddd:2c4:2c4:2c4::/64 -j ACCEPT
ExecStart=$ip6tables_path -w 5 -I FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
ExecStop=$ip6tables_path -w 5 -t nat -D POSTROUTING -s fddd:2c4:2c4:2c4::/64 ! -d fddd:2c4:2c4:2c4::/64 -j SNAT --to $ip6
ExecStop=$ip6tables_path -w 5 -D FORWARD -s fddd:2c4:2c4:2c4::/64 -j ACCEPT
ExecStop=$ip6tables_path -w 5 -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
IPTEOF6
  fi

  cat >> /etc/systemd/system/wg-iptables.service << IPTEOF_END
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
IPTEOF_END
  systemctl enable --now wg-iptables.service
fi

echo ">>> Creating first client: $client..."
key=$(wg genkey)
psk=$(wg genpsk)
client_pubkey=$(echo "$key" | wg pubkey)

ipv6_peer=""
[ -n "$ip6" ] && ipv6_peer=", fddd:2c4:2c4:2c4::2/128"

cat >> /etc/wireguard/wg0.conf << PEEREOF
# BEGIN_PEER $client
[Peer]
PublicKey = $client_pubkey
PresharedKey = $psk
AllowedIPs = 10.7.0.2/32${{ipv6_peer}}
# END_PEER $client
PEEREOF

ipv6_client=""
[ -n "$ip6" ] && ipv6_client=", fddd:2c4:2c4:2c4::2/64"

mkdir -p /etc/wireguard/clients
cat > "/etc/wireguard/clients/$client.conf" << CLIENTEOF
[Interface]
Address = 10.7.0.2/24${{ipv6_client}}
DNS = $dns
PrivateKey = $key

[Peer]
PublicKey = $server_pubkey
PresharedKey = $psk
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = $public_ip:$port
PersistentKeepalive = 25
CLIENTEOF

echo ">>> Starting WireGuard service..."
systemctl enable --now wg-quick@wg0.service

echo ">>> Verifying installation..."
if systemctl is-active --quiet wg-quick@wg0.service && command -v wg >/dev/null 2>&1; then
  echo "WG_INSTALL_SUCCESS"
  echo ">>> WireGuard installed and running successfully!"
else
  echo "WG_INSTALL_FAILED"
  echo ">>> WireGuard service failed to start"
  exit 1
fi
' 2>&1
"""


WG_UNINSTALL_SCRIPT = r"""
bash -c '
set -e

# Detect OS
os=""
if grep -qs "ubuntu" /etc/os-release; then os="ubuntu"
elif [ -e /etc/debian_version ]; then os="debian"
elif [ -e /etc/almalinux-release ] || [ -e /etc/rocky-release ] || [ -e /etc/centos-release ]; then os="centos"
elif [ -e /etc/fedora-release ]; then os="fedora"
fi

# BoringTun check
use_boringtun=0
[ -f /usr/local/sbin/boringtun ] && use_boringtun=1

port=$(grep "^ListenPort" /etc/wireguard/wg0.conf | cut -d " " -f 3)

echo ">>> Removing firewall rules..."
if systemctl is-active --quiet firewalld.service; then
  ip=$(firewall-cmd --direct --get-rules ipv4 nat POSTROUTING | grep "\-s 10.7.0.0/24" | grep -oE "[^ ]+$" || true)
  firewall-cmd --remove-port="${port}"/udp 2>/dev/null || true
  firewall-cmd --zone=trusted --remove-source=10.7.0.0/24 2>/dev/null || true
  firewall-cmd --permanent --remove-port="${port}"/udp 2>/dev/null || true
  firewall-cmd --permanent --zone=trusted --remove-source=10.7.0.0/24 2>/dev/null || true
  [ -n "$ip" ] && firewall-cmd --direct --remove-rule ipv4 nat POSTROUTING 0 -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to "$ip" 2>/dev/null || true
  [ -n "$ip" ] && firewall-cmd --permanent --direct --remove-rule ipv4 nat POSTROUTING 0 -s 10.7.0.0/24 ! -d 10.7.0.0/24 -j SNAT --to "$ip" 2>/dev/null || true
  if grep -qs "fddd:2c4:2c4:2c4::1/64" /etc/wireguard/wg0.conf; then
    firewall-cmd --zone=trusted --remove-source=fddd:2c4:2c4:2c4::/64 2>/dev/null || true
    firewall-cmd --permanent --zone=trusted --remove-source=fddd:2c4:2c4:2c4::/64 2>/dev/null || true
  fi
else
  systemctl disable --now wg-iptables.service 2>/dev/null || true
  rm -f /etc/systemd/system/wg-iptables.service
fi

echo ">>> Stopping WireGuard service..."
systemctl disable --now wg-quick@wg0.service 2>/dev/null || true
rm -f /etc/systemd/system/wg-quick@wg0.service.d/boringtun.conf
rm -f /etc/sysctl.d/99-wireguard-forward.conf

echo ">>> Removing packages..."
if [ "$use_boringtun" -eq 0 ]; then
  if [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
    apt-get remove --purge -y wireguard wireguard-tools 2>/dev/null || true
  elif [ "$os" = "centos" ] || [ "$os" = "fedora" ]; then
    dnf remove -y wireguard-tools 2>/dev/null || true
  fi
else
  if [ "$os" = "ubuntu" ] || [ "$os" = "debian" ]; then
    apt-get remove --purge -y wireguard-tools 2>/dev/null || true
  elif [ "$os" = "centos" ] || [ "$os" = "fedora" ]; then
    dnf remove -y wireguard-tools 2>/dev/null || true
  fi
  rm -f /usr/local/sbin/boringtun /usr/local/sbin/boringtun-upgrade
  { crontab -l 2>/dev/null | grep -v "/usr/local/sbin/boringtun-upgrade"; } | crontab - 2>/dev/null || true
fi

echo ">>> Cleaning up config files..."
rm -rf /etc/wireguard/

echo ">>> Verifying removal..."
if ! command -v wg >/dev/null 2>&1 && [ ! -e /etc/wireguard/wg0.conf ]; then
  echo "WG_UNINSTALL_SUCCESS"
else
  echo "WG_UNINSTALL_FAILED"
fi
' 2>&1
"""


def _build_wg_add_client_script(client_name: str, dns: str) -> str:
    """Build script to add a named WireGuard client."""
    client_name = _sanitize_shell(client_name)
    dns = _sanitize_shell(dns)

    return f"""bash -c '
set -e

client="{client_name}"
dns="{dns}"

# Check client name not already in use
if grep -q "^# BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "ERROR:Client name already exists"
  exit 1
fi

# Find next available IP octet
octet=2
while grep AllowedIPs /etc/wireguard/wg0.conf | cut -d "." -f 4 | cut -d "/" -f 1 | grep -q "^$octet$"; do
  octet=$((octet + 1))
done
if [ "$octet" -ge 255 ]; then
  echo "ERROR:Address space full (max 253 clients)"
  exit 1
fi

# Generate keys
key=$(wg genkey)
psk=$(wg genpsk)
client_pubkey=$(echo "$key" | wg pubkey)
server_pubkey=$(grep PrivateKey /etc/wireguard/wg0.conf | cut -d " " -f 3 | wg pubkey)

# IPv6 support
ipv6_peer=""
grep -q "fddd:2c4:2c4:2c4::1" /etc/wireguard/wg0.conf && ipv6_peer=", fddd:2c4:2c4:2c4::$octet/128"

# Add peer to server config
cat >> /etc/wireguard/wg0.conf << PEEREOF
# BEGIN_PEER $client
[Peer]
PublicKey = $client_pubkey
PresharedKey = $psk
AllowedIPs = 10.7.0.$octet/32${{ipv6_peer}}
# END_PEER $client
PEEREOF

# Add to live interface
wg addconf wg0 <(sed -n "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/p" /etc/wireguard/wg0.conf)

# IPv6 client address
ipv6_client=""
grep -q "fddd:2c4:2c4:2c4::1" /etc/wireguard/wg0.conf && ipv6_client=", fddd:2c4:2c4:2c4::$octet/64"

# Build client config
endpoint=$(grep "^# ENDPOINT" /etc/wireguard/wg0.conf | cut -d " " -f 3)
listen_port=$(grep ListenPort /etc/wireguard/wg0.conf | cut -d " " -f 3)

mkdir -p /etc/wireguard/clients
cat > "/etc/wireguard/clients/$client.conf" << CLIENTEOF
[Interface]
Address = 10.7.0.$octet/24${{ipv6_client}}
DNS = $dns
PrivateKey = $key

[Peer]
PublicKey = $server_pubkey
PresharedKey = $psk
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = $endpoint:$listen_port
PersistentKeepalive = 25
CLIENTEOF

# Output the config content
echo "CLIENT_CONFIG_START"
cat "/etc/wireguard/clients/$client.conf"
echo "CLIENT_CONFIG_END"

# Generate QR code as SVG if qrencode is available
if command -v qrencode >/dev/null 2>&1; then
  echo "QR_SVG_START"
  qrencode -t SVG -r "/etc/wireguard/clients/$client.conf"
  echo "QR_SVG_END"
fi

# Verify peer was added
if sudo wg show wg0 dump | grep -q "$client_pubkey"; then
  echo "ADD_CLIENT_SUCCESS"
else
  echo "ADD_CLIENT_FAILED"
fi
' 2>&1
"""


def _build_wg_remove_client_script(client_name: str) -> str:
    """Build script to remove a named WireGuard client."""
    client_name = _sanitize_shell(client_name)

    return f"""bash -c '
client="{client_name}"

# Find the public key for this client
pubkey=$(sed -n "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/p" /etc/wireguard/wg0.conf | grep "PublicKey" | cut -d " " -f 3)

if [ -z "$pubkey" ]; then
  echo "ERROR:Client not found"
  exit 1
fi

# Remove from live interface
sudo wg set wg0 peer "$pubkey" remove

# Remove from config file
sudo sed -i "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/d" /etc/wireguard/wg0.conf

# Remove client config file
rm -f "/etc/wireguard/clients/$client.conf"

# Verify removal
if ! grep -q "^# BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "REMOVE_CLIENT_SUCCESS"
else
  echo "REMOVE_CLIENT_FAILED"
fi
' 2>&1
"""


def _build_wg_toggle_client_script(client_name: str, action: str) -> str:
    """Build script to enable/disable a named WireGuard client."""
    client_name = _sanitize_shell(client_name)

    if action == "disable":
        return f"""bash -c '
client="{client_name}"

# Check client exists and is enabled
if ! grep -q "^# BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "ERROR:Client not found or already disabled"
  exit 1
fi

# Get public key before commenting
pubkey=$(sed -n "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/p" /etc/wireguard/wg0.conf | grep "PublicKey" | cut -d " " -f 3)

# Remove from live interface
[ -n "$pubkey" ] && sudo wg set wg0 peer "$pubkey" remove

# Comment out the peer block by renaming markers and commenting config lines
sudo sed -i "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/{{
  s/^# BEGIN_PEER $client$/# DISABLED_BEGIN_PEER $client/
  s/^# END_PEER $client$/# DISABLED_END_PEER $client/
  /^# DISABLED_/! s/^/# DISABLED_/
}}" /etc/wireguard/wg0.conf

# Verify
if grep -q "^# DISABLED_BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "TOGGLE_CLIENT_SUCCESS"
else
  echo "TOGGLE_CLIENT_FAILED"
fi
' 2>&1
"""
    else:  # enable
        return f"""bash -c '
client="{client_name}"

# Check client exists and is disabled
if ! grep -q "^# DISABLED_BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "ERROR:Client not found or already enabled"
  exit 1
fi

# Uncomment the peer block
sudo sed -i "/^# DISABLED_BEGIN_PEER $client$/,/^# DISABLED_END_PEER $client$/{{
  s/^# DISABLED_BEGIN_PEER $client$/# BEGIN_PEER $client/
  s/^# DISABLED_END_PEER $client$/# END_PEER $client/
  /^# \\(BEGIN\\|END\\)_PEER/! s/^# DISABLED_//
}}" /etc/wireguard/wg0.conf

# Re-add to live interface
wg addconf wg0 <(sed -n "/^# BEGIN_PEER $client$/,/^# END_PEER $client$/p" /etc/wireguard/wg0.conf)

# Verify
if grep -q "^# BEGIN_PEER $client$" /etc/wireguard/wg0.conf; then
  echo "TOGGLE_CLIENT_SUCCESS"
else
  echo "TOGGLE_CLIENT_FAILED"
fi
' 2>&1
"""


def _build_wg_get_client_config_script(client_name: str) -> str:
    """Build script to retrieve a client config and generate QR."""
    client_name = _sanitize_shell(client_name)

    return f"""bash -c '
client="{client_name}"
conf="/etc/wireguard/clients/$client.conf"

if [ ! -f "$conf" ]; then
  echo "ERROR:Client config file not found"
  exit 1
fi

echo "CLIENT_CONFIG_START"
cat "$conf"
echo "CLIENT_CONFIG_END"

if command -v qrencode >/dev/null 2>&1; then
  echo "QR_SVG_START"
  qrencode -t SVG -r "$conf"
  echo "QR_SVG_END"
fi
echo "GET_CONFIG_SUCCESS"
' 2>&1
"""


@router.get("/{connection_id}/wireguard/check", response_model=WireGuardInstallCheck)
async def check_wireguard(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Pre-install check: detect OS, version, existing install, IPs."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, WG_CHECK_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    data: dict = {
        "supported": False, "os": "", "os_version": "",
        "already_installed": False, "public_ip": "", "local_ips": [],
        "has_ipv6": False, "ipv6_addr": "", "is_container": False,
        "needs_boringtun": False, "reason": "",
    }

    for line in stdout.split("\n"):
        line = line.strip()
        if line.startswith("SUPPORTED:"):
            data["supported"] = line.split(":", 1)[1] == "true"
        elif line.startswith("OS:"):
            data["os"] = line.split(":", 1)[1]
        elif line.startswith("OS_VERSION:"):
            data["os_version"] = line.split(":", 1)[1]
        elif line.startswith("ALREADY_INSTALLED:"):
            data["already_installed"] = line.split(":", 1)[1] == "true"
        elif line.startswith("PUBLIC_IP:"):
            data["public_ip"] = line.split(":", 1)[1]
        elif line.startswith("LOCAL_IPS:"):
            ips_str = line.split(":", 1)[1]
            data["local_ips"] = [ip for ip in ips_str.split(",") if ip] if ips_str else []
        elif line.startswith("HAS_IPV6:"):
            data["has_ipv6"] = line.split(":", 1)[1] == "true"
        elif line.startswith("IPV6_ADDR:"):
            data["ipv6_addr"] = line.split(":", 1)[1]
        elif line.startswith("IS_CONTAINER:"):
            data["is_container"] = line.split(":", 1)[1] == "true"
        elif line.startswith("NEEDS_BORINGTUN:"):
            data["needs_boringtun"] = line.split(":", 1)[1] == "true"
        elif line.startswith("REASON:"):
            data["reason"] = line.split(":", 1)[1]

    return WireGuardInstallCheck(**data)


@router.get("/{connection_id}/wireguard/status", response_model=WireGuardStatusResponse)
async def get_wireguard_status(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get comprehensive WireGuard server status and named clients."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, WG_STATUS_SCRIPT, timeout=15)
    stdout = result.get("stdout", "").strip()

    data: dict = {
        "installed": False, "version": "", "active": False,
        "server_public_key": "", "listen_port": "", "address": "",
        "endpoint": "", "public_ip": "",
        "total_transfer_rx": "0", "total_transfer_tx": "0",
        "clients": [], "active_clients": 0, "total_clients": 0,
    }

    # Track client names and states from config parsing
    client_configs: list[dict] = []
    live_peers: dict[str, dict] = {}  # keyed by client name

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue

        if line.startswith("INSTALLED:"):
            data["installed"] = line.split(":", 1)[1] == "true"
        elif line.startswith("VERSION:"):
            data["version"] = line.split(":", 1)[1]
        elif line.startswith("SERVER_INFO:"):
            parts = line.split(":", 1)[1].split("|", 5)
            data["server_public_key"] = parts[0] if len(parts) > 0 else ""
            data["listen_port"] = parts[1] if len(parts) > 1 else ""
            data["address"] = parts[2] if len(parts) > 2 else ""
            data["active"] = parts[3] == "true" if len(parts) > 3 else False
            data["endpoint"] = parts[4] if len(parts) > 4 else ""
            data["public_ip"] = parts[5] if len(parts) > 5 else ""
        elif line.startswith("CLIENT_START:"):
            parts = line.split(":", 1)[1].split(":", 1)
            name = parts[0] if len(parts) > 0 else ""
            enabled = parts[1] != "disabled" if len(parts) > 1 else True
            client_configs.append({"name": name, "enabled": enabled})
        elif line.startswith("LIVE_PEER:"):
            parts = line.split(":", 1)[1].split("|", 8)
            name = parts[0] if len(parts) > 0 else "unknown"
            live_peers[name] = {
                "public_key": parts[1] if len(parts) > 1 else "",
                "endpoint": parts[2] if len(parts) > 2 else "",
                "allowed_ips": parts[3] if len(parts) > 3 else "",
                "latest_handshake": parts[4] if len(parts) > 4 else "",
                "transfer_rx": parts[5] if len(parts) > 5 else "",
                "transfer_tx": parts[6] if len(parts) > 6 else "",
                "persistent_keepalive": parts[7] if len(parts) > 7 else "",
                "has_recent_handshake": parts[8] == "true" if len(parts) > 8 else False,
            }
        elif line.startswith("TOTAL_TRANSFER:"):
            parts = line.split(":", 1)[1].split("|", 1)
            data["total_transfer_rx"] = parts[0] if len(parts) > 0 else "0"
            data["total_transfer_tx"] = parts[1] if len(parts) > 1 else "0"

    # Merge config clients with live stats
    active_count = 0
    clients = []
    for cc in client_configs:
        name = cc["name"]
        live = live_peers.get(name, {})
        has_recent = live.get("has_recent_handshake", False)
        if has_recent:
            active_count += 1
        clients.append(WireGuardClient(
            name=name,
            public_key=live.get("public_key", ""),
            allowed_ips=live.get("allowed_ips", ""),
            endpoint=live.get("endpoint", ""),
            latest_handshake=live.get("latest_handshake", ""),
            transfer_rx=live.get("transfer_rx", ""),
            transfer_tx=live.get("transfer_tx", ""),
            persistent_keepalive=live.get("persistent_keepalive", ""),
            enabled=cc["enabled"],
            has_recent_handshake=has_recent,
        ))

    data["clients"] = clients
    data["total_clients"] = len(clients)
    data["active_clients"] = active_count

    return WireGuardStatusResponse(**data)


@router.post("/{connection_id}/wireguard/toggle")
async def toggle_wireguard(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Bring wg0 interface up or down."""
    await _verify_connection(connection_id, current_user)

    state_result = await _run(
        connection_id,
        "ip link show wg0 2>/dev/null | grep -oP 'state \\K\\w+'",
        timeout=5,
    )
    current_state = state_result.get("stdout", "").strip()
    is_up = current_state in ("UP", "UNKNOWN")

    cmd = f"sudo wg-quick {'down' if is_up else 'up'} wg0 2>&1; echo EXIT:$?"
    result = await _run(connection_id, cmd, timeout=15)
    stdout = result.get("stdout", "").strip()

    exit_code = "1"
    for line in stdout.split("\n"):
        if line.startswith("EXIT:"):
            exit_code = line.replace("EXIT:", "").strip()

    if exit_code != "0":
        error_lines = [l for l in stdout.split("\n") if not l.startswith("EXIT:")]
        raise HTTPException(status_code=400, detail="\n".join(error_lines) or "Failed to toggle wg0")

    action = "down" if is_up else "up"
    return {"message": f"Interface wg0 brought {action}", "active": not is_up}


@router.post("/{connection_id}/wireguard/uninstall")
async def uninstall_wireguard(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Remove WireGuard completely from the server."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, WG_UNINSTALL_SCRIPT, timeout=120)
    stdout = result.get("stdout", "").strip()

    if "WG_UNINSTALL_SUCCESS" in stdout:
        return {"message": "WireGuard removed successfully", "success": True, "output": stdout}
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Uninstall may have failed. Output:\n{stdout}",
        )


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


@router.post("/{connection_id}/wireguard/clients/add", response_model=WireGuardClientConfig)
async def add_wireguard_client(
    connection_id: str,
    request: WireGuardAddClient,
    current_user: User = Depends(get_current_user),
):
    """Add a named WireGuard client (Nyr-style with config + QR)."""
    await _verify_connection(connection_id, current_user)

    if not _re.match(r'^[a-zA-Z0-9_-]+$', request.name):
        raise HTTPException(status_code=400, detail="Invalid client name")

    script = _build_wg_add_client_script(request.name, request.dns)
    result = await _run(connection_id, script, timeout=30)
    stdout = result.get("stdout", "").strip()

    if stdout.startswith("ERROR:"):
        raise HTTPException(status_code=400, detail=stdout.replace("ERROR:", "").strip())

    # Parse config content
    config_content = ""
    qr_svg = ""

    in_config = False
    config_lines = []
    in_qr = False
    qr_lines = []

    for line in stdout.split("\n"):
        if line.strip() == "CLIENT_CONFIG_START":
            in_config = True
            continue
        elif line.strip() == "CLIENT_CONFIG_END":
            in_config = False
            continue
        elif line.strip() == "QR_SVG_START":
            in_qr = True
            continue
        elif line.strip() == "QR_SVG_END":
            in_qr = False
            continue

        if in_config:
            config_lines.append(line)
        elif in_qr:
            qr_lines.append(line)

    config_content = "\n".join(config_lines)
    qr_svg = "\n".join(qr_lines)

    if "ADD_CLIENT_FAILED" in stdout:
        raise HTTPException(status_code=500, detail="Client was created but peer verification failed")

    return WireGuardClientConfig(
        name=request.name,
        config_content=config_content,
        qr_svg=qr_svg,
    )


@router.post("/{connection_id}/wireguard/clients/remove")
async def remove_wireguard_client(
    connection_id: str,
    request: WireGuardRemoveClient,
    current_user: User = Depends(get_current_user),
):
    """Remove a named WireGuard client."""
    await _verify_connection(connection_id, current_user)

    if not _re.match(r'^[a-zA-Z0-9_-]+$', request.name):
        raise HTTPException(status_code=400, detail="Invalid client name")

    script = _build_wg_remove_client_script(request.name)
    result = await _run(connection_id, script, timeout=15)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=400, detail=stdout.split("ERROR:", 1)[1].strip())

    if "REMOVE_CLIENT_SUCCESS" in stdout:
        return {"message": f"Client '{request.name}' removed successfully"}
    else:
        raise HTTPException(status_code=500, detail="Failed to remove client")


@router.post("/{connection_id}/wireguard/clients/toggle")
async def toggle_wireguard_client(
    connection_id: str,
    request: WireGuardToggleClient,
    current_user: User = Depends(get_current_user),
):
    """Enable or disable a named WireGuard client."""
    await _verify_connection(connection_id, current_user)

    if not _re.match(r'^[a-zA-Z0-9_-]+$', request.name):
        raise HTTPException(status_code=400, detail="Invalid client name")

    if request.action not in ("enable", "disable"):
        raise HTTPException(status_code=400, detail="Action must be 'enable' or 'disable'")

    script = _build_wg_toggle_client_script(request.name, request.action)
    result = await _run(connection_id, script, timeout=15)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=400, detail=stdout.split("ERROR:", 1)[1].strip())

    if "TOGGLE_CLIENT_SUCCESS" in stdout:
        return {"message": f"Client '{request.name}' {request.action}d successfully"}
    else:
        raise HTTPException(status_code=500, detail=f"Failed to {request.action} client")


@router.get("/{connection_id}/wireguard/clients/{client_name}/config", response_model=WireGuardClientConfig)
async def get_wireguard_client_config(
    connection_id: str,
    client_name: str,
    current_user: User = Depends(get_current_user),
):
    """Get a client's config file and QR code."""
    await _verify_connection(connection_id, current_user)

    if not _re.match(r'^[a-zA-Z0-9_-]+$', client_name):
        raise HTTPException(status_code=400, detail="Invalid client name")

    script = _build_wg_get_client_config_script(client_name)
    result = await _run(connection_id, script, timeout=10)
    stdout = result.get("stdout", "").strip()

    if "ERROR:" in stdout:
        raise HTTPException(status_code=404, detail=stdout.split("ERROR:", 1)[1].strip())

    config_content = ""
    qr_svg = ""
    in_config = False
    config_lines = []
    in_qr = False
    qr_lines = []

    for line in stdout.split("\n"):
        if line.strip() == "CLIENT_CONFIG_START":
            in_config = True
            continue
        elif line.strip() == "CLIENT_CONFIG_END":
            in_config = False
            continue
        elif line.strip() == "QR_SVG_START":
            in_qr = True
            continue
        elif line.strip() == "QR_SVG_END":
            in_qr = False
            continue
        if in_config:
            config_lines.append(line)
        elif in_qr:
            qr_lines.append(line)

    config_content = "\n".join(config_lines)
    qr_svg = "\n".join(qr_lines)

    return WireGuardClientConfig(
        name=client_name,
        config_content=config_content,
        qr_svg=qr_svg,
    )


# ---------------------------------------------------------------------------
# Cron
# ---------------------------------------------------------------------------

CRON_LIST_SCRIPT = r"""
sh -c '
user=$(whoami)
echo "USER:${user}"

# Extract env vars from crontab
echo "ENV_START"
crontab -l 2>/dev/null | grep -E "^(SHELL|PATH|MAILTO|HOME|LOGNAME)=" | while IFS= read -r line; do
  key=$(echo "$line" | cut -d= -f1)
  val=$(echo "$line" | cut -d= -f2-)
  val_esc=$(printf "%s" "$val" | sed "s/\"/\\\\\"/g")
  printf "{\"key\":\"%s\",\"value\":\"%s\"}\n" "$key" "$val_esc"
done
echo "ENV_END"

# User crontab -- include disabled (commented) lines too
echo "USER_CRON_START"
line_num=0
crontab -l 2>/dev/null | grep -v "^$" | while IFS= read -r line; do
  # Skip env var lines
  case "$line" in SHELL=*|PATH=*|MAILTO=*|HOME=*|LOGNAME=*) continue ;; esac

  # Check if it is a pure comment (not a disabled job)
  is_comment_line=false
  stripped=$(echo "$line" | sed "s/^#\s*//")
  # A disabled job looks like: #* * * * * command or #*/5 * * * * command
  first_field=$(echo "$stripped" | awk "{print \$1}")
  case "$first_field" in
    \*|[0-9]*|*/[0-9]*|@reboot|@hourly|@daily|@weekly|@monthly|@yearly|@annually)
      ;;
    *)
      is_comment_line=true
      ;;
  esac

  if [ "$is_comment_line" = "true" ]; then
    continue
  fi

  line_num=$((line_num + 1))

  enabled="true"
  parse_line="$line"
  if echo "$line" | grep -q "^#"; then
    enabled="false"
    parse_line="$stripped"
  fi

  # Check for inline comment at the end
  comment=""

  # Handle special schedules
  first_word=$(echo "$parse_line" | awk "{print \$1}")
  case "$first_word" in
    @reboot|@hourly|@daily|@weekly|@monthly|@yearly|@annually)
      sched="$first_word"
      cmd=$(echo "$parse_line" | awk "{for(i=2;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
      ;;
    *)
      sched=$(echo "$parse_line" | awk "{print \$1,\$2,\$3,\$4,\$5}")
      cmd=$(echo "$parse_line" | awk "{for(i=6;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
      ;;
  esac

  cmd_esc=$(printf "%s" "$cmd" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
  raw_esc=$(printf "%s" "$line" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
  comment_esc=$(printf "%s" "$comment" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")

  printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":%s,\"raw\":\"%s\",\"enabled\":%s,\"comment\":\"%s\"}\n" \
    "$sched" "$cmd_esc" "$user" "$line_num" "$raw_esc" "$enabled" "$comment_esc"
done
echo "USER_CRON_END"

# System crontab entries
echo "SYSTEM_CRON_START"
if [ -f /etc/crontab ]; then
  grep -v "^#" /etc/crontab 2>/dev/null | grep -v "^$" | grep -v "^SHELL\|^PATH\|^MAILTO\|^HOME" | while IFS= read -r line; do
    sched=$(echo "$line" | awk "{print \$1,\$2,\$3,\$4,\$5}")
    cron_user=$(echo "$line" | awk "{print \$6}")
    cmd=$(echo "$line" | awk "{for(i=7;i<=NF;i++) printf \"%s \",\$i; print \"\"}" | sed "s/ $//")
    cmd_esc=$(printf "%s" "$cmd" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
    raw_esc=$(printf "%s" "$line" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
    printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":0,\"raw\":\"%s\",\"enabled\":true,\"comment\":\"\"}\n" \
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
    cmd_esc=$(printf "%s" "$cmd" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
    raw_esc=$(printf "%s" "$line" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g")
    printf "{\"schedule\":\"%s\",\"command\":\"%s\",\"user\":\"%s\",\"line_number\":0,\"raw\":\"%s\",\"enabled\":true,\"comment\":\"\"}\n" \
      "$sched" "$cmd_esc" "$cron_user" "$raw_esc"
  done
done
echo "SYSTEM_CRON_END"
' 2>/dev/null
"""

CRON_HISTORY_SCRIPT = r"""
# Try multiple sources for cron execution history
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u cron -u crond --no-pager -n 200 --output=short-iso 2>/dev/null | grep -i "CMD\|CRON" | tail -100
elif [ -f /var/log/cron ]; then
  tail -200 /var/log/cron 2>/dev/null | grep -i "CMD\|CRON" | tail -100
elif [ -f /var/log/syslog ]; then
  grep -i "CRON" /var/log/syslog 2>/dev/null | tail -100
else
  echo "NO_CRON_LOGS"
fi
"""


def _compute_next_run(schedule: str) -> str:
    """Compute a human-readable next run time from a cron schedule expression."""
    import re
    from datetime import datetime, timezone, timedelta

    if schedule.startswith("@"):
        specials = {
            "@reboot": "On reboot",
            "@hourly": "At the start of next hour",
            "@daily": "Tomorrow at midnight",
            "@weekly": "Next Sunday at midnight",
            "@monthly": "1st of next month",
            "@yearly": "January 1st",
            "@annually": "January 1st",
        }
        return specials.get(schedule, "")

    parts = schedule.split()
    if len(parts) < 5:
        return ""

    try:
        now = datetime.now(timezone.utc)
        minute_s, hour_s, dom_s, month_s, dow_s = parts[:5]

        def parse_field(field: str, max_val: int, min_val: int = 0) -> list[int] | None:
            if field == "*":
                return None
            values = set()
            for part in field.split(","):
                if "/" in part:
                    base, step = part.split("/", 1)
                    step = int(step)
                    start = min_val if base == "*" else int(base)
                    for v in range(start, max_val + 1, step):
                        values.add(v)
                elif "-" in part:
                    a, b = part.split("-", 1)
                    for v in range(int(a), int(b) + 1):
                        values.add(v)
                else:
                    values.add(int(part))
            return sorted(values) if values else None

        minutes = parse_field(minute_s, 59, 0)
        hours = parse_field(hour_s, 23, 0)

        # Simple next-run: find next matching minute/hour from now
        candidate = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(1440 * 7):  # search up to 7 days
            m_ok = minutes is None or candidate.minute in minutes
            h_ok = hours is None or candidate.hour in hours
            if m_ok and h_ok:
                delta = candidate - now
                total_min = int(delta.total_seconds() // 60)
                if total_min < 60:
                    return f"in {total_min}m"
                elif total_min < 1440:
                    return f"in {total_min // 60}h {total_min % 60}m"
                else:
                    days = total_min // 1440
                    return f"in {days}d {(total_min % 1440) // 60}h"
            candidate += timedelta(minutes=1)
        return ""
    except Exception:
        return ""


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
    env_vars: dict = {}
    section = ""

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("USER:"):
            user = line.split(":", 1)[1]
        elif line == "ENV_START":
            section = "env"
        elif line == "ENV_END":
            section = ""
        elif line == "USER_CRON_START":
            section = "user"
        elif line == "USER_CRON_END":
            section = ""
        elif line == "SYSTEM_CRON_START":
            section = "system"
        elif line == "SYSTEM_CRON_END":
            section = ""
        elif section == "env" and line.startswith("{"):
            try:
                ev = json.loads(line)
                env_vars[ev["key"]] = ev["value"]
            except (json.JSONDecodeError, KeyError):
                continue
        elif section in ("user", "system") and line.startswith("{"):
            try:
                data = json.loads(line)
                job = CronJob(**data)
                # Compute next run time server-side
                if job.enabled:
                    job.next_run = _compute_next_run(job.schedule)
                if section == "user":
                    user_jobs.append(job)
                else:
                    system_jobs.append(job)
            except (json.JSONDecodeError, Exception):
                continue

    active = sum(1 for j in user_jobs if j.enabled)
    disabled = sum(1 for j in user_jobs if not j.enabled)

    return CronListResponse(
        jobs=user_jobs,
        total=len(user_jobs),
        active=active,
        disabled=disabled,
        user=user,
        system_jobs=system_jobs,
        env_vars=env_vars,
    )


@router.post("/{connection_id}/cron/add")
async def add_cron_job(
    connection_id: str,
    request: CronJobAdd,
    current_user: User = Depends(get_current_user),
):
    """Add a cron job to the current user's crontab."""
    await _verify_connection(connection_id, current_user)

    import base64

    # Build full cron line, optionally with comment prefix
    comment_line = ""
    if request.comment:
        safe_comment = request.comment.replace("\n", " ").replace("\r", "")
        comment_line = f"# {safe_comment}\n"

    cron_line = f"{request.schedule} {request.command}"
    full_content = comment_line + cron_line + "\n"
    encoded = base64.b64encode(full_content.encode()).decode()

    # Pipe base64 decode directly to temp file to preserve trailing newline
    # (command substitution $() strips trailing newlines, so we avoid it)
    cmd = (
        f'_tmpf=$(mktemp) && '
        f'crontab -l 2>/dev/null > "$_tmpf" 2>/dev/null; '
        f'(echo "{encoded}" | base64 -d 2>/dev/null || echo "{encoded}" | base64 -D 2>/dev/null) >> "$_tmpf" && '
        f'crontab "$_tmpf" 2>&1; _rc=$?; rm -f "$_tmpf"; echo EXIT:$_rc'
    )
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code, clean = _parse_exit_code(stdout)
    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to add cron job")

    return {"message": "Cron job added successfully"}


@router.post("/{connection_id}/cron/update")
async def update_cron_job(
    connection_id: str,
    request: CronJobUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update an existing cron job by replacing the line at the given line number."""
    await _verify_connection(connection_id, current_user)

    import base64

    line_num = request.line_number
    new_cron_line = f"{request.schedule} {request.command}"
    encoded_new = base64.b64encode(new_cron_line.encode()).decode()

    # Replace the specific line in the crontab (line numbers are 1-indexed among non-comment/non-empty lines)
    cmd = (
        f'_tmpf=$(mktemp) && '
        f'_decoded=$(echo "{encoded_new}" | base64 -d 2>/dev/null || echo "{encoded_new}" | base64 -D 2>/dev/null) && '
        f'crontab -l 2>/dev/null > "$_tmpf" && '
        f'_line_count=0 && _out=$(mktemp) && '
        f'while IFS= read -r _line; do '
        f'  case "$_line" in SHELL=*|PATH=*|MAILTO=*|HOME=*|LOGNAME=*) echo "$_line" >> "$_out"; continue ;; esac; '
        f'  _stripped=$(echo "$_line" | sed "s/^#\\s*//"); '
        f'  _first=$(echo "$_stripped" | awk "{{print \\$1}}"); '
        f'  _is_job=false; '
        f'  case "$_first" in \\*|[0-9]*|*/[0-9]*|@reboot|@hourly|@daily|@weekly|@monthly|@yearly|@annually) _is_job=true ;; esac; '
        f'  if echo "$_line" | grep -q "^#" && [ "$_is_job" = "true" ]; then _is_job=true; fi; '
        f'  if [ "$_is_job" = "true" ]; then '
        f'    _line_count=$((_line_count + 1)); '
        f'    if [ "$_line_count" -eq {line_num} ]; then '
        f'      echo "$_decoded" >> "$_out"; '
        f'    else '
        f'      echo "$_line" >> "$_out"; '
        f'    fi; '
        f'  else '
        f'    echo "$_line" >> "$_out"; '
        f'  fi; '
        f'done < "$_tmpf" && '
        f'crontab "$_out" 2>&1; rm -f "$_tmpf" "$_out"; echo EXIT:$?'
    )
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code, clean = _parse_exit_code(stdout)
    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to update cron job")

    return {"message": "Cron job updated successfully"}


@router.post("/{connection_id}/cron/delete")
async def delete_cron_job(
    connection_id: str,
    request: CronJobDelete,
    current_user: User = Depends(get_current_user),
):
    """Delete a cron job by line number from the current user's crontab."""
    await _verify_connection(connection_id, current_user)

    line_num = request.line_number

    # Delete the specific job line (line numbers among non-env/non-blank lines, including disabled jobs)
    cmd = (
        f'_tmpf=$(mktemp) && '
        f'crontab -l 2>/dev/null > "$_tmpf" && '
        f'_line_count=0 && _out=$(mktemp) && '
        f'while IFS= read -r _line; do '
        f'  case "$_line" in SHELL=*|PATH=*|MAILTO=*|HOME=*|LOGNAME=*) echo "$_line" >> "$_out"; continue ;; esac; '
        f'  _stripped=$(echo "$_line" | sed "s/^#\\s*//"); '
        f'  _first=$(echo "$_stripped" | awk "{{print \\$1}}"); '
        f'  _is_job=false; '
        f'  case "$_first" in \\*|[0-9]*|*/[0-9]*|@reboot|@hourly|@daily|@weekly|@monthly|@yearly|@annually) _is_job=true ;; esac; '
        f'  if echo "$_line" | grep -q "^#" && [ "$_is_job" = "true" ]; then _is_job=true; fi; '
        f'  if [ "$_is_job" = "true" ]; then '
        f'    _line_count=$((_line_count + 1)); '
        f'    if [ "$_line_count" -ne {line_num} ]; then '
        f'      echo "$_line" >> "$_out"; '
        f'    fi; '
        f'  else '
        f'    echo "$_line" >> "$_out"; '
        f'  fi; '
        f'done < "$_tmpf" && '
        f'crontab "$_out" 2>&1; rm -f "$_tmpf" "$_out"; echo EXIT:$?'
    )
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code, clean = _parse_exit_code(stdout)
    if exit_code != "0":
        raise HTTPException(status_code=400, detail=clean or "Failed to delete cron job")

    return {"message": "Cron job deleted successfully"}


@router.post("/{connection_id}/cron/toggle")
async def toggle_cron_job(
    connection_id: str,
    request: CronJobToggle,
    current_user: User = Depends(get_current_user),
):
    """Enable or disable a cron job by commenting/uncommenting the line."""
    await _verify_connection(connection_id, current_user)

    line_num = request.line_number
    enable = "true" if request.enabled else "false"

    cmd = (
        f'_tmpf=$(mktemp) && '
        f'crontab -l 2>/dev/null > "$_tmpf" && '
        f'_line_count=0 && _out=$(mktemp) && '
        f'while IFS= read -r _line; do '
        f'  case "$_line" in SHELL=*|PATH=*|MAILTO=*|HOME=*|LOGNAME=*) echo "$_line" >> "$_out"; continue ;; esac; '
        f'  _stripped=$(echo "$_line" | sed "s/^#\\s*//"); '
        f'  _first=$(echo "$_stripped" | awk "{{print \\$1}}"); '
        f'  _is_job=false; '
        f'  case "$_first" in \\*|[0-9]*|*/[0-9]*|@reboot|@hourly|@daily|@weekly|@monthly|@yearly|@annually) _is_job=true ;; esac; '
        f'  if echo "$_line" | grep -q "^#" && [ "$_is_job" = "true" ]; then _is_job=true; fi; '
        f'  if [ "$_is_job" = "true" ]; then '
        f'    _line_count=$((_line_count + 1)); '
        f'    if [ "$_line_count" -eq {line_num} ]; then '
        f'      if [ "{enable}" = "true" ]; then '
        f'        echo "$_stripped" >> "$_out"; '
        f'      else '
        f'        echo "# $_stripped" >> "$_out"; '
        f'      fi; '
        f'    else '
        f'      echo "$_line" >> "$_out"; '
        f'    fi; '
        f'  else '
        f'    echo "$_line" >> "$_out"; '
        f'  fi; '
        f'done < "$_tmpf" && '
        f'crontab "$_out" 2>&1; rm -f "$_tmpf" "$_out"; echo EXIT:$?'
    )
    result = await _run(connection_id, cmd, timeout=10)
    stdout = result.get("stdout", "").strip()

    exit_code, clean = _parse_exit_code(stdout)
    if exit_code != "0":
        action_word = "enable" if request.enabled else "disable"
        raise HTTPException(status_code=400, detail=clean or f"Failed to {action_word} cron job")

    return {"message": f"Cron job {'enabled' if request.enabled else 'disabled'} successfully"}


@router.get("/{connection_id}/cron/history", response_model=CronHistoryResponse)
async def get_cron_history(
    connection_id: str,
    current_user: User = Depends(get_current_user),
):
    """Get recent cron execution history from system logs."""
    await _verify_connection(connection_id, current_user)

    result = await _run(connection_id, CRON_HISTORY_SCRIPT, timeout=10)
    stdout = result.get("stdout", "").strip()

    entries: list[CronHistoryEntry] = []
    if stdout and "NO_CRON_LOGS" not in stdout:
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Parse log lines: timestamp hostname CRON[pid]: (user) CMD (command)
            entry = CronHistoryEntry(message=line)
            # Try to extract structured parts
            import re
            # journalctl ISO format: 2024-01-15T10:30:00+0000 hostname CRON[1234]: ...
            m = re.match(r'^(\S+)\s+\S+\s+CRON\[(\d+)\]:\s*\((\S+)\)\s+CMD\s+\((.+)\)\s*$', line, re.IGNORECASE)
            if m:
                entry.timestamp = m.group(1)
                entry.pid = m.group(2)
                entry.user = m.group(3)
                entry.command = m.group(4)
            else:
                # syslog format: Jan 15 10:30:00 hostname CRON[1234]: ...
                m2 = re.match(r'^(\w+\s+\d+\s+[\d:]+)\s+\S+\s+CRON\[(\d+)\]:\s*\((\S+)\)\s+CMD\s+\((.+)\)\s*$', line, re.IGNORECASE)
                if m2:
                    entry.timestamp = m2.group(1)
                    entry.pid = m2.group(2)
                    entry.user = m2.group(3)
                    entry.command = m2.group(4)

            entries.append(entry)

    return CronHistoryResponse(
        entries=entries,
        total=len(entries),
    )
