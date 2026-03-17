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
    enabled: str = ""
    service_type: str = ""
    main_pid: int = 0
    memory: str = ""
    cpu: str = ""
    started_at: str = ""
    uptime: str = ""


class ServiceListResponse(BaseModel):
    """Response for service listing."""
    services: list[ServiceInfo]
    init_system: str = "unknown"
    total: int = 0
    running: int = 0
    failed: int = 0
    inactive: int = 0
    enabled_count: int = 0


class ServiceActionRequest(BaseModel):
    """Request to perform an action on a service."""
    action: str = Field(..., pattern=r"^(start|stop|restart|enable|disable|reload)$")


class ServiceDetailResponse(BaseModel):
    """Detailed information about a specific systemd service."""
    name: str = ""
    description: str = ""
    load_state: str = ""
    active_state: str = ""
    sub_state: str = ""
    enabled: str = ""
    service_type: str = ""
    main_pid: int = 0
    exec_main_pid: int = 0
    memory_current: str = ""
    cpu_usage: str = ""
    tasks_current: str = ""
    restart_policy: str = ""
    restart_count: int = 0
    started_at: str = ""
    active_enter: str = ""
    inactive_enter: str = ""
    unit_file_path: str = ""
    fragment_path: str = ""
    wants: list[str] = []
    required_by: list[str] = []
    after: list[str] = []
    before: list[str] = []
    environment: list[str] = []
    exec_start: str = ""
    user: str = ""
    group: str = ""
    working_directory: str = ""
    root_directory: str = ""
    properties: dict = {}


class ServiceLogEntry(BaseModel):
    """A single service log entry."""
    timestamp: str = ""
    message: str = ""
    priority: str = ""


class ServiceLogsResponse(BaseModel):
    """Response for service log queries."""
    lines: list[ServiceLogEntry] = []
    unit: str = ""
    total: int = 0


class ServiceUnitFileResponse(BaseModel):
    """Response for viewing a service unit file."""
    path: str = ""
    content: str = ""
    unit: str = ""


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


# ---------------------------------------------------------------------------
# Firewall: Overview & Detection
# ---------------------------------------------------------------------------

class FirewallBackendInfo(BaseModel):
    """Info about a single detected firewall backend."""
    name: str = ""
    installed: bool = False
    active: bool = False
    version: str = ""
    rules_count: int = 0
    default_incoming: str = ""
    default_outgoing: str = ""


class FirewallOverview(BaseModel):
    """Full overview of all firewall backends on the system."""
    backends: list[FirewallBackendInfo] = []
    primary_backend: str = ""
    server_public_ip: str = ""
    server_local_ips: list[str] = []
    dashboard_port: int = 0
    ssh_port: int = 22


class ClientIpResponse(BaseModel):
    """Response containing the visitor's IP address."""
    ip: str = ""


# ---------------------------------------------------------------------------
# Firewall: UFW
# ---------------------------------------------------------------------------

class UfwRule(BaseModel):
    """A single UFW rule."""
    number: int = 0
    action: str = ""
    direction: str = ""
    protocol: str = ""
    port: str = ""
    from_ip: str = ""
    to_ip: str = ""
    v6: bool = False
    raw: str = ""
    comment: str = ""


class UfwStatus(BaseModel):
    """Full UFW status."""
    active: bool = False
    version: str = ""
    logging: str = ""
    default_incoming: str = ""
    default_outgoing: str = ""
    default_routed: str = ""
    rules: list[UfwRule] = []


class UfwRuleAdd(BaseModel):
    """Request to add a UFW rule."""
    action: str = Field(..., pattern=r"^(allow|deny|reject|limit)$")
    direction: str = Field(default="in", pattern=r"^(in|out)$")
    protocol: str = Field(default="tcp", pattern=r"^(tcp|udp|any)$")
    port: str = Field(default="", max_length=50)
    from_ip: str = Field(default="any", max_length=100)
    to_ip: str = Field(default="any", max_length=100)
    comment: str = Field(default="", max_length=200)


class UfwRuleEdit(BaseModel):
    """Request to edit a UFW rule (delete + re-add)."""
    rule_number: int = Field(..., ge=1)
    action: str = Field(..., pattern=r"^(allow|deny|reject|limit)$")
    direction: str = Field(default="in", pattern=r"^(in|out)$")
    protocol: str = Field(default="tcp", pattern=r"^(tcp|udp|any)$")
    port: str = Field(default="", max_length=50)
    from_ip: str = Field(default="any", max_length=100)
    to_ip: str = Field(default="any", max_length=100)
    comment: str = Field(default="", max_length=200)


