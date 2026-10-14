import React, { useState, useRef } from "react";
import {
  X,
  Image as ImageIcon,
  Calendar,
  Clock,
  Target,
  FileText,
  Plus,
  Trash2,
  List,
  AlignLeft,
  ChevronDown,
  Zap,
  Terminal,
  Laptop,
  Globe,
  Mail,
  Bell,
  RotateCw,
  ShieldAlert
} from "lucide-react";
import { describeCron, validateCron, calculateNextRunPreview, CRON_PRESETS, TIMEZONES } from "../../utils/cronUtils";
import { parseAndNormalizeWebsite } from "../../utils/urlHelper";
import { api } from "../../utils/api";
import { WebsiteIcon, WebsiteIdentityBadge } from "../common/BrandIcons";

const PRESET_IMAGES = [
  {
    label: "Dumbbell",
    src: "/assets/dumbbell.jpg",
    defaultName: "Gym Workout",
    defaultGoal: "Stay fit and healthy",
    defaultHeader: "Full body workout",
    defaultPoints: [
      "10 min warm up",
      "30 min strength training",
      "10 min cardio",
      "10 min cool down",
    ],
  },
  {
    label: "Books",
    src: "/assets/books.jpg",
    defaultName: "Reading Book",
    defaultGoal: "Expand knowledge & mindfulness",
    defaultHeader: "Evening reading session",
    defaultPoints: [
      "Read chapters 4 & 5",
      "Highlight key concepts",
      "Reflect on core takeaways",
    ],
  },
  {
    label: "Laptop",
    src: "/assets/laptop.jpg",
    defaultName: "Product Development",
    defaultGoal: "Review Sprint Goals & Architecture",
    defaultHeader: "Project review",
    defaultPoints: [
      "Verify Taskly UI matching modern standards",
      "Review smart chatbot responses",
      "Check interactive canvas and workflow",
    ],
  },
  {
    label: "Shopping",
    src: "/assets/shopping.jpg",
    defaultName: "Grocery Shopping",
    defaultGoal: "Purchase weekly essentials",
    defaultHeader: "Shopping list",
    defaultPoints: [
      "Organic fruits & protein shakes",
      "Notebooks & stationery supplies",
      "Review list before checkout",
    ],
  },
];

const ACTION_TYPES = [
  { id: "standard", label: "Standard Task", icon: Clock },
  { id: "run_script", label: "Run Local Script", icon: Terminal },
  { id: "open_app", label: "Open Application", icon: Laptop },
  { id: "restart_app", label: "Restart Application", icon: RotateCw },
  { id: "open_url", label: "Open Website", icon: Globe },
  { id: "delete_file", label: "Delete File After Delay (30 Days)", icon: Trash2 },
  { id: "restrict_website", label: "Website Restriction (YouTube/Instagram)", icon: ShieldAlert },
  { id: "send_message", label: "Send Scheduled Message", icon: Mail },
  { id: "notification", label: "Desktop Reminder / Alert", icon: Bell },
];

