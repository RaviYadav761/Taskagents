import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LogIn,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { supabase, supabaseConfigError, toTasklyUser } from "../../utils/supabase";

const inputClassName =
  "w-full bg-[#FAF9F6] focus:bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 outline-none focus:ring-1 focus:ring-neutral-900 shadow-2xs font-medium";

const AuthModal = ({ isOpen, onLogin, onContinueDemo, initialMode = "signin" }) => {
  const [mode, setMode] = useState(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isSignUp = mode === "signup";
  const isForgotPassword = mode === "forgot-password";
  const isRecovery = mode === "recovery";
  const isPasswordForm = !isForgotPassword;
  const title = isRecovery
    ? "Choose a new password"
    : isForgotPassword
      ? "Reset your password"
      : "Taskly Workspace";

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setSuccessMsg("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!supabase) {
      setError(supabaseConfigError);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (mode !== "recovery" && !cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        if (!fullName.trim()) throw new Error("Please enter your full name.");
        if (password.length < 8 || new TextEncoder().encode(password).length > 72) {
          throw new Error("Choose a password with at least 8 characters (maximum 72 UTF-8 bytes).");
        }

        const { data, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (authError) throw authError;

        if (data.session && data.user) {
          onLogin({ ...toTasklyUser(data.user), isNewUser: true });
        } else {
          setSuccessMsg("Account request received. Check your email for the confirmation link, then return here to sign in.");
          setMode("signin");
        }
        setPassword("");
        return;
      }

      if (isForgotPassword) {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin,
        });
        if (authError) throw authError;
        setSuccessMsg("If an account uses that email, a password-reset link will be sent. Check your inbox.");
        return;
      }

      if (isRecovery) {
        if (password.length < 8 || new TextEncoder().encode(password).length > 72) {
          throw new Error("Choose a password with at least 8 characters (maximum 72 UTF-8 bytes).");
        }
        if (password !== confirmPassword) throw new Error("The passwords do not match.");

        const { data, error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        const user = toTasklyUser(data.user);
        if (!user) throw new Error("Your account could not be verified. Request a new reset link.");
        onLogin(user);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      if (!password) throw new Error("Please enter your password.");
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (authError) throw authError;
      const user = toTasklyUser(data.user);
      if (!user) throw new Error("The authentication provider did not return a valid account.");
      onLogin(user);
      setPassword("");
    } catch (authError) {
      setError(authError.message || "Authentication failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl border border-neutral-150 max-h-[92vh] overflow-y-auto no-scrollbar">
        <div className="text-center mb-6 relative">
          <div className="w-12 h-12 rounded-2xl bg-neutral-900 text-white mx-auto flex items-center justify-center shadow-md mb-3">
            <Sparkles size={22} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-neutral-900 tracking-tight">{title}</h2>
          <p className="text-xs text-neutral-500 mt-1 font-medium">
            {isRecovery
              ? "Set a new password for your Taskly account."
              : isForgotPassword
                ? "Enter your email and we’ll send a secure reset link."
                : isSignUp
                  ? "Create an account with your email and password."
                  : "Sign in to access your Taskly workspace."}
          </p>
        </div>

        {!isForgotPassword && !isRecovery && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#FAF9F6] rounded-2xl border border-neutral-200 mb-6">
            <button
              type="button"
              onClick={() => changeMode("signin")}
              className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                !isSignUp ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => changeMode("signup")}
              className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                isSignUp ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {supabaseConfigError && (
          <div role="status" className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
            Sign-in is temporarily unavailable because this website has not been connected to its authentication project.
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label htmlFor="taskly-full-name" className="block text-xs font-bold text-neutral-700 mb-1.5">
                Full Name *
              </label>
              <input
                id="taskly-full-name"
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Alex Morgan"
                className={inputClassName}
                maxLength={100}
                autoComplete="name"
                required
              />
            </div>
          )}

          {!isRecovery && (
            <div>
              <label htmlFor="taskly-email" className="block text-xs font-bold text-neutral-700 mb-1.5">
                Email Address *
              </label>
              <input
                id="taskly-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className={inputClassName}
                autoComplete="email"
                required
              />
            </div>
          )}

          {isPasswordForm && (
            <div>
              <label htmlFor="taskly-password" className="block text-xs font-bold text-neutral-700 mb-1.5">
                {isRecovery ? "New Password *" : "Password *"}
              </label>
              <input
                id="taskly-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className={inputClassName}
                autoComplete={isSignUp ? "new-password" : isRecovery ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </div>
          )}

          {isRecovery && (
            <div>
              <label htmlFor="taskly-confirm-password" className="block text-xs font-bold text-neutral-700 mb-1.5">
                Confirm New Password *
              </label>
              <input
                id="taskly-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Enter the new password again"
                className={inputClassName}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          )}

          {!isSignUp && !isForgotPassword && !isRecovery && (
            <div className="-mt-2 text-right">
              <button
                type="button"
                onClick={() => changeMode("forgot-password")}
                className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !supabase}
            className="w-full mt-2 py-3 bg-neutral-900 hover:bg-black disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <span>Please wait…</span>
            ) : isSignUp ? (
              <><UserPlus size={15} /><span>Create Account</span></>
            ) : isForgotPassword ? (
              <span>Send Reset Link</span>
            ) : isRecovery ? (
              <span>Save New Password</span>
            ) : (
              <><LogIn size={15} /><span>Sign In to Taskly</span></>
            )}
          </button>
        </form>

        {(isForgotPassword || isRecovery) && (
          <button
            type="button"
            onClick={() => changeMode("signin")}
            className="mt-4 text-xs font-semibold text-neutral-600 hover:text-neutral-900 flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
          >
            <ArrowLeft size={13} /> Back to sign in
          </button>
        )}

        {!isForgotPassword && !isRecovery && (
          <div className="mt-5 pt-4 border-t border-neutral-150 text-center">
            <p className="text-[11px] text-neutral-400 mb-2">Want to test with sample project data first?</p>
            <button
              type="button"
              onClick={onContinueDemo}
              className="text-xs font-bold text-neutral-700 hover:text-black flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer"
            >
              <span>Continue with Demo Workspace</span>
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
