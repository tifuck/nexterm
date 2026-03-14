import React, { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  RefreshCw,
  Loader2,
  X,
  Plus,
  Trash2,
  Shield,
  ShieldOff,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Globe,
  Server,
  Pencil,
  Check,
  Info,
  TriangleAlert,
  LayoutDashboard,
  Table2,
  CircleDot,
  ChevronDown,
  ChevronRight,
  Zap,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { ToolModal } from './ToolModal';
import { apiGet, apiPost } from '@/api/client';
import { useToastStore } from '@/store/toastStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FirewallBackendInfo {
  name: string;
  installed: boolean;
  active: boolean;
  version: string;
  rules_count: number;
  default_incoming: string;
  default_outgoing: string;
}

interface FirewallOverview {
  backends: FirewallBackendInfo[];
  primary_backend: string;
  server_public_ip: string;
  server_local_ips: string[];
  dashboard_port: number;
  ssh_port: number;
}

// UFW
interface UfwRule {
  number: number;
  action: string;
  direction: string;
  protocol: string;
  port: string;
  from_ip: string;
  to_ip: string;
  v6: boolean;
  raw: string;
  comment: string;
}

interface UfwStatus {
  active: boolean;
  version: string;
  logging: string;
  default_incoming: string;
  default_outgoing: string;
  default_routed: string;
  rules: UfwRule[];
}

// iptables
interface IptablesRule {
  chain: string;
  number: number;
  target: string;
  protocol: string;
  source: string;
  destination: string;
  port: string;
  in_interface: string;
  out_interface: string;
  extra: string;
  raw: string;
}

interface IptablesStatus {
  active: boolean;
  policy_input: string;
  policy_output: string;
  policy_forward: string;
  rules: IptablesRule[];
}

// firewalld
interface FirewalldRule {
  zone: string;
  type: string;
  value: string;
  permanent: boolean;
  raw: string;
}

interface FirewalldStatus {
  active: boolean;
  version: string;
  default_zone: string;
  active_zones: string[];
  rules: FirewalldRule[];
}

// Safety
interface SafetyWarning {
  level: string;
  code: string;
  message: string;
  suggestion: string;
}

interface SafetyCheck {
  safe: boolean;
  warnings: SafetyWarning[];
}

type TabId = 'overview' | 'ufw' | 'iptables' | 'firewalld';
type IptablesChain = 'INPUT' | 'OUTPUT' | 'FORWARD';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  connectionId: string;
}

