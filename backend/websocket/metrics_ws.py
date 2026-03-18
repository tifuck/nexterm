"""System metrics WebSocket endpoint."""
import asyncio
import json
import logging
from fastapi import WebSocket, WebSocketDisconnect, Query
from backend.services.ssh_proxy import ssh_proxy
from backend.middleware.auth import verify_token
from backend.config import config

logger = logging.getLogger(__name__)


async def metrics_websocket_handler(
    websocket: WebSocket,
    token: str = Query(default=None, deprecated=True),
):
    """Handle system metrics WebSocket connections.
    
    Collects CPU, RAM, disk, and network stats from the remote server
    via the active SSH connection and streams them to the client.
    
    Client messages:
      - {type: "subscribe", connection_id: "..."} - Start receiving metrics
      - {type: "unsubscribe"} - Stop receiving metrics
      - {type: "ping"}
    
    Server messages:
      - {type: "metrics", data: {cpu_percent, mem_total, mem_used, mem_percent, disk_total, disk_used, disk_percent, net_rx, net_tx, load_avg, uptime, os_name}}
      - {type: "pong"}
      - {type: "error", message: "..."}
    """
    await websocket.accept()
    
    user_id = None
    connection_id = None
    metrics_task = None
    
    try:
        if token:
            try:
                payload = verify_token(token)
                user_id = payload.get("sub")
            except Exception:
                await websocket.send_json({"type": "error", "message": "Invalid token"})
                await websocket.close(code=4001)
                return

        # Enforce auth timeout if not authenticated via query param
        if not user_id:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
                msg = json.loads(raw)
                if msg.get("type") == "auth":
                    payload = verify_token(msg.get("token", ""))
                    user_id = payload.get("sub")
                    await websocket.send_json({"type": "authenticated"})
                else:
                    await websocket.send_json({"type": "error", "message": "Authentication required"})
                    await websocket.close(code=4001)
                    return
            except asyncio.TimeoutError:
                await websocket.close(code=4001)
                return
            except Exception:
                await websocket.close(code=4001)
                return

        while True:
            try:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")
                
                if msg_type == "auth":
                    if user_id:
                        await websocket.send_json({"type": "error", "message": "Already authenticated"})
                        continue
                    try:
                        payload = verify_token(msg.get("token", ""))
                        user_id = payload.get("sub")
                        await websocket.send_json({"type": "authenticated"})
                    except Exception:
                        await websocket.send_json({"type": "error", "message": "Auth failed"})
                
                elif msg_type == "subscribe":
                    conn_id = msg.get("connection_id", "")
                    conn = await ssh_proxy.get_connection(conn_id)
                    if conn and conn.user_id == user_id:
                        connection_id = conn_id
                        # Cancel existing task and wait for it to finish
                        if metrics_task and not metrics_task.done():
                            metrics_task.cancel()
                            try:
                                await asyncio.wait_for(metrics_task, timeout=2)
                            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                                pass
                        metrics_task = asyncio.create_task(
                            _collect_metrics(websocket, connection_id)
                        )
                    else:
                        await websocket.send_json({"type": "error", "message": "Connection not found"})
                
                elif msg_type == "unsubscribe":
                    if metrics_task and not metrics_task.done():
                        metrics_task.cancel()
                        try:
                            await asyncio.wait_for(metrics_task, timeout=2)
                        except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                            pass
                    connection_id = None
                
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"Metrics WS error: {e}")
    finally:
        if metrics_task and not metrics_task.done():
            metrics_task.cancel()
            try:
                await asyncio.wait_for(metrics_task, timeout=2)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass


