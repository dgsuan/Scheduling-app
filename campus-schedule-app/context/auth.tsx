import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { disablePush } from "@/lib/push";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

// Email + password accounts via Supabase Auth. Optional: without keys (or
// while signed out) the app works fully offline on this device.

/** Minimum length we ask for (Supabase's own minimum is lower). */
export const MIN_PASSWORD_LENGTH = 8;

type Result = { error?: string };

type AuthCtx = {
  configured: boolean;
  ready: boolean;
  session: Session | null;
  user: User | null;
  /** True after arriving from a password-reset email link. */
  recovering: boolean;
  signIn: (email: string, password: string) => Promise<Result>;
  signUp: (email: string, password: string) => Promise<Result & { needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<Result>;
  resendConfirmation: (email: string) => Promise<Result>;
  updatePassword: (password: string) => Promise<Result>;
};

const AuthContext = createContext<AuthCtx | null>(null);

/** Where email links should land: this site (including the GitHub Pages path). */
function redirectUrl(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  return manifest ? new URL(".", manifest.href).href : `${window.location.origin}/`;
}

/** Supabase's messages, in plain words. */
function friendly(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Sign in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Couldn't reach the server. Check your connection.";
  if (m.includes("password should be") || m.includes("weak")) return message;
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "That email address doesn't look right.";
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<Result> => {
    if (!supabase) return { error: "Accounts aren't set up in this version of the app." };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: friendly(error?.message) };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "Accounts aren't set up in this version of the app." };
    if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` };
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectUrl() },
    });
    if (error) return { error: friendly(error.message) };
    // With "Confirm email" on, there's no session until the link is clicked.
    // An already-registered email also returns no session (and no identities).
    if (data.user && data.user.identities?.length === 0)
      return { error: "An account with this email already exists. Sign in instead." };
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    // Background reminders belong to the account; stop them on this device first.
    await disablePush().catch(() => {});
    await supabase?.auth.signOut();
    setRecovering(false);
  }, []);

  const sendPasswordReset = useCallback(async (email: string): Promise<Result> => {
    if (!supabase) return { error: "Accounts aren't set up in this version of the app." };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() });
    return { error: friendly(error?.message) };
  }, []);

  const resendConfirmation = useCallback(async (email: string): Promise<Result> => {
    if (!supabase) return { error: "Accounts aren't set up in this version of the app." };
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: redirectUrl() } });
    return { error: friendly(error?.message) };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<Result> => {
    if (!supabase) return { error: "Accounts aren't set up in this version of the app." };
    if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` };
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setRecovering(false);
    return { error: friendly(error?.message) };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      configured: isSupabaseConfigured,
      ready,
      session,
      user: session?.user ?? null,
      recovering,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      resendConfirmation,
      updatePassword,
    }),
    [ready, session, recovering, signIn, signUp, signOut, sendPasswordReset, resendConfirmation, updatePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
