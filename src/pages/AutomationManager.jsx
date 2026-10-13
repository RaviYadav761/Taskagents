import React, { useState, useEffect } from "react";
import {
  Zap,
  Clock,
  Play,
  RotateCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Laptop,
  Terminal,
  FileCode,
  ShieldAlert,
  ChevronRight,
  Plus,
  RefreshCw,
  ExternalLink,
  Sliders,
  X,
  Eye,
  FileText,
  Globe,
  Coffee,
  Lock,
  BarChart2,
  Calendar
} from "lucide-react";
import { WebsiteIcon, YoutubeIcon, InstagramIcon } from "../components/common/BrandIcons";
import { api } from "../utils/api";

const AutomationManager = ({
  onOpenCreateModal,
  onEditTask,
  tasks = [],
}) => {
  const [jobs, setJobs] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [siteLimits, setSiteLimits] = useState([]);
  const [agentStatus, setAgentStatus] = useState({ isOnline: false, data: null });
  const [devices, setDevices] = useState([]);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState(null);
  const [extensionPairingModalOpen, setExtensionPairingModalOpen] = useState(false);
  const [extensionPairingCode, setExtensionPairingCode] = useState(null);
  const [extensionPairingLoading, setExtensionPairingLoading] = useState(false);
  const [selectedExecutionLog, setSelectedExecutionLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'rules' | 'analytics' | 'history'
  const [actionMessage, setActionMessage] = useState(null);

  // Analytics filters & state
  const [analyticsRange, setAnalyticsRange] = useState("7days");
  const [analyticsDomain, setAnalyticsDomain] = useState("all");
  const [analyticsData, setAnalyticsData] = useState({ totals: {}, todaySnapshot: [], history: [] });
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const showToast = (msg) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  const loadData = async () => {
    try {
      setLoading(true);

      // Check local agent IPC
      const agentRes = await api.checkLocalAgent();
      setAgentStatus(agentRes);

      // Fetch jobs from backend
      try {
        const jobsData = await api.getJobs();
        if (jobsData?.jobs) setJobs(jobsData.jobs);
      } catch (e) {
        setJobs(tasks.filter((t) => t.actionType && t.actionType !== "standard"));
      }

      // Fetch executions
      try {
        const execData = await api.getExecutions();
        if (execData?.executions) setExecutions(execData.executions);
      } catch (e) {}

      // Fetch site limits
      try {
        const limitsData = await api.getSiteLimits();
        if (limitsData?.limits) setSiteLimits(limitsData.limits);
      } catch (e) {}

      // Fetch devices
      try {
        const devData = await api.getDevices();
        if (devData?.devices) setDevices(devData.devices);
      } catch (e) {}
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    try {
      setLoadingAnalytics(true);
      const data = await api.getSiteAnalytics({ range: analyticsRange, domain: analyticsDomain });
      setAnalyticsData(data);
    } catch (e) {
      console.warn("Failed to load analytics:", e);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "analytics") {
      loadAnalytics();
    }
  }, [activeTab, analyticsRange, analyticsDomain]);

  const handleGeneratePairCode = async () => {
    try {
      const data = await api.generatePairingCode();
      setPairingCode(data.pairingCode);
      setPairingModalOpen(true);
    } catch (e) {
      alert("Please sign in or start the Taskly backend to pair devices.");
    }
  };

  const handleGenerateExtensionCode = async () => {
    try {
      setExtensionPairingLoading(true);
      const data = await api.generateExtensionPairingCode();
      setExtensionPairingCode(data.code);
      setExtensionPairingModalOpen(true);
    } catch (e) {
      alert("Please sign in to generate a Chrome extension pairing code.");
    } finally {
      setExtensionPairingLoading(false);
    }
  };

  const handleTriggerNow = async (jobId) => {
    try {
      await api.triggerJobNow(jobId);
      showToast("Manual execution triggered! Task queued for execution.");
      loadData();
    } catch (e) {
      alert(e.message || "Failed to trigger job");
    }
  };

  const handleToggleJob = async (jobId) => {
    try {
      await api.toggleJobStatus(jobId);
      loadData();
    } catch (e) {
      alert(e.message || "Failed to toggle status");
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!window.confirm("Are you sure you wish to delete this scheduled job?")) return;
    try {
      await api.deleteJob(jobId);
      showToast("Scheduled job deleted.");
      loadData();
    } catch (e) {
      alert(e.message || "Failed to delete job");
    }
  };

  const handleRetryExecution = async (execId) => {
    try {
      await api.retryExecution(execId);
      showToast("Job retry initiated!");
      loadData();
    } catch (e) {
      alert(e.message || "Failed to retry execution");
    }
  };

  const handleToggleSiteRule = async (ruleId) => {
    try {
      await api.toggleSiteLimit(ruleId);
      loadData();
    } catch (e) {
      alert(e.message || "Failed to toggle rule");
    }
  };

  const handleDeleteSiteRule = async (ruleId) => {
    if (!window.confirm("Are you sure you want to remove this website restriction rule?")) return;
    try {
      await api.deleteSiteLimitRule(ruleId);
      showToast("Website restriction rule deleted.");
      loadData();
    } catch (e) {
      alert(e.message || "Failed to delete rule");
    }
  };

  const handleEmergencyOverride = async (domain) => {
    if (!window.confirm(`Warning: Emergency override will bypass your scheduled habit limits for ${domain} for today. Continue?`)) return;
    try {
      await api.toggleEmergencyOverride(domain, true);
      showToast(`Emergency override enabled for ${domain}.`);
      loadData();
    } catch (e) {
      alert(e.message || "Failed to enable emergency override");
    }
  };

  const formatSeconds = (sec) => {
    if (!sec || sec < 60) return `${sec || 0}s`;
    const mins = Math.floor(sec / 60);
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  };

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto overflow-y-auto min-h-[calc(100vh-57px)] lg:h-screen">
      {/* Toast notification */}
      {actionMessage && (
        <div className="fixed top-6 right-6 z-50 bg-neutral-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-900 text-amber-400 flex items-center justify-center shadow-xs">
              <Zap size={18} />
            </div>
            <h1 className="text-2xl font-black text-neutral-900 tracking-tight">
              Automations & Website Controller
            </h1>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Real cron jobs, local scripts, dynamic website restrictions, and usage sync analytics
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleGeneratePairCode}
            className="px-3.5 py-2.5 rounded-2xl border border-neutral-300 hover:border-neutral-900 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-xs"
          >
            <Laptop size={15} />
            <span>Pair Local Agent</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateModal}
            className="px-4 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-bold rounded-2xl flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus size={16} />
            <span>Create Automation</span>
          </button>
        </div>
      </div>

      {/* Device & Local Agent Status Card */}
      <div className="mb-6 p-4 sm:p-5 rounded-3xl bg-white border border-[#E2DDD3] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${agentStatus.isOnline ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-amber-50 text-amber-600 border border-amber-200"}`}>
            <Laptop size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-neutral-900">
                {agentStatus.isOnline ? "Local Automation Agent is Online" : "Local Agent Not Connected"}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${agentStatus.isOnline ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                <span className={`w-1.5 h-1.5 rounded-full mr-1 ${agentStatus.isOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                {agentStatus.isOnline ? "Active Daemon (127.0.0.1:47891)" : "Awaiting Device"}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              {agentStatus.isOnline
                ? `Running on ${agentStatus.data?.platform || "Mac"} (${agentStatus.data?.nodeVersion || "Node.js"}). Executing approved local scripts, file trashing, and app restarts.`
                : "Cloud tasks (emails/reminders) will run. To run local scripts, file deletions, and desktop restrictions, run `npm run agent` on your computer."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-xl transition-colors cursor-pointer"
            title="Refresh Status"
          >
            <RefreshCw size={16} />
          </button>
          {!agentStatus.isOnline && (
            <button
              type="button"
              onClick={handleGeneratePairCode}
              className="px-3 py-1.5 bg-neutral-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Get Pairing Code
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-[#E2DDD3] mb-5 pb-3 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "all" ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"}`}
          >
            Scheduled Jobs ({jobs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === "rules" ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"}`}
          >
            <ShieldAlert size={13} />
            <span>Website Rules ({siteLimits.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === "analytics" ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"}`}
          >
            <BarChart2 size={13} />
            <span>Usage Analytics</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeTab === "history" ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"}`}
          >
            Execution History ({executions.length})
          </button>
        </div>

        <span className="text-xs text-neutral-400 font-medium shrink-0 ml-4">Timezone: Asia/Kolkata</span>
      </div>

      {/* TAB 1: WEBSITE RULES & USAGE LIMITS */}
      {activeTab === "rules" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-neutral-900">Configured Website Usage Rules</h2>
              <p className="text-xs text-neutral-500">Rules are automatically synchronized and enforced by the Taskly Extension.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateExtensionCode}
                disabled={extensionPairingLoading}
                className="px-3 py-1.5 bg-white border border-[#E2DDD3] hover:border-neutral-400 text-neutral-800 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
              >
                <ShieldAlert size={14} className="text-amber-600" />
                <span>Connect Chrome Extension</span>
              </button>
              <button
                onClick={onOpenCreateModal}
                className="px-3 py-1.5 bg-neutral-900 hover:bg-black text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus size={14} />
                <span>Add Website Rule</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {siteLimits.map((rule) => {
              const used = rule.usedTodaySeconds || 0;
              const cap = rule.dailyAllowanceSeconds || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

              return (
                <div
                  key={rule.id}
                  className="p-5 rounded-3xl bg-white border border-[#E2DDD3] shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-white border border-neutral-200 flex items-center justify-center shrink-0 shadow-2xs">
                          <WebsiteIcon domain={rule.domain} size={22} />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-neutral-900 flex items-center gap-1.5">
                            <span>{rule.displayName || rule.domain}</span>
                            <span className="text-[10px] font-normal text-neutral-400">({rule.domain})</span>
                          </h3>
                          <span className="text-[11px] text-neutral-500">
                            {rule.restrictionType === "cycle"
                              ? `${Math.round(rule.activeIntervalSeconds / 60)}m active / ${Math.round(rule.breakSeconds / 60)}m break loop`
                              : rule.restrictionType === "today_only"
                              ? "One-time block for today"
                              : rule.restrictionType === "schedule"
                              ? `Blocked ${rule.scheduleStartTime || "09:00"}–${rule.scheduleEndTime || "12:00"}`
                              : rule.restrictionType === "daily_limit"
                              ? `Daily quota limit (${formatSeconds(rule.dailyAllowanceSeconds)})`
                              : "Date range restriction"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rule.isBlocked ? "bg-rose-100 text-rose-800" :
                          rule.isInBreak ? "bg-amber-100 text-amber-800" :
                          rule.isEnabled ? "bg-emerald-100 text-emerald-800" :
                          "bg-neutral-100 text-neutral-600"
                        }`}>
                          {rule.isBlocked ? "Blocked" : rule.isInBreak ? "In Break" : rule.isEnabled ? "Active" : "Paused"}
                        </span>
                      </div>
                    </div>

                    {/* Usage Progress bar */}
                    <div className="space-y-1 mb-3">
                      <div className="flex justify-between text-xs font-semibold text-neutral-700">
                        <span>Today's Tracked Active Time:</span>
                        <span>{formatSeconds(used)} / {cap > 0 ? formatSeconds(cap) : "Unlimited"}</span>
                      </div>
                      {cap > 0 && (
                        <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleSiteRule(rule.id)}
                        className="text-neutral-600 hover:text-black font-semibold text-[11px] cursor-pointer"
                      >
                        {rule.isEnabled ? "Pause Rule" : "Activate Rule"}
                      </button>
                      {(rule.isBlocked || rule.isInBreak) && (
                        <button
                          type="button"
                          onClick={() => handleEmergencyOverride(rule.domain)}
                          className="text-rose-600 hover:text-rose-800 font-bold text-[11px] underline cursor-pointer"
                        >
                          Override Today
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteSiteRule(rule.id)}
                      className="text-neutral-400 hover:text-rose-600 p-1 rounded-lg transition-colors cursor-pointer"
                      title="Delete Rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === "analytics" ? (
        /* TAB 2: COMPREHENSIVE USAGE ANALYTICS */
        <div className="space-y-6">
          {/* Analytics Filter Header */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-[#E2DDD3] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-black text-neutral-900">Website Usage Analytics</h2>
              <p className="text-xs text-neutral-500">Tracked active-tab viewing time, breaks taken, and block durations.</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Range Selector */}
              <div className="flex bg-[#F4F4F6] p-1 rounded-xl">
                {["today", "yesterday", "7days", "30days"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAnalyticsRange(r)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer capitalize ${
                      analyticsRange === r ? "bg-white text-neutral-900 shadow-2xs" : "text-neutral-600 hover:text-black"
                    }`}
                  >
                    {r === "7days" ? "Last 7 Days" : r === "30days" ? "Last 30 Days" : r}
                  </button>
                ))}
              </div>

              {/* Website Selector */}
              <select
                value={analyticsDomain}
                onChange={(e) => setAnalyticsDomain(e.target.value)}
                className="bg-white border border-neutral-200 text-xs font-bold rounded-xl px-3 py-1.5 outline-none"
              >
                <option value="all">All Websites</option>
                {siteLimits.map((lim) => (
                  <option key={lim.domain} value={lim.domain}>{lim.displayName || lim.domain}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Aggregated Totals Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-[#E2DDD3] shadow-xs">
              <span className="text-xs font-bold text-neutral-500 block mb-1">Active-Tab Time</span>
              <div className="text-2xl font-black text-neutral-900">
                {formatSeconds(analyticsData.totals?.totalActiveUsedSeconds || 0)}
              </div>
              <span className="text-[11px] text-neutral-400 mt-1 block">Active user focus</span>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-[#E2DDD3] shadow-xs">
              <span className="text-xs font-bold text-neutral-500 block mb-1">Mindful Breaks Taken</span>
              <div className="text-2xl font-black text-emerald-600 flex items-center gap-1.5">
                <Coffee size={20} />
                <span>{analyticsData.totals?.totalBreaksTaken || 0}</span>
              </div>
              <span className="text-[11px] text-neutral-400 mt-1 block">Healthy interval pauses</span>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-[#E2DDD3] shadow-xs">
              <span className="text-xs font-bold text-neutral-500 block mb-1">Time Spent Blocked</span>
              <div className="text-2xl font-black text-rose-600 flex items-center gap-1.5">
                <Lock size={20} />
                <span>{formatSeconds(analyticsData.totals?.totalBlockedSeconds || 0)}</span>
              </div>
              <span className="text-[11px] text-neutral-400 mt-1 block">Enforced restrictions</span>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-[#E2DDD3] shadow-xs">
              <span className="text-xs font-bold text-neutral-500 block mb-1">Websites Monitored</span>
              <div className="text-2xl font-black text-neutral-900">
                {siteLimits.length}
              </div>
              <span className="text-[11px] text-neutral-400 mt-1 block">Active extension rules</span>
            </div>
          </div>

          {/* Today Snapshot List */}
          <div className="bg-white rounded-3xl border border-[#E2DDD3] shadow-xs overflow-hidden">
            <div className="p-4 border-b border-neutral-150 flex items-center justify-between bg-neutral-50/50">
              <h3 className="font-bold text-sm text-neutral-900">Today's Website Breakdown</h3>
              <span className="text-xs text-neutral-500">Live active-tab metric comparison</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-150 bg-neutral-50/80 text-neutral-500 font-semibold">
                    <th className="py-3 px-4">Website</th>
                    <th className="py-3 px-4">Active-Tab Time</th>
                    <th className="py-3 px-4">Configured Limit</th>
                    <th className="py-3 px-4">Breaks Taken</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-150">
                  {analyticsData.todaySnapshot?.map((item) => (
                    <tr key={item.domain} className="hover:bg-neutral-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-neutral-900 flex items-center gap-2">
                        <Globe size={14} className="text-neutral-500" />
                        <span>{item.displayName}</span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-neutral-800">
                        {formatSeconds(item.usedTodaySeconds)}
                      </td>
                      <td className="py-3 px-4 text-neutral-600">
                        {item.dailyAllowanceSeconds > 0 ? formatSeconds(item.dailyAllowanceSeconds) : "No Limit"}
                      </td>
                      <td className="py-3 px-4 text-neutral-700 font-medium">
                        {item.breaksCountToday} breaks
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.limitExceeded ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {item.limitExceeded ? "Quota Exceeded" : "Within Quota"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === "history" ? (
        /* TAB 3: EXECUTION HISTORY TABLE */
        <div className="bg-white rounded-3xl border border-[#E2DDD3] shadow-xs overflow-hidden">
          <div className="p-4 border-b border-neutral-150 flex items-center justify-between bg-neutral-50/50">
            <h3 className="font-bold text-sm text-neutral-900">Execution History Logs</h3>
            <span className="text-xs text-neutral-500">Atomic execution records with exit codes & output</span>
          </div>

          {executions.length === 0 ? (
            <div className="p-10 text-center text-neutral-400 text-xs">
              No executions recorded yet. Schedule or manually trigger an automation to see execution history here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-150 bg-neutral-50/80 text-neutral-500 font-semibold">
                    <th className="py-3 px-4">Job Name</th>
                    <th className="py-3 px-4">Action Type</th>
                    <th className="py-3 px-4">Scheduled / Triggered</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Exit Code</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-150">
                  {executions.map((exec) => {
                    const isSuccess = exec.status === "Successful";
                    const isFailed = exec.status === "Failed";
                    const isRunning = exec.status === "Running";

                    return (
                      <tr key={exec.id} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="py-3 px-4 font-bold text-neutral-900">
                          {exec.jobTitle || "Automated Job"}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-[11px] bg-neutral-100 px-2 py-0.5 rounded-md text-neutral-700">
                            {exec.actionType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-600">
                          {exec.startedAt ? new Date(exec.startedAt).toLocaleString() : new Date(exec.scheduledAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${isSuccess ? "bg-emerald-100 text-emerald-800" : isFailed ? "bg-rose-100 text-rose-800" : isRunning ? "bg-blue-100 text-blue-800 animate-pulse" : "bg-neutral-100 text-neutral-700"}`}>
                            {exec.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-neutral-600">
                          {exec.exitCode !== null && exec.exitCode !== undefined ? exec.exitCode : "--"}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => setSelectedExecutionLog(exec)}
                            className="px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                          >
                            View Log
                          </button>
                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => handleRetryExecution(exec.id)}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* TAB 4: SCHEDULED AUTOMATIONS (CRON JOBS, SCRIPTS, TRASHING) */
        <div className="space-y-3">
          {jobs.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-[#E2DDD3]">
              <div className="w-14 h-14 rounded-2xl bg-[#F5F3ED] text-neutral-400 flex items-center justify-center mx-auto mb-3">
                <Clock size={26} />
              </div>
              <h3 className="font-black text-base text-neutral-900 mb-1">No automations configured yet</h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto mb-4">
                Create scheduled scripts, application restarts, file retention policies, or custom cron jobs with real execution.
              </p>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="px-5 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs font-bold rounded-2xl transition-all cursor-pointer"
              >
                + Create Your First Automation
              </button>
            </div>
          ) : (
            jobs.map((job) => {
              const isPaused = job.status === "Paused";
              let payload = job.actionPayload || {};

              return (
                <div
                  key={job.id}
                  className="bg-white rounded-3xl p-5 border border-[#E2DDD3] hover:border-neutral-400 shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] flex items-center justify-center shrink-0">
                      {job.actionType === "run_script" ? <Terminal size={20} className="text-neutral-800" /> :
                       job.actionType === "delete_file" ? <Trash2 size={20} className="text-rose-600" /> :
                       job.actionType === "open_app" || job.actionType === "restart_app" ? <Laptop size={20} className="text-blue-600" /> :
                       job.actionType === "send_message" ? <FileText size={20} className="text-amber-600" /> :
                       job.actionType === "restrict_website" ? <ShieldAlert size={20} className="text-amber-600" /> :
                       <Clock size={20} className="text-neutral-700" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-black text-sm text-neutral-900 truncate">
                          {job.title}
                        </h4>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EAF7EE] text-[#22864E]">
                          {job.actionType === "run_script" ? `Script (${payload.runtime || "node"})` :
                           job.actionType === "delete_file" ? "File Deletion" :
                           job.actionType === "restart_app" ? `Restart ${payload.appName || "App"}` :
                           job.actionType === "send_message" ? `Message (${payload.channel || "Email"})` :
                           job.actionType === "restrict_website" ? `Website Limit (${payload.domain || "custom"})` :
                           job.actionType}
                        </span>
                        {job.cronExpression && (
                          <span className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-neutral-100 text-neutral-800">
                            {job.cronExpression}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-neutral-500 font-medium">
                        {job.cronDescription || (job.scheduleType === "once" ? `Run once at ${job.startDate || "due date"} ${job.startTime || ""}` : `${job.repeat} recurrence`)}
                      </p>

                      {job.nextRunAt && (
                        <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                          Next Execution: {new Date(job.nextRunAt).toLocaleString()} ({job.timezone || "Asia/Kolkata"})
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 justify-end">
                    <button
                      type="button"
                      onClick={() => handleTriggerNow(job.id)}
                      className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-black text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Trigger execution immediately"
                    >
                      <Play size={12} />
                      <span>Run Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleJob(job.id)}
                      className="px-2.5 py-1.5 rounded-xl border border-neutral-300 hover:border-neutral-900 text-neutral-700 text-xs font-semibold cursor-pointer"
                    >
                      {isPaused ? "Resume" : "Pause"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteJob(job.id)}
                      className="p-1.5 rounded-xl text-neutral-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                      title="Delete automation"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Execution Log Inspector Modal */}
      {selectedExecutionLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-[28px] w-full max-w-2xl max-h-[85vh] p-6 shadow-2xl flex flex-col border border-neutral-200">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-150">
              <div>
                <h3 className="text-lg font-black text-neutral-900">
                  Execution Log Inspector
                </h3>
                <span className="text-xs text-neutral-500 font-mono">
                  ID: {selectedExecutionLog.id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedExecutionLog(null)}
                className="w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-neutral-50 p-3 rounded-2xl border border-neutral-150">
                <div><span className="text-neutral-400">Job:</span> <strong className="text-neutral-800">{selectedExecutionLog.jobTitle}</strong></div>
                <div><span className="text-neutral-400">Status:</span> <strong className="text-neutral-800">{selectedExecutionLog.status}</strong></div>
                <div><span className="text-neutral-400">Started:</span> <span className="text-neutral-800">{selectedExecutionLog.startedAt || "--"}</span></div>
                <div><span className="text-neutral-400">Exit Code:</span> <span className="text-neutral-800 font-mono">{selectedExecutionLog.exitCode ?? "--"}</span></div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">Standard Output (stdout)</label>
                <pre className="bg-[#1C1E28] text-[#F8FAFC] p-4 rounded-2xl font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-56">
                  {selectedExecutionLog.outputLog || "(No output recorded)"}
                </pre>
              </div>

              {selectedExecutionLog.errorLog && (
                <div>
                  <label className="block text-xs font-bold text-rose-600 mb-1.5">Error Output (stderr)</label>
                  <pre className="bg-rose-950/20 text-rose-300 p-4 rounded-2xl font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-rose-900/30">
                    {selectedExecutionLog.errorLog}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-neutral-150 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedExecutionLog(null)}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Agent Pairing Modal */}
      {pairingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-[28px] w-full max-w-md p-6 sm:p-7 shadow-2xl border border-neutral-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black text-neutral-900">Pair Local Automation Agent</h3>
              <button
                type="button"
                onClick={() => setPairingModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-center py-3 bg-[#FAF8F5] rounded-2xl border border-[#E2DDD3] mb-4">
              <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">Your Temporary Pairing Code</span>
              <span className="text-3xl font-black text-neutral-900 tracking-widest font-mono mt-1 block">
                {pairingCode || "TSK-4982"}
              </span>
              <span className="text-[10px] text-neutral-400 mt-1 block">Valid for 15 minutes</span>
            </div>

            <div className="space-y-2.5 text-xs text-neutral-600 mb-5">
              <p className="font-semibold text-neutral-800">To link your computer with this Taskly workspace:</p>
              <div className="p-3 bg-neutral-900 text-white rounded-xl font-mono text-[11px] select-all">
                npm run agent pair {pairingCode || "TSK-4982"}
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Or to install the background service that launches at user login, run:
              </p>
              <div className="p-2 bg-neutral-100 text-neutral-800 rounded-xl font-mono text-[11px] select-all">
                ./agent/install-service.sh
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setPairingModalOpen(false);
                loadData();
              }}
              className="w-full py-2.5 bg-neutral-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Done & Check Status
            </button>
          </div>
        </div>
      )}

      {/* Chrome Extension Pairing Modal */}
      {extensionPairingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-[28px] w-full max-w-md p-6 sm:p-7 shadow-2xl border border-neutral-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-neutral-900">Link Chrome Extension</h3>
                  <p className="text-[11px] text-neutral-500">One-time secure authentication token</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExtensionPairingModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-500 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-center py-4 bg-[#FAF8F5] rounded-2xl border border-[#E2DDD3] mb-4">
              <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">Extension Pairing Code</span>
              <span className="text-3xl font-black text-neutral-900 tracking-widest font-mono mt-1 block select-all">
                {extensionPairingCode || "EXT-0000"}
              </span>
              <span className="text-[10px] text-neutral-400 mt-1 block">Valid for 15 minutes • Single-use exchange</span>
            </div>

            <div className="space-y-2 text-xs text-neutral-600 mb-5">
              <p className="font-semibold text-neutral-800">Quick Connection Steps:</p>
              <ol className="list-decimal list-inside space-y-1 text-neutral-600 text-[11px]">
                <li>Click the <strong>Taskly</strong> icon in your Chrome extensions bar.</li>
                <li>In the popup under <strong>Account Link</strong>, paste this code.</li>
                <li>Click <strong>Link</strong> to authorize the extension to receive rules and track quota.</li>
              </ol>
            </div>

            <button
              type="button"
              onClick={() => {
                setExtensionPairingModalOpen(false);
                loadData();
              }}
              className="w-full py-2.5 bg-neutral-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Done & Refresh Rules
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AutomationManager;