class UfwRuleDelete(BaseModel):
    """Request to delete a UFW rule by number."""
    rule_number: int = Field(..., ge=1)


class UfwDefaultsUpdate(BaseModel):
    """Request to update UFW default policies."""
    incoming: str = Field(..., pattern=r"^(allow|deny|reject)$")
    outgoing: str = Field(..., pattern=r"^(allow|deny|reject)$")


# ---------------------------------------------------------------------------
# Firewall: iptables
# ---------------------------------------------------------------------------

class IptablesRule(BaseModel):
    """A single iptables rule."""
    chain: str = ""
    number: int = 0
    target: str = ""
    protocol: str = ""
    source: str = ""
    destination: str = ""
    port: str = ""
    in_interface: str = ""
    out_interface: str = ""
    extra: str = ""
    raw: str = ""


class IptablesStatus(BaseModel):
    """iptables status for filter table."""
    active: bool = False
    policy_input: str = ""
    policy_output: str = ""
    policy_forward: str = ""
    rules: list[IptablesRule] = []


class IptablesRuleAdd(BaseModel):
    """Request to add an iptables rule."""
    chain: str = Field(..., pattern=r"^(INPUT|OUTPUT|FORWARD)$")
    target: str = Field(..., pattern=r"^(ACCEPT|DROP|REJECT|LOG)$")
    protocol: str = Field(default="tcp", pattern=r"^(tcp|udp|all|icmp)$")
    source: str = Field(default="0.0.0.0/0", max_length=100)
    destination: str = Field(default="0.0.0.0/0", max_length=100)
    port: str = Field(default="", max_length=50)
    position: int = Field(default=0, ge=0)


class IptablesRuleDelete(BaseModel):
    """Request to delete an iptables rule."""
    chain: str = Field(..., pattern=r"^(INPUT|OUTPUT|FORWARD)$")
    rule_number: int = Field(..., ge=1)


class IptablesPolicyUpdate(BaseModel):
    """Request to set chain default policy."""
    chain: str = Field(..., pattern=r"^(INPUT|OUTPUT|FORWARD)$")
    policy: str = Field(..., pattern=r"^(ACCEPT|DROP)$")


# ---------------------------------------------------------------------------
# Firewall: firewalld
# ---------------------------------------------------------------------------

class FirewalldRule(BaseModel):
    """A single firewalld rule."""
    zone: str = ""
    type: str = ""
    value: str = ""
    permanent: bool = True
    raw: str = ""


class FirewalldStatus(BaseModel):
    """firewalld status."""
    active: bool = False
    version: str = ""
    default_zone: str = ""
    active_zones: list[str] = []
    rules: list[FirewalldRule] = []


class FirewalldRuleAdd(BaseModel):
    """Request to add a firewalld rule."""
    zone: str = Field(default="", max_length=50)
    type: str = Field(..., pattern=r"^(port|service|rich-rule|source)$")
    value: str = Field(..., min_length=1, max_length=500)
    permanent: bool = True


class FirewalldRuleDelete(BaseModel):
    """Request to remove a firewalld rule."""
    zone: str = Field(default="", max_length=50)
    type: str = Field(..., pattern=r"^(port|service|rich-rule|source)$")
    value: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Firewall: Safety Checks
# ---------------------------------------------------------------------------

class FirewallSafetyWarning(BaseModel):
    """A single safety warning."""
    level: str = ""
    code: str = ""
    message: str = ""
    suggestion: str = ""


class FirewallSafetyCheck(BaseModel):
    """Result of a safety check before a firewall action."""
    safe: bool = True
    warnings: list[FirewallSafetyWarning] = []


class FirewallSafetyRequest(BaseModel):
    """Request body for safety check."""
    action: str = Field(..., max_length=50)
    backend: str = Field(default="", max_length=20)
    details: dict = {}


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
    custom_command: str | None = Field(default=None, max_length=500)


class PackageCheckRequest(BaseModel):
    """Request to check if packages are installed."""
    packages: list[str] = Field(..., min_length=1, max_length=50)


class PackageCheckResponse(BaseModel):
    """Response for batch installed check."""
    installed: dict[str, bool] = {}


