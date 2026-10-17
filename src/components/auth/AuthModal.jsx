import React, { useEffect, useState } from "react";
import { LogIn, UserPlus, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { api } from "../../utils/api";

const AuthModal = ({ isOpen, onLogin, onContinueDemo }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem("taskly_registered_users");
    } catch {}
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (isSignUp && !fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (isSignUp && (password.length < 8 || password.length > 72)) {
      setError("Choose a password with at least 8 characters (maximum 72 UTF-8 bytes).");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = isSignUp
        ? await api.register(trimmedEmail, password, fullName.trim())
        : await api.login(trimmedEmail, password);

      if (!result?.user) {
        throw new Error("The authentication server did not return a valid account.");
      }

      onLogin({ ...result.user, isNewUser: isSignUp });
    } catch (err) {
      setError(err.message || "Authentication failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl border border-neutral-150 max-h-[92vh] overflow-y-auto no-scrollbar">
        {/* Brand Header */}
        <div className="text-center mb-6 relative">
          <div className="w-12 h-12 rounded-2xl bg-neutral-900 text-white mx-auto flex items-center justify-center shadow-md mb-3">
            <Sparkles size={22} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-neutral-900 tracking-tight">
            Taskly Workspace
          </h2>
          <p className="text-xs text-neutral-500 mt-1 font-medium">
            {isSignUp
              ? "Create your account for a fresh, clean workspace."
              : "Sign in to access your personal tasks, notes, and metrics."}
          </p>
        </div>

        {/* Tab Switcher: Sign In vs Create Account */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#FAF9F6] rounded-2xl border border-neutral-200 mb-6">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError("");
              setSuccessMsg("");
            }}
            className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              !isSignUp
                ? "bg-white text-neutral-900 shadow-xs"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError("");
              setSuccessMsg("");
            }}
            className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              isSignUp
                ? "bg-white text-neutral-900 shadow-xs"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Success Banner */}
        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Error message banner */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                Full Name *
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Alex Morgan"
                className="w-full bg-[#FAF9F6] focus:bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-900 shadow-2xs font-medium"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              Email Address *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-[#FAF9F6] focus:bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-900 shadow-2xs font-medium"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              Password *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#FAF9F6] focus:bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-900 shadow-2xs font-medium"
              required
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 py-3 bg-neutral-900 hover:bg-black disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 hover:scale-102"
          >
            {isSignUp ? (
              <>
                <UserPlus size={15} />
                <span>{isSubmitting ? "Creating account…" : "Create Clean Workspace"}</span>
              </>
            ) : (
              <>
                <LogIn size={15} />
                <span>{isSubmitting ? "Signing in…" : "Sign In to Taskly"}</span>
              </>
            )}
          </button>
        </form>

        {/* Demo Fast Login Option */}
        <div className="mt-5 pt-4 border-t border-neutral-150 text-center">
          <p className="text-[11px] text-neutral-400 mb-2">
            Want to test with sample project data first?
          </p>
          <button
            type="button"
            onClick={onContinueDemo}
            className="text-xs font-bold text-neutral-700 hover:text-black flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer"
          >
            <span>Continue with Demo Workspace</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