export const FirewallManager: React.FC<Props> = ({ connectionId }) => {
  const addToast = useToastStore((s) => s.addToast);

  // --- Overview state ---
  const [overview, setOverview] = useState<FirewallOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [clientIp, setClientIp] = useState('');

  // --- UFW state ---
  const [ufwStatus, setUfwStatus] = useState<UfwStatus | null>(null);
  const [ufwLoading, setUfwLoading] = useState(false);
  const [showUfwAddForm, setShowUfwAddForm] = useState(false);
  const [ufwEditRule, setUfwEditRule] = useState<UfwRule | null>(null);
  const [ufwForm, setUfwForm] = useState({ action: 'allow', direction: 'in', protocol: 'tcp', port: '', from_ip: 'any', to_ip: 'any', comment: '' });
  const [ufwFormLoading, setUfwFormLoading] = useState(false);
  const [showUfwDefaults, setShowUfwDefaults] = useState(false);
  const [ufwDefaultsForm, setUfwDefaultsForm] = useState({ incoming: 'deny', outgoing: 'allow' });

  // --- iptables state ---
  const [iptablesStatus, setIptablesStatus] = useState<IptablesStatus | null>(null);
  const [iptablesLoading, setIptablesLoading] = useState(false);
  const [iptablesChain, setIptablesChain] = useState<IptablesChain>('INPUT');
  const [showIptablesAddForm, setShowIptablesAddForm] = useState(false);
  const [iptablesForm, setIptablesForm] = useState({ chain: 'INPUT', target: 'ACCEPT', protocol: 'tcp', source: '0.0.0.0/0', destination: '0.0.0.0/0', port: '', position: 0 });
  const [iptablesFormLoading, setIptablesFormLoading] = useState(false);

  // --- firewalld state ---
  const [firewalldStatus, setFirewalldStatus] = useState<FirewalldStatus | null>(null);
  const [firewalldLoading, setFirewalldLoading] = useState(false);
  const [showFirewalldAddForm, setShowFirewalldAddForm] = useState(false);
  const [firewalldForm, setFirewalldForm] = useState({ zone: '', type: 'port', value: '', permanent: true });
  const [firewalldFormLoading, setFirewalldFormLoading] = useState(false);

  // --- Safety dialog state ---
  const [safetyWarnings, setSafetyWarnings] = useState<SafetyWarning[]>([]);
  const [showSafetyDialog, setShowSafetyDialog] = useState(false);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState<Set<string>>(new Set());
  const [pendingSafetyAction, setPendingSafetyAction] = useState<(() => Promise<void>) | null>(null);

  // --- Quick setup dialog state ---
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [quickSetupBackend, setQuickSetupBackend] = useState('ufw');
  const [quickSetupIps, setQuickSetupIps] = useState<string[]>([]);
  const [quickSetupDashPort, setQuickSetupDashPort] = useState(true);
  const [quickSetupSshPort, setQuickSetupSshPort] = useState(true);
  const [quickSetupLoading, setQuickSetupLoading] = useState(false);

  // --- General action loading ---
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // --- Confirm dialogs ---
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ===================================================================
  // Data fetching
  // ===================================================================

  const fetchOverview = useCallback(async () => {
    try {
      const data = await apiGet(`/api/tools/${connectionId}/firewall/overview`);
      setOverview(data);
      return data as FirewallOverview;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load firewall overview';
      addToast(message, 'error');
      return null;
    }
  }, [connectionId, addToast]);

  const fetchClientIp = useCallback(async () => {
    try {
      const data = await apiGet('/api/tools/client-ip');
      setClientIp(data.ip || '');
    } catch {
      // non-critical
    }
  }, []);

  const fetchUfwStatus = useCallback(async () => {
    setUfwLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/firewall/ufw/status`);
      setUfwStatus(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load UFW status';
      addToast(message, 'error');
    } finally {
      setUfwLoading(false);
    }
  }, [connectionId, addToast]);

  const fetchIptablesStatus = useCallback(async () => {
    setIptablesLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/firewall/iptables/status`);
      setIptablesStatus(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load iptables status';
      addToast(message, 'error');
    } finally {
      setIptablesLoading(false);
    }
  }, [connectionId, addToast]);

  const fetchFirewalldStatus = useCallback(async () => {
    setFirewalldLoading(true);
    try {
      const data = await apiGet(`/api/tools/${connectionId}/firewall/firewalld/status`);
      setFirewalldStatus(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load firewalld status';
      addToast(message, 'error');
    } finally {
      setFirewalldLoading(false);
    }
  }, [connectionId, addToast]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    const ov = await fetchOverview();
    await fetchClientIp();
    if (ov) {
      const promises: Promise<void>[] = [];
      for (const b of ov.backends) {
        if (b.installed && b.name === 'ufw') promises.push(fetchUfwStatus());
        if (b.installed && b.name === 'iptables') promises.push(fetchIptablesStatus());
        if (b.installed && b.name === 'firewalld') promises.push(fetchFirewalldStatus());
      }
      await Promise.all(promises);
    }
    setLoading(false);
  }, [fetchOverview, fetchClientIp, fetchUfwStatus, fetchIptablesStatus, fetchFirewalldStatus]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ===================================================================
  // Safety check helper
  // ===================================================================

  const runSafetyCheck = useCallback(async (
    action: string,
    backend: string,
    details: Record<string, unknown>,
    onProceed: () => Promise<void>,
  ) => {
    try {
      const result: SafetyCheck = await apiPost(`/api/tools/${connectionId}/firewall/safety-check`, { action, backend, details });
      if (result.warnings && result.warnings.length > 0) {
        setSafetyWarnings(result.warnings);
        setSafetyAcknowledged(new Set());
        setPendingSafetyAction(() => onProceed);
        setShowSafetyDialog(true);
      } else {
        await onProceed();
      }
    } catch {
      // If safety check fails, proceed anyway
      await onProceed();
    }
  }, [connectionId]);

  const proceedSafetyAction = async () => {
    setShowSafetyDialog(false);
    if (pendingSafetyAction) {
      await pendingSafetyAction();
    }
    setPendingSafetyAction(null);
    setSafetyWarnings([]);
  };

  // ===================================================================
  // UFW actions
  // ===================================================================

  const toggleUfw = async () => {
    if (!ufwStatus) return;
    const isEnabling = !ufwStatus.active;

    const doToggle = async () => {
      setActionLoading('ufw-toggle');
      try {
        await apiPost(`/api/tools/${connectionId}/firewall/ufw/toggle`, {});
        addToast(`UFW ${isEnabling ? 'enabled' : 'disabled'}`, 'success');
        setTimeout(() => { fetchUfwStatus(); fetchOverview(); }, 1000);
      } catch (err: unknown) {
        addToast(err instanceof Error ? err.message : 'Failed to toggle UFW', 'error');
      } finally {
        setActionLoading(null);
      }
    };

    if (isEnabling) {
      const allowRules = ufwStatus.rules.filter(r => r.action === 'allow' || r.action === 'ALLOW');
      const dashAllowed = allowRules.some(r => r.port === String(overview?.dashboard_port));
      const sshAllowed = allowRules.some(r => r.port === String(overview?.ssh_port || 22));

      await runSafetyCheck('enable_firewall', 'ufw', {
        rules_count: allowRules.length,
        dashboard_port_allowed: dashAllowed,
        ssh_port_allowed: sshAllowed,
      }, doToggle);
    } else {
      await runSafetyCheck('disable_firewall', 'ufw', {}, doToggle);
    }
  };

  const addUfwRule = async () => {
    if (!ufwForm.port.trim()) {
      addToast('Port is required', 'error');
      return;
    }
    setUfwFormLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/ufw/add-rule`, {
        action: ufwForm.action,
        direction: ufwForm.direction,
        protocol: ufwForm.protocol,
        port: ufwForm.port.trim(),
        from_ip: ufwForm.from_ip.trim() || 'any',
        to_ip: ufwForm.to_ip.trim() || 'any',
        comment: ufwForm.comment.trim(),
      });
      addToast('UFW rule added', 'success');
      setShowUfwAddForm(false);
      setUfwForm({ action: 'allow', direction: 'in', protocol: 'tcp', port: '', from_ip: 'any', to_ip: 'any', comment: '' });
      setTimeout(fetchUfwStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to add rule', 'error');
    } finally {
      setUfwFormLoading(false);
    }
  };

  const editUfwRule = async () => {
    if (!ufwEditRule || !ufwForm.port.trim()) return;
    setUfwFormLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/ufw/edit-rule`, {
        rule_number: ufwEditRule.number,
        action: ufwForm.action,
        direction: ufwForm.direction,
        protocol: ufwForm.protocol,
        port: ufwForm.port.trim(),
        from_ip: ufwForm.from_ip.trim() || 'any',
        to_ip: ufwForm.to_ip.trim() || 'any',
        comment: ufwForm.comment.trim(),
      });
      addToast('UFW rule updated', 'success');
      setUfwEditRule(null);
      setShowUfwAddForm(false);
      setUfwForm({ action: 'allow', direction: 'in', protocol: 'tcp', port: '', from_ip: 'any', to_ip: 'any', comment: '' });
      setTimeout(fetchUfwStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to edit rule', 'error');
    } finally {
      setUfwFormLoading(false);
    }
  };

  const deleteUfwRule = async (ruleNumber: number) => {
    const rule = ufwStatus?.rules.find(r => r.number === ruleNumber);
    const isAllowRule = rule && (rule.action === 'allow' || rule.action === 'ALLOW');

    const doDelete = async () => {
      setActionLoading(`ufw-del-${ruleNumber}`);
      try {
        await apiPost(`/api/tools/${connectionId}/firewall/ufw/delete-rule`, { rule_number: ruleNumber });
        addToast('UFW rule deleted', 'success');
        setTimeout(fetchUfwStatus, 500);
      } catch (err: unknown) {
        addToast(err instanceof Error ? err.message : 'Failed to delete rule', 'error');
      } finally {
        setActionLoading(null);
        setDeleteConfirm(null);
      }
    };

    if (isAllowRule && ufwStatus?.active) {
      const remainingAllows = ufwStatus.rules.filter(r => (r.action === 'allow' || r.action === 'ALLOW') && r.number !== ruleNumber).length;
      await runSafetyCheck('delete_allow_rule', 'ufw', {
        port: rule?.port || '',
        remaining_allow_rules: remainingAllows,
        firewall_active: true,
      }, doDelete);
    } else {
      await doDelete();
    }
  };

  const updateUfwDefaults = async () => {
    const doUpdate = async () => {
      setActionLoading('ufw-defaults');
      try {
        await apiPost(`/api/tools/${connectionId}/firewall/ufw/defaults`, {
          incoming: ufwDefaultsForm.incoming,
          outgoing: ufwDefaultsForm.outgoing,
        });
        addToast('UFW defaults updated', 'success');
        setShowUfwDefaults(false);
        setTimeout(fetchUfwStatus, 500);
      } catch (err: unknown) {
        addToast(err instanceof Error ? err.message : 'Failed to update defaults', 'error');
      } finally {
        setActionLoading(null);
      }
    };

    if (ufwDefaultsForm.incoming === 'deny' || ufwDefaultsForm.incoming === 'reject') {
      const allowRules = ufwStatus?.rules.filter(r => r.action === 'allow' || r.action === 'ALLOW') || [];
      const dashAllowed = allowRules.some(r => r.port === String(overview?.dashboard_port));
      const sshAllowed = allowRules.some(r => r.port === String(overview?.ssh_port || 22));

      await runSafetyCheck('change_default_policy', 'ufw', {
        incoming: ufwDefaultsForm.incoming,
        allow_rules_count: allowRules.length,
        dashboard_port_allowed: dashAllowed,
        ssh_port_allowed: sshAllowed,
      }, doUpdate);
    } else {
      await doUpdate();
    }
  };

  const resetUfw = async () => {
    setActionLoading('ufw-reset');
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/ufw/reset`, {});
      addToast('UFW reset to defaults', 'success');
      setShowResetConfirm(false);
      setTimeout(() => { fetchUfwStatus(); fetchOverview(); }, 1000);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to reset UFW', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // ===================================================================
  // iptables actions
  // ===================================================================

  const addIptablesRule = async () => {
    setIptablesFormLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/iptables/add-rule`, {
        chain: iptablesForm.chain,
        target: iptablesForm.target,
        protocol: iptablesForm.protocol,
        source: iptablesForm.source.trim() || '0.0.0.0/0',
        destination: iptablesForm.destination.trim() || '0.0.0.0/0',
        port: iptablesForm.port.trim(),
        position: iptablesForm.position,
      });
      addToast('iptables rule added', 'success');
      setShowIptablesAddForm(false);
      setIptablesForm({ chain: iptablesChain, target: 'ACCEPT', protocol: 'tcp', source: '0.0.0.0/0', destination: '0.0.0.0/0', port: '', position: 0 });
      setTimeout(fetchIptablesStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to add rule', 'error');
    } finally {
      setIptablesFormLoading(false);
    }
  };

  const deleteIptablesRule = async (chain: string, ruleNumber: number) => {
    setActionLoading(`ipt-del-${chain}-${ruleNumber}`);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/iptables/delete-rule`, { chain, rule_number: ruleNumber });
      addToast('iptables rule deleted', 'success');
      setTimeout(fetchIptablesStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to delete rule', 'error');
    } finally {
      setActionLoading(null);
      setDeleteConfirm(null);
    }
  };

  const setIptablesPolicy = async (chain: string, policy: string) => {
    const doSetPolicy = async () => {
      setActionLoading(`ipt-pol-${chain}`);
      try {
        await apiPost(`/api/tools/${connectionId}/firewall/iptables/policy`, { chain, policy });
        addToast(`${chain} policy set to ${policy}`, 'success');
        setTimeout(fetchIptablesStatus, 500);
      } catch (err: unknown) {
        addToast(err instanceof Error ? err.message : 'Failed to set policy', 'error');
      } finally {
        setActionLoading(null);
      }
    };

    if (policy === 'DROP') {
      const rules = iptablesStatus?.rules.filter(r => r.chain === chain && r.target === 'ACCEPT') || [];
      const dashAllowed = rules.some(r => r.port === String(overview?.dashboard_port));
      const sshAllowed = rules.some(r => r.port === String(overview?.ssh_port || 22));

      await runSafetyCheck('change_default_policy', 'iptables', {
        incoming: 'DROP',
        allow_rules_count: rules.length,
        dashboard_port_allowed: dashAllowed,
        ssh_port_allowed: sshAllowed,
      }, doSetPolicy);
    } else {
      await doSetPolicy();
    }
  };

  // ===================================================================
  // firewalld actions
  // ===================================================================

  const toggleFirewalld = async () => {
    if (!firewalldStatus) return;
    setActionLoading('fwd-toggle');
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/firewalld/toggle`, {});
      addToast(`firewalld ${firewalldStatus.active ? 'stopped' : 'started'}`, 'success');
      setTimeout(() => { fetchFirewalldStatus(); fetchOverview(); }, 1000);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to toggle firewalld', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const addFirewalldRule = async () => {
    if (!firewalldForm.value.trim()) {
      addToast('Value is required', 'error');
      return;
    }
    setFirewalldFormLoading(true);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/firewalld/add-rule`, {
        zone: firewalldForm.zone.trim(),
        type: firewalldForm.type,
        value: firewalldForm.value.trim(),
        permanent: firewalldForm.permanent,
      });
      addToast('firewalld rule added', 'success');
      setShowFirewalldAddForm(false);
      setFirewalldForm({ zone: '', type: 'port', value: '', permanent: true });
      setTimeout(fetchFirewalldStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to add rule', 'error');
    } finally {
      setFirewalldFormLoading(false);
    }
  };

  const deleteFirewalldRule = async (rule: FirewalldRule) => {
    setActionLoading(`fwd-del-${rule.type}-${rule.value}`);
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/firewalld/delete-rule`, {
        zone: rule.zone,
        type: rule.type,
        value: rule.value,
      });
      addToast('firewalld rule deleted', 'success');
      setTimeout(fetchFirewalldStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to delete rule', 'error');
    } finally {
      setActionLoading(null);
      setDeleteConfirm(null);
    }
  };

  const reloadFirewalld = async () => {
    setActionLoading('fwd-reload');
    try {
      await apiPost(`/api/tools/${connectionId}/firewall/firewalld/reload`, {});
      addToast('firewalld reloaded', 'success');
      setTimeout(fetchFirewalldStatus, 500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to reload', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // ===================================================================
  // Quick Setup
  // ===================================================================

  const openQuickSetup = () => {
    const ips: string[] = [];
    if (clientIp && clientIp !== 'unknown') ips.push(clientIp);
    if (overview?.server_public_ip && !ips.includes(overview.server_public_ip)) ips.push(overview.server_public_ip);
    setQuickSetupIps(ips);
    setQuickSetupDashPort(true);
    setQuickSetupSshPort(true);

    // Pick the best backend
    const installed = overview?.backends.filter(b => b.installed) || [];
    const ufwB = installed.find(b => b.name === 'ufw');
    if (ufwB) {
      setQuickSetupBackend('ufw');
    } else if (installed.find(b => b.name === 'firewalld')) {
      setQuickSetupBackend('firewalld');
    } else {
      setQuickSetupBackend('iptables');
    }
    setShowQuickSetup(true);
  };

  const executeQuickSetup = async () => {
    setQuickSetupLoading(true);
    try {
      const backend = quickSetupBackend;
      const dashPort = overview?.dashboard_port || 8443;
      const sshPort = overview?.ssh_port || 22;

      if (backend === 'ufw') {
        // Add SSH port rule
        if (quickSetupSshPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/ufw/add-rule`, {
            action: 'limit', direction: 'in', protocol: 'tcp', port: String(sshPort), from_ip: 'any', to_ip: 'any', comment: 'SSH access (rate limited)',
          });
        }
        // Add dashboard port rule
        if (quickSetupDashPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/ufw/add-rule`, {
            action: 'allow', direction: 'in', protocol: 'tcp', port: String(dashPort), from_ip: 'any', to_ip: 'any', comment: 'Dashboard access',
          });
        }
        // Whitelist each IP (allow all traffic from this source)
        for (const ip of quickSetupIps) {
          await apiPost(`/api/tools/${connectionId}/firewall/ufw/add-rule`, {
            action: 'allow', direction: 'in', protocol: 'any', port: '', from_ip: ip, to_ip: 'any', comment: `Whitelisted IP: ${ip}`,
          });
        }
        // Set defaults to deny incoming, allow outgoing
        await apiPost(`/api/tools/${connectionId}/firewall/ufw/defaults`, { incoming: 'deny', outgoing: 'allow' });
        // Enable UFW
        await apiPost(`/api/tools/${connectionId}/firewall/ufw/toggle`, {});
        addToast('UFW configured and enabled', 'success');
      } else if (backend === 'firewalld') {
        if (quickSetupSshPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/firewalld/add-rule`, { zone: '', type: 'service', value: 'ssh', permanent: true });
        }
        if (quickSetupDashPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/firewalld/add-rule`, { zone: '', type: 'port', value: `${dashPort}/tcp`, permanent: true });
        }
        for (const ip of quickSetupIps) {
          await apiPost(`/api/tools/${connectionId}/firewall/firewalld/add-rule`, { zone: '', type: 'source', value: ip, permanent: true });
        }
        await apiPost(`/api/tools/${connectionId}/firewall/firewalld/reload`, {});
        addToast('firewalld configured', 'success');
      } else if (backend === 'iptables') {
        if (quickSetupSshPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/iptables/add-rule`, { chain: 'INPUT', target: 'ACCEPT', protocol: 'tcp', port: String(sshPort), source: '0.0.0.0/0', destination: '0.0.0.0/0', position: 0 });
        }
        if (quickSetupDashPort) {
          await apiPost(`/api/tools/${connectionId}/firewall/iptables/add-rule`, { chain: 'INPUT', target: 'ACCEPT', protocol: 'tcp', port: String(dashPort), source: '0.0.0.0/0', destination: '0.0.0.0/0', position: 0 });
        }
        for (const ip of quickSetupIps) {
          await apiPost(`/api/tools/${connectionId}/firewall/iptables/add-rule`, { chain: 'INPUT', target: 'ACCEPT', protocol: 'all', source: ip, destination: '0.0.0.0/0', position: 0 });
        }
        // Allow established connections
        await apiPost(`/api/tools/${connectionId}/firewall/iptables/add-rule`, { chain: 'INPUT', target: 'ACCEPT', protocol: 'all', source: '0.0.0.0/0', destination: '0.0.0.0/0', position: 0 });
        addToast('iptables rules added', 'success');
      }

      setShowQuickSetup(false);
      setTimeout(refreshAll, 1500);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Quick setup failed', 'error');
    } finally {
      setQuickSetupLoading(false);
    }
  };

  // ===================================================================
  // Helpers
  // ===================================================================

  const isBackendInstalled = (name: string) => overview?.backends.some(b => b.name === name && b.installed) ?? false;
  const getBackend = (name: string) => overview?.backends.find(b => b.name === name);

  const getOverallSafetyColor = (): string => {
    if (!overview) return 'var(--text-muted)';
    const anyActive = overview.backends.some(b => b.active);
    if (!anyActive) return 'var(--danger)';
    const activeBackend = overview.backends.find(b => b.active);
    if (activeBackend && activeBackend.rules_count > 0) return 'var(--success)';
    return 'var(--warning)';
  };

  const getOverallSafetyLabel = (): string => {
    if (!overview) return 'Unknown';
    const anyActive = overview.backends.some(b => b.active);
    if (!anyActive) return 'Unprotected';
    const activeBackend = overview.backends.find(b => b.active);
    if (activeBackend && activeBackend.rules_count > 0) return 'Protected';
    return 'Active (No Rules)';
  };

  const openEditUfwRule = (rule: UfwRule) => {
    setUfwEditRule(rule);
    setUfwForm({
      action: rule.action.toLowerCase(),
      direction: rule.direction || 'in',
      protocol: rule.protocol || 'tcp',
      port: rule.port,
      from_ip: rule.from_ip || 'any',
      to_ip: rule.to_ip || 'any',
      comment: rule.comment || '',
    });
    setShowUfwAddForm(true);
  };

  // ===================================================================
  // Tab definitions (dynamic based on detected backends)
  // ===================================================================

  const tabs: { id: TabId; icon: React.ReactNode; label: string; show: boolean }[] = [
    { id: 'overview', icon: <LayoutDashboard size={12} />, label: 'Overview', show: true },
    { id: 'ufw', icon: <Shield size={12} />, label: 'UFW', show: isBackendInstalled('ufw') },
    { id: 'iptables', icon: <Table2 size={12} />, label: 'iptables', show: isBackendInstalled('iptables') },
    { id: 'firewalld', icon: <Flame size={12} />, label: 'firewalld', show: isBackendInstalled('firewalld') },
  ];

  // ===================================================================
  // RENDER
  // ===================================================================

  if (loading && !overview) {
    return (
      <ToolModal title="Firewall Manager" icon={<Flame size={18} />}>
        <div className="py-16 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Detecting firewall backends...
        </div>
      </ToolModal>
    );
  }

  return (
    <ToolModal title="Firewall Manager" icon={<Flame size={18} />}>
      {/* Tabs + actions */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
          {tabs.filter(t => t.show).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Safety badge */}
        <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-medium" style={{ color: getOverallSafetyColor(), background: `color-mix(in srgb, ${getOverallSafetyColor()} 15%, transparent)` }}>
          <CircleDot size={10} />
          {getOverallSafetyLabel()}
        </span>

        <button
          onClick={refreshAll}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
          title="Refresh all"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ================================================================ */}
      {/* OVERVIEW TAB */}
      {/* ================================================================ */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-4">
          {/* Detected Firewalls Grid */}
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-[var(--accent)]" />
              Detected Firewalls
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {overview.backends.map(b => (
                <div key={b.name} className={`p-3 rounded-lg border transition-colors ${b.installed ? 'border-[var(--border)] bg-[var(--bg-secondary)]' : 'border-[var(--border)]/50 bg-[var(--bg-secondary)]/50 opacity-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${b.active ? 'bg-[var(--success)]' : b.installed ? 'bg-[var(--text-muted)]' : 'bg-[var(--border)]'}`} />
                      <span className="text-xs font-semibold text-[var(--text-primary)] uppercase">{b.name}</span>
                    </div>
                    {b.installed && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${b.active ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'}`}>
                        {b.active ? 'Active' : 'Inactive'}
                      </span>
                    )}
                    {!b.installed && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--border)]/30 text-[var(--text-muted)] font-medium">Not Installed</span>
                    )}
                  </div>
                  {b.installed && (
                    <div className="space-y-1 text-[10px] text-[var(--text-muted)]">
                      {b.version && <div>Version: <span className="text-[var(--text-secondary)]">{b.version}</span></div>}
                      <div>Rules: <span className="text-[var(--text-secondary)]">{b.rules_count}</span></div>
                      {b.default_incoming && <div>Default in: <span className="text-[var(--text-secondary)]">{b.default_incoming}</span></div>}
                      {b.default_outgoing && <div>Default out: <span className="text-[var(--text-secondary)]">{b.default_outgoing}</span></div>}
                      <button
                        onClick={() => setActiveTab(b.name as TabId)}
                        className="mt-1.5 flex items-center gap-1 text-[var(--accent)] hover:underline text-[10px]"
                      >
                        Manage <ExternalLink size={9} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Server Info */}
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
              <Server size={13} className="text-[var(--accent)]" />
              Server Info
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <InfoCard label="Public IP" value={overview.server_public_ip || '--'} icon={<Globe size={11} />} />
              <InfoCard label="Your IP" value={clientIp || '--'} icon={<ExternalLink size={11} />} />
              <InfoCard label="Dashboard Port" value={String(overview.dashboard_port)} icon={<Server size={11} />} />
              <InfoCard label="SSH Port" value={String(overview.ssh_port)} icon={<Shield size={11} />} />
            </div>
            {overview.server_local_ips.length > 0 && (
              <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                Local IPs: {overview.server_local_ips.join(', ')}
              </div>
            )}
          </div>

          {/* Safety Summary */}
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
              <ShieldAlert size={13} className="text-[var(--accent)]" />
              Safety Summary
            </div>
            <SafetySummary overview={overview} clientIp={clientIp} ufwStatus={ufwStatus} iptablesStatus={iptablesStatus} firewalldStatus={firewalldStatus} />
          </div>

          {/* Quick Setup */}
          <div className="pt-2 border-t border-[var(--border)]">
            <button
              onClick={openQuickSetup}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Zap size={14} />
              Quick Setup from Scratch
            </button>
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              Auto-whitelist your IP, dashboard port, and SSH port, then enable the firewall.
            </p>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* UFW TAB */}
      {/* ================================================================ */}
      {activeTab === 'ufw' && (
        <div>
          {/* UFW Status Bar */}
          {ufwStatus && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium ${
                ufwStatus.active
                  ? 'bg-[var(--success)]/15 text-[var(--success)]'
                  : 'bg-[var(--danger)]/15 text-[var(--danger)]'
              }`}>
                {ufwStatus.active ? <Shield size={13} /> : <ShieldOff size={13} />}
                {ufwStatus.active ? 'Active' : 'Inactive'}
              </span>
              {ufwStatus.version && (
                <span className="text-[10px] text-[var(--text-muted)]">v{ufwStatus.version}</span>
              )}
              {ufwStatus.logging && (
                <span className="text-[10px] text-[var(--text-muted)]">Logging: {ufwStatus.logging}</span>
              )}
              <div className="flex-1" />

              <button
                onClick={() => {
                  setUfwDefaultsForm({ incoming: ufwStatus.default_incoming || 'deny', outgoing: ufwStatus.default_outgoing || 'allow' });
                  setShowUfwDefaults(!showUfwDefaults);
                }}
                className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              >
                Defaults: {ufwStatus.default_incoming}/{ufwStatus.default_outgoing}
                {showUfwDefaults ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>

              <button
                onClick={toggleUfw}
                disabled={actionLoading === 'ufw-toggle'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                  ufwStatus.active
                    ? 'bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25'
                    : 'bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25'
                }`}
              >
                {actionLoading === 'ufw-toggle' ? <Loader2 size={12} className="animate-spin" /> : ufwStatus.active ? <ShieldOff size={12} /> : <Shield size={12} />}
                {ufwStatus.active ? 'Disable' : 'Enable'}
              </button>

              <button
                onClick={() => {
                  setShowUfwAddForm(true);
                  setUfwEditRule(null);
                  setUfwForm({ action: 'allow', direction: 'in', protocol: 'tcp', port: '', from_ip: 'any', to_ip: 'any', comment: '' });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={12} />
                Add Rule
              </button>

              <button
                onClick={fetchUfwStatus}
                disabled={ufwLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={ufwLoading ? 'animate-spin' : ''} />
              </button>

              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                title="Reset UFW"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          )}

          {/* UFW Defaults Editor */}
          {showUfwDefaults && ufwStatus && (
            <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
              <div className="text-xs font-medium text-[var(--text-primary)]">Default Policies</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Incoming</label>
                  <select value={ufwDefaultsForm.incoming} onChange={e => setUfwDefaultsForm(p => ({ ...p, incoming: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Outgoing</label>
                  <select value={ufwDefaultsForm.outgoing} onChange={e => setUfwDefaultsForm(p => ({ ...p, outgoing: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={updateUfwDefaults} disabled={actionLoading === 'ufw-defaults'} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50">
                  {actionLoading === 'ufw-defaults' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Apply
                </button>
                <button onClick={() => setShowUfwDefaults(false)} className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* UFW Add/Edit Rule Form */}
          {showUfwAddForm && (
            <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
              <div className="text-xs font-medium text-[var(--text-primary)] mb-2">{ufwEditRule ? `Edit Rule #${ufwEditRule.number}` : 'New UFW Rule'}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Action</label>
                  <select value={ufwForm.action} onChange={e => setUfwForm(p => ({ ...p, action: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                    <option value="reject">Reject</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Direction</label>
                  <select value={ufwForm.direction} onChange={e => setUfwForm(p => ({ ...p, direction: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="in">Incoming</option>
                    <option value="out">Outgoing</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Protocol</label>
                  <select value={ufwForm.protocol} onChange={e => setUfwForm(p => ({ ...p, protocol: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="any">Any</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Port</label>
                  <input type="text" value={ufwForm.port} onChange={e => setUfwForm(p => ({ ...p, port: e.target.value }))} placeholder="80, 443, 8000:9000" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">From (Source IP)</label>
                  <input type="text" value={ufwForm.from_ip} onChange={e => setUfwForm(p => ({ ...p, from_ip: e.target.value }))} placeholder="any or IP/CIDR" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">To (Destination IP)</label>
                  <input type="text" value={ufwForm.to_ip} onChange={e => setUfwForm(p => ({ ...p, to_ip: e.target.value }))} placeholder="any or IP/CIDR" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Comment</label>
                  <input type="text" value={ufwForm.comment} onChange={e => setUfwForm(p => ({ ...p, comment: e.target.value }))} placeholder="Optional note" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={ufwEditRule ? editUfwRule : addUfwRule} disabled={ufwFormLoading || !ufwForm.port.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50">
                  {ufwFormLoading ? <Loader2 size={12} className="animate-spin" /> : ufwEditRule ? <Check size={12} /> : <Plus size={12} />}
                  {ufwEditRule ? 'Save' : 'Add'}
                </button>
                <button onClick={() => { setShowUfwAddForm(false); setUfwEditRule(null); }} className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* UFW Loading */}
          {ufwLoading && !ufwStatus && (
            <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading UFW status...
            </div>
          )}

          {/* UFW Rules Table */}
          {ufwStatus && (
            <div className="overflow-auto max-h-[calc(80vh-280px)]">
              {ufwStatus.rules.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)] text-xs">
                  <Shield size={24} className="mx-auto mb-2 opacity-30" />
                  No UFW rules configured
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="py-2 px-2 font-medium w-10">#</th>
                      <th className="py-2 px-2 font-medium">Action</th>
                      <th className="py-2 px-2 font-medium">Dir</th>
                      <th className="py-2 px-2 font-medium">Proto</th>
                      <th className="py-2 px-2 font-medium">Port</th>
                      <th className="py-2 px-2 font-medium">From</th>
                      <th className="py-2 px-2 font-medium">Rule</th>
                      <th className="py-2 px-2 font-medium w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ufwStatus.rules.map((rule, i) => (
                      <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group">
                        <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono">{rule.number}</td>
                        <td className="py-1.5 px-2">
                          <ActionBadge action={rule.action} />
                        </td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)]">{rule.direction || 'in'}</td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)]">{rule.protocol || '—'}</td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono">{rule.port || '—'}</td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)] text-[10px]">{rule.from_ip || 'Anywhere'}</td>
                        <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono text-[10px] truncate max-w-[250px]" title={rule.raw}>{rule.raw}</td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {rule.number > 0 && (
                              <>
                                <button onClick={() => openEditUfwRule(rule)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors" title="Edit rule">
                                  <Pencil size={12} />
                                </button>
                                {deleteConfirm === `ufw-${rule.number}` ? (
                                  <div className="flex items-center gap-0.5">
                                    <button onClick={() => deleteUfwRule(rule.number)} disabled={actionLoading === `ufw-del-${rule.number}`} className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors" title="Confirm delete">
                                      {actionLoading === `ufw-del-${rule.number}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    </button>
                                    <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Cancel">
                                      <X size={12} />
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(`ufw-${rule.number}`)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors" title="Delete rule">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* IPTABLES TAB */}
      {/* ================================================================ */}
      {activeTab === 'iptables' && (
        <div>
          {/* Chain selector + policies */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border)] p-0.5">
              {(['INPUT', 'OUTPUT', 'FORWARD'] as IptablesChain[]).map(chain => {
                const policy = chain === 'INPUT' ? iptablesStatus?.policy_input : chain === 'OUTPUT' ? iptablesStatus?.policy_output : iptablesStatus?.policy_forward;
                const count = iptablesStatus?.rules.filter(r => r.chain === chain).length || 0;
                return (
                  <button
                    key={chain}
                    onClick={() => setIptablesChain(chain)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
                      iptablesChain === chain ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {chain}
                    <span className="opacity-75">({count})</span>
                    {policy && <span className={`ml-0.5 text-[8px] ${policy === 'DROP' ? 'text-red-300' : ''}`}>[{policy}]</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            {/* Policy changer */}
            <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <span>Policy:</span>
              <select
                value={iptablesChain === 'INPUT' ? iptablesStatus?.policy_input : iptablesChain === 'OUTPUT' ? iptablesStatus?.policy_output : iptablesStatus?.policy_forward}
                onChange={e => setIptablesPolicy(iptablesChain, e.target.value)}
                disabled={actionLoading?.startsWith('ipt-pol')}
                className="px-1.5 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[10px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="ACCEPT">ACCEPT</option>
                <option value="DROP">DROP</option>
              </select>
            </div>

            <button
              onClick={() => {
                setShowIptablesAddForm(true);
                setIptablesForm(f => ({ ...f, chain: iptablesChain }));
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Plus size={12} />
              Add Rule
            </button>

            <button
              onClick={fetchIptablesStatus}
              disabled={iptablesLoading}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={iptablesLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* iptables Add Rule Form */}
          {showIptablesAddForm && (
            <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
              <div className="text-xs font-medium text-[var(--text-primary)] mb-2">New iptables Rule</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Chain</label>
                  <select value={iptablesForm.chain} onChange={e => setIptablesForm(p => ({ ...p, chain: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="INPUT">INPUT</option>
                    <option value="OUTPUT">OUTPUT</option>
                    <option value="FORWARD">FORWARD</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Target</label>
                  <select value={iptablesForm.target} onChange={e => setIptablesForm(p => ({ ...p, target: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="ACCEPT">ACCEPT</option>
                    <option value="DROP">DROP</option>
                    <option value="REJECT">REJECT</option>
                    <option value="LOG">LOG</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Protocol</label>
                  <select value={iptablesForm.protocol} onChange={e => setIptablesForm(p => ({ ...p, protocol: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="all">All</option>
                    <option value="icmp">ICMP</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Port</label>
                  <input type="text" value={iptablesForm.port} onChange={e => setIptablesForm(p => ({ ...p, port: e.target.value }))} placeholder="80, 443" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Source</label>
                  <input type="text" value={iptablesForm.source} onChange={e => setIptablesForm(p => ({ ...p, source: e.target.value }))} placeholder="0.0.0.0/0" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Destination</label>
                  <input type="text" value={iptablesForm.destination} onChange={e => setIptablesForm(p => ({ ...p, destination: e.target.value }))} placeholder="0.0.0.0/0" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Position (0=append)</label>
                  <input type="number" value={iptablesForm.position} onChange={e => setIptablesForm(p => ({ ...p, position: parseInt(e.target.value) || 0 }))} min={0} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={addIptablesRule} disabled={iptablesFormLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50">
                  {iptablesFormLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add
                </button>
                <button onClick={() => setShowIptablesAddForm(false)} className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* iptables Loading */}
          {iptablesLoading && !iptablesStatus && (
            <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading iptables status...
            </div>
          )}

          {/* iptables Rules Table */}
          {iptablesStatus && (() => {
            const chainRules = iptablesStatus.rules.filter(r => r.chain === iptablesChain);
            return (
              <div className="overflow-auto max-h-[calc(80vh-280px)]">
                {chainRules.length === 0 ? (
                  <div className="py-8 text-center text-[var(--text-muted)] text-xs">
                    <Table2 size={24} className="mx-auto mb-2 opacity-30" />
                    No rules in {iptablesChain} chain
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="py-2 px-2 font-medium w-10">#</th>
                        <th className="py-2 px-2 font-medium">Target</th>
                        <th className="py-2 px-2 font-medium">Proto</th>
                        <th className="py-2 px-2 font-medium">Source</th>
                        <th className="py-2 px-2 font-medium">Dest</th>
                        <th className="py-2 px-2 font-medium">Port</th>
                        <th className="py-2 px-2 font-medium">Details</th>
                        <th className="py-2 px-2 font-medium w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {chainRules.map((rule, i) => (
                        <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)] transition-colors group">
                          <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono">{rule.number}</td>
                          <td className="py-1.5 px-2">
                            <ActionBadge action={rule.target} />
                          </td>
                          <td className="py-1.5 px-2 text-[var(--text-secondary)]">{rule.protocol}</td>
                          <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px]">{rule.source}</td>
                          <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono text-[10px]">{rule.destination}</td>
                          <td className="py-1.5 px-2 text-[var(--text-secondary)] font-mono">{rule.port || '—'}</td>
                          <td className="py-1.5 px-2 text-[var(--text-muted)] text-[10px] truncate max-w-[200px]" title={rule.extra}>{rule.extra || '—'}</td>
                          <td className="py-1.5 px-2">
                            {deleteConfirm === `ipt-${rule.chain}-${rule.number}` ? (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => deleteIptablesRule(rule.chain, rule.number)} disabled={actionLoading === `ipt-del-${rule.chain}-${rule.number}`} className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors" title="Confirm delete">
                                  {actionLoading === `ipt-del-${rule.chain}-${rule.number}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                </button>
                                <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Cancel">
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(`ipt-${rule.chain}-${rule.number}`)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100" title="Delete rule">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ================================================================ */}
      {/* FIREWALLD TAB */}
      {/* ================================================================ */}
      {activeTab === 'firewalld' && (
        <div>
          {/* firewalld Status Bar */}
          {firewalldStatus && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium ${
                firewalldStatus.active
                  ? 'bg-[var(--success)]/15 text-[var(--success)]'
                  : 'bg-[var(--danger)]/15 text-[var(--danger)]'
              }`}>
                {firewalldStatus.active ? <Shield size={13} /> : <ShieldOff size={13} />}
                {firewalldStatus.active ? 'Active' : 'Inactive'}
              </span>
              {firewalldStatus.version && (
                <span className="text-[10px] text-[var(--text-muted)]">v{firewalldStatus.version}</span>
              )}
              {firewalldStatus.default_zone && (
                <span className="text-[10px] text-[var(--text-muted)]">Zone: {firewalldStatus.default_zone}</span>
              )}
              {firewalldStatus.active_zones.length > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">Active: {firewalldStatus.active_zones.join(', ')}</span>
              )}

              <div className="flex-1" />

              <button
                onClick={toggleFirewalld}
                disabled={actionLoading === 'fwd-toggle'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                  firewalldStatus.active
                    ? 'bg-[var(--danger)]/15 text-[var(--danger)] hover:bg-[var(--danger)]/25'
                    : 'bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25'
                }`}
              >
                {actionLoading === 'fwd-toggle' ? <Loader2 size={12} className="animate-spin" /> : firewalldStatus.active ? <ShieldOff size={12} /> : <Shield size={12} />}
                {firewalldStatus.active ? 'Stop' : 'Start'}
              </button>

              <button
                onClick={() => { setShowFirewalldAddForm(true); setFirewalldForm({ zone: firewalldStatus.default_zone, type: 'port', value: '', permanent: true }); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={12} />
                Add Rule
              </button>

              <button
                onClick={reloadFirewalld}
                disabled={actionLoading === 'fwd-reload'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                title="Reload firewalld"
              >
                {actionLoading === 'fwd-reload' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                <span className="hidden sm:inline">Reload</span>
              </button>

              <button
                onClick={fetchFirewalldStatus}
                disabled={firewalldLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={firewalldLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          )}

          {/* firewalld Add Rule Form */}
          {showFirewalldAddForm && (
            <div className="mb-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--accent)]/30 space-y-2">
              <div className="text-xs font-medium text-[var(--text-primary)] mb-2">New firewalld Rule</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Type</label>
                  <select value={firewalldForm.type} onChange={e => setFirewalldForm(p => ({ ...p, type: e.target.value, value: '' }))} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                    <option value="port">Port</option>
                    <option value="service">Service</option>
                    <option value="rich-rule">Rich Rule</option>
                    <option value="source">Source</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">
                    {firewalldForm.type === 'port' ? 'Port (e.g., 80/tcp)' : firewalldForm.type === 'service' ? 'Service name (e.g., ssh)' : firewalldForm.type === 'rich-rule' ? 'Rich rule' : 'Source IP/CIDR'}
                  </label>
                  <input type="text" value={firewalldForm.value} onChange={e => setFirewalldForm(p => ({ ...p, value: e.target.value }))} placeholder={firewalldForm.type === 'port' ? '80/tcp' : firewalldForm.type === 'service' ? 'ssh, http, https' : firewalldForm.type === 'source' ? '10.0.0.0/8' : 'rule family="ipv4" ...'} className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">Zone</label>
                  <input type="text" value={firewalldForm.zone} onChange={e => setFirewalldForm(p => ({ ...p, zone: e.target.value }))} placeholder="default" className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={firewalldForm.permanent} onChange={e => setFirewalldForm(p => ({ ...p, permanent: e.target.checked }))} className="rounded border-[var(--border)]" />
                  Permanent
                </label>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={addFirewalldRule} disabled={firewalldFormLoading || !firewalldForm.value.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50">
                  {firewalldFormLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add
                </button>
                <button onClick={() => setShowFirewalldAddForm(false)} className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* firewalld Loading */}
          {firewalldLoading && !firewalldStatus && (
            <div className="py-12 text-center text-[var(--text-muted)] text-xs flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading firewalld status...
            </div>
          )}

          {/* firewalld Rules grouped by type */}
          {firewalldStatus && (
            <div className="overflow-auto max-h-[calc(80vh-280px)]">
              {firewalldStatus.rules.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)] text-xs">
                  <Flame size={24} className="mx-auto mb-2 opacity-30" />
                  No firewalld rules configured
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Group rules by type */}
                  {['service', 'port', 'rich-rule', 'source'].map(type => {
                    const typeRules = firewalldStatus.rules.filter(r => r.type === type);
                    if (typeRules.length === 0) return null;
                    return (
                      <div key={type}>
                        <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <CircleDot size={9} />
                          {type === 'rich-rule' ? 'Rich Rules' : `${type.charAt(0).toUpperCase()}${type.slice(1)}s`}
                          <span className="text-[var(--text-muted)] opacity-50">({typeRules.length})</span>
                        </div>
                        <div className="space-y-1">
                          {typeRules.map((rule, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]/50 group hover:border-[var(--border)] transition-colors">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--success)]/15 text-[var(--success)] font-medium">{rule.type}</span>
                              <span className="text-xs text-[var(--text-primary)] font-mono flex-1">{rule.value}</span>
                              <span className="text-[10px] text-[var(--text-muted)]">{rule.zone}</span>
                              {deleteConfirm === `fwd-${rule.type}-${rule.value}` ? (
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => deleteFirewalldRule(rule)} disabled={actionLoading === `fwd-del-${rule.type}-${rule.value}`} className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors">
                                    {actionLoading === `fwd-del-${rule.type}-${rule.value}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                  </button>
                                  <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setDeleteConfirm(`fwd-${rule.type}-${rule.value}`)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors opacity-0 group-hover:opacity-100" title="Delete rule">
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* SAFETY WARNING DIALOG */}
      {/* ================================================================ */}
      {showSafetyDialog && safetyWarnings.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSafetyDialog(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-md mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <AlertTriangle size={32} className="mx-auto mb-2 text-[var(--warning)]" />
              <div className="text-sm font-semibold text-[var(--text-primary)]">Safety Warning</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">Review the following warnings before proceeding</div>
            </div>

            <div className="space-y-2 mb-4 max-h-[300px] overflow-auto">
              {safetyWarnings.map((w, i) => (
                <div key={i} className={`p-3 rounded border text-xs ${
                  w.level === 'critical' ? 'border-red-500/30 bg-red-500/5' :
                  w.level === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' :
                  'border-blue-500/30 bg-blue-500/5'
                }`}>
                  <div className="flex items-start gap-2">
                    {w.level === 'critical' && (
                      <label className="flex items-center gap-1.5 shrink-0 cursor-pointer mt-0.5">
                        <input
                          type="checkbox"
                          checked={safetyAcknowledged.has(w.code)}
                          onChange={() => {
                            setSafetyAcknowledged(prev => {
                              const next = new Set(prev);
                              if (next.has(w.code)) next.delete(w.code); else next.add(w.code);
                              return next;
                            });
                          }}
                          className="rounded border-[var(--border)]"
                        />
                      </label>
                    )}
                    <div>
                      <div className={`font-medium ${w.level === 'critical' ? 'text-red-400' : w.level === 'warning' ? 'text-yellow-400' : 'text-blue-400'}`}>
                        {w.message}
                      </div>
                      {w.suggestion && (
                        <div className="text-[var(--text-muted)] text-[10px] mt-1">{w.suggestion}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setShowSafetyDialog(false); setPendingSafetyAction(null); }}
                className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={proceedSafetyAction}
                disabled={(() => {
                  const criticals = safetyWarnings.filter(w => w.level === 'critical');
                  return criticals.length > 0 && !criticals.every(w => safetyAcknowledged.has(w.code));
                })()}
                className="px-4 py-1.5 rounded bg-[var(--warning)] text-black text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                I Understand, Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* QUICK SETUP DIALOG */}
      {/* ================================================================ */}
      {showQuickSetup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowQuickSetup(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-md mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <Zap size={28} className="mx-auto mb-2 text-[var(--accent)]" />
              <div className="text-sm font-semibold text-[var(--text-primary)]">Quick Firewall Setup</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                Auto-configure essential firewall rules and enable protection
              </div>
            </div>

            <div className="space-y-3 mb-4">
              {/* Backend selection */}
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-1">Firewall Backend</label>
                <select
                  value={quickSetupBackend}
                  onChange={e => setQuickSetupBackend(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {overview?.backends.filter(b => b.installed).map(b => (
                    <option key={b.name} value={b.name}>{b.name.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              {/* IPs to whitelist */}
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-1">Auto-detected IPs to Whitelist</label>
                <div className="space-y-1">
                  {quickSetupIps.map((ip, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <Globe size={11} className="text-[var(--accent)] shrink-0" />
                      <span className="text-xs text-[var(--text-primary)] font-mono flex-1">{ip}</span>
                      <span className="text-[9px] text-[var(--text-muted)]">{ip === clientIp ? 'Your IP' : 'Server IP'}</span>
                      <button onClick={() => setQuickSetupIps(prev => prev.filter((_, j) => j !== i))} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {quickSetupIps.length === 0 && (
                    <div className="text-[10px] text-[var(--text-muted)] italic px-2 py-1.5">No IPs to whitelist</div>
                  )}
                </div>
              </div>

              {/* Port rules */}
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-1">Port Rules</label>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] cursor-pointer">
                    <input type="checkbox" checked={quickSetupDashPort} onChange={e => setQuickSetupDashPort(e.target.checked)} className="rounded border-[var(--border)]" />
                    <span className="text-xs text-[var(--text-primary)] flex-1">Dashboard port ({overview?.dashboard_port})</span>
                    <span className="text-[9px] text-[var(--text-muted)]">allow</span>
                  </label>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] cursor-pointer">
                    <input type="checkbox" checked={quickSetupSshPort} onChange={e => setQuickSetupSshPort(e.target.checked)} className="rounded border-[var(--border)]" />
                    <span className="text-xs text-[var(--text-primary)] flex-1">SSH port ({overview?.ssh_port})</span>
                    <span className="text-[9px] text-[var(--text-muted)]">rate limit</span>
                  </label>
                </div>
              </div>

              {quickSetupBackend === 'ufw' && (
                <div className="p-2 rounded bg-blue-500/5 border border-blue-500/20 text-[10px] text-blue-400">
                  <Info size={10} className="inline mr-1" />
                  This will set the default incoming policy to <strong>deny</strong>, add the selected rules, and enable UFW.
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowQuickSetup(false)}
                className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeQuickSetup}
                disabled={quickSetupLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                {quickSetupLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                Apply & Enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* UFW RESET CONFIRMATION */}
      {/* ================================================================ */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowResetConfirm(false)} />
          <div className="relative bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 max-w-sm mx-4 shadow-2xl">
            <div className="text-center">
              <AlertTriangle size={28} className="mx-auto mb-3 text-red-400" />
              <div className="text-sm font-medium text-[var(--text-primary)] mb-2">Reset UFW?</div>
              <div className="text-xs text-[var(--text-muted)] mb-4">
                This will disable UFW and delete ALL firewall rules. This action cannot be undone.
              </div>
              <div className="flex items-center gap-2 justify-center">
                <button onClick={() => setShowResetConfirm(false)} className="px-4 py-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)] transition-colors">
                  Cancel
                </button>
                <button onClick={resetUfw} disabled={actionLoading === 'ufw-reset'} className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50">
                  {actionLoading === 'ufw-reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolModal>
  );
};


// ===================================================================
// Sub-components
// ===================================================================

const InfoCard: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
    <div className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
      {icon}
      {label}
    </div>
    <div className="text-xs font-semibold text-[var(--text-primary)] mt-0.5 font-mono">{value}</div>
  </div>
);

const ActionBadge: React.FC<{ action: string }> = ({ action }) => {
  const a = action.toLowerCase();
  const colorClass =
    a === 'allow' || a === 'accept' ? 'bg-[var(--success)]/20 text-[var(--success)]' :
    a === 'deny' || a === 'drop' ? 'bg-[var(--danger)]/20 text-[var(--danger)]' :
    a === 'reject' ? 'bg-[var(--danger)]/20 text-[var(--danger)]' :
    a === 'limit' ? 'bg-[var(--warning)]/20 text-[var(--warning)]' :
    a === 'log' ? 'bg-blue-500/20 text-blue-400' :
    'bg-[var(--bg-tertiary)] text-[var(--text-muted)]';

  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${colorClass}`}>{action}</span>;
};

const SafetySummary: React.FC<{
  overview: FirewallOverview;
  clientIp: string;
  ufwStatus: UfwStatus | null;
  iptablesStatus: IptablesStatus | null;
  firewalldStatus: FirewalldStatus | null;
}> = ({ overview, clientIp, ufwStatus, iptablesStatus, firewalldStatus }) => {
  const issues: { level: string; message: string }[] = [];

  const anyActive = overview.backends.some(b => b.active);
  if (!anyActive) {
    issues.push({ level: 'critical', message: 'No firewall is currently active. All ports are exposed.' });
  }

  // Check UFW-specific issues
  if (ufwStatus?.active) {
    const allowRules = ufwStatus.rules.filter(r => r.action === 'allow' || r.action === 'ALLOW');
    if (allowRules.length === 0 && ufwStatus.default_incoming === 'deny') {
      issues.push({ level: 'warning', message: 'UFW is active with deny-all and no allow rules. All incoming traffic is blocked.' });
    }
    const dashAllowed = ufwStatus.rules.some(r => (r.action === 'allow' || r.action === 'ALLOW') && r.port === String(overview.dashboard_port));
    if (!dashAllowed && ufwStatus.default_incoming === 'deny') {
      issues.push({ level: 'warning', message: `Dashboard port ${overview.dashboard_port} is not explicitly allowed in UFW.` });
    }
    const sshRateLimited = ufwStatus.rules.some(r => r.action === 'limit' && r.port === String(overview.ssh_port));
    const sshAllowed = ufwStatus.rules.some(r => (r.action === 'allow' || r.action === 'ALLOW') && r.port === String(overview.ssh_port));
    if (sshAllowed && !sshRateLimited) {
      issues.push({ level: 'info', message: `SSH port ${overview.ssh_port} is allowed but not rate-limited. Consider using 'limit' for brute-force protection.` });
    }
  }

  // Check iptables
  if (iptablesStatus && iptablesStatus.policy_input === 'DROP') {
    const acceptRules = iptablesStatus.rules.filter(r => r.chain === 'INPUT' && r.target === 'ACCEPT');
    if (acceptRules.length === 0) {
      issues.push({ level: 'warning', message: 'iptables INPUT policy is DROP with no ACCEPT rules.' });
    }
  }

  if (issues.length === 0 && anyActive) {
    issues.push({ level: 'success', message: 'Firewall is properly configured with active rules.' });
  }

  if (clientIp && clientIp !== 'unknown') {
    // Check if client IP is whitelisted somewhere
    let ipWhitelisted = false;
    if (ufwStatus?.active) {
      ipWhitelisted = ufwStatus.rules.some(r => r.from_ip === clientIp);
    }
    if (firewalldStatus?.active) {
      ipWhitelisted = ipWhitelisted || firewalldStatus.rules.some(r => r.type === 'source' && r.value === clientIp);
    }
    // Don't warn if firewall isn't active or has default allow
    if (anyActive && !ipWhitelisted && ufwStatus?.default_incoming === 'deny') {
      issues.push({ level: 'info', message: `Your IP (${clientIp}) is not explicitly whitelisted.` });
    }
  }

  return (
    <div className="space-y-1.5">
      {issues.map((issue, i) => (
        <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded text-xs ${
          issue.level === 'critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
          issue.level === 'warning' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
          issue.level === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
        }`}>
          {issue.level === 'critical' && <TriangleAlert size={13} className="shrink-0 mt-0.5" />}
          {issue.level === 'warning' && <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
          {issue.level === 'success' && <ShieldCheck size={13} className="shrink-0 mt-0.5" />}
          {issue.level === 'info' && <Info size={13} className="shrink-0 mt-0.5" />}
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
};