class CustomCheckItem(BaseModel):
    """A single custom check: name + shell command."""
    name: str = Field(..., min_length=1, max_length=200)
    check_cmd: str = Field(..., min_length=1, max_length=500)


class CustomCheckRequest(BaseModel):
    """Request to check if custom-installed tools are present."""
    checks: list[CustomCheckItem] = Field(..., min_length=1, max_length=20)


# ---------------------------------------------------------------------------
# Phase 3: Docker, WireGuard, Cron
# ---------------------------------------------------------------------------

class DockerInstallCheck(BaseModel):
    """Pre-install system check result for Docker."""
    supported: bool = False
    os: str = ""
    os_version: str = ""
    already_installed: bool = False
    reason: str = ""
    curl_available: bool = False
    has_systemd: bool = False


class DockerInfo(BaseModel):
    """Comprehensive Docker daemon info."""
    installed: bool = False
    version: str = ""
    api_version: str = ""
    containers_running: int = 0
    containers_paused: int = 0
    containers_stopped: int = 0
    images_count: int = 0
    storage_driver: str = ""
    docker_root: str = ""
    os_type: str = ""
    architecture: str = ""
    daemon_running: bool = False
    disk_usage_images: str = ""
    disk_usage_containers: str = ""
    disk_usage_volumes: str = ""
    disk_usage_buildcache: str = ""
    disk_usage_total: str = ""
    networks_count: int = 0
    volumes_count: int = 0
    compose_installed: bool = False
    compose_version: str = ""


class DockerContainer(BaseModel):
    """A single Docker container with optional resource stats."""
    id: str = ""
    name: str = ""
    image: str = ""
    status: str = ""
    state: str = ""
    created: str = ""
    ports: str = ""
    size: str = ""
    cpu_percent: str = ""
    mem_usage: str = ""
    mem_limit: str = ""
    mem_percent: str = ""
    net_io: str = ""
    block_io: str = ""
    pids: str = ""
    compose_project: str = ""
    compose_service: str = ""


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


class DockerPullImage(BaseModel):
    """Request to pull a Docker image."""
    image: str = Field(..., min_length=1, max_length=500)


class DockerNetwork(BaseModel):
    """A Docker network."""
    id: str = ""
    name: str = ""
    driver: str = ""
    scope: str = ""
    subnet: str = ""
    gateway: str = ""
    containers_count: int = 0
    internal: bool = False


class DockerNetworksResponse(BaseModel):
    """Response for Docker networks listing."""
    networks: list[DockerNetwork] = []
    total: int = 0


class DockerNetworkCreate(BaseModel):
    """Request to create a Docker network."""
    name: str = Field(..., min_length=1, max_length=100)
    driver: str = Field(default="bridge", max_length=50)
    subnet: str = Field(default="", max_length=50)


class DockerVolume(BaseModel):
    """A Docker volume."""
    name: str = ""
    driver: str = ""
    mountpoint: str = ""
    size: str = ""
    created: str = ""


class DockerVolumesResponse(BaseModel):
    """Response for Docker volumes listing."""
    volumes: list[DockerVolume] = []
    total: int = 0


class DockerVolumeCreate(BaseModel):
    """Request to create a Docker volume."""
    name: str = Field(..., min_length=1, max_length=100)
    driver: str = Field(default="local", max_length=50)


class DockerComposeProject(BaseModel):
    """A Docker Compose project."""
    name: str = ""
    status: str = ""
    config_files: str = ""
    running_count: int = 0
    total_count: int = 0


class DockerComposeProjectsResponse(BaseModel):
    """Response for Docker Compose projects listing."""
    projects: list[DockerComposeProject] = []
    total: int = 0


class DockerComposeAction(BaseModel):
    """Request to perform an action on a Docker Compose project."""
    project_dir: str = Field(..., min_length=1, max_length=500)
    action: str = Field(..., pattern=r"^(up|down|restart|pull|build)$")


class DockerComposeFileRequest(BaseModel):
    """Request to read a Docker Compose file."""
    path: str = Field(..., min_length=1, max_length=500)


class DockerComposeFileSave(BaseModel):
    """Request to save a Docker Compose file."""
    path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1)


