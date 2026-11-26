import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "./BrandMark";
import { ACCENTS, useAccent, useTheme, useToast, useWorkspace, type Accent } from "../app/Providers";
import { copyText, initials } from "../lib/utils";
import { Icon, type IconName } from "./Icon";
import { Button, Field, Input, Modal, Spinner, useGlobalShortcut } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Chat & recall", icon: "message", end: true },
  { to: "/studio?s=sessions", label: "Sessions", icon: "messages" },
  { to: "/studio", label: "Memories", icon: "brain" },
  { to: "/studio?s=optimize", label: "Optimize", icon: "wand" },
  { to: "/studio?s=jobs", label: "Jobs", icon: "activity" },
];

const CONFIG_NAV: NavItem[] = [
  { to: "/studio?s=entities", label: "Entities", icon: "users" },
  { to: "/studio?s=categories", label: "Categories", icon: "tag" },
  { to: "/studio?s=ingest", label: "Ingest", icon: "upload" },
  { to: "/studio?s=extractors", label: "Extractors", icon: "cpu" },
  { to: "/studio?s=backend", label: "Backend", icon: "database" },
  { to: "/studio?s=security", label: "Security", icon: "shield" },
];

const LEARN_NAV: NavItem[] = [{ to: "/how-it-works", label: "How it works", icon: "info" }];

