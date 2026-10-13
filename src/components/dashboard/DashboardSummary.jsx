import React, { useState, useEffect } from "react";
import StatCard from "./StatCard";
import TaskFocusTimer from "../analytics/TaskFocusTimer";
import {
  ListTodo,
  Clock,
  CheckCircle2,
  CalendarClock,
  TrendingUp,
  Plus,
  Bot,
  ShieldAlert,
  Globe,
  Coffee,
  Lock,
  CheckCircle,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { YoutubeIcon, InstagramIcon } from "../common/BrandIcons";
import { api } from "../../utils/api";

const DashboardSummary = ({
  tasks = [],
  focusTimer,
  onStartTimer,
  onPauseTimer,
  onResetTimer,
  onSelectDuration,
  onSelectTimerTask,
  focusStats,
  onCompleteEarly,
  onOpenCreateModal,
  onOpenChatbot,
  onFilterChange,
  onToggleStatus
}) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "Completed").length;
  const pending = tasks.filter((t) => t.status !== "Completed").length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const todayCount = tasks.filter(
    (t) => t.dueDate === todayStr && t.status !== "Completed"
  ).length;

  const highPriorityPending = tasks.filter(
    (t) => t.priority?.includes("High") && t.status !== "Completed"
  ).length;

  const mediumPriorityPending = tasks.filter(
    (t) => t.priority?.includes("Medium") && t.status !== "Completed"
  ).length;

  const lowPriorityPending = tasks.filter(
    (t) => (t.priority?.includes("Low") || !t.priority) && t.status !== "Completed"
  ).length;

  // Phase 2: Live Website Usage Rules & Synchronized Counters
  const [siteLimits, setSiteLimits] = useState([]);
  const [loadingLimits, setLoadingLimits] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const fetchLimits = async () => {
    try {
      setLoadingLimits(true);
      const data = await api.getSiteLimits();
      if (data && data.limits) {
        setSiteLimits(data.limits);
        setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch (e) {
      // Offline fallback
    } finally {
      setLoadingLimits(false);
    }
  };

  useEffect(() => {
    fetchLimits();
    const timer = setInterval(fetchLimits, 8000);
    return () => clearInterval(timer);
  }, []);

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
    <div className="space-y-6 mb-8">
      {/* 1. PERSISTENT TASK FOCUS TIMER */}
      <TaskFocusTimer
        tasks={tasks}
        onToggleStatus={onToggleStatus}
        focusTimer={focusTimer}
        onStartTimer={onStartTimer}
        onPauseTimer={onPauseTimer}
        onResetTimer={onResetTimer}
        onSelectDuration={onSelectDuration}
        onSelectTimerTask={onSelectTimerTask}
        focusStats={focusStats}
        onCompleteEarly={onCompleteEarly}
      />

      {/* 2. Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Tasks"
          value={total}
          subtitle="All assignments & tasks"
          icon={ListTodo}
          colorClass="bg-neutral-100 text-neutral-800"
          onClick={() => onFilterChange && onFilterChange("all")}
        />

        <StatCard
          title="Pending Tasks"
          value={pending}
          subtitle={`${highPriorityPending} High • ${mediumPriorityPending} Medium`}
          icon={Clock}
          colorClass="bg-amber-50 text-amber-600"
          onClick={() => onFilterChange && onFilterChange("pending")}
        />

        <StatCard
          title="Completed"
          value={completed}
          subtitle={`${completionRate}% overall rate`}
          icon={CheckCircle2}
          colorClass="bg-emerald-50 text-emerald-600"
          onClick={() => onFilterChange && onFilterChange("completed")}
        />

        <StatCard
          title="Due Today"
          value={todayCount}
          subtitle={todayCount > 0 ? "Requires action today" : "No urgent due today"}
          icon={CalendarClock}
          colorClass="bg-rose-50 text-rose-600"
          onClick={() => onFilterChange && onFilterChange("today")}
        />
      </div>

      {/* 3. Phase 2: Live Website Usage & Habit Restriction Dashboard Card */}
      {siteLimits.length > 0 && (
        <div className="bg-white border border-[#E2DDD3] p-5 sm:p-6 rounded-3xl shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-neutral-150">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <ShieldAlert size={17} />
              </div>
              <div>
                <h3 className="text-sm font-black text-neutral-900 tracking-tight">
                  Website Mindful Usage & Restrictions
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Real-time active-tab usage synchronized with Taskly Extension
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-neutral-500">
              {lastSyncTime && (
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Synced: {lastSyncTime}</span>
                </span>
              )}
              <button
                onClick={fetchLimits}
                className="p-1.5 text-neutral-500 hover:text-black rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer"
                title="Refresh Counters"
              >
                <RefreshCw size={13} className={loadingLimits ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {siteLimits.map((lim) => {
              const allowance = lim.dailyAllowanceSeconds || 0;
              const used = lim.usedTodaySeconds || 0;
              const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
              const isBlocked = lim.isBlocked;
              const isInBreak = lim.isInBreak;

              let statusBadge = (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Allowed
                </span>
              );

              if (isInBreak) {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                    <Coffee size={10} /> In Break
                  </span>
                );
              } else if (isBlocked) {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                    <Lock size={10} /> Blocked
                  </span>
                );
              } else if (!lim.isEnabled) {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-600">
                    Paused
                  </span>
                );
              }

              const isYt = lim.domain.includes("youtube");
              const isIg = lim.domain.includes("instagram");

              return (
                <div
                  key={lim.id}
                  className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3]/80 flex flex-col justify-between transition-all hover:shadow-xs"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isYt ? (
                        <div className="w-6 h-6 rounded-lg bg-red-600 text-white flex items-center justify-center">
                          <YoutubeIcon size={13} />
                        </div>
                      ) : isIg ? (
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center">
                          <InstagramIcon size={13} />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-lg bg-neutral-900 text-white flex items-center justify-center">
                          <Globe size={13} />
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-black text-neutral-900 leading-tight">
                          {lim.displayName || lim.domain}
                        </div>
                        <div className="text-[10px] text-neutral-500 leading-tight">
                          {lim.domain}
                        </div>
                      </div>
                    </div>
                    {statusBadge}
                  </div>

                  {/* Usage Progress */}
                  <div className="my-2">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-semibold text-neutral-700">
                        {formatSeconds(used)} used
                      </span>
                      <span className="text-neutral-500">
                        {allowance > 0 ? `${formatSeconds(allowance)} cap` : "No daily cap"}
                      </span>
                    </div>
                    {allowance > 0 && (
                      <div className="w-full h-2 bg-neutral-200/80 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            pct >= 100
                              ? "bg-rose-500"
                              : pct >= 80
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        ></div>
                      </div>
                    )}
                  </div>

                  {/* Subtext info */}
                  <div className="pt-2 border-t border-neutral-200/50 flex flex-col gap-1 text-[10px] text-neutral-500">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-neutral-700">
                        {lim.scheduleWindowEnabled || lim.restrictionType === "schedule"
                          ? `🕒 ${lim.scheduleStartTime || "09:00"}–${lim.scheduleEndTime || "12:00"} (${
                              lim.outsideWindowPolicy === "block_outside" ? "Allowed" : "Restricted"
                            })`
                          : lim.restrictionType === "today_only"
                          ? "📵 Today Only Block"
                          : lim.dailyQuotaEnabled !== false && lim.dailyAllowanceSeconds > 0
                          ? `⏳ ${Math.round(lim.dailyAllowanceSeconds / 60)}m Daily Quota`
                          : "Custom Policy"}
                      </span>
                      <span className="font-semibold text-neutral-600">
                        {lim.breaksCountToday > 0 ? `${lim.breaksCountToday} breaks taken` : "0 breaks"}
                      </span>
                    </div>
                    {lim.blockedReason && isBlocked && (
                      <div className="text-[9.5px] text-rose-600 font-medium truncate">
                        🔒 {lim.blockedReason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Overall Task Completion Progress Banner */}
      <div className="bg-white border border-neutral-200/90 p-6 sm:p-7 rounded-3xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex-1 w-full">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <TrendingUp size={17} className="text-neutral-900" />
              <span className="text-xs font-black text-neutral-900 uppercase tracking-wider">
                Overall Task Completion Progress
              </span>
            </div>
            <span className="text-xs font-black text-neutral-900">
              {completionRate}% ({completed}/{total} Completed)
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-3 bg-neutral-100 rounded-full overflow-hidden p-0.5 border border-neutral-200">
            <div
              className="h-full bg-gradient-to-r from-neutral-900 via-neutral-800 to-emerald-500 rounded-full transition-all duration-500 shadow-xs"
              style={{ width: `${completionRate}%` }}
            ></div>
          </div>

          {/* Priority Breakdown Badges: High, Medium, Low */}
          <div className="mt-4 pt-3.5 border-t border-neutral-150 flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-neutral-700">
              Priority Status:
            </span>

            {/* High Priority Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <span>High: {highPriorityPending}</span>
              <span className="text-[10px] text-rose-500 font-medium">pending</span>
            </div>

            {/* Medium Priority Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Medium: {mediumPriorityPending}</span>
              <span className="text-[10px] text-amber-500 font-medium">pending</span>
            </div>

            {/* Low Priority Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Low: {lowPriorityPending}</span>
              <span className="text-[10px] text-emerald-500 font-medium">pending</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
          <button
            onClick={onOpenCreateModal}
            className="flex-1 md:flex-none px-5 py-2.5 bg-neutral-900 hover:bg-black text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer hover:scale-102"
          >
            <Plus size={15} />
            <span>Add Task</span>
          </button>

          <button
            onClick={onOpenChatbot}
            className="flex-1 md:flex-none px-4 py-2.5 bg-[#FAF9F6] hover:bg-white border border-neutral-200 text-neutral-800 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
          >
            <Bot size={15} className="text-neutral-700" />
            <span>Ask Smart Bot</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardSummary;
