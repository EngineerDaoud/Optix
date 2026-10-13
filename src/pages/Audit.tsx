import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { COMING_SOON_MESSAGE } from "../lib/brand";

type Role = "admin" | "user";
type Ctx = {
  session: Session | null;
  loading: boolean;
  role: Role | null;
  isAdmin: boolean;
  /** set when a signed-in email is not on the approved list (the person is signed out again) */
  denied: string | null;
  clearDenied: () => void;
};
const AuthCtx = createContext<Ctx>({
  session: null,
  loading: true,
  role: null,
  isAdmin: false,
  denied: null,
  clearDenied: () => {},
});
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // After sign-in, ask the database if this email is approved. If not: sign out right away.
  const uid = session?.user?.id ?? null;
  useEffect(() => {
    if (!uid) {
      setRole(null);
      setCheckedFor(null);
      return;
    }
    let off = false;
    supabase.rpc("my_role").then(({ data, error }) => {
      if (off) return;
      if (error || (data !== "admin" && data !== "user")) {
        setDenied(
          error
            ? `Access check failed: ${error.message}`
            : COMING_SOON_MESSAGE,
        );
        setRole(null);
        setCheckedFor(null);
        supabase.auth.signOut();
        return;
      }
      setRole(data);
      setCheckedFor(uid);
    });
    return () => {
      off = true;
    };
  }, [uid]);

  // keep showing the spinner until the approval check has finished
  const loading = booting || (!!uid && checkedFor !== uid);
  const allowedSession = !!uid && checkedFor === uid ? session : null;

  return (
    <AuthCtx.Provider
      value={{
        session: allowedSession,
        loading,
        role,
        isAdmin: role === "admin",
        denied,
        clearDenied: () => setDenied(null),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}