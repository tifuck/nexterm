"""Server tools WebSocket endpoint for streaming dashboard metrics and log tailing."""
import asyncio
import json
import logging
import re
from fastapi import WebSocket, WebSocketDisconnect, Query
from backend.services.ssh_proxy import ssh_proxy
from backend.middleware.auth import verify_token
from backend.config import config
from backend.routers.tools import _build_wg_install_script, _sanitize_shell, _parse_exit_code

logger = logging.getLogger(__name__)


async def tools_websocket_handler(
    websocket: WebSocket,
    token: str = Query(default=None),
):
    """Handle server tools WebSocket connections.

    Provides streaming data for the system dashboard and live log tailing.

    Client messages:
      - {type: "subscribe_dashboard", connection_id: "..."} - Start extended metrics
      - {type: "unsubscribe_dashboard"} - Stop extended metrics
      - {type: "start_log_tail", connection_id: "...", unit: "...", pattern: "...", lines: N}
      - {type: "stop_log_tail"} - Stop log tailing
      - {type: "ping"}

    Server messages:
      - {type: "dashboard_metrics", data: {...}}
      - {type: "log_line", data: "..."}
      - {type: "log_batch", lines: [...]}
      - {type: "error", message: "..."}
      - {type: "pong"}
    """
    await websocket.accept()

    user_id = None
    dashboard_task = None
    log_tail_task = None
    wg_install_task = None
    docker_install_task = None
    docker_logs_task = None
    docker_pull_task = None

    try:
        if token:
            try:
                payload = verify_token(token)
                user_id = payload.get("sub")
            except Exception:
                await websocket.send_json({"type": "error", "message": "Invalid token"})
                await websocket.close(code=4001)
                return

        while True:
            try:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "auth" and not user_id:
                    try:
                        payload = verify_token(msg.get("token", ""))
                        user_id = payload.get("sub")
                        await websocket.send_json({"type": "authenticated"})
                    except Exception:
                        await websocket.send_json({"type": "error", "message": "Auth failed"})

                elif msg_type == "subscribe_dashboard":
                    conn_id = msg.get("connection_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id:
                        if dashboard_task and not dashboard_task.done():
                            dashboard_task.cancel()
                        dashboard_task = asyncio.create_task(
                            _collect_dashboard_metrics(websocket, conn_id)
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "unsubscribe_dashboard":
                    if dashboard_task and not dashboard_task.done():
                        dashboard_task.cancel()

                elif msg_type == "start_log_tail":
                    conn_id = msg.get("connection_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id:
                        if log_tail_task and not log_tail_task.done():
                            log_tail_task.cancel()
                        log_tail_task = asyncio.create_task(
                            _tail_logs(
                                websocket,
                                conn_id,
                                unit=msg.get("unit", ""),
                                pattern=msg.get("pattern", ""),
                                lines=msg.get("lines", 50),
                            )
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "stop_log_tail":
                    if log_tail_task and not log_tail_task.done():
                        log_tail_task.cancel()

                elif msg_type == "wireguard_install":
                    conn_id = msg.get("connection_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id:
                        if wg_install_task and not wg_install_task.done():
                            wg_install_task.cancel()
                        install_config = msg.get("config", {})
                        wg_install_task = asyncio.create_task(
                            _stream_wg_install(websocket, conn_id, install_config)
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "wireguard_install_kill":
                    if wg_install_task and not wg_install_task.done():
                        wg_install_task.cancel()
                        await websocket.send_json({
                            "type": "wireguard_install_output",
                            "data": "Installation process killed by user.",
                            "status": "killed",
                        })

                # -- Docker install streaming --
                elif msg_type == "docker_install":
                    conn_id = msg.get("connection_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id:
                        if docker_install_task and not docker_install_task.done():
                            docker_install_task.cancel()
                        docker_install_task = asyncio.create_task(
                            _stream_docker_install(websocket, conn_id)
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "docker_install_kill":
                    if docker_install_task and not docker_install_task.done():
                        docker_install_task.cancel()
                        await websocket.send_json({
                            "type": "docker_install_output",
                            "data": "Installation process killed by user.",
                            "status": "killed",
                        })

                # -- Docker container logs streaming --
                elif msg_type == "docker_logs_stream":
                    conn_id = msg.get("connection_id", "")
                    container_id = msg.get("container_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id and container_id:
                        if docker_logs_task and not docker_logs_task.done():
                            docker_logs_task.cancel()
                        docker_logs_task = asyncio.create_task(
                            _stream_docker_logs(
                                websocket, conn_id, container_id,
                                tail=msg.get("tail", 100),
                            )
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "docker_logs_stop":
                    if docker_logs_task and not docker_logs_task.done():
                        docker_logs_task.cancel()
                        await websocket.send_json({
                            "type": "docker_logs_stopped",
                            "data": "Log streaming stopped.",
                        })

                # -- Docker image pull streaming --
                elif msg_type == "docker_pull_image":
                    conn_id = msg.get("connection_id", "")
                    image_name = msg.get("image", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id and image_name:
                        if docker_pull_task and not docker_pull_task.done():
                            docker_pull_task.cancel()
                        docker_pull_task = asyncio.create_task(
                            _stream_docker_pull(websocket, conn_id, image_name)
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})

                elif msg_type == "docker_pull_stop":
                    if docker_pull_task and not docker_pull_task.done():
                        docker_pull_task.cancel()
                        await websocket.send_json({
                            "type": "docker_pull_output",
                            "data": "Pull cancelled by user.",
                            "status": "killed",
                        })

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"Tools WS error: {e}")
    finally:
        if dashboard_task and not dashboard_task.done():
            dashboard_task.cancel()
        if log_tail_task and not log_tail_task.done():
            log_tail_task.cancel()
        if wg_install_task and not wg_install_task.done():
            wg_install_task.cancel()
        if docker_install_task and not docker_install_task.done():
            docker_install_task.cancel()
        if docker_logs_task and not docker_logs_task.done():
            docker_logs_task.cancel()
        if docker_pull_task and not docker_pull_task.done():
            docker_pull_task.cancel()


# ---------------------------------------------------------------------------
# Extended dashboard metrics collection script
# ---------------------------------------------------------------------------

DASHBOARD_SCRIPT = r"""
sh -c '
OS=$(uname -s)
case "$OS" in
Linux)
  # Per-CPU ticks
  cpu_lines=""
  while read line; do
    case "$line" in
      cpu[0-9]*)
        set -- $line
        name=$1; shift
        u=$1; n=$2; s=$3; idle=$4; iow=$5; irq=$6; sirq=$7; st=${8:-0}
        total=$((u+n+s+idle+iow+irq+sirq+st))
        printf "CORE:%s:%s:%s\n" "$name" "$total" "$idle"
        ;;
      cpu\ *)
        set -- $line
        shift
        u=$1; n=$2; s=$3; idle=$4; iow=$5; irq=$6; sirq=$7; st=${8:-0}
        total=$((u+n+s+idle+iow+irq+sirq+st))
        printf "CPU_TOTAL:%s:%s\n" "$total" "$idle"
        ;;
    esac
  done < /proc/stat

  # Memory
  mt=0; ma=0; mf=0; st=0; sf=0
  while read key val _; do
    case "$key" in
      MemTotal:)     mt=$val ;;
      MemAvailable:) ma=$val ;;
      MemFree:)      mf=$val ;;
      SwapTotal:)    st=$val ;;
      SwapFree:)     sf=$val ;;
    esac
  done < /proc/meminfo
  [ "$ma" -eq 0 ] 2>/dev/null && ma=$mf
  mem_total=$((mt*1024))
  mem_used=$(( (mt-ma)*1024 ))
  swap_total=$((st*1024))
  swap_used=$(( (st-sf)*1024 ))
  printf "MEM:%s:%s:%s:%s\n" "$mem_total" "$mem_used" "$swap_total" "$swap_used"

  # Load + uptime
  read l1 l5 l15 _ < /proc/loadavg
  read upt _ < /proc/uptime
  uptime_s=${upt%%.*}
  printf "LOAD:%s:%s:%s:%s\n" "$l1" "$l5" "$l15" "$uptime_s"

  # Disk
  eval $(df -Pk / 2>/dev/null | awk "NR==2{printf \"dk_t=%d dk_u=%d dk_p=%s\n\",\$2*1024,\$3*1024,\$5}")
  printf "DISK:%s:%s\n" "${dk_t:-0}" "${dk_u:-0}"

  # Network bytes (aggregate all non-lo interfaces)
  rx=0; tx=0
  while read iface rbytes _ _ _ _ _ _ _ tbytes _; do
    case "$iface" in
      lo:*|Inter-*|*face*) continue ;;
    esac
    iface_rx=${rbytes}
    iface_tx=${tbytes}
    rx=$((rx + iface_rx))
    tx=$((tx + iface_tx))
  done < /proc/net/dev
  printf "NET:%s:%s\n" "$rx" "$tx"

  # Disk I/O (from /proc/diskstats, aggregate all sd* and vd* and nvme*)
  io_r=0; io_w=0
  while read _ _ dev _ rs _ _ rbs _ ws _ _ wbs _; do
    case "$dev" in
      sd[a-z]|vd[a-z]|nvme[0-9]*n[0-9]*) 
        io_r=$((io_r + rbs))
        io_w=$((io_w + wbs))
        ;;
    esac
  done < /proc/diskstats 2>/dev/null
  printf "IO:%s:%s\n" "$io_r" "$io_w"

  # Top 5 processes by CPU
  printf "TOP_CPU_START\n"
  ps aux --sort=-pcpu 2>/dev/null | head -6 | awk "NR>1{cmd=\"\"; for(i=11;i<=NF;i++){cmd=cmd (i>11?\" \":\"\")\$i}; printf \"%s|%s|%s|%s\n\",\$2,\$1,\$3,cmd}"
  printf "TOP_CPU_END\n"

  # Top 5 processes by MEM
  printf "TOP_MEM_START\n"
  ps aux --sort=-rss 2>/dev/null | head -6 | awk "NR>1{cmd=\"\"; for(i=11;i<=NF;i++){cmd=cmd (i>11?\" \":\"\")\$i}; printf \"%s|%s|%s|%s\n\",\$2,\$1,\$4,cmd}"
  printf "TOP_MEM_END\n"

  # CPU temp
  cpu_temp=""
  if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    raw=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
    cpu_temp=$((raw/1000))
  fi
  printf "CPU_TEMP:%s\n" "$cpu_temp"

  # GPU temp
  gpu_temp=""
  if command -v nvidia-smi >/dev/null 2>&1; then
    gpu_temp=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
  fi
  printf "GPU_TEMP:%s\n" "$gpu_temp"

  # OS name
  os_name="Linux"
  if [ -f /etc/os-release ]; then
    while IFS="=" read key val; do
      case "$key" in PRETTY_NAME) os_name=$(echo "$val" | tr -d "\""); break ;; esac
    done < /etc/os-release
  fi
  printf "OS_NAME:%s\n" "$os_name"
  ;;
*)
  printf "OS_NAME:%s\n" "$(uname -sr)"
  ;;
esac
' 2>/dev/null
"""


async def _collect_dashboard_metrics(websocket: WebSocket, connection_id: str):
    """Background task to collect extended dashboard metrics."""
    interval = max(config.metrics_interval, 3)
    prev_cpu_total = 0
    prev_cpu_idle = 0
    prev_core_data: dict[str, tuple[int, int]] = {}
    prev_net_rx = 0
    prev_net_tx = 0
    prev_io_r = 0
    prev_io_w = 0
    first_sample = True

    try:
        while True:
            conn = await ssh_proxy.get_connection(connection_id)
            if not conn or not conn.exists:
                break

            try:
                result = await ssh_proxy.run_command(
                    connection_id, DASHBOARD_SCRIPT, timeout=8,
                )
                if "error" in result and result["error"]:
                    await asyncio.sleep(interval)
                    continue

                stdout = result.get("stdout", "")
                if not stdout:
                    await asyncio.sleep(interval)
                    continue

                data: dict = {
                    "cpu_percent": 0.0,
                    "cpu_cores": [],
                    "mem_total": 0,
                    "mem_used": 0,
                    "mem_percent": 0.0,
                    "swap_total": 0,
                    "swap_used": 0,
                    "swap_percent": 0.0,
                    "disk_total": 0,
                    "disk_used": 0,
                    "disk_percent": 0.0,
                    "net_rx_rate": 0.0,
                    "net_tx_rate": 0.0,
                    "load_avg": [],
                    "uptime": 0,
                    "os_name": "",
                    "top_cpu_procs": [],
                    "top_mem_procs": [],
                    "io_read_rate": 0.0,
                    "io_write_rate": 0.0,
                    "gpu_temp": "",
                    "cpu_temp": "",
                }

                in_top_cpu = False
                in_top_mem = False
                core_percents = []

                for line in stdout.split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    if line.startswith("CPU_TOTAL:"):
                        parts = line.split(":")
                        if len(parts) >= 3:
                            cpu_total = int(parts[1])
                            cpu_idle = int(parts[2])
                            if prev_cpu_total > 0:
                                td = cpu_total - prev_cpu_total
                                idd = cpu_idle - prev_cpu_idle
                                if td > 0:
                                    data["cpu_percent"] = round((1 - idd / td) * 100, 1)
                            prev_cpu_total = cpu_total
                            prev_cpu_idle = cpu_idle

                    elif line.startswith("CORE:"):
                        parts = line.split(":")
                        if len(parts) >= 4:
                            core_name = parts[1]
                            core_total = int(parts[2])
                            core_idle = int(parts[3])
                            if core_name in prev_core_data:
                                pt, pi = prev_core_data[core_name]
                                td = core_total - pt
                                idd = core_idle - pi
                                if td > 0:
                                    core_percents.append(round((1 - idd / td) * 100, 1))
                                else:
                                    core_percents.append(0.0)
                            else:
                                core_percents.append(0.0)
                            prev_core_data[core_name] = (core_total, core_idle)

                    elif line.startswith("MEM:"):
                        parts = line.split(":")
                        if len(parts) >= 5:
                            data["mem_total"] = int(parts[1])
                            data["mem_used"] = int(parts[2])
                            data["swap_total"] = int(parts[3])
                            data["swap_used"] = int(parts[4])
                            if data["mem_total"] > 0:
                                data["mem_percent"] = round(data["mem_used"] / data["mem_total"] * 100, 1)
                            if data["swap_total"] > 0:
                                data["swap_percent"] = round(data["swap_used"] / data["swap_total"] * 100, 1)

                    elif line.startswith("LOAD:"):
                        parts = line.split(":")
                        if len(parts) >= 5:
                            try:
                                data["load_avg"] = [float(parts[1]), float(parts[2]), float(parts[3])]
                                data["uptime"] = int(parts[4])
                            except ValueError:
                                pass

                    elif line.startswith("DISK:"):
                        parts = line.split(":")
                        if len(parts) >= 3:
                            data["disk_total"] = int(parts[1])
                            data["disk_used"] = int(parts[2])
                            if data["disk_total"] > 0:
                                data["disk_percent"] = round(data["disk_used"] / data["disk_total"] * 100, 1)

                    elif line.startswith("NET:"):
                        parts = line.split(":")
                        if len(parts) >= 3:
                            net_rx = int(parts[1])
                            net_tx = int(parts[2])
                            if not first_sample and prev_net_rx > 0:
                                data["net_rx_rate"] = round((net_rx - prev_net_rx) / interval, 1)
                                data["net_tx_rate"] = round((net_tx - prev_net_tx) / interval, 1)
                            prev_net_rx = net_rx
                            prev_net_tx = net_tx

                    elif line.startswith("IO:"):
                        parts = line.split(":")
                        if len(parts) >= 3:
                            io_r = int(parts[1])
                            io_w = int(parts[2])
                            if not first_sample and prev_io_r > 0:
                                data["io_read_rate"] = round((io_r - prev_io_r) * 512 / interval, 1)
                                data["io_write_rate"] = round((io_w - prev_io_w) * 512 / interval, 1)
                            prev_io_r = io_r
                            prev_io_w = io_w

                    elif line == "TOP_CPU_START":
                        in_top_cpu = True
                        continue
                    elif line == "TOP_CPU_END":
                        in_top_cpu = False
                        continue
                    elif line == "TOP_MEM_START":
                        in_top_mem = True
                        continue
                    elif line == "TOP_MEM_END":
                        in_top_mem = False
                        continue
                    elif in_top_cpu and "|" in line:
                        parts = line.split("|", 3)
                        if len(parts) >= 4:
                            data["top_cpu_procs"].append({
                                "pid": parts[0],
                                "user": parts[1],
                                "cpu": parts[2],
                                "command": parts[3][:80],
                            })
                    elif in_top_mem and "|" in line:
                        parts = line.split("|", 3)
                        if len(parts) >= 4:
                            data["top_mem_procs"].append({
                                "pid": parts[0],
                                "user": parts[1],
                                "mem": parts[2],
                                "command": parts[3][:80],
                            })

                    elif line.startswith("CPU_TEMP:"):
                        data["cpu_temp"] = line.split(":", 1)[1]
                    elif line.startswith("GPU_TEMP:"):
                        data["gpu_temp"] = line.split(":", 1)[1]
                    elif line.startswith("OS_NAME:"):
                        data["os_name"] = line.split(":", 1)[1]

                data["cpu_cores"] = core_percents
                first_sample = False

                await websocket.send_json({"type": "dashboard_metrics", "data": data})

            except Exception as e:
                logger.debug(f"Dashboard metrics error: {e}")

            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# Log tailing via polling
# ---------------------------------------------------------------------------

async def _tail_logs(
    websocket: WebSocket,
    connection_id: str,
    unit: str = "",
    pattern: str = "",
    lines: int = 50,
):
    """Poll journalctl for new log lines and stream them to the client."""
    import re

    def _ws_sanitize(value: str) -> str:
        value = value.replace("`", "").replace("\n", " ").replace("\r", "").replace("\0", "")
        value = re.sub(r"\$\(", "(", value)
        value = re.sub(r"\$\{", "{", value)
        value = value.replace(";", "").replace("|", "").replace("&", "")
        value = value.replace('"', "").replace("'", "")
        return value.strip()

    poll_interval = 2
    cursor = ""
    safe_unit = _ws_sanitize(unit) if unit else ""
    safe_pattern = _ws_sanitize(pattern) if pattern else ""

    try:
        # Initial fetch
        cmd_parts = ["journalctl", "--no-pager", "-o", "short-iso", f"-n {lines}"]
        if safe_unit:
            cmd_parts.append(f'-u "{safe_unit}"')
        if safe_pattern:
            cmd_parts.append(f'--grep="{safe_pattern}"')

        # Add --show-cursor to get the cursor position
        cmd_parts.append("--show-cursor")

        cmd = " ".join(cmd_parts) + " 2>/dev/null"
        result = await ssh_proxy.run_command(connection_id, cmd, timeout=10)
        stdout = result.get("stdout", "")

        if stdout:
            log_lines = []
            for line in stdout.split("\n"):
                line = line.strip()
                if line.startswith("-- cursor:"):
                    cursor = line.replace("-- cursor:", "").strip()
                elif line:
                    log_lines.append(line)

            if log_lines:
                await websocket.send_json({"type": "log_batch", "lines": log_lines})

        # Polling loop for new lines
        while True:
            await asyncio.sleep(poll_interval)

            conn = await ssh_proxy.get_connection(connection_id)
            if not conn or not conn.exists:
                await websocket.send_json({"type": "error", "message": "Connection lost"})
                break

            poll_parts = ["journalctl", "--no-pager", "-o", "short-iso"]
            if safe_unit:
                poll_parts.append(f'-u "{safe_unit}"')
            if safe_pattern:
                poll_parts.append(f'--grep="{safe_pattern}"')
            if cursor:
                poll_parts.append(f'--after-cursor="{cursor}"')
            else:
                poll_parts.append("--since '2 seconds ago'")
            poll_parts.append("--show-cursor")

            poll_cmd = " ".join(poll_parts) + " 2>/dev/null"
            try:
                poll_result = await ssh_proxy.run_command(connection_id, poll_cmd, timeout=5)
                poll_stdout = poll_result.get("stdout", "")

                if poll_stdout:
                    new_lines = []
                    for line in poll_stdout.split("\n"):
                        line = line.strip()
                        if line.startswith("-- cursor:"):
                            cursor = line.replace("-- cursor:", "").strip()
                        elif line:
                            new_lines.append(line)

                    if new_lines:
                        await websocket.send_json({"type": "log_batch", "lines": new_lines})
            except Exception:
                pass

    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# WireGuard install streaming
# ---------------------------------------------------------------------------

async def _stream_wg_install(
    websocket: WebSocket,
    connection_id: str,
    install_config: dict,
):
    """Run WireGuard install script and stream output line-by-line.

    Uses a background process with output written to a temp file, polled
    every second for new lines.
    """
    import base64

    tmpfile = ""
    tmpscript = ""
    pid = ""

    try:
        endpoint = _sanitize_shell(install_config.get("endpoint", ""))
        port = int(install_config.get("port", 51820))
        dns = _sanitize_shell(install_config.get("dns", "1.1.1.1, 1.0.0.1"))
        first_client = _sanitize_shell(install_config.get("first_client_name", "client"))
        local_ip = _sanitize_shell(install_config.get("local_ip", ""))
        ipv6_addr = _sanitize_shell(install_config.get("ipv6_addr", ""))

        if not endpoint:
            await websocket.send_json({
                "type": "wireguard_install_output",
                "data": "Error: No endpoint specified.",
                "status": "failed",
            })
            return

        await websocket.send_json({
            "type": "wireguard_install_output",
            "data": "Preparing WireGuard installation...",
            "status": "running",
        })

        # Build the install script
        script = _build_wg_install_script(
            endpoint=endpoint, port=port, dns=dns,
            first_client=first_client, local_ip=local_ip,
            ipv6_addr=ipv6_addr,
        )

        # Create temp files for script and output log
        setup_cmd = (
            "tmpfile=$(mktemp /tmp/wg_install_XXXXXX.log) && "
            "tmpscript=$(mktemp /tmp/wg_install_XXXXXX.sh) && "
            "printf '%s\\n%s' \"$tmpfile\" \"$tmpscript\""
        )
        setup_result = await ssh_proxy.run_command(connection_id, setup_cmd, timeout=5)
        setup_lines = setup_result.get("stdout", "").strip().split("\n")
        if len(setup_lines) < 2 or "error" in setup_result:
            await websocket.send_json({
                "type": "wireguard_install_output",
                "data": "Failed to create temp files for install.",
                "status": "failed",
            })
            return

        tmpfile = setup_lines[0].strip()
        tmpscript = setup_lines[1].strip()

        # Write script content via base64 to avoid escaping issues
        script_b64 = base64.b64encode(script.encode()).decode()
        write_cmd = f"echo '{script_b64}' | base64 -d > {tmpscript} && chmod +x {tmpscript}"
        await ssh_proxy.run_command(connection_id, write_cmd, timeout=10)

        # Execute in background, output to log file
        exec_cmd = f"nohup sudo bash {tmpscript} > {tmpfile} 2>&1 & echo $!"
        pid_result = await ssh_proxy.run_command(connection_id, exec_cmd, timeout=10)
        pid = pid_result.get("stdout", "").strip().split("\n")[-1]

        if not pid.isdigit():
            await websocket.send_json({
                "type": "wireguard_install_output",
                "data": f"Failed to start install process.",
                "status": "failed",
            })
            return

        await websocket.send_json({
            "type": "wireguard_install_output",
            "data": f"Install process started (PID {pid}), streaming output...",
            "status": "running",
        })

        # Poll the output file for new lines
        lines_read = 0
        consecutive_empty = 0
        max_empty = 300  # 5 min at 1s interval

        while consecutive_empty < max_empty:
            await asyncio.sleep(1)

            # Check if process is still running
            check_cmd = f"kill -0 {pid} 2>/dev/null && echo RUNNING || echo DONE"
            check_result = await ssh_proxy.run_command(connection_id, check_cmd, timeout=5)
            process_status = check_result.get("stdout", "").strip()

            # Read new lines from log file
            tail_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
            tail_result = await ssh_proxy.run_command(connection_id, tail_cmd, timeout=5)
            new_output = tail_result.get("stdout", "")

            if new_output.strip():
                new_lines = new_output.split("\n")
                for line in new_lines:
                    if line.strip():
                        await websocket.send_json({
                            "type": "wireguard_install_output",
                            "data": line,
                            "status": "running",
                        })
                lines_read += len(new_lines)
                consecutive_empty = 0
            else:
                consecutive_empty += 1

            # Process finished
            if "DONE" in process_status:
                await asyncio.sleep(0.5)
                # Read any remaining output
                final_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
                final_result = await ssh_proxy.run_command(connection_id, final_cmd, timeout=5)
                final_output = final_result.get("stdout", "")
                if final_output.strip():
                    for line in final_output.split("\n"):
                        if line.strip():
                            await websocket.send_json({
                                "type": "wireguard_install_output",
                                "data": line,
                                "status": "running",
                            })

                # Check full output for success marker
                full_cmd = f"cat {tmpfile} 2>/dev/null"
                full_result = await ssh_proxy.run_command(connection_id, full_cmd, timeout=5)
                full_output = full_result.get("stdout", "")

                if "WG_INSTALL_SUCCESS" in full_output:
                    await websocket.send_json({
                        "type": "wireguard_install_output",
                        "data": "WireGuard installation completed successfully!",
                        "status": "completed",
                    })
                else:
                    await websocket.send_json({
                        "type": "wireguard_install_output",
                        "data": "Installation process finished but verification failed.",
                        "status": "failed",
                    })

                # Cleanup
                cleanup = f"rm -f {tmpfile} {tmpscript} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, cleanup, timeout=5)
                return

        # Timed out
        await websocket.send_json({
            "type": "wireguard_install_output",
            "data": "Installation timed out (no output for 5 minutes).",
            "status": "failed",
        })
        kill_cmd = f"sudo kill {pid} 2>/dev/null; rm -f {tmpfile} {tmpscript} 2>/dev/null"
        await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)

    except asyncio.CancelledError:
        logger.info("WireGuard install task cancelled")
        # Try to kill background process
        if pid and pid.isdigit():
            try:
                kill_cmd = f"sudo kill {pid} 2>/dev/null; rm -f {tmpfile} {tmpscript} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"WireGuard install streaming error: {e}")
        try:
            await websocket.send_json({
                "type": "wireguard_install_output",
                "data": f"Install error: {str(e)}",
                "status": "failed",
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Docker install streaming
# ---------------------------------------------------------------------------

async def _stream_docker_install(
    websocket: WebSocket,
    connection_id: str,
):
    """Stream Docker Engine install via official get.docker.com script.

    Uses same pattern as WireGuard: write a wrapper script to temp file,
    execute in background, poll the log file for new lines.
    """
    import base64

    tmpfile = ""
    tmpscript = ""
    pid = ""

    # Wrapper script that downloads and runs the official Docker installer
    install_script = r"""#!/bin/bash
set -e
echo "=== Downloading Docker install script from get.docker.com ==="
if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o /tmp/_docker_install_official.sh
elif command -v wget >/dev/null 2>&1; then
    wget -qO /tmp/_docker_install_official.sh https://get.docker.com
else
    echo "ERROR: Neither curl nor wget found. Cannot download installer."
    exit 1
fi
echo "=== Running Docker install script ==="
sh /tmp/_docker_install_official.sh
rm -f /tmp/_docker_install_official.sh
echo "=== Enabling and starting Docker service ==="
if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
fi
echo "=== Verifying Docker installation ==="
if command -v docker >/dev/null 2>&1; then
    docker --version
    echo "DOCKER_INSTALL_SUCCESS"
else
    echo "ERROR: docker command not found after install"
    exit 1
fi
"""

    try:
        await websocket.send_json({
            "type": "docker_install_output",
            "data": "Preparing Docker installation...",
            "status": "running",
        })

        # Create temp files
        setup_cmd = (
            "tmpfile=$(mktemp /tmp/docker_install_XXXXXX.log) && "
            "tmpscript=$(mktemp /tmp/docker_install_XXXXXX.sh) && "
            "printf '%s\\n%s' \"$tmpfile\" \"$tmpscript\""
        )
        setup_result = await ssh_proxy.run_command(connection_id, setup_cmd, timeout=5)
        setup_lines = setup_result.get("stdout", "").strip().split("\n")
        if len(setup_lines) < 2 or "error" in setup_result:
            await websocket.send_json({
                "type": "docker_install_output",
                "data": "Failed to create temp files for install.",
                "status": "failed",
            })
            return

        tmpfile = setup_lines[0].strip()
        tmpscript = setup_lines[1].strip()

        # Write script via base64
        script_b64 = base64.b64encode(install_script.encode()).decode()
        write_cmd = f"echo '{script_b64}' | base64 -d > {tmpscript} && chmod +x {tmpscript}"
        await ssh_proxy.run_command(connection_id, write_cmd, timeout=10)

        # Execute in background
        exec_cmd = f"nohup sudo bash {tmpscript} > {tmpfile} 2>&1 & echo $!"
        pid_result = await ssh_proxy.run_command(connection_id, exec_cmd, timeout=10)
        pid = pid_result.get("stdout", "").strip().split("\n")[-1]

        if not pid.isdigit():
            await websocket.send_json({
                "type": "docker_install_output",
                "data": "Failed to start install process.",
                "status": "failed",
            })
            return

        await websocket.send_json({
            "type": "docker_install_output",
            "data": f"Install process started (PID {pid}), streaming output...",
            "status": "running",
        })

        # Poll output file
        lines_read = 0
        consecutive_empty = 0
        max_empty = 600  # 10 min at 1s interval (Docker install can be slow)

        while consecutive_empty < max_empty:
            await asyncio.sleep(1)

            # Check process status
            check_cmd = f"kill -0 {pid} 2>/dev/null && echo RUNNING || echo DONE"
            check_result = await ssh_proxy.run_command(connection_id, check_cmd, timeout=5)
            process_status = check_result.get("stdout", "").strip()

            # Read new lines
            tail_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
            tail_result = await ssh_proxy.run_command(connection_id, tail_cmd, timeout=5)
            new_output = tail_result.get("stdout", "")

            if new_output.strip():
                new_lines = new_output.split("\n")
                for line in new_lines:
                    if line.strip():
                        await websocket.send_json({
                            "type": "docker_install_output",
                            "data": line,
                            "status": "running",
                        })
                lines_read += len(new_lines)
                consecutive_empty = 0
            else:
                consecutive_empty += 1

            # Process finished
            if "DONE" in process_status:
                await asyncio.sleep(0.5)
                # Read remaining output
                final_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
                final_result = await ssh_proxy.run_command(connection_id, final_cmd, timeout=5)
                final_output = final_result.get("stdout", "")
                if final_output.strip():
                    for line in final_output.split("\n"):
                        if line.strip():
                            await websocket.send_json({
                                "type": "docker_install_output",
                                "data": line,
                                "status": "running",
                            })

                # Check for success marker
                full_cmd = f"cat {tmpfile} 2>/dev/null"
                full_result = await ssh_proxy.run_command(connection_id, full_cmd, timeout=5)
                full_output = full_result.get("stdout", "")

                if "DOCKER_INSTALL_SUCCESS" in full_output:
                    await websocket.send_json({
                        "type": "docker_install_output",
                        "data": "Docker installation completed successfully!",
                        "status": "completed",
                    })
                else:
                    await websocket.send_json({
                        "type": "docker_install_output",
                        "data": "Installation process finished but verification failed. Check output above for errors.",
                        "status": "failed",
                    })

                # Cleanup
                cleanup = f"rm -f {tmpfile} {tmpscript} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, cleanup, timeout=5)
                return

        # Timed out
        await websocket.send_json({
            "type": "docker_install_output",
            "data": "Installation timed out (no output for 10 minutes).",
            "status": "failed",
        })
        kill_cmd = f"sudo kill {pid} 2>/dev/null; rm -f {tmpfile} {tmpscript} 2>/dev/null"
        await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)

    except asyncio.CancelledError:
        logger.info("Docker install task cancelled")
        if pid and pid.isdigit():
            try:
                kill_cmd = f"sudo kill {pid} 2>/dev/null; rm -f {tmpfile} {tmpscript} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Docker install streaming error: {e}")
        try:
            await websocket.send_json({
                "type": "docker_install_output",
                "data": f"Install error: {str(e)}",
                "status": "failed",
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Docker container log streaming
# ---------------------------------------------------------------------------

async def _stream_docker_logs(
    websocket: WebSocket,
    connection_id: str,
    container_id: str,
    tail: int = 100,
):
    """Stream container logs by polling `docker logs --tail` with increasing since timestamp.

    Uses a background `docker logs -f` process writing to a temp file,
    polled every 1s for new lines. This gives us real-time log tailing
    without needing a persistent SSH channel.
    """
    safe_id = _sanitize_shell(container_id)
    tmpfile = ""
    pid = ""

    try:
        # Create temp file and start `docker logs -f` in background
        setup_cmd = (
            f"tmpfile=$(mktemp /tmp/docker_logs_XXXXXX.log) && "
            f"nohup sudo docker logs -f --tail {int(tail)} {safe_id} > \"$tmpfile\" 2>&1 & "
            f"echo \"$!\" && echo \"$tmpfile\""
        )
        setup_result = await ssh_proxy.run_command(connection_id, setup_cmd, timeout=10)
        setup_lines = setup_result.get("stdout", "").strip().split("\n")

        if len(setup_lines) < 2:
            await websocket.send_json({
                "type": "docker_logs_error",
                "message": "Failed to start log streaming process.",
            })
            return

        pid = setup_lines[0].strip()
        tmpfile = setup_lines[1].strip()

        if not pid.isdigit():
            await websocket.send_json({
                "type": "docker_logs_error",
                "message": "Failed to start docker logs process.",
            })
            return

        await websocket.send_json({
            "type": "docker_logs_started",
            "container_id": container_id,
        })

        # Poll for new lines
        lines_read = 0
        consecutive_empty = 0
        max_empty = 300  # 5 min with no new output

        while consecutive_empty < max_empty:
            await asyncio.sleep(1)

            # Check if process is still running
            check_cmd = f"kill -0 {pid} 2>/dev/null && echo RUNNING || echo DONE"
            check_result = await ssh_proxy.run_command(connection_id, check_cmd, timeout=5)
            process_status = check_result.get("stdout", "").strip()

            # Read new lines
            tail_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
            tail_result = await ssh_proxy.run_command(connection_id, tail_cmd, timeout=5)
            new_output = tail_result.get("stdout", "")

            if new_output.strip():
                new_lines = [l for l in new_output.split("\n") if l.strip()]
                if new_lines:
                    await websocket.send_json({
                        "type": "docker_logs_lines",
                        "container_id": container_id,
                        "lines": new_lines,
                    })
                lines_read += len(new_output.split("\n"))
                consecutive_empty = 0
            else:
                consecutive_empty += 1

            # Container stopped producing logs
            if "DONE" in process_status:
                # Read any remaining
                final_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
                final_result = await ssh_proxy.run_command(connection_id, final_cmd, timeout=5)
                final_output = final_result.get("stdout", "")
                if final_output.strip():
                    final_lines = [l for l in final_output.split("\n") if l.strip()]
                    if final_lines:
                        await websocket.send_json({
                            "type": "docker_logs_lines",
                            "container_id": container_id,
                            "lines": final_lines,
                        })

                await websocket.send_json({
                    "type": "docker_logs_ended",
                    "container_id": container_id,
                    "reason": "Container log process exited.",
                })

                cleanup = f"rm -f {tmpfile} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, cleanup, timeout=5)
                return

        # Timed out - no new output for 5 min
        await websocket.send_json({
            "type": "docker_logs_ended",
            "container_id": container_id,
            "reason": "No new log output for 5 minutes.",
        })
        kill_cmd = f"kill {pid} 2>/dev/null; rm -f {tmpfile} 2>/dev/null"
        await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)

    except asyncio.CancelledError:
        logger.info(f"Docker logs task cancelled for container {container_id}")
        if pid and pid.isdigit():
            try:
                kill_cmd = f"kill {pid} 2>/dev/null; rm -f {tmpfile} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Docker log streaming error: {e}")
        try:
            await websocket.send_json({
                "type": "docker_logs_error",
                "message": f"Log streaming error: {str(e)}",
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Docker image pull streaming
# ---------------------------------------------------------------------------

async def _stream_docker_pull(
    websocket: WebSocket,
    connection_id: str,
    image_name: str,
):
    """Stream `docker pull` output line-by-line.

    Runs `sudo docker pull <image>` in background with output to temp file,
    polls for new lines every 1s.
    """
    safe_image = _sanitize_shell(image_name)
    tmpfile = ""
    pid = ""

    try:
        await websocket.send_json({
            "type": "docker_pull_output",
            "data": f"Pulling image: {image_name}...",
            "status": "running",
        })

        # Start pull in background
        setup_cmd = (
            f"tmpfile=$(mktemp /tmp/docker_pull_XXXXXX.log) && "
            f"nohup sudo docker pull {safe_image} > \"$tmpfile\" 2>&1 & "
            f"echo \"$!\" && echo \"$tmpfile\""
        )
        setup_result = await ssh_proxy.run_command(connection_id, setup_cmd, timeout=10)
        setup_lines = setup_result.get("stdout", "").strip().split("\n")

        if len(setup_lines) < 2:
            await websocket.send_json({
                "type": "docker_pull_output",
                "data": "Failed to start pull process.",
                "status": "failed",
            })
            return

        pid = setup_lines[0].strip()
        tmpfile = setup_lines[1].strip()

        if not pid.isdigit():
            await websocket.send_json({
                "type": "docker_pull_output",
                "data": "Failed to start docker pull process.",
                "status": "failed",
            })
            return

        # Poll output file
        lines_read = 0
        consecutive_empty = 0
        max_empty = 600  # 10 min for large images

        while consecutive_empty < max_empty:
            await asyncio.sleep(1)

            # Check process status
            check_cmd = f"kill -0 {pid} 2>/dev/null && echo RUNNING || echo DONE"
            check_result = await ssh_proxy.run_command(connection_id, check_cmd, timeout=5)
            process_status = check_result.get("stdout", "").strip()

            # Read new lines
            tail_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
            tail_result = await ssh_proxy.run_command(connection_id, tail_cmd, timeout=5)
            new_output = tail_result.get("stdout", "")

            if new_output.strip():
                new_lines = new_output.split("\n")
                for line in new_lines:
                    if line.strip():
                        await websocket.send_json({
                            "type": "docker_pull_output",
                            "data": line,
                            "status": "running",
                        })
                lines_read += len(new_lines)
                consecutive_empty = 0
            else:
                consecutive_empty += 1

            # Process finished
            if "DONE" in process_status:
                await asyncio.sleep(0.5)
                # Read remaining
                final_cmd = f"tail -n +{lines_read + 1} {tmpfile} 2>/dev/null"
                final_result = await ssh_proxy.run_command(connection_id, final_cmd, timeout=5)
                final_output = final_result.get("stdout", "")
                if final_output.strip():
                    for line in final_output.split("\n"):
                        if line.strip():
                            await websocket.send_json({
                                "type": "docker_pull_output",
                                "data": line,
                                "status": "running",
                            })

                # Check exit code of the pull
                exitcode_cmd = f"wait {pid} 2>/dev/null; echo $?"
                # wait may not work for non-child processes, so check the log for errors
                full_cmd = f"cat {tmpfile} 2>/dev/null"
                full_result = await ssh_proxy.run_command(connection_id, full_cmd, timeout=5)
                full_output = full_result.get("stdout", "")

                # Docker pull prints "Status: Downloaded newer image" or "Status: Image is up to date"
                if "Status: Downloaded" in full_output or "Status: Image is up to date" in full_output:
                    await websocket.send_json({
                        "type": "docker_pull_output",
                        "data": f"Successfully pulled {image_name}",
                        "status": "completed",
                    })
                elif "Error" in full_output or "error" in full_output.lower():
                    await websocket.send_json({
                        "type": "docker_pull_output",
                        "data": f"Pull failed for {image_name}. Check output above.",
                        "status": "failed",
                    })
                else:
                    # Ambiguous - but process finished
                    await websocket.send_json({
                        "type": "docker_pull_output",
                        "data": f"Pull process completed for {image_name}.",
                        "status": "completed",
                    })

                # Cleanup
                cleanup = f"rm -f {tmpfile} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, cleanup, timeout=5)
                return

        # Timed out
        await websocket.send_json({
            "type": "docker_pull_output",
            "data": "Pull timed out (no output for 10 minutes).",
            "status": "failed",
        })
        kill_cmd = f"kill {pid} 2>/dev/null; rm -f {tmpfile} 2>/dev/null"
        await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)

    except asyncio.CancelledError:
        logger.info(f"Docker pull task cancelled for {image_name}")
        if pid and pid.isdigit():
            try:
                kill_cmd = f"kill {pid} 2>/dev/null; rm -f {tmpfile} 2>/dev/null"
                await ssh_proxy.run_command(connection_id, kill_cmd, timeout=5)
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Docker pull streaming error: {e}")
        try:
            await websocket.send_json({
                "type": "docker_pull_output",
                "data": f"Pull error: {str(e)}",
                "status": "failed",
            })
        except Exception:
            pass