METRICS_SCRIPT = r"""
sh -c '
OS=$(uname -s)
case "$OS" in
Linux)
  # CPU - cumulative ticks from /proc/stat
  read _c u n s idle iow irq sirq st _ < /proc/stat
  cpu_total=$((u+n+s+idle+iow+irq+sirq+st))
  cpu_idle=$idle

  # Memory - /proc/meminfo (kB values)
  mt=0; ma=0; mf=0
  while read key val _; do
    case "$key" in
      MemTotal:)     mt=$val ;;
      MemAvailable:) ma=$val ;;
      MemFree:)      mf=$val ;;
    esac
  done < /proc/meminfo
  [ "$ma" -eq 0 ] 2>/dev/null && ma=$mf
  mem_total=$((mt*1024))
  mem_used=$(( (mt-ma)*1024 ))
  [ "$mt" -gt 0 ] && mem_pct=$(( (mt-ma)*1000/mt )) || mem_pct=0
  mem_p1=$((mem_pct/10))
  mem_p2=$((mem_pct%10))

  # Load
  read l1 l5 l15 _ < /proc/loadavg

  # Uptime
  read upt _ < /proc/uptime
  uptime_s=${upt%%.*}

  # OS name
  os_name="Linux"
  if [ -f /etc/os-release ]; then
    while IFS="=" read key val; do
      case "$key" in
        PRETTY_NAME) os_name=$(echo "$val" | tr -d "\""); break ;;
      esac
    done < /etc/os-release
  fi
  ;;

Darwin)
  # CPU - instantaneous snapshot via top (no cumulative ticks from shell)
  # Encode as synthetic ticks so the backend delta calculation works:
  #   cpu_total=1000, cpu_idle=idle_pct*10
  cpu_pct_line=$(top -l 1 -n 0 -s 0 2>/dev/null | grep "^CPU usage:")
  idle_raw=$(echo "$cpu_pct_line" | awk "{gsub(/%/,\"\"); print \$7}")
  idle_int=${idle_raw%%.*}
  cpu_total=1000
  cpu_idle=$((idle_int*10))

  # Memory
  mem_total=$(sysctl -n hw.memsize 2>/dev/null)
  pgsz=$(sysctl -n hw.pagesize 2>/dev/null)
  eval $(vm_stat 2>/dev/null | awk "
    /Pages active:/   {gsub(/\\./,\"\",\$3); printf \"pa=%s\\n\",\$3}
    /Pages wired/     {gsub(/\\./,\"\",\$4); printf \"pw=%s\\n\",\$4}
  ")
  pa=${pa:-0}; pw=${pw:-0}
  mem_used=$(( (pa+pw)*pgsz ))
  [ "$mem_total" -gt 0 ] 2>/dev/null && mem_pct=$((mem_used*1000/mem_total)) || mem_pct=0
  mem_p1=$((mem_pct/10))
  mem_p2=$((mem_pct%10))

  # Load
  load_raw=$(sysctl -n vm.loadavg 2>/dev/null)
  l1=$(echo "$load_raw" | awk "{print \$2}")
  l5=$(echo "$load_raw" | awk "{print \$3}")
  l15=$(echo "$load_raw" | awk "{print \$4}")

  # Uptime
  boot_sec=$(sysctl -n kern.boottime 2>/dev/null | awk -F"[ ,=]+" "{print \$4}")
  now=$(date +%s)
  uptime_s=$((now-boot_sec))

  # OS name
  os_name="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
  ;;

FreeBSD)
  # CPU - cumulative ticks from sysctl
  set -- $(sysctl -n kern.cp_time 2>/dev/null)
  cu=$1; cn=$2; cs=$3; ci=$4; cid=$5
  cpu_total=$((cu+cn+cs+ci+cid))
  cpu_idle=$cid

  # Memory
  mem_total=$(sysctl -n hw.physmem 2>/dev/null)
  pgsz=$(sysctl -n hw.pagesize 2>/dev/null)
  vf=$(sysctl -n vm.stats.vm.v_free_count 2>/dev/null || echo 0)
  vi=$(sysctl -n vm.stats.vm.v_inactive_count 2>/dev/null || echo 0)
  vc=$(sysctl -n vm.stats.vm.v_cache_count 2>/dev/null || echo 0)
  mem_free=$(( (vf+vi+vc)*pgsz ))
  mem_used=$((mem_total-mem_free))
  [ "$mem_total" -gt 0 ] 2>/dev/null && mem_pct=$((mem_used*1000/mem_total)) || mem_pct=0
  mem_p1=$((mem_pct/10))
  mem_p2=$((mem_pct%10))

  # Load
  load_raw=$(sysctl -n vm.loadavg 2>/dev/null)
  l1=$(echo "$load_raw" | awk "{print \$2}")
  l5=$(echo "$load_raw" | awk "{print \$3}")
  l15=$(echo "$load_raw" | awk "{print \$4}")

  # Uptime
  boot_sec=$(sysctl -n kern.boottime 2>/dev/null | awk -F"[ ,=]+" "{print \$4}")
  now=$(date +%s)
  uptime_s=$((now-boot_sec))

  # OS name
  os_name=$(uname -sr)
  ;;

*)
  printf "{\"error\":\"unsupported OS: %s\"}\n" "$OS"
  exit 0
  ;;
esac

# Disk (cross-platform)
eval $(df -Pk / 2>/dev/null | awk "NR==2{gsub(/%/,\"\",\$5); printf \"dk_t=%d dk_u=%d dk_p=%s\n\",\$2*1024,\$3*1024,\$5}")

# Escape os_name quotes for JSON
os_esc=$(printf "%s" "$os_name" | sed "s/\"/\\\\\"/g")

printf "{\"cpu_total\":%s,\"cpu_idle\":%s,\"mem_total\":%s,\"mem_used\":%s,\"mem_percent\":%s.%s,\"disk_total\":%s,\"disk_used\":%s,\"disk_percent\":%s,\"load_avg\":[%s,%s,%s],\"uptime\":%s,\"os_name\":\"%s\"}\n" \
  "${cpu_total:-0}" "${cpu_idle:-0}" "${mem_total:-0}" "${mem_used:-0}" \
  "${mem_p1:-0}" "${mem_p2:-0}" "${dk_t:-0}" "${dk_u:-0}" "${dk_p:-0}" \
  "${l1:-0}" "${l5:-0}" "${l15:-0}" "${uptime_s:-0}" "$os_esc"
' 2>/dev/null || echo '{"error":"metrics collection failed"}'
"""


