# Taskly: Task Management & Cron Automation Platform
**TYCS SEM 5 Project Submission**

### Student Details
- **Name:** Ravi Avdesh Yadav
- **Roll No:** 47
- **Class / Semester:** TYCS SEM 5 (Third Year Computer Science)
- **Academic Year:** 2025–2026

---

## 📌 Architecture Overview

Taskly has been upgraded into a real, multi-tier automation platform while strictly preserving the signature warm cream design, 3D line stack, and navigation aesthetic:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. REACT FRONTEND (Vite, React 19, Tailwind CSS v4)         │
│    - Taskly Dashboard, 3D Stack, Detail Card, Calendar      │
│    - Create/Edit Task Modals with Cron & Automation Actions │
│    - Automation Manager, Execution History & Live Metrics   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JWT
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BACKEND API & PERSISTENCE (Node.js, Express, SQLite)     │
│    - Multi-user authentication & account data isolation     │
│    - Real SQLite storage (users, jobs, executions, devices) │
│    - Cloud scheduler (recurring messages, alerts, webhooks) │
│    - Device pairing API with revocable bearer tokens        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Pairing Token & Heartbeat
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LOCAL AUTOMATION AGENT (Node.js daemon, better-sqlite3)   │
│    - Runs in background on user's computer when tab closed  │
│    - Persistent local SQLite schedule & node-cron engine    │
│    - Reconciles schedules on reboot (run_once / skip policy)│
│    - Executes approved scripts (safe spawn, timeout limit)  │
│    - Graceful app restarts & safe 30-day file trashing      │
│    - Local IPC server (127.0.0.1:47891) for web extension   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Localhost IPC
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. BROWSER EXTENSION (Manifest V3 for Chrome/Brave/Firefox)  │
│    - Tracks active YouTube attention (10m use / 10m break)  │
│    - Enforces 3-hour daily YouTube cap until midnight reset │
│    - One-time Instagram "Today Only" block expiring at 00:00│
│    - Emergency override with confirmation dialog            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

### 1. Real Cron Job Scheduler (Phase 4)
- **5 Standard Cron Fields:** Minute (`0–59`), Hour (`0–23`), Day of Month (`1–31`), Month (`1–12`), Day of Week (`0–7`).
- **Human Descriptions & Live Preview:** Real-time translation (e.g. `30 8 * * *` → "Every day at 8:30 AM").
- **Timezones:** Configured with `Asia/Kolkata` as default.
- **Missed Job Policy:** User-configurable (`run_once`, `skip`, or `require_confirmation`) when agent starts after downtime.
- **Atomic Execution & Retirement:** One-time jobs execute once and retire; recurring jobs automatically advance to the next run date.

### 2. YouTube Usage Control (Phase 5)
- Tracks active viewing when the tab is visible and focused.
- After 10 minutes of active use, triggers a 10-minute break with video pause and countdown overlay.
- Break time does not consume the daily allowance.
- After consuming the 3-hour daily allowance, blocks YouTube until midnight reset in the configured timezone.
- Survives browser restarts via persistent storage.
- Emergency override option with confirmation dialog.

### 3. Instagram: Block Only for Today (Phase 6)
- One-time schedule for today.
- Automatically locks access until local midnight.
- Does not repeat tomorrow unless explicitly configured.

### 4. Scheduled Local File Deletion (30-Day Retention - Phase 7)
- Schedules deletion of an actual local file with a 30-day countdown.
- Persisted locally so countdown survives restarts.
- Safely moves to operating system Trash (macOS Finder Trash) by default.
- Strictly rejects protected system roots (`/`, `/System`, `/usr`, `/bin`, `/etc`, `C:\Windows`) and path traversal.

### 5. Scheduled Messaging (Phase 8)
- Dispatches messages via Email (SMTP), Webhook (Telegram/Discord), or prepared draft reminder.
- Records actual submission status and timestamp.

### 6. Scheduled Scripts & Application Actions (Phase 9)
- Run local scripts with approved runtimes (`node`, `python3`, `bash`, `sh`, `ruby`).
- Safe process invocation via `child_process.spawn` (no shell concatenation).
- Timeouts, buffer limits, exit code, stdout, and stderr logging.
- Graceful application restart (quits, waits, relaunches).

### 7. Calendar Integration (Phase 10)
- Accurately renders real occurrences on the calendar:
  - Daily tasks appear on every day.
  - Weekly tasks appear on configured weekdays.
  - Monthly tasks appear on their day of the month.
  - Custom cron jobs appear on calculated days.
  - 30-day file deletion appears on its deadline date.
  - Instagram block appears on today's date.
  - Cancelled and paused tasks are omitted.

### 8. Multi-User Security & Execution History (Phases 11 & 12)
- Multi-user authentication with bcrypt password hashing and JWT tokens.
- SQLite data isolation: users cannot view or trigger another user's jobs.
- Execution history table with atomic occurrence IDs, exit codes, output logs, and safe manual retry.

---

## 💻 How to Run Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Tests
Verify all 19 automated tests for cron parsing, execution, habit limits, security, and reconciliation:
```bash
npm test
```

### 3. Start the Backend Server (Port 4000)
```bash
npm run server
```
Server runs on `http://localhost:4000` with SQLite database initialized in `server/data/taskly.db`.

### 4. Start the Local Automation Agent
In a separate terminal:
```bash
npm run agent
```
Or to pair with your account:
```bash
npm run agent pair TSK-XXXX
```
Local agent connects to backend, syncs jobs, and exposes IPC server on `http://127.0.0.1:47891`.

To install the agent as a background login service on macOS:
```bash
./agent/install-service.sh
```

### 5. Start the React Frontend Control Panel
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 6. Load the Browser Extension
1. Open Chrome, Brave, or Edge and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in top right).
3. Click **Load unpacked**.
4. Select the `extension/` directory inside this project folder.
5. The Taskly controller icon will appear in your toolbar, monitoring YouTube usage and Instagram locks.

---

## 🛠️ Technology Stack
- **Frontend:** React 19, Vite 8, Tailwind CSS v4, Lucide React
- **Backend:** Node.js, Express, SQLite (`node:sqlite`), JWT, bcryptjs, cron-parser
- **Local Agent:** Node.js, `node-cron`, safe `child_process.spawn`, launchd service
- **Extension:** WebExtensions Manifest V3 (Chrome, Brave, Edge, Firefox)
- **Testing:** Node.js native test runner (`node:test`, `node:assert`)