function isCurrent(pathname: string, search: string, item: NavItem): boolean {
  const [itemPath, itemQuery] = item.to.split("?");
  if (pathname !== itemPath) return false;
  if (itemQuery) {
    const params = new URLSearchParams(search);
    const expected = new URLSearchParams(itemQuery);
    for (const [key, value] of expected) {
      if (params.get(key) !== value) return false;
    }
    return true;
  }
  if (itemPath === "/studio") {
    const params = new URLSearchParams(search);
    const section = params.get("s");
    return !section || section === "memories";
  }
  return true;
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const location = useLocation();
  const active = isCurrent(location.pathname, location.search, item);
  const [path, query] = item.to.split("?");
  return (
    <Link
      to={query ? `${path}?${query}` : path}
      className={`sidebar-link${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon name={item.icon} size={17} />
      <span>{item.label}</span>
    </Link>
  );
}

function AccentPicker({ value, onChange }: { value: Accent; onChange: (accent: Accent) => void }) {
  return (
    <div className="row" style={{ gap: 7 }} role="radiogroup" aria-label="Accent color">
      {ACCENTS.map((accent) => (
        <button
          key={accent}
          type="button"
          role="radio"
          aria-checked={value === accent}
          aria-label={`${accent} accent`}
          className="accent-dot"
          data-accent-dot={accent}
          onClick={() => onChange(accent)}
          style={{
            inlineSize: 18,
            blockSize: 18,
            borderRadius: "999px",
            border: value === accent ? "2px solid var(--fg)" : "1px solid var(--border)",
            background:
              accent === "clay"
                ? "#d97757"
                : accent === "blue"
                ? "#2662d9"
                : accent === "violet"
                  ? "#7c3aed"
                  : accent === "pink"
                    ? "#db2777"
                    : accent === "red"
                      ? "#dc2626"
                      : accent === "orange"
                        ? "#ea580c"
                        : accent === "green"
                          ? "#16a34a"
                          : "#404040",
            boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35)",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

function ScopeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userId, setUserId, sessionId, setSessionId, newSession, scopes, setScopes, email } = useWorkspace();
  const { toast } = useToast();
  const [draftUser, setDraftUser] = useState(userId);
  const [draftSession, setDraftSession] = useState(sessionId);
  const [draftScopes, setDraftScopes] = useState(scopes);

  useEffect(() => {
    if (!open) return;
    setDraftUser(userId);
    setDraftSession(sessionId);
    setDraftScopes(scopes);
  }, [open, userId, sessionId, scopes]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Workspace scope"
      description={`Signed in as ${email || "local developer"}. Scopes decide which memories are read and written.`}
      footer={
        <>
          <Button
            variant="ghost"
            icon="copy"
            onClick={async () => {
              await copyText(JSON.stringify({ user: draftUser, session: draftSession, ...draftScopes }, null, 2));
              toast("success", "Scope copied");
            }}
          >
            Copy
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setUserId(draftUser.trim() || userId);
              setSessionId(draftSession.trim() || sessionId);
              setScopes(draftScopes);
              toast("success", "Scope updated");
              onClose();
            }}
          >
            Save scope
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="User scope" className="span-2" hint="Every recall and write is scoped to this identity.">
          <Input value={draftUser} onChange={(event) => setDraftUser(event.target.value)} placeholder="user:you@example.com" />
        </Field>
        <Field label="Session" className="span-2" hint="Turns and extractions attach to the active session.">
          <div className="row">
            <Input value={draftSession} onChange={(event) => setDraftSession(event.target.value)} />
            <Button
              icon="refresh"
              onClick={() => {
                newSession();
                onClose();
                toast("info", "New session started");
              }}
            >
              New
            </Button>
          </div>
        </Field>
        <Field label="Org">
          <Input value={draftScopes.org_id} onChange={(event) => setDraftScopes({ ...draftScopes, org_id: event.target.value })} />
        </Field>
        <Field label="Team">
          <Input value={draftScopes.team_id} onChange={(event) => setDraftScopes({ ...draftScopes, team_id: event.target.value })} />
        </Field>
        <Field label="Agent">
          <Input value={draftScopes.agent_id} onChange={(event) => setDraftScopes({ ...draftScopes, agent_id: event.target.value })} />
        </Field>
        <Field label="User entity">
          <Input value={draftScopes.user_id} onChange={(event) => setDraftScopes({ ...draftScopes, user_id: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function UserMenu({ onClose, onOpenScope }: { onClose: () => void; onOpenScope: () => void }) {
  const { email, userId } = useWorkspace();
  const { theme, toggleTheme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  return (
    <div
      className="surface"
      style={{
        position: "absolute",
        insetBlockStart: "calc(100% + 8px)",
        insetInlineEnd: 0,
        inlineSize: 268,
        padding: 8,
        zIndex: 50,
        boxShadow: "var(--shadow-float)",
        borderRadius: "var(--radius-lg)",
      }}
      role="menu"
    >
      <div className="row" style={{ padding: "8px 8px 10px", gap: 10 }}>
        <span className="avatar">{initials(email || "local")}</span>
        <div className="user-meta">
          <span className="user-name">{email || "Local developer"}</span>
          <span className="user-scope mono">{userId}</span>
        </div>
      </div>
      <hr />
      <button className="palette-item" onClick={() => { onOpenScope(); onClose(); }} role="menuitem">
        <Icon name="userCheck" size={16} />
        Workspace scope
        <span className="kbd">S</span>
      </button>
      <button className="palette-item" onClick={toggleTheme} role="menuitem">
        <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </button>
      <button className="palette-item" onClick={() => setTheme("light")} role="menuitem">
        <Icon name="sun" size={16} />
        Follow light
      </button>
      <div style={{ padding: "8px 10px 6px" }}>
        <div className="field-label" style={{ marginBottom: 7 }}>Accent</div>
        <AccentPicker value={accent} onChange={setAccent} />
      </div>
      <hr />
      <a className="palette-item" href="/logout" role="menuitem">
        <Icon name="logout" size={16} />
        Sign out
      </a>
    </div>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toggleTheme } = useTheme();
  const { newSession } = useWorkspace();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo(
    () => [
      { id: "chat", label: "Open chat & recall", icon: "message" as IconName, run: () => navigate("/") },
      { id: "memories", label: "Open memories", icon: "brain" as IconName, run: () => navigate("/studio") },
      { id: "sessions", label: "Open sessions", icon: "messages" as IconName, run: () => navigate("/studio?s=sessions") },
      { id: "optimize", label: "Open optimize", icon: "wand" as IconName, run: () => navigate("/studio?s=optimize") },
      { id: "jobs", label: "Open jobs", icon: "activity" as IconName, run: () => navigate("/studio?s=jobs") },
      { id: "ingest", label: "Open ingest", icon: "upload" as IconName, run: () => navigate("/studio?s=ingest") },
      { id: "extractors", label: "Open extractors", icon: "cpu" as IconName, run: () => navigate("/studio?s=extractors") },
      { id: "security", label: "Open security", icon: "shield" as IconName, run: () => navigate("/studio?s=security") },
      { id: "how", label: "How it works", icon: "info" as IconName, run: () => navigate("/how-it-works") },
      { id: "new-session", label: "Start a new session", icon: "refresh" as IconName, run: () => { newSession(); toast("info", "New session started"); } },
      { id: "theme", label: "Toggle theme", icon: "moon" as IconName, run: toggleTheme },
    ],
    [navigate, newSession, toast, toggleTheme],
  );

  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const execute = (command: (typeof commands)[number] | undefined) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          className="palette-input"
          autoFocus
          value={query}
          placeholder="Jump to a workspace, start a session, toggle theme…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              execute(filtered[index]);
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>No matches</div>
          ) : (
            filtered.map((command, i) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className="palette-item"
                onMouseMove={() => setIndex(i)}
                onClick={() => execute(command)}
              >
                <Icon name={command.icon} size={16} />
                {command.label}
                {i === index ? <span className="kbd">↵</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Chat & recall", sub: "Capture, consolidate, recall" },
  "/studio": { title: "Memory studio", sub: "Inspect and govern the memory bank" },
  "/how-it-works": { title: "How Everstate works", sub: "Architecture and lifecycle" },
};

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { email, userId } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useGlobalShortcut("cmd+k", () => setPaletteOpen(true));

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
    setUserOpen(false);
  }, [location.pathname, location.search]);

  const heading = TITLES[location.pathname] ?? TITLES["/"];

  useEffect(() => {
    document.title = `${location.pathname === "/studio" ? "Memory studio" : heading.title} · Everstate`;
  }, [location.pathname, heading.title]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {mobileOpen ? <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} /> : null}

      <aside className={`app-sidebar${mobileOpen ? " is-open" : ""}`} aria-label="Primary">
        <div className="brand-row">
          <NavLink to="/" className="brand" aria-label="Everstate home">
            <span className="brand-mark">
              <BrandMark size={22} />
            </span>
            <span>
              <span className="brand-name">Everstate</span>
              <span className="brand-sub">Agent memory</span>
            </span>
          </NavLink>
          <button className="btn btn-ghost btn-sm btn-icon mobile-menu-btn" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            ×
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Workspace</div>
          <nav className="sidebar-nav">
            {MAIN_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </nav>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Configure</div>
          <nav className="sidebar-nav">
            {CONFIG_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </nav>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Learn</div>
          <nav className="sidebar-nav">
            {LEARN_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </nav>
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-card">
          <div className="row-between">
            <span className="sidebar-card-title">Dream cycle</span>
            <TagDot />
          </div>
          <p className="sidebar-card-copy">
            Consolidate recent sessions into durable, scoped memories while the agents sleep.
          </p>
          <NavLink to="/?stage=extract" className="btn btn-secondary btn-sm" style={{ justifyContent: "center" }}>
            <Icon name="sparkles" size={14} />
            Run extraction
          </NavLink>
        </div>

        <div style={{ position: "relative" }}>
          <button className="sidebar-user" onClick={() => setUserOpen((prev) => !prev)} aria-haspopup="menu" aria-expanded={userOpen}>
            <span className="avatar">{initials(email || "local")}</span>
            <span className="user-meta">
              <span className="user-name">{email || "Local developer"}</span>
              <span className="user-scope mono">{userId || "user:current"}</span>
            </span>
            <Icon name="chevronDown" size={15} />
          </button>
          {userOpen ? <UserMenu onClose={() => setUserOpen(false)} onOpenScope={() => setScopeOpen(true)} /> : null}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button className="btn btn-ghost btn-sm btn-icon mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={18} />
          </button>
          <div className="topbar-title">
            <span className="topbar-heading">{location.pathname === "/studio" ? "Memory studio" : heading.title}</span>
            <span>{location.pathname === "/studio" ? "Inspect and govern the memory bank" : heading.sub}</span>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-secondary btn-sm topbar-search" onClick={() => setPaletteOpen(true)} title="Command palette">
              <Icon name="search" size={14} />
              <span className="search-label" style={{ color: "var(--fg-muted)" }}>Search</span>
              <span className="kbd" style={{ marginLeft: 2 }}>⌘K</span>
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setScopeOpen(true)} title="Workspace scope" aria-label="Workspace scope">
              <Icon name="userCheck" size={17} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"} aria-label="Toggle theme">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
            <a className="btn btn-ghost btn-sm btn-icon" href="/logout" title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={17} />
            </a>
          </div>
        </header>

        {children}

        <footer style={{ padding: "0 24px 20px", maxWidth: "var(--content-max)", margin: "0 auto", width: "100%" }}>
          <div className="row-between" style={{ fontSize: "var(--text-caption-1)", color: "var(--fg-muted)" }}>
            <span>Everstate · scoped cognitive memory for agents</span>
            <span className="mono">v1.0</span>
          </div>
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </div>
  );
}

function TagDot() {
  return (
    <span className="row" style={{ gap: 5, fontSize: "var(--text-caption-2)", color: "var(--fg-muted)" }}>
      <span className="dot live" />
      ready
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <Spinner label="Opening workspace" />
    </div>
  );
}
