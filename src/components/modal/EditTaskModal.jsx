import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Calendar,
  Clock,
  Target,
  FileText,
  Plus,
  Trash2,
  Tag,
  CheckCircle2,
  Image as ImageIcon,
  Zap,
  Terminal,
  Laptop,
  Globe,
  Mail,
  Bell,
  ShieldAlert,
  ChevronDown
} from "lucide-react";
import { CATEGORIES, PRIORITIES } from "../../data/initialTasks";
import { describeCron, validateCron, calculateNextRunPreview, CRON_PRESETS, TIMEZONES } from "../../utils/cronUtils";
import { parseAndNormalizeWebsite } from "../../utils/urlHelper";
import { api } from "../../utils/api";

const ACTION_TYPES = [
  { id: "standard", label: "Standard Task" },
  { id: "run_script", label: "Run Local Script" },
  { id: "open_app", label: "Open Application" },
  { id: "restart_app", label: "Restart Application" },
  { id: "open_url", label: "Open Website" },
  { id: "delete_file", label: "Delete File After Delay (30 Days)" },
  { id: "restrict_website", label: "Website Restriction (YouTube/Instagram)" },
  { id: "send_message", label: "Send Scheduled Message" },
  { id: "notification", label: "Desktop Reminder / Alert" },
];

