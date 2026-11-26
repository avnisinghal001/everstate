import type { ReactNode } from "react";
import type { StudioState } from "../lib/types";
import { prettyJson } from "../lib/utils";
import { Icon } from "../components/Icon";
import { Banner, Button } from "../components/ui";

export interface PanelProps {
  state: StudioState;
  refresh: () => Promise<void>;
}

export function EmptyPanel({
  icon = "sparkles",
  title,
  copy,
  action,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  title: string;
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface">
      <div className="empty" style={{ padding: "44px 24px" }}>
        <span className="empty-icon">
          <Icon name={icon} size={20} />
        </span>
        <strong>{title}</strong>
        {copy ? <p>{copy}</p> : null}
        {action}
      </div>
    </div>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row-between" style={{ alignItems: "flex-start", gap: 14, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted" style={{ fontSize: "var(--text-caption-1)", minWidth: 92 }}>{label}</span>
      <span style={{ fontSize: "var(--text-subhead)", textAlign: "right", overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="code-block" style={{ maxHeight: 340 }}>{prettyJson(value)}</pre>;
}

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <Banner tone="error">
      <Icon name="alert" size={16} />
      <span style={{ flex: 1 }}>{error}</span>
      <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </Banner>
  );
}
