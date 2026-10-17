import { createClient } from "@supabase/supabase-js";

const env = import.meta.env || {};
const supabaseUrl = String(env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? "Taskly sign-in is not configured yet. Please try again later."
    : "";

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });

export function toTasklyUser(user) {
  if (!user?.id || !user?.email) return null;

  const metadata = user.user_metadata || {};
  const name = metadata.full_name || metadata.name || user.email.split("@")[0];

  return {
    id: user.id,
    email: user.email,
    fullName: name,
    role: "Personal Workspace",
    avatar: metadata.avatar_url || metadata.picture || "/assets/avatar.jpg",
  };
}