class WireGuardClient(BaseModel):
    """A named WireGuard client (peer) parsed from wg0.conf BEGIN_PEER/END_PEER markers."""
    name: str = ""
    public_key: str = ""
    allowed_ips: str = ""
    endpoint: str = ""
    latest_handshake: str = ""
    transfer_rx: str = ""
    transfer_tx: str = ""
    persistent_keepalive: str = ""
    enabled: bool = True
    has_recent_handshake: bool = False


class WireGuardStatusResponse(BaseModel):
    """Comprehensive WireGuard server status response."""
    installed: bool = False
    version: str = ""
    active: bool = False
    server_public_key: str = ""
    listen_port: str = ""
    address: str = ""
    endpoint: str = ""
    public_ip: str = ""
    total_transfer_rx: str = ""
    total_transfer_tx: str = ""
    config_path: str = "/etc/wireguard/wg0.conf"
    clients: list[WireGuardClient] = []
    active_clients: int = 0
    total_clients: int = 0


class WireGuardInstallCheck(BaseModel):
    """Pre-install system check result."""
    supported: bool = False
    os: str = ""
    os_version: str = ""
    already_installed: bool = False
    public_ip: str = ""
    local_ips: list[str] = []
    has_ipv6: bool = False
    ipv6_addr: str = ""
    is_container: bool = False
    needs_boringtun: bool = False
    reason: str = ""


class WireGuardInstallRequest(BaseModel):
    """Request to install WireGuard server."""
    endpoint: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=51820, ge=1, le=65535)
    dns: str = Field(default="1.1.1.1, 1.0.0.1", max_length=200)
    first_client_name: str = Field(default="client", min_length=1, max_length=15, pattern=r"^[a-zA-Z0-9_-]+$")
    local_ip: str = Field(default="", max_length=50)
    ipv6_addr: str = Field(default="", max_length=100)


class WireGuardAddClient(BaseModel):
    """Request to add a named WireGuard client."""
    name: str = Field(..., min_length=1, max_length=15, pattern=r"^[a-zA-Z0-9_-]+$")
    dns: str = Field(default="1.1.1.1, 1.0.0.1", max_length=200)


class WireGuardClientConfig(BaseModel):
    """Response with client configuration and QR code."""
    name: str = ""
    config_content: str = ""
    qr_svg: str = ""


class WireGuardRemoveClient(BaseModel):
    """Request to remove a named WireGuard client."""
    name: str = Field(..., min_length=1, max_length=15)


class WireGuardToggleClient(BaseModel):
    """Request to enable or disable a named WireGuard client."""
    name: str = Field(..., min_length=1, max_length=15)
    action: str = Field(..., pattern=r"^(enable|disable)$")


class WireGuardKeyPair(BaseModel):
    """A WireGuard key pair."""
    private_key: str = ""
    public_key: str = ""


class CronJob(BaseModel):
    """A single cron job entry."""
    schedule: str = ""
    command: str = ""
    user: str = ""
    line_number: int = 0
    raw: str = ""
    enabled: bool = True
    comment: str = ""
    next_run: str = ""


class CronListResponse(BaseModel):
    """Response for cron jobs listing."""
    jobs: list[CronJob] = []
    total: int = 0
    active: int = 0
    disabled: int = 0
    user: str = ""
    system_jobs: list[CronJob] = []
    env_vars: dict = {}


class CronJobAdd(BaseModel):
    """Request to add a cron job."""
    schedule: str = Field(..., min_length=1, max_length=100)
    command: str = Field(..., min_length=1, max_length=2000)
    comment: str = Field(default="", max_length=200)


class CronJobUpdate(BaseModel):
    """Request to update an existing cron job."""
    line_number: int = Field(..., ge=1)
    schedule: str = Field(..., min_length=1, max_length=100)
    command: str = Field(..., min_length=1, max_length=2000)
    comment: str = Field(default="", max_length=200)


class CronJobDelete(BaseModel):
    """Request to delete a cron job by line number."""
    line_number: int = Field(..., ge=1)


class CronJobToggle(BaseModel):
    """Request to enable or disable a cron job."""
    line_number: int = Field(..., ge=1)
    enabled: bool = True


class CronHistoryEntry(BaseModel):
    """A single cron execution history entry."""
    timestamp: str = ""
    user: str = ""
    command: str = ""
    pid: str = ""
    message: str = ""


class CronHistoryResponse(BaseModel):
    """Response for cron execution history."""
    entries: list[CronHistoryEntry] = []
    total: int = 0


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
