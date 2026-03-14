"""Pydantic schemas for server tools."""
from pydantic import BaseModel, Field
from typing import Optional


class ProcessInfo(BaseModel):
    """A single process entry."""
    pid: int
    user: str
    cpu_percent: float
    mem_percent: float
    vsz: int = 0
    rss: int = 0
    tty: str = ""
    stat: str = ""
    start: str = ""
    time: str = ""
    command: str


class ProcessListResponse(BaseModel):
    """Response for process listing."""
    processes: list[ProcessInfo]
    total: int


class KillRequest(BaseModel):
    """Request to kill a process."""
    signal: str = Field(default="TERM", pattern=r"^(TERM|KILL|HUP|INT|STOP|CONT|USR1|USR2)$")


class ServiceInfo(BaseModel):
    """A single systemd service entry."""
    name: str
    load_state: str = ""
    active_state: str = ""
    sub_state: str = ""
    description: str = ""


class ServiceListResponse(BaseModel):
    """Response for service listing."""
    services: list[ServiceInfo]
    init_system: str = "unknown"


class ServiceActionRequest(BaseModel):
    """Request to perform an action on a service."""
    action: str = Field(..., pattern=r"^(start|stop|restart|enable|disable|reload)$")


class SystemInfoResponse(BaseModel):
    """System hardware and kernel info."""
    hostname: str = ""
    kernel: str = ""
    os_name: str = ""
    os_version: str = ""
    architecture: str = ""
    cpu_model: str = ""
    cpu_cores: int = 0
    cpu_threads: int = 0
    total_memory: str = ""
    uptime: str = ""
    uptime_seconds: int = 0
    gpu_info: str = ""
    block_devices: list[dict] = []


class LogQueryParams(BaseModel):
    """Parameters for log queries."""
    unit: str = ""
    lines: int = Field(default=100, ge=1, le=5000)
    pattern: str = ""
    priority: str = ""
    since: str = ""
    until: str = ""


class LogEntry(BaseModel):
    """A single log entry."""
    timestamp: str = ""
    unit: str = ""
    priority: str = ""
    message: str = ""


class LogResponse(BaseModel):
    """Response for log queries."""
    entries: list[LogEntry]
    total: int
    available_units: list[str] = []


class LogAnalyzeRequest(BaseModel):
    """Request for AI log analysis."""
    log_text: str = Field(..., min_length=1, max_length=50000)
    context: str = ""


class LogAnalyzeResponse(BaseModel):
    """Response from AI log analysis."""
    summary: str
    error_count: int = 0
    warning_count: int = 0
    insights: list[str] = []


class ScriptRunRequest(BaseModel):
    """Request to run a script on the remote server."""
    script: str = Field(..., min_length=1, max_length=100000)
    timeout: int = Field(default=30, ge=1, le=300)
    interpreter: str = Field(default="bash", pattern=r"^(bash|sh|python3|python|perl|node)$")


class ScriptRunResponse(BaseModel):
    """Response from script execution."""
    stdout: str = ""
    stderr: str = ""
    exit_status: int = -1
    timed_out: bool = False


# ---------------------------------------------------------------------------
# Phase 2: Security, Firewall, Packages
# ---------------------------------------------------------------------------

class OpenPort(BaseModel):
    """An open listening port."""
    protocol: str = ""
    local_address: str = ""
    port: int = 0
    pid: str = ""
    process: str = ""
    state: str = ""


class FailedLogin(BaseModel):
    """A failed login attempt."""
    date: str = ""
    user: str = ""
    source: str = ""
    service: str = ""


class UserPrivilege(BaseModel):
    """A system user and their privileges."""
    username: str = ""
    uid: int = 0
    gid: int = 0
    groups: list[str] = []
    shell: str = ""
    has_sudo: bool = False
    home: str = ""


class SecurityScanResponse(BaseModel):
    """Full security scan result."""
    open_ports: list[OpenPort] = []
    failed_logins: list[FailedLogin] = []
    users: list[UserPrivilege] = []
    ssh_config: dict = {}
    malware_scan_available: bool = False


class MalwareScanResponse(BaseModel):
    """Result of a malware scan."""
    tool: str = ""
    status: str = ""
    output: str = ""
    threats_found: int = 0


class FirewallRule(BaseModel):
    """A single firewall rule."""
    number: int = 0
    action: str = ""
    direction: str = ""
    protocol: str = ""
    port: str = ""
    source: str = ""
    destination: str = ""
    raw: str = ""


class FirewallStatus(BaseModel):
    """Firewall status and rules."""
    backend: str = ""
    active: bool = False
    rules: list[FirewallRule] = []
    default_incoming: str = ""
    default_outgoing: str = ""


class FirewallRuleAdd(BaseModel):
    """Request to add a firewall rule."""
    action: str = Field(..., pattern=r"^(allow|deny|reject|limit)$")
    direction: str = Field(default="in", pattern=r"^(in|out)$")
    protocol: str = Field(default="tcp", pattern=r"^(tcp|udp|any)$")
    port: str = Field(..., min_length=1, max_length=50)
    source: str = Field(default="any", max_length=100)


class FirewallRuleDelete(BaseModel):
    """Request to delete a firewall rule by number."""
    rule_number: int = Field(..., ge=1)


class PackageManagerInfo(BaseModel):
    """Detected package manager info."""
    manager: str = ""
    os_id: str = ""
    os_name: str = ""
    os_version: str = ""


class PackageInfo(BaseModel):
    """A single package entry."""
    name: str = ""
    version: str = ""
    architecture: str = ""
    status: str = ""
    description: str = ""
    size: str = ""