async def _collect_metrics(websocket: WebSocket, connection_id: str):
    """Background task to periodically collect and send metrics."""
    interval = config.metrics_interval
    prev_cpu_total = 0
    prev_cpu_idle = 0
    
    try:
        while True:
            conn = await ssh_proxy.get_connection(connection_id)
            if not conn or not conn.exists:
                break
            
            try:
                result = await ssh_proxy.run_command(
                    connection_id, METRICS_SCRIPT, timeout=5,
                )
                if "error" in result and result["error"]:
                    await websocket.send_json({"type": "error", "message": result["error"]})
                    await asyncio.sleep(interval)
                    continue

                stdout = result.get("stdout", "")
                if stdout:
                    data = json.loads(stdout.strip())
                    if "error" not in data:
                        # Calculate CPU percent from delta
                        cpu_total = data.pop("cpu_total", 0)
                        cpu_idle = data.pop("cpu_idle", 0)
                        if prev_cpu_total > 0:
                            total_diff = cpu_total - prev_cpu_total
                            idle_diff = cpu_idle - prev_cpu_idle
                            if total_diff > 0:
                                data["cpu_percent"] = round((1 - idle_diff / total_diff) * 100, 1)
                            else:
                                data["cpu_percent"] = 0.0
                        else:
                            data["cpu_percent"] = 0.0
                        prev_cpu_total = cpu_total
                        prev_cpu_idle = cpu_idle
                        
                        await websocket.send_json({"type": "metrics", "data": data})
                    else:
                        await websocket.send_json({"type": "error", "message": data["error"]})
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug(f"Metrics collection error: {e}")
            
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
