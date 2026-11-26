import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import { useLocalStorage } from "../lib/hooks";
import type { ScopeIds } from "../lib/types";

/* ------------------------------------------------------------------ theme */

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const ACCENTS = ["clay", "blue", "violet", "pink", "red", "orange", "green", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export { ACCENTS };

interface AccentContextValue {
  accent: Accent;
  setAccent: (accent: Accent) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

/* ------------------------------------------------------------------ toast */

type ToastTone = "info" | "success" | "error";

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (tone: ToastTone, title: string, description?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/* -------------------------------------------------------------- workspace */

interface WorkspaceContextValue {
  email: string;
  setEmail: (email: string) => void;
  userId: string;
  setUserId: (id: string) => void;
  sessionId: string;
  newSession: () => void;
  setSessionId: (id: string) => void;
  scopes: ScopeIds;
  setScopes: (next: Partial<ScopeIds>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function createSessionId(): string {
  return `sess-${Date.now().toString(36)}`;
}

export function Providers({ children }: { children: ReactNode }) {
  /* Theme: default to the OS preference once, then persist the user's choice. */
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("everstate-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("everstate-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === "dark" ? "light" : "dark")), []);

  /* Accent */
  const [accent, setAccentState] = useLocalStorage<Accent>("everstate-accent", "clay");
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  const setAccent = useCallback((next: Accent) => setAccentState(next), [setAccentState]);

  /* Toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, tone, title, description }]);
      const timer = window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4200);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  /* Workspace */
  const [email, setEmail] = useLocalStorage<string>("everstate_user_email", "");
  const [userId, setUserIdState] = useLocalStorage<string>("everstate_user_id", "");
  const [sessionId, setSessionIdState] = useLocalStorage<string>("everstate_session_id", createSessionId());
  const [scopes, setScopesState] = useLocalStorage<ScopeIds>("everstate_scopes", {
    org_id: "org:default",
    team_id: "team:platform-eng",
    agent_id: "agent:code-reviewer",
    user_id: "user:developer",
  });

  /* Derive a sensible default user scope once the signed-in email is known. */
  useEffect(() => {
    if (!email) return;
    if (userId && !userId.startsWith("user:current")) return;
    const derived = `user:${email}`;
    setUserIdState(derived);
    setScopesState((prev) => ({ ...prev, user_id: derived }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const setUserId = useCallback(
    (id: string) => {
      setUserIdState(id);
      setScopesState((prev) => ({ ...prev, user_id: id }));
    },
    [setUserIdState, setScopesState],
  );

  const setScopes = useCallback(
    (next: Partial<ScopeIds>) => {
      setScopesState((prev) => ({ ...prev, ...next }));
    },
    [setScopesState],
  );

  const newSession = useCallback(() => setSessionIdState(createSessionId()), [setSessionIdState]);

  /* Session recovery: ask the server who we are, once. */
  useEffect(() => {
    let active = true;
    api.auth
      .me()
      .then((me) => {
        if (active && me?.email) setEmail(me.email);
      })
      .catch(() => {
        /* unauthenticated is a valid state; the gate decides */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const themeValue = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  const accentValue = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);
  const toastValue = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const workspaceValue = useMemo(
    () => ({
      email,
      setEmail,
      userId,
      setUserId,
      sessionId,
      newSession,
      setSessionId: setSessionIdState,
      scopes,
      setScopes,
    }),
    [email, setEmail, userId, setUserId, sessionId, newSession, setSessionIdState, scopes, setScopes],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <AccentContext.Provider value={accentValue}>
        <ToastContext.Provider value={toastValue}>
          <WorkspaceContext.Provider value={workspaceValue}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
              {toasts.map((item) => (
                <div key={item.id} className={`toast-item ${item.tone}`}>
                  <div className="stack" style={{ gap: 2, flex: 1 }}>
                    <strong style={{ fontSize: "var(--text-subhead)" }}>{item.title}</strong>
                    {item.description ? <span className="muted" style={{ fontSize: "var(--text-footnote)" }}>{item.description}</span> : null}
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dismiss(item.id)} aria-label="Dismiss">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </WorkspaceContext.Provider>
        </ToastContext.Provider>
      </AccentContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside Providers");
  return value;
}

export function useAccent(): AccentContextValue {
  const value = useContext(AccentContext);
  if (!value) throw new Error("useAccent must be used inside Providers");
  return value;
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside Providers");
  return value;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside Providers");
  return value;
}