const EditTaskModal = ({ isOpen, onClose, task, onUpdateTask }) => {
  const fileInputRef = useRef(null);
  const dateInputRef = useRef(null);

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [priority, setPriority] = useState("Low Priority");
  const [category, setCategory] = useState("General");
  const [status, setStatus] = useState("Pending");
  const [dueDate, setDueDate] = useState("");
  const [dateDisplay, setDateDisplay] = useState("Today");
  const [time, setTime] = useState("");
  const [repeat, setRepeat] = useState("Daily");
  const [cronExpr, setCronExpr] = useState("30 8 * * *");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [missedPolicy, setMissedPolicy] = useState("run_once");
  const [actionType, setActionType] = useState("standard");
  const [scriptPath, setScriptPath] = useState("");
  const [runtime, setRuntime] = useState("node");
  const [scriptArgs, setScriptArgs] = useState("");
  const [appName, setAppName] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://");
  const [filePath, setFilePath] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [permanentDelete, setPermanentDelete] = useState(false);
  const [messageChannel, setMessageChannel] = useState("Email");
  const [messageRecipient, setMessageRecipient] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [restrictionDomain, setRestrictionDomain] = useState("youtube.com");

  // Phase 2: Dynamic Website Restriction State
  const [websiteUrl, setWebsiteUrl] = useState("https://www.youtube.com/");
  const [websiteScope, setWebsiteScope] = useState("entire_domain");
  const [restrictionType, setRestrictionType] = useState("combined");
  const [scheduleWindowEnabled, setScheduleWindowEnabled] = useState(false);
  const [outsideWindowPolicy, setOutsideWindowPolicy] = useState("block_outside");
  const [dailyQuotaEnabled, setDailyQuotaEnabled] = useState(true);
  const [cycleBreaksEnabled, setCycleBreaksEnabled] = useState(true);
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [websiteActiveMinutes, setWebsiteActiveMinutes] = useState(10);
  const [websiteBreakMinutes, setWebsiteBreakMinutes] = useState(10);
  const [websiteDailyMaxMinutes, setWebsiteDailyMaxMinutes] = useState(180);
  const [websiteScheduleStart, setWebsiteScheduleStart] = useState("09:00");
  const [websiteScheduleEnd, setWebsiteScheduleEnd] = useState("12:00");
  const [websiteActiveDays, setWebsiteActiveDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [websiteStartDate, setWebsiteStartDate] = useState("");
  const [websiteEndDate, setWebsiteEndDate] = useState("");

  const [notesHeader, setNotesHeader] = useState("");
  const [bulletPoints, setBulletPoints] = useState([]);
  const [image, setImage] = useState("/assets/dumbbell.jpg");

  // Load task into state when opened
  useEffect(() => {
    if (task) {
      setTitle(task.title || "");
      setGoal(task.goal || "");
      setPriority(task.priority || "Low Priority");
      setCategory(task.category || "General");
      setStatus(task.status || "Pending");
      setDueDate(task.dueDate || new Date().toISOString().split("T")[0]);
      setDateDisplay(task.date || "Today");
      setTime(task.time || "6:00 PM – 7:00 PM");
      setRepeat(task.cronExpression ? "Custom Cron Expression" : (task.repeat || "Daily"));
      setCronExpr(task.cronExpression || "30 8 * * *");
      setTimezone(task.timezone || "Asia/Kolkata");
      setMissedPolicy(task.missedPolicy || "run_once");
      setActionType(task.actionType || "standard");

      const payload = task.actionPayload || {};
      setScriptPath(payload.scriptPath || "");
      setRuntime(payload.runtime || "node");
      setScriptArgs(Array.isArray(payload.args) ? payload.args.join(" ") : (payload.args || ""));
      setAppName(payload.appName || "");
      setTargetUrl(payload.url || "https://");
      setFilePath(payload.filePath || "");
      setRetentionDays(payload.retentionDays || 30);
      setPermanentDelete(Boolean(payload.permanent));
      setMessageChannel(payload.channel || "Email");
      setMessageRecipient(payload.recipient || "");
      setMessageSubject(payload.subject || "");
      setMessageContent(payload.message || "");
      setRestrictionDomain(payload.domain || "youtube.com");

      // Load Phase 2 website fields
      setWebsiteUrl(payload.websiteUrl || payload.url || (payload.domain ? `https://${payload.domain}` : "https://www.youtube.com/"));
      setWebsiteScope(payload.scope || "entire_domain");
      setRestrictionType(payload.restrictionType || "combined");
      setScheduleWindowEnabled(Boolean(payload.scheduleWindowEnabled || payload.restrictionType === "schedule"));
      setOutsideWindowPolicy(payload.outsideWindowPolicy || "block_outside");
      setDailyQuotaEnabled(payload.dailyQuotaEnabled !== false);
      setCycleBreaksEnabled(payload.cycleBreaksEnabled !== false);
      setDateRangeEnabled(Boolean(payload.startDate || payload.endDate || payload.restrictionType === "date_range"));
      setWebsiteActiveMinutes(payload.activeIntervalMinutes || (payload.activeIntervalSeconds ? Math.round(payload.activeIntervalSeconds / 60) : 10));
      setWebsiteBreakMinutes(payload.breakMinutes || (payload.breakSeconds ? Math.round(payload.breakSeconds / 60) : 10));
      setWebsiteDailyMaxMinutes(payload.dailyMaxMinutes || (payload.dailyAllowanceSeconds ? Math.round(payload.dailyAllowanceSeconds / 60) : 180));
      setWebsiteScheduleStart(payload.scheduleStartTime || "09:00");
      setWebsiteScheduleEnd(payload.scheduleEndTime || "12:00");
      setWebsiteActiveDays(payload.activeDays || [0, 1, 2, 3, 4, 5, 6]);
      setWebsiteStartDate(payload.startDate || "");
      setWebsiteEndDate(payload.endDate || "");

      setNotesHeader(task.notesHeader || "");
      setBulletPoints(Array.isArray(task.bulletPoints) ? [...task.bulletPoints] : []);
      setImage(task.image || "/assets/dumbbell.jpg");
    }
  }, [task]);

  if (!isOpen || !task) return null;

  const handlePointChange = (idx, value) => {
    setBulletPoints((prev) => {
      const copy = [...prev];
      copy[idx] = value;
      return copy;
    });
  };

  const handleAddPoint = () => {
    setBulletPoints((prev) => [...prev, "New takeaway point"]);
  };

  const handleDeletePoint = (idx) => {
    setBulletPoints((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      alert("Please enter a task title.");
      return;
    }

    const isCron = repeat === "Custom Cron Expression";
    let normalizedWebsite = null;
    if (actionType === "restrict_website") {
      normalizedWebsite = parseAndNormalizeWebsite(websiteUrl, websiteScope);
      if (!normalizedWebsite.valid) {
        alert(`Website Validation Error: ${normalizedWebsite.error}`);
        return;
      }
    }

    const actionPayload = {
      scriptPath: scriptPath.trim(),
      runtime,
      args: scriptArgs ? scriptArgs.split(" ").filter(Boolean) : [],
      appName: appName.trim(),
      url: targetUrl.trim(),
      filePath: filePath.trim(),
      retentionDays: Number(retentionDays) || 30,
      permanent: permanentDelete,
      channel: messageChannel,
      recipient: messageRecipient.trim(),
      subject: messageSubject.trim(),
      message: messageContent.trim(),
      domain: normalizedWebsite ? normalizedWebsite.normalizedDomain : restrictionDomain,
      websiteUrl: normalizedWebsite ? normalizedWebsite.originalUrl : websiteUrl.trim(),
      displayName: normalizedWebsite ? normalizedWebsite.displayName : "",
      scope: websiteScope,
      restrictionType,
      scheduleWindowEnabled,
      scheduleStartTime: websiteScheduleStart,
      scheduleEndTime: websiteScheduleEnd,
      outsideWindowPolicy,
      dailyQuotaEnabled,
      dailyMaxMinutes: Number(websiteDailyMaxMinutes) || 180,
      dailyAllowanceSeconds: (Number(websiteDailyMaxMinutes) || 180) * 60,
      cycleBreaksEnabled,
      activeIntervalMinutes: Number(websiteActiveMinutes) || 10,
      activeIntervalSeconds: (Number(websiteActiveMinutes) || 10) * 60,
      breakMinutes: Number(websiteBreakMinutes) || 10,
      breakSeconds: (Number(websiteBreakMinutes) || 10) * 60,
      activeDays: websiteActiveDays,
      startDate: dateRangeEnabled ? websiteStartDate : null,
      endDate: dateRangeEnabled ? websiteEndDate : null,
    };

    const updatedTask = {
      ...task,
      title: title.trim(),
      pillTitle: title.trim(),
      goal: goal.trim(),
      priority,
      category,
      status,
      dueDate,
      date: dateDisplay,
      time,
      repeat,
      actionType,
      actionPayload,
      scheduleType: isCron ? "cron" : repeat === "Daily" ? "daily" : repeat === "Weekly" ? "weekly" : repeat === "Monthly" ? "monthly" : repeat === "Weekdays" ? "weekdays" : "once",
      cronExpression: isCron ? cronExpr.trim() : null,
      timezone,
      missedPolicy,
      notesHeader: notesHeader.trim(),
      bulletPoints: bulletPoints.filter((pt) => pt.trim().length > 0),
      image,
      updatedAt: new Date().toISOString(),
    };

    onUpdateTask(updatedTask);

    api.updateJob(updatedTask.id, {
      title: updatedTask.title,
      category: updatedTask.category,
      priority: updatedTask.priority,
      actionType,
      actionPayload,
      scheduleType: updatedTask.scheduleType,
      cronExpression: updatedTask.cronExpression,
      timezone,
      startDate: updatedTask.dueDate,
      startTime: time ? time.split("–")[0].trim() : "18:00",
      status: updatedTask.status,
      missedPolicy,
      repeat: updatedTask.repeat,
      goal: updatedTask.goal,
      notesHeader: updatedTask.notesHeader,
      bulletPoints: updatedTask.bulletPoints,
      image: updatedTask.image,
    }).catch((err) => {
      console.warn("Backend sync notice:", err.message);
    });

    if (actionType === "restrict_website" && normalizedWebsite) {
      api.saveSiteLimitRule({
        url: normalizedWebsite.originalUrl,
        scope: normalizedWebsite.scope,
        restrictionType,
        displayName: normalizedWebsite.displayName,
        scheduleWindowEnabled,
        scheduleStartTime: websiteScheduleStart,
        scheduleEndTime: websiteScheduleEnd,
        outsideWindowPolicy,
        dailyQuotaEnabled,
        dailyAllowanceSeconds: Number(websiteDailyMaxMinutes) * 60,
        cycleBreaksEnabled,
        activeIntervalSeconds: Number(websiteActiveMinutes) * 60,
        breakSeconds: Number(websiteBreakMinutes) * 60,
        activeDays: websiteActiveDays,
        startDate: dateRangeEnabled ? (websiteStartDate || null) : null,
        endDate: dateRangeEnabled ? (websiteEndDate || null) : null,
        timezone,
        isEnabled: true,
      }).catch((err) => {
        console.warn("Notice: Site limit rule buffered offline:", err.message);
      });
    }

    onClose();
  };

  const cronValidation = repeat === "Custom Cron Expression" ? validateCron(cronExpr) : { valid: true };
  const humanCronDesc = repeat === "Custom Cron Expression" ? describeCron(cronExpr) : "";
  const nextRunPreview = repeat === "Custom Cron Expression" ? calculateNextRunPreview(cronExpr, timezone) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/50 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-xl max-h-[92vh] bg-white rounded-[24px] sm:rounded-[32px] p-5 sm:p-7 shadow-2xl border border-neutral-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-150">
          <div>
            <h2 className="text-xl font-black text-neutral-900 tracking-tight">
              Edit Task & Automation
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Update task schedule, cron triggers, notes and execution action
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-4 text-xs">
          {/* Action Type */}
          <div>
            <label className="block text-xs font-bold text-neutral-800 mb-1 flex items-center gap-1.5">
              <Zap size={14} className="text-amber-500" />
              <span>Action & Automation Type</span>
            </label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full bg-[#F4F4F6] text-neutral-900 font-semibold rounded-xl px-3 py-2.5 border-none outline-none"
            >
              {ACTION_TYPES.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          {/* Conditional Action fields */}
          {actionType === "run_script" && (
            <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-2.5">
              <span className="font-bold text-neutral-800 flex items-center gap-1.5">
                <Terminal size={14} /> Script Parameters
              </span>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Script Path</label>
                <input
                  type="text"
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  placeholder="/path/to/script.sh"
                  className="w-full bg-white font-mono rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Runtime</label>
                  <select
                    value={runtime}
                    onChange={(e) => setRuntime(e.target.value)}
                    className="w-full bg-white rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                  >
                    <option value="node">Node.js</option>
                    <option value="python3">Python 3</option>
                    <option value="bash">Bash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Arguments</label>
                  <input
                    type="text"
                    value={scriptArgs}
                    onChange={(e) => setScriptArgs(e.target.value)}
                    placeholder="args"
                    className="w-full bg-white rounded-xl px-3 py-2 border border-neutral-200 outline-none font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {actionType === "delete_file" && (
            <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-200/60 space-y-2">
              <span className="font-bold text-rose-800 flex items-center gap-1.5">
                <Trash2 size={14} /> Local File Target (Safe 30-Day Trash Deletion)
              </span>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="/path/to/file"
                className="w-full bg-white font-mono rounded-xl px-3 py-2 border border-neutral-200 outline-none"
              />
              <div className="flex items-center justify-between pt-1">
                <label className="text-[11px] text-neutral-600">Retention Days: {retentionDays}</label>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-700">
                  <input
                    type="checkbox"
                    checked={permanentDelete}
                    onChange={(e) => setPermanentDelete(e.target.checked)}
                  />
                  <span>Skip Trash (Permanent)</span>
                </label>
              </div>
            </div>
          )}

          {actionType === "restrict_website" && (
            <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-2.5">
              <span className="font-bold text-neutral-800 flex items-center gap-1.5 text-xs">
                <ShieldAlert size={14} className="text-amber-600" /> Website Restriction Rule
              </span>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Target URL</label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://www.youtube.com/"
                  className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Scope</label>
                  <select
                    value={websiteScope}
                    onChange={(e) => setWebsiteScope(e.target.value)}
                    className="w-full bg-white text-xs font-semibold rounded-lg px-2 py-1.5 border border-neutral-200 outline-none"
                  >
                    <option value="entire_domain">Entire Domain (*.site.com)</option>
                    <option value="hostname_only">Approved Host Only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Restriction Profile</label>
                  <select
                    value={restrictionType}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setRestrictionType(mode);
                      if (mode === "combined") {
                        setScheduleWindowEnabled(true);
                        setOutsideWindowPolicy("block_outside");
                        setWebsiteScheduleStart("20:00");
                        setWebsiteScheduleEnd("22:00");
                        setDailyQuotaEnabled(true);
                        setWebsiteDailyMaxMinutes(20);
                        setCycleBreaksEnabled(true);
                        setWebsiteActiveMinutes(10);
                        setWebsiteBreakMinutes(5);
                        setDateRangeEnabled(false);
                      } else if (mode === "cycle") {
                        setScheduleWindowEnabled(false);
                        setDailyQuotaEnabled(true);
                        setWebsiteDailyMaxMinutes(180);
                        setCycleBreaksEnabled(true);
                        setWebsiteActiveMinutes(10);
                        setWebsiteBreakMinutes(10);
                        setDateRangeEnabled(false);
                      } else if (mode === "schedule") {
                        setScheduleWindowEnabled(true);
                        setOutsideWindowPolicy("block_outside");
                        setDailyQuotaEnabled(false);
                        setCycleBreaksEnabled(false);
                        setDateRangeEnabled(false);
                      } else if (mode === "daily_limit") {
                        setScheduleWindowEnabled(false);
                        setDailyQuotaEnabled(true);
                        setWebsiteDailyMaxMinutes(60);
                        setCycleBreaksEnabled(false);
                        setDateRangeEnabled(false);
                      } else if (mode === "today_only") {
                        setScheduleWindowEnabled(false);
                        setDailyQuotaEnabled(false);
                        setCycleBreaksEnabled(false);
                        setDateRangeEnabled(false);
                      } else if (mode === "date_range") {
                        setScheduleWindowEnabled(false);
                        setDateRangeEnabled(true);
                      }
                    }}
                    className="w-full bg-white text-xs font-semibold rounded-lg px-2 py-1.5 border border-neutral-200 outline-none"
                  >
                    <option value="combined">🎯 Schedule Window + Daily Allowance + Breaks</option>
                    <option value="cycle">⏱️ Usage Cycle with Break</option>
                    <option value="schedule">🕒 Allowed Schedule Window</option>
                    <option value="daily_limit">⏳ Daily Usage Quota</option>
                    <option value="today_only">📵 Immediate Lock For Today</option>
                    <option value="date_range">🗓️ Date Range Restriction</option>
                  </select>
                </div>
              </div>

              {restrictionType === "today_only" ? (
                <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 text-xs text-amber-900">
                  <span className="font-bold">📵 Immediate Lock For Today</span>
                  <p className="text-[11px] mt-0.5">Expires automatically at local midnight in {timezone}.</p>
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {/* Schedule Window */}
                  <div className="bg-white p-2.5 rounded-xl border border-neutral-100 space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleWindowEnabled}
                        onChange={(e) => setScheduleWindowEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">🕒 Schedule Window</span>
                    </label>

                    {scheduleWindowEnabled && (
                      <div className="pt-1 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="block text-[9px] font-semibold text-neutral-500">Start Time</label>
                            <input
                              type="time"
                              value={websiteScheduleStart}
                              onChange={(e) => setWebsiteScheduleStart(e.target.value)}
                              className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-semibold text-neutral-500">End Time</label>
                            <input
                              type="time"
                              value={websiteScheduleEnd}
                              onChange={(e) => setWebsiteScheduleEnd(e.target.value)}
                              className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-semibold text-neutral-500">Outside Window Policy</label>
                          <select
                            value={outsideWindowPolicy}
                            onChange={(e) => setOutsideWindowPolicy(e.target.value)}
                            className="w-full text-xs font-semibold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                          >
                            <option value="block_outside">Allowed Window: Block access outside window</option>
                            <option value="block_inside">Restricted Hours: Block access during window</option>
                            <option value="allow_outside_no_count">Free Outside: Count quota only during window</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Daily Quota */}
                  <div className="bg-white p-2.5 rounded-xl border border-neutral-100 space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyQuotaEnabled}
                        onChange={(e) => setDailyQuotaEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">⏳ Daily Usage Quota</span>
                    </label>

                    {dailyQuotaEnabled && (
                      <div className="pt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="720"
                          value={websiteDailyMaxMinutes}
                          onChange={(e) => setWebsiteDailyMaxMinutes(e.target.value)}
                          className="w-24 text-xs font-bold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                        />
                        <span className="text-xs text-neutral-600 font-medium">
                          mins/day ({Math.round((websiteDailyMaxMinutes / 60) * 10) / 10} hrs)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Cycle Breaks */}
                  <div className="bg-white p-2.5 rounded-xl border border-neutral-100 space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cycleBreaksEnabled}
                        onChange={(e) => setCycleBreaksEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">⏱️ Active Cycle & Breaks</span>
                    </label>

                    {cycleBreaksEnabled && (
                      <div className="pt-1 grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="block text-[9px] font-semibold text-neutral-500">Active Viewing Interval</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={websiteActiveMinutes}
                            onChange={(e) => setWebsiteActiveMinutes(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                          />
                          <span className="text-[9px] text-neutral-400">mins active</span>
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold text-neutral-500">Break Duration</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={websiteBreakMinutes}
                            onChange={(e) => setWebsiteBreakMinutes(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2 py-1 outline-none"
                          />
                          <span className="text-[9px] text-neutral-400">mins rest</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-neutral-800 mb-1">Task Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#F4F4F6] text-neutral-900 font-bold rounded-xl px-3.5 py-2.5 border-none outline-none text-xs"
              required
            />
          </div>

          {/* Priority, Category, Status */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-[#F4F4F6] rounded-xl px-2.5 py-2 text-xs font-semibold outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#F4F4F6] rounded-xl px-2.5 py-2 text-xs font-semibold outline-none"
              >
                {CATEGORIES.filter((c) => c !== "All").map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-[#F4F4F6] rounded-xl px-2.5 py-2 text-xs font-semibold outline-none"
              >
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Paused">Paused</option>
              </select>
            </div>
          </div>

          {/* Repeat / Cron */}
          <div>
            <label className="block text-xs font-bold text-neutral-800 mb-1">Repeat & Recurrence</label>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="w-full bg-[#F4F4F6] font-semibold rounded-xl px-3 py-2 text-xs outline-none"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Weekdays">Weekdays</option>
              <option value="Custom Cron Expression">Custom Cron Expression</option>
              <option value="Doesn't repeat">Doesn't repeat</option>
            </select>
          </div>

          {repeat === "Custom Cron Expression" && (
            <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-2">
              <span className="font-bold text-neutral-800 block">5-Field Cron Expression</span>
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                className="w-full bg-white font-mono font-bold rounded-xl px-3 py-2 border border-neutral-300 outline-none"
              />
              {cronValidation.valid ? (
                <div className="space-y-0.5">
                  <span className="text-emerald-700 font-bold block">✓ {humanCronDesc}</span>
                  {nextRunPreview && <span className="text-neutral-500 block">Next: {nextRunPreview}</span>}
                </div>
              ) : (
                <span className="text-rose-600 font-semibold">{cronValidation.error}</span>
              )}
            </div>
          )}

          {/* Goal */}
          <div>
            <label className="block text-xs font-bold text-neutral-800 mb-1">Goal</label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full bg-[#F4F4F6] rounded-xl px-3 py-2 text-xs outline-none font-medium"
            />
          </div>

          {/* Notes Header & Points */}
          <div>
            <label className="block text-xs font-bold text-neutral-800 mb-1">Notes & Objectives</label>
            <input
              type="text"
              value={notesHeader}
              onChange={(e) => setNotesHeader(e.target.value)}
              placeholder="Notes Header"
              className="w-full bg-[#F4F4F6] rounded-xl px-3 py-2 text-xs outline-none font-semibold mb-2"
            />
            <div className="space-y-1.5">
              {bulletPoints.map((pt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-neutral-800 text-white flex items-center justify-center text-[10px] shrink-0">{idx + 1}</span>
                  <input
                    type="text"
                    value={pt}
                    onChange={(e) => handlePointChange(idx, e.target.value)}
                    className="flex-1 bg-white border border-neutral-200 rounded-lg px-2 py-1 text-xs outline-none"
                  />
                  <button type="button" onClick={() => handleDeletePoint(idx)} className="p-1 text-neutral-400 hover:text-rose-600"><Trash2 size={12} /></button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddPoint}
                className="w-full py-1 border border-dashed border-neutral-300 rounded-lg text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                + Add Point
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-150">
            <button
              type="submit"
              className="w-full py-3 bg-neutral-900 hover:bg-black text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditTaskModal;