const CreateTaskModal = ({ isOpen, onClose, onAddTask }) => {
  const todayISO = new Date().toISOString().split("T")[0];

  const [taskName, setTaskName] = useState("");
  const [selectedImage, setSelectedImage] = useState("/assets/dumbbell.jpg");

  // Date states
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [dateDisplay, setDateDisplay] = useState("Today");

  // Time states (24-hour internal strings)
  const [startTime, setStartTime] = useState("18:00"); // 6:00 PM
  const [endTime, setEndTime] = useState("19:00"); // 7:00 PM

  // Repeat & Cron state
  const [repeat, setRepeat] = useState("Daily");
  const [cronExpr, setCronExpr] = useState("30 8 * * *");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [missedPolicy, setMissedPolicy] = useState("run_once"); // 'run_once' | 'skip' | 'require_confirmation'

  // Action & Automation state
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

  // Phase 2: Dynamic Website Restriction State (Separate Schedule Window + Usage Allowance Settings)
  const [websiteUrl, setWebsiteUrl] = useState("https://www.youtube.com/");
  const [websiteScope, setWebsiteScope] = useState("entire_domain"); // 'entire_domain' | 'hostname_only'
  const [restrictionType, setRestrictionType] = useState("combined"); // 'combined' | 'cycle' | 'today_only' | 'schedule' | 'daily_limit' | 'date_range'
  const [scheduleWindowEnabled, setScheduleWindowEnabled] = useState(false);
  const [outsideWindowPolicy, setOutsideWindowPolicy] = useState("block_outside"); // 'block_outside' | 'block_inside' | 'allow_outside_no_count'
  const [dailyQuotaEnabled, setDailyQuotaEnabled] = useState(true);
  const [cycleBreaksEnabled, setCycleBreaksEnabled] = useState(true);
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [websiteActiveMinutes, setWebsiteActiveMinutes] = useState(10);
  const [websiteBreakMinutes, setWebsiteBreakMinutes] = useState(10);
  const [websiteDailyMaxMinutes, setWebsiteDailyMaxMinutes] = useState(180);
  const [websiteScheduleStart, setWebsiteScheduleStart] = useState("09:00");
  const [websiteScheduleEnd, setWebsiteScheduleEnd] = useState("12:00");
  const [websiteActiveDays, setWebsiteActiveDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [websiteStartDate, setWebsiteStartDate] = useState(todayISO);
  const [websiteEndDate, setWebsiteEndDate] = useState(todayISO);

  // Goal state
  const [goal, setGoal] = useState("");

  // Notes states
  const [notesMode, setNotesMode] = useState("points"); // 'text' | 'points'
  const [notesHeader, setNotesHeader] = useState("Full body workout");
  const [points, setPoints] = useState([
    "10 min warm up",
    "30 min strength training",
    "10 min cardio",
    "10 min cool down",
  ]);
  const [notesText, setNotesText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const createRequestId = useRef(null);

  // Element refs for triggering pickers
  const fileInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const startTimeInputRef = useRef(null);
  const endTimeInputRef = useRef(null);

  if (!isOpen) return null;

  // Convert 24-hr (HH:mm) to 12-hr format (e.g., "6:00 PM")
  const formatTime12h = (time24) => {
    if (!time24) return "--:-- --";
    const [hStr, mStr] = time24.split(":");
    let h = parseInt(hStr, 10);
    const m = mStr || "00";
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    h = h ? h : 12;
    return `${h}:${m} ${ampm}`;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setSelectedImage(event.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePresetSelect = (preset) => {
    setSelectedImage(preset.src);
    if (!taskName) setTaskName(preset.defaultName);
    if (!goal) setGoal(preset.defaultGoal);
    if (notesHeader === "Full body workout" || !notesHeader) setNotesHeader(preset.defaultHeader);
    if (notesMode === "points" && points.length <= 4) setPoints(preset.defaultPoints);
  };

  const handleDateChange = (e) => {
    const val = e.target.value;
    setSelectedDate(val);
    if (!val) {
      setDateDisplay("Today");
      return;
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    if (val === todayStr) {
      setDateDisplay("Today");
    } else if (val === tomorrowStr) {
      setDateDisplay("Tomorrow");
    } else {
      const [y, m, d] = val.split("-");
      setDateDisplay(`${d}/${m}/${y}`);
    }
  };

  const handleOpenDatePicker = () => {
    if (dateInputRef.current) {
      try {
        if (typeof dateInputRef.current.showPicker === "function") {
          dateInputRef.current.showPicker();
        } else {
          dateInputRef.current.focus();
        }
      } catch {
        dateInputRef.current.focus();
      }
    }
  };

  const handleOpenStartTime = () => {
    if (startTimeInputRef.current) {
      try {
        if (typeof startTimeInputRef.current.showPicker === "function") {
          startTimeInputRef.current.showPicker();
        } else {
          startTimeInputRef.current.focus();
        }
      } catch {
        startTimeInputRef.current.focus();
      }
    }
  };

  const handleOpenEndTime = () => {
    if (endTimeInputRef.current) {
      try {
        if (typeof endTimeInputRef.current.showPicker === "function") {
          endTimeInputRef.current.showPicker();
        } else {
          endTimeInputRef.current.focus();
        }
      } catch {
        endTimeInputRef.current.focus();
      }
    }
  };

  const handleQuickDateSelect = (type) => {
    if (type === "today") {
      setSelectedDate(todayISO);
      setDateDisplay("Today");
    } else if (type === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];
      setSelectedDate(tomorrowStr);
      setDateDisplay("Tomorrow");
    }
  };

  // If action type is 30-day file deletion, auto-calculate 30-day target date
  const handleActionSelect = (type) => {
    setActionType(type);
    if (type === "delete_file") {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 30);
      const iso = targetDate.toISOString().split("T")[0];
      setSelectedDate(iso);
      setDateDisplay(`30 Days (${targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`);
      setRepeat("Doesn't repeat");
      if (!taskName) setTaskName("Scheduled File Deletion");
      if (!goal) setGoal("Safely delete selected file after 30-day retention period");
    } else if (type === "restrict_website") {
      if (!taskName) setTaskName("Habit & Website Control");
      if (!goal) setGoal("Enforce daily usage limit & focus breaks");
    } else if (type === "send_message") {
      if (!taskName) setTaskName("Scheduled Message");
      if (!goal) setGoal("Send authorized notification at scheduled time");
    } else if (type === "run_script") {
      if (!taskName) setTaskName("Automated Script Task");
      if (!goal) setGoal("Execute local maintenance script");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = taskName.trim() || (actionType !== "standard" ? "Automated Task" : "New Task");

    let finalNotes = "";
    let finalHeader = notesHeader.trim();
    let finalBulletPoints = [];

    if (notesMode === "points") {
      finalBulletPoints = points.map((p) => p.trim()).filter(Boolean);
      if (finalBulletPoints.length === 0 && finalHeader) {
        finalBulletPoints = [finalHeader];
      }
      finalNotes = finalBulletPoints.join("\n");
    } else {
      finalNotes = notesText.trim();
      finalBulletPoints = [];
    }

    const startFormatted = formatTime12h(startTime);
    const endFormatted = formatTime12h(endTime);
    let timeString = "6:00 PM – 7:00 PM";
    if (startFormatted && endFormatted) {
      timeString = `${startFormatted} – ${endFormatted}`;
    } else if (startFormatted) {
      timeString = startFormatted;
    }

    // Auto category
    let category = "Work & Projects";
    if (actionType === "standard") {
      if (selectedImage.includes("dumbbell") || name.toLowerCase().includes("gym") || name.toLowerCase().includes("workout")) {
        category = "Health & Fitness";
      } else if (selectedImage.includes("books") || name.toLowerCase().includes("read")) {
        category = "Personal Growth";
      } else if (selectedImage.includes("shopping") || name.toLowerCase().includes("shop")) {
        category = "Personal";
      }
    }

    // Schedule type
    let scheduleType = "once";
    let finalCron = null;

    if (repeat === "Custom Cron Expression") {
      scheduleType = "cron";
      finalCron = cronExpr.trim();
    } else if (repeat === "Daily") {
      scheduleType = "daily";
    } else if (repeat === "Weekly") {
      scheduleType = "weekly";
    } else if (repeat === "Monthly") {
      scheduleType = "monthly";
    } else if (repeat === "Weekdays") {
      scheduleType = "weekdays";
    } else {
      scheduleType = "once";
    }

    let normalizedWebsite = null;
    if (actionType === "restrict_website") {
      normalizedWebsite = parseAndNormalizeWebsite(websiteUrl, websiteScope);
      if (!normalizedWebsite.valid) {
        setSubmitError(`Website Validation Error: ${normalizedWebsite.error}`);
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

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await api.checkHealth();
      if (!createRequestId.current) createRequestId.current = crypto.randomUUID();
      const res = await api.createJob({
        clientRequestId: createRequestId.current,
        title: name,
        category,
        priority: actionType !== "standard" ? "High Priority" : "Medium Priority",
        actionType,
        actionPayload,
        scheduleType,
        cronExpression: finalCron,
        timezone,
        startDate: selectedDate || todayISO,
        startTime: startTime || "18:00",
        missedPolicy,
        repeat: repeat || "Daily",
        goal: goal.trim() || (actionType !== "standard" ? `Execute ${actionType}` : "Stay fit and healthy"),
        notes: finalNotes,
        notesHeader: finalHeader,
        bulletPoints: finalBulletPoints,
        image: selectedImage || "/assets/laptop.jpg",
      });

      if (!res?.job || (actionType === "restrict_website" && !res.siteLimit)) {
        throw new Error("The server did not confirm both the task and website rule. The form remains open; check the backend before retrying.");
      }
      onAddTask(res.job);
      if (actionType === "restrict_website") {
        console.info("[Taskly] API persistence confirmed; extension synchronization/enforcement is not yet verified.");
      }
      onClose();
      createRequestId.current = null;

      // Reset form on success
      setTaskName("");
      setGoal("");
      setActionType("standard");
    } catch (err) {
      console.error("Task creation failed:", err);
      const message = err.message || "Failed to save automation task. Please check server connection.";
      setSubmitError(/Network failure before an HTTP response|Backend could not be reached/i.test(message)
        ? `${message} The save outcome is unknown because no response arrived. Retry this unchanged form safely; the request is idempotent.`
        : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cronValidation = repeat === "Custom Cron Expression" ? validateCron(cronExpr) : { valid: true };
  const humanCronDesc = repeat === "Custom Cron Expression" ? describeCron(cronExpr) : "";
  const nextRunPreview = repeat === "Custom Cron Expression" ? calculateNextRunPreview(cronExpr, timezone) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-[24px] sm:rounded-[32px] w-full max-w-lg shadow-2xl p-5 sm:p-7 text-neutral-900 relative max-h-[92vh] overflow-y-auto no-scrollbar border border-neutral-100">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-2xl font-black text-neutral-900 tracking-tight">
              Create Task & Automation
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Standard tasks, cron triggers, local scripts, and habit controls
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Action / Automation Type Selector */}
          <div>
            <label className="block text-sm font-semibold text-neutral-900 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Zap size={15} className="text-amber-500" />
                <span>Action & Automation Type</span>
              </span>
              <span className="text-[11px] text-neutral-400 font-normal">Optional execution</span>
            </label>
            <div className="relative">
              <select
                value={actionType}
                onChange={(e) => handleActionSelect(e.target.value)}
                className="w-full bg-[#F4F4F6] hover:bg-[#EEEDF0] text-neutral-900 rounded-xl px-4 py-3 text-sm font-semibold outline-none appearance-none cursor-pointer pr-10 transition-colors"
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={18}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
              />
            </div>
          </div>

          {/* Conditional Action Fields matching exact Taskly design */}
          {actionType === "run_script" && (
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
                <Terminal size={14} className="text-neutral-600" />
                <span>Script Configuration (Executed safely via Local Agent)</span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Target Script Path</label>
                <input
                  type="text"
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  placeholder="/Users/name/scripts/backup.sh or ./maintenance.py"
                  className="w-full bg-white text-xs font-mono rounded-xl px-3 py-2.5 border border-neutral-200 outline-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Runtime</label>
                  <select
                    value={runtime}
                    onChange={(e) => setRuntime(e.target.value)}
                    className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                  >
                    <option value="node">Node.js</option>
                    <option value="python3">Python 3</option>
                    <option value="bash">Bash / Shell</option>
                    <option value="zsh">Zsh</option>
                    <option value="ruby">Ruby</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Arguments</label>
                  <input
                    type="text"
                    value={scriptArgs}
                    onChange={(e) => setScriptArgs(e.target.value)}
                    placeholder="--flag value"
                    className="w-full bg-white text-xs rounded-xl px-3 py-2 border border-neutral-200 outline-none font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {actionType === "delete_file" && (
            <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-200/60 space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                <Trash2 size={14} />
                <span>Scheduled Local File Deletion (30-Day Retention Policy)</span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Full Path to File</label>
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/Users/ravi/Downloads/temp-archive.zip"
                  className="w-full bg-white text-xs font-mono rounded-xl px-3 py-2.5 border border-neutral-200 outline-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Retention Delay (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={retentionDays}
                    onChange={(e) => {
                      const d = Number(e.target.value) || 30;
                      setRetentionDays(d);
                      const target = new Date();
                      target.setDate(target.getDate() + d);
                      setSelectedDate(target.toISOString().split("T")[0]);
                    }}
                    className="w-full bg-white text-xs font-bold rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permanentDelete}
                      onChange={(e) => setPermanentDelete(e.target.checked)}
                      className="rounded"
                    />
                    <span>Permanent Delete (Skip Trash)</span>
                  </label>
                </div>
              </div>
              <p className="text-[10px] text-neutral-500 leading-tight">
                Files are safely moved to operating system Trash by default. Protected system paths (/, /System, /usr, /bin) are strictly rejected.
              </p>
            </div>
          )}

          {actionType === "restrict_website" && (
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-3.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
                  <ShieldAlert size={15} className="text-amber-600" />
                  <span>Dynamic Website Restriction & Mindful Usage</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  Extension Enforced
                </span>
              </div>

              {/* Website URL Input */}
              <div>
                <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                  Website URL or Domain
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="e.g. https://www.youtube.com/, https://web.whatsapp.com/, reddit.com"
                    className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2.5 border border-neutral-200 outline-none focus:border-neutral-900 transition-colors"
                    required
                  />
                </div>
                {/* Real-time URL validation badge & website identity preview */}
                {(() => {
                  const check = parseAndNormalizeWebsite(websiteUrl, websiteScope);
                  if (check.valid) {
                    return (
                      <div className="mt-2 space-y-1.5 animate-in fade-in">
                        <WebsiteIdentityBadge domain={check.normalizedDomain} scope={websiteScope} />
                      </div>
                    );
                  }
                  return (
                    <div className="mt-1.5 text-[11px] text-rose-600 font-medium">
                      ⚠️ {check.error}
                    </div>
                  );
                })()}
              </div>

              {/* Scope Selection */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWebsiteScope("entire_domain")}
                  className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                    websiteScope === "entire_domain"
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <div className="font-bold">Entire Domain</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Matches all subdomains (*.site.com)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setWebsiteScope("hostname_only")}
                  className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                    websiteScope === "hostname_only"
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <div className="font-bold">Approved Host Only</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Strictly this exact host e.g. web.whatsapp.com</div>
                </button>
              </div>

              {/* Restriction Profile Selector */}
              <div>
                <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                  Restriction Profile
                </label>
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
                  className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2.5 border border-neutral-200 outline-none"
                >
                  <option value="combined">🎯 Schedule Window + Daily Allowance + Breaks (Combined)</option>
                  <option value="cycle">⏱️ Usage Cycle with Break (e.g. 10m watch / 10m break / 3h cap)</option>
                  <option value="schedule">🕒 Allowed Schedule Window (e.g. 8:00 PM – 10:00 PM only)</option>
                  <option value="daily_limit">⏳ Daily Usage Quota (e.g. 20 min cap per day)</option>
                  <option value="today_only">📵 Immediate Lock For Today (Expires at midnight)</option>
                  <option value="date_range">🗓️ One-Time / Date-Range Restriction</option>
                </select>
              </div>

              {restrictionType === "today_only" ? (
                <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-3 text-xs text-amber-900">
                  <div className="font-bold flex items-center gap-1.5 mb-1">
                    <span>📵 Immediate Lock For Today</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    Access to this website will be locked immediately and will automatically expire at local midnight in {timezone}. It will NOT repeat tomorrow.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Setting 1: Schedule Window */}
                  <div className="bg-white p-3 rounded-xl border border-neutral-100 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleWindowEnabled}
                        onChange={(e) => setScheduleWindowEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">
                        🕒 Schedule Window Setting
                      </span>
                    </label>

                    {scheduleWindowEnabled && (
                      <div className="pt-1 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Start Time</label>
                            <input
                              type="time"
                              value={websiteScheduleStart}
                              onChange={(e) => setWebsiteScheduleStart(e.target.value)}
                              className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">End Time</label>
                            <input
                              type="time"
                              value={websiteScheduleEnd}
                              onChange={(e) => setWebsiteScheduleEnd(e.target.value)}
                              className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Outside Window Policy</label>
                          <select
                            value={outsideWindowPolicy}
                            onChange={(e) => setOutsideWindowPolicy(e.target.value)}
                            className="w-full text-xs font-semibold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                          >
                            <option value="block_outside">Allowed Window: Block access outside {websiteScheduleStart} – {websiteScheduleEnd}</option>
                            <option value="block_inside">Restricted Hours: Block access during {websiteScheduleStart} – {websiteScheduleEnd}</option>
                            <option value="allow_outside_no_count">Free Outside: Count usage quota only during {websiteScheduleStart} – {websiteScheduleEnd}</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-1">Active Days</label>
                          <div className="flex gap-1.5">
                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName, idx) => {
                              const active = websiteActiveDays.includes(idx);
                              return (
                                <button
                                  key={dayName}
                                  type="button"
                                  onClick={() => {
                                    if (active) {
                                      if (websiteActiveDays.length > 1) {
                                        setWebsiteActiveDays(websiteActiveDays.filter((d) => d !== idx));
                                      }
                                    } else {
                                      setWebsiteActiveDays([...websiteActiveDays, idx]);
                                    }
                                  }}
                                  className={`flex-1 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-colors ${
                                    active ? "bg-neutral-900 text-white" : "bg-[#F4F4F6] text-neutral-600 hover:bg-neutral-200"
                                  }`}
                                >
                                  {dayName[0]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Setting 2: Daily Allowance Quota */}
                  <div className="bg-white p-3 rounded-xl border border-neutral-100 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyQuotaEnabled}
                        onChange={(e) => setDailyQuotaEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">
                        ⏳ Daily Total Allowance Quota
                      </span>
                    </label>

                    {dailyQuotaEnabled && (
                      <div className="pt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="720"
                          value={websiteDailyMaxMinutes}
                          onChange={(e) => setWebsiteDailyMaxMinutes(e.target.value)}
                          className="w-28 text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                        />
                        <span className="text-xs text-neutral-600 font-medium">
                          minutes allowance per day ({Math.round((websiteDailyMaxMinutes / 60) * 10) / 10} hours)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Setting 3: Active Cycle & Breaks */}
                  <div className="bg-white p-3 rounded-xl border border-neutral-100 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cycleBreaksEnabled}
                        onChange={(e) => setCycleBreaksEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">
                        ⏱️ Active Use Cycle with Rest Breaks
                      </span>
                    </label>

                    {cycleBreaksEnabled && (
                      <div className="pt-1 grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Active Viewing Interval</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={websiteActiveMinutes}
                            onChange={(e) => setWebsiteActiveMinutes(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                          />
                          <span className="text-[9px] text-neutral-400">minutes of continuous use</span>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Break Duration</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={websiteBreakMinutes}
                            onChange={(e) => setWebsiteBreakMinutes(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                          />
                          <span className="text-[9px] text-neutral-400">minutes break timer</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Setting 4: Date Range */}
                  <div className="bg-white p-3 rounded-xl border border-neutral-100 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dateRangeEnabled}
                        onChange={(e) => setDateRangeEnabled(e.target.checked)}
                        className="rounded accent-neutral-900"
                      />
                      <span className="text-[11px] font-bold text-neutral-800">
                        🗓️ Enforce Only on Specific Dates
                      </span>
                    </label>

                    {dateRangeEnabled && (
                      <div className="pt-1 grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">Start Date</label>
                          <input
                            type="date"
                            value={websiteStartDate}
                            onChange={(e) => setWebsiteStartDate(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-neutral-600 mb-0.5">End Date</label>
                          <input
                            type="date"
                            value={websiteEndDate}
                            onChange={(e) => setWebsiteEndDate(e.target.value)}
                            className="w-full text-xs font-bold bg-[#F4F4F6] rounded-lg px-2.5 py-1.5 outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-neutral-500 leading-tight">
                Synced with Taskly Chrome Extension. Uses active-tab tracking (idle/hidden tabs are not counted).
              </p>
            </div>
          )}

          {(actionType === "open_app" || actionType === "restart_app") && (
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-2 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
                <Laptop size={14} className="text-blue-600" />
                <span>Application Configuration</span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Installed Application Name</label>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="e.g. Safari, Calculator, Terminal, VS Code"
                  className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2.5 border border-neutral-200 outline-none"
                  required
                />
              </div>
            </div>
          )}

          {actionType === "send_message" && (
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
                <Mail size={14} className="text-amber-600" />
                <span>Scheduled Message (Official API Integration)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Channel</label>
                  <select
                    value={messageChannel}
                    onChange={(e) => setMessageChannel(e.target.value)}
                    className="w-full bg-white text-xs font-semibold rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                  >
                    <option value="Email">Email (SMTP / Nodemailer)</option>
                    <option value="Webhook">Webhook (Discord/Telegram)</option>
                    <option value="Reminder">Prepared Draft Reminder</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Recipient</label>
                  <input
                    type="text"
                    value={messageRecipient}
                    onChange={(e) => setMessageRecipient(e.target.value)}
                    placeholder="user@example.com or Webhook URL"
                    className="w-full bg-white text-xs rounded-xl px-3 py-2 border border-neutral-200 outline-none"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Message Body</label>
                <textarea
                  rows={2}
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  placeholder="Enter message to send at scheduled time..."
                  className="w-full bg-white text-xs rounded-xl p-2.5 border border-neutral-200 outline-none resize-none"
                  required
                />
              </div>
            </div>
          )}

          {/* Task Name */}
          <div>
            <label className="block text-sm font-semibold text-neutral-900 mb-1.5">
              Task Name
            </label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="e.g. Gym Workout, Database Backup, or Daily Review"
              className="w-full bg-[#F4F4F6] text-neutral-900 placeholder:text-neutral-400 rounded-xl px-4 py-3.5 border-none outline-none text-sm font-medium focus:ring-2 focus:ring-neutral-900/10 transition-all"
              autoFocus
            />
          </div>

          {/* Image Upload / Picker */}
          <div>
            <label className="block text-sm font-semibold text-neutral-900 mb-1.5">
              Image
            </label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-neutral-300 rounded-2xl p-3 flex items-center justify-between bg-white hover:bg-neutral-50 transition-colors cursor-pointer group"
            >
              {selectedImage ? (
                <div className="flex items-center gap-3 w-full">
                  <div className="w-12 h-12 rounded-xl bg-[#F5F3ED] overflow-hidden flex items-center justify-center p-1 shrink-0 border border-neutral-200">
                    <img src={selectedImage} alt="Selected" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <span className="text-xs font-bold text-neutral-800 block truncate">Image Selected</span>
                    <span className="text-[11px] text-neutral-400">Click to change</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-1 text-xs font-semibold text-neutral-600">
                  <ImageIcon size={16} />
                  <span>Choose custom image</span>
                </div>
              )}
            </div>

            {/* Presets */}
            <div className="mt-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[11px] font-semibold text-neutral-400 shrink-0">Presets:</span>
              {PRESET_IMAGES.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer shrink-0 ${
                    selectedImage === preset.src
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700"
                  }`}
                >
                  <img src={preset.src} alt={preset.label} className="w-3.5 h-3.5 object-contain rounded-full" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Date & Time Picker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold text-neutral-900">Date</label>
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleQuickDateSelect("today")}
                    className={`px-2 py-0.5 rounded-full font-medium cursor-pointer ${dateDisplay === "Today" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickDateSelect("tomorrow")}
                    className={`px-2 py-0.5 rounded-full font-medium cursor-pointer ${dateDisplay === "Tomorrow" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}
                  >
                    Tomorrow
                  </button>
                </div>
              </div>
              <div
                onClick={handleOpenDatePicker}
                className="bg-[#F4F4F6] hover:bg-[#EEEDF0] rounded-xl px-3.5 py-3 flex items-center justify-between text-sm text-neutral-900 cursor-pointer relative"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar size={16} className="text-neutral-500 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-900 truncate">{dateDisplay}</span>
                </div>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={selectedDate}
                  onChange={handleDateChange}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  tabIndex={-1}
                />
              </div>
            </div>

            {/* Time */}
            <div>
              <label className="block text-sm font-semibold text-neutral-900 mb-1.5">
                Execution Time
              </label>
              <div className="flex items-center gap-1.5">
                <div
                  onClick={handleOpenStartTime}
                  className="flex-1 bg-[#F4F4F6] hover:bg-[#EEEDF0] rounded-xl px-3 py-3 flex items-center justify-between text-sm text-neutral-900 cursor-pointer relative"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Clock size={15} className="text-neutral-500 shrink-0" />
                    <span className="text-xs font-semibold">{formatTime12h(startTime)}</span>
                  </div>
                  <input
                    ref={startTimeInputRef}
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    tabIndex={-1}
                  />
                </div>
                <span className="text-neutral-400 text-xs font-bold">–</span>
                <div
                  onClick={handleOpenEndTime}
                  className="flex-1 bg-[#F4F4F6] hover:bg-[#EEEDF0] rounded-xl px-3 py-3 flex items-center justify-between text-sm text-neutral-900 cursor-pointer relative"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Clock size={15} className="text-neutral-500 shrink-0" />
                    <span className="text-xs font-semibold">{formatTime12h(endTime)}</span>
                  </div>
                  <input
                    ref={endTimeInputRef}
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    tabIndex={-1}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Repeat & Cron Scheduler */}
          <div>
            <label className="block text-sm font-semibold text-neutral-900 mb-1.5">
              Repeat & Recurrence Schedule
            </label>
            <div className="relative">
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="w-full bg-[#F4F4F6] hover:bg-[#EEEDF0] text-neutral-900 rounded-xl px-4 py-3 text-sm font-semibold outline-none appearance-none cursor-pointer pr-10 transition-colors"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Weekdays">Weekdays (Mon–Fri)</option>
                <option value="Custom Cron Expression">Custom Cron Expression (Minute, Hour, Day, Month, Weekday)</option>
                <option value="Doesn't repeat">Doesn't repeat (One-time only)</option>
              </select>
              <ChevronDown
                size={18}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
              />
            </div>
          </div>

          {/* Phase 4: Cron Job Scheduler Custom Configuration */}
          {repeat === "Custom Cron Expression" && (
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD3] space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-neutral-900 tracking-tight flex items-center gap-1.5">
                  <Clock size={14} className="text-neutral-700" />
                  <span>5-Field Standard Cron Expression</span>
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">Min Hr Dom Mon Dow</span>
              </div>

              <div>
                <input
                  type="text"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="30 8 * * * (At 8:30 AM every day)"
                  className="w-full bg-white text-xs font-mono font-bold rounded-xl px-3.5 py-2.5 border border-neutral-300 outline-none tracking-wider"
                  required
                />
                {!cronValidation.valid ? (
                  <p className="text-[11px] text-rose-600 mt-1 font-semibold">{cronValidation.error}</p>
                ) : (
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-xs font-bold text-emerald-700">✓ {humanCronDesc}</p>
                    {nextRunPreview && (
                      <p className="text-[11px] text-neutral-500">
                        Next Run: <strong className="text-neutral-800">{nextRunPreview}</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Presets */}
              <div>
                <span className="text-[11px] font-semibold text-neutral-500 block mb-1">Common Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.expr}
                      type="button"
                      onClick={() => setCronExpr(p.expr)}
                      className="px-2 py-1 rounded-lg bg-white hover:bg-neutral-100 border border-neutral-200 text-[11px] font-medium text-neutral-700 cursor-pointer transition-colors"
                      title={p.desc}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timezone & Missed Policy */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-neutral-200">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Timezone</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full bg-white text-xs rounded-xl px-2.5 py-1.5 border border-neutral-200 outline-none"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.id} value={tz.id}>{tz.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Missed Job Policy</label>
                  <select
                    value={missedPolicy}
                    onChange={(e) => setMissedPolicy(e.target.value)}
                    className="w-full bg-white text-xs rounded-xl px-2.5 py-1.5 border border-neutral-200 outline-none"
                  >
                    <option value="run_once">Run once on recovery</option>
                    <option value="skip">Skip missed execution</option>
                    <option value="require_confirmation">Require confirmation</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Goal */}
          <div>
            <label className="block text-sm font-semibold text-neutral-900 mb-1.5">
              Goal
            </label>
            <div className="bg-[#F4F4F6] rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-neutral-900">
              <Target size={18} className="text-neutral-500 shrink-0" />
              <input
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What do you want to achieve? (e.g. Stay fit, Run backup)"
                className="bg-transparent border-none outline-none text-sm text-neutral-900 font-medium w-full placeholder:text-neutral-400"
              />
            </div>
          </div>

          {/* Notes (Text vs Points Toggle) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-neutral-900">
                Notes
              </label>
              <div className="bg-[#EFEFEF] p-0.5 rounded-xl flex items-center text-xs font-semibold border border-neutral-200">
                <button
                  type="button"
                  onClick={() => setNotesMode("text")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    notesMode === "text" ? "bg-black text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  <AlignLeft size={13} />
                  <span>Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNotesMode("points")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    notesMode === "points" ? "bg-black text-white shadow-xs" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  <List size={13} />
                  <span>Points</span>
                </button>
              </div>
            </div>

            {notesMode === "text" ? (
              <div className="space-y-2">
                <div className="bg-[#F4F4F6] rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-sm text-neutral-900">
                  <FileText size={16} className="text-neutral-400 shrink-0" />
                  <input
                    type="text"
                    value={notesHeader}
                    onChange={(e) => setNotesHeader(e.target.value)}
                    placeholder="Heading / Subject (optional)"
                    className="bg-transparent border-none outline-none text-xs text-neutral-900 font-semibold w-full placeholder:text-neutral-400"
                  />
                </div>
                <div className="bg-[#F4F4F6] rounded-xl p-3.5 min-h-[90px]">
                  <textarea
                    rows={3}
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    placeholder="Write detailed notes here..."
                    className="bg-transparent border-none outline-none text-xs text-neutral-900 font-medium w-full placeholder:text-neutral-400 resize-none leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="bg-[#F4F4F6] rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-sm text-neutral-900">
                  <FileText size={16} className="text-neutral-400 shrink-0" />
                  <input
                    type="text"
                    value={notesHeader}
                    onChange={(e) => setNotesHeader(e.target.value)}
                    placeholder="Plan heading"
                    className="bg-transparent border-none outline-none text-xs text-neutral-900 font-semibold w-full placeholder:text-neutral-400"
                  />
                </div>
                <div className="bg-[#F4F4F6] rounded-xl p-3 space-y-2 max-h-[160px] overflow-y-auto no-scrollbar">
                  {points.map((pt, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 shadow-2xs border border-neutral-100">
                      <span className="w-5 h-5 rounded-full bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={pt}
                        onChange={(e) => {
                          const next = [...points];
                          next[idx] = e.target.value;
                          setPoints(next);
                        }}
                        className="bg-transparent border-none outline-none text-xs text-neutral-900 font-medium w-full"
                        placeholder="Step description"
                      />
                      {points.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPoints(points.filter((_, i) => i !== idx))}
                          className="w-5 h-5 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-red-500 flex items-center justify-center shrink-0"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPoints([...points, ""])}
                    className="w-full py-1.5 border border-dashed border-neutral-300 rounded-lg text-xs font-semibold text-neutral-600 hover:bg-white flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Add Point</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {submitError && (
            <div className="mb-3 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between shadow-2xs animate-in fade-in">
              <span className="flex items-center gap-2">
                <span>⚠️</span>
                <span>{submitError}</span>
              </span>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="text-rose-600 hover:text-rose-800 font-bold ml-2 text-sm cursor-pointer"
              >
                ×
              </button>
            </div>
          )}

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || (repeat === "Custom Cron Expression" && !cronValidation.valid)}
              className="w-full py-3.5 bg-black hover:bg-neutral-800 disabled:bg-neutral-400 text-white font-bold rounded-2xl transition-all shadow-md text-sm cursor-pointer"
            >
              {isSubmitting
                ? "Saving & Syncing..."
                : actionType !== "standard"
                ? "Save & Activate Automation"
                : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTaskModal;