class PackageUpdateInfo(BaseModel):
    """An available package update."""
    name: str = ""
    current_version: str = ""
    new_version: str = ""
    size: str = ""


class PackageUpdatesResponse(BaseModel):
    """Response for checking updates."""
    manager: str = ""
    updates: list[PackageUpdateInfo] = []
    total: int = 0
    security_updates: int = 0


class PackageSearchResult(BaseModel):
    """Search results for packages."""
    packages: list[PackageInfo] = []
    total: int = 0


class PackageActionRequest(BaseModel):
    """Request to install or remove a package."""
    action: str = Field(..., pattern=r"^(install|remove|purge)$")
    package_name: str = Field(..., min_length=1, max_length=200)


# ---------------------------------------------------------------------------
# Phase 3: Docker, WireGuard, Cron
# ---------------------------------------------------------------------------

class DockerInfo(BaseModel):
    """Docker daemon info."""
    installed: bool = False
    version: str = ""
    api_version: str = ""
    containers_running: int = 0
    containers_paused: int = 0
    containers_stopped: int = 0
    images: int = 0
    storage_driver: str = ""


class DockerContainer(BaseModel):
    """A single Docker container."""
    id: str = ""
    name: str = ""
    image: str = ""
    status: str = ""
    state: str = ""
    created: str = ""
    ports: str = ""
    size: str = ""


class DockerContainersResponse(BaseModel):
    """Response for Docker containers listing."""
    containers: list[DockerContainer] = []
    total: int = 0


class DockerContainerAction(BaseModel):
    """Request to perform an action on a Docker container."""
    action: str = Field(..., pattern=r"^(start|stop|restart|pause|unpause|remove)$")


class DockerImage(BaseModel):
    """A single Docker image."""
    id: str = ""
    repository: str = ""
    tag: str = ""
    size: str = ""
    created: str = ""


class DockerImagesResponse(BaseModel):
    """Response for Docker images listing."""
    images: list[DockerImage] = []
    total: int = 0


class DockerLogsRequest(BaseModel):
    """Request for container logs."""
    tail: int = Field(default=100, ge=1, le=5000)


class WireGuardInfo(BaseModel):
    """WireGuard installation info."""
    installed: bool = False
    version: str = ""
    interfaces: list[str] = []


class WireGuardPeer(BaseModel):
    """A WireGuard peer."""
    public_key: str = ""
    endpoint: str = ""
    allowed_ips: str = ""
    latest_handshake: str = ""
    transfer_rx: str = ""
    transfer_tx: str = ""
    persistent_keepalive: str = ""


class WireGuardInterface(BaseModel):
    """A WireGuard interface and its peers."""
    name: str = ""
    public_key: str = ""
    listening_port: str = ""
    address: str = ""
    peers: list[WireGuardPeer] = []
    active: bool = False


class WireGuardStatusResponse(BaseModel):
    """Response for WireGuard status."""
    installed: bool = False
    version: str = ""
    interfaces: list[WireGuardInterface] = []


class WireGuardKeyPair(BaseModel):
    """A WireGuard key pair."""
    private_key: str = ""
    public_key: str = ""


class WireGuardCreateConfig(BaseModel):
    """Request to create a WireGuard config."""
    interface_name: str = Field(..., min_length=1, max_length=15, pattern=r"^[a-zA-Z0-9_-]+$")
    address: str = Field(..., min_length=7, max_length=50)
    listen_port: int = Field(default=51820, ge=1, le=65535)
    private_key: str = Field(..., min_length=1)


class WireGuardAddPeer(BaseModel):
    """Request to add a peer to a WireGuard interface."""
    public_key: str = Field(..., min_length=1)
    allowed_ips: str = Field(..., min_length=1, max_length=200)
    endpoint: str = Field(default="", max_length=100)
    persistent_keepalive: int = Field(default=0, ge=0, le=65535)


class WireGuardRemovePeer(BaseModel):
    """Request to remove a peer from a WireGuard interface."""
    public_key: str = Field(..., min_length=1)


class CronJob(BaseModel):
    """A single cron job entry."""
    schedule: str = ""
    command: str = ""
    user: str = ""
    line_number: int = 0
    raw: str = ""


class CronListResponse(BaseModel):
    """Response for cron jobs listing."""
    jobs: list[CronJob] = []
    total: int = 0
    user: str = ""
    system_jobs: list[CronJob] = []


class CronJobAdd(BaseModel):
    """Request to add a cron job."""
    schedule: str = Field(..., min_length=5, max_length=100)
    command: str = Field(..., min_length=1, max_length=2000)


class CronJobDelete(BaseModel):
    """Request to delete a cron job by line number."""
    line_number: int = Field(..., ge=1)


class DashboardMetrics(BaseModel):
    """Extended dashboard metrics with per-core CPU, network rates, top processes."""
    cpu_percent: float = 0.0
    cpu_cores: list[float] = []
    mem_total: int = 0
    mem_used: int = 0
    mem_percent: float = 0.0
    swap_total: int = 0
    swap_used: int = 0
    swap_percent: float = 0.0
    disk_total: int = 0
    disk_used: int = 0
    disk_percent: float = 0.0
    net_rx_rate: float = 0.0
    net_tx_rate: float = 0.0
    load_avg: list[float] = []
    uptime: int = 0
    os_name: str = ""
    top_cpu_procs: list[dict] = []
    top_mem_procs: list[dict] = []
    io_read_rate: float = 0.0
    io_write_rate: float = 0.0
    gpu_temp: str = ""
    cpu_temp: str = ""
