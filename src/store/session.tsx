import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, BACKEND_ENABLED } from "@/lib/supabase";

interface SessionState {
  ready: boolean;
  userId: string | null;
  email: string | null;
  backendEnabled: boolean;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!BACKEND_ENABLED);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUserId(data.session?.user?.id ?? null);
      setEmail(data.session?.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
      setEmail(session?.user?.email ?? null);
      setReady(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (e: string, p: string) => {
    if (!supabase) return { error: "Backend not configured." };
    const { error } = await supabase.auth.signUp({ email: e, password: p });
    return error ? { error: error.message } : {};
  }, []);
  const signIn = useCallback(async (e: string, p: string) => {
    if (!supabase) return { error: "Backend not configured." };
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
    return error ? { error: error.message } : {};
  }, []);
  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo<SessionState>(
    () => ({ ready, userId, email, backendEnabled: BACKEND_ENABLED, signUp, signIn, signOut }),
    [ready, userId, email, signUp, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
