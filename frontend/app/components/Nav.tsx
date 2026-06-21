import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { api } from "~/lib/api";

const GearSvg = ({ stroke = "#000" }: { stroke?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth="2.5"
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

type NavProps =
  | { variant: "dashboard" }
  | { variant: "back"; backTo: string; backLabel: string }
  | { variant: "settings" }
  | { variant: "discover"; pendingCount: number };

export function Nav(props: NavProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    api.health.check().then((res) => setVersion(res.version)).catch(() => {});
  }, []);

  useEffect(() => {
    api.profile.get().then((res) => setDisplayName(res.display_name)).catch(() => {});
  }, []);
  if (props.variant === "settings") {
    return (
      <nav className="nav" style={{ display: "flex", justifyContent: "space-between" }}>
        <NavLink to="/" className="wordmark">
          <span className="dot" />
          RENDURE
        </NavLink>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="crumbs">
            PROFILE · <b>{displayName ?? "..."}</b>
          </span>
          <button
            className="gear"
            style={{ background: "var(--black)" }}
            aria-label="Settings (active)"
          >
            <GearSvg stroke="#fff" />
          </button>
        </div>
      </nav>
    );
  }

  const leftSlot =
    props.variant === "back" ? (
      <NavLink to={props.backTo} className="back mono">
        ← {props.backLabel}
      </NavLink>
    ) : props.variant === "discover" ? (
      <span className="crumbs">
        <b>DISCOVER</b> · {props.pendingCount} PENDING
      </span>
    ) : (
      <span className="crumbs">
        <b>DASHBOARD</b> · {version ? `v${version}` : ""}
      </span>
    );

  return (
    <nav className="nav">
      <div className="left-slot">{leftSlot}</div>
      <NavLink to="/" className="wordmark">
        <span className="dot" />
        RENDURE
      </NavLink>
      <div className="right-slot">
        <NavLink to="/discover" className="discover-nav-link mono">
          DISCOVER
        </NavLink>
        <NavLink to="/settings" className="gear" aria-label="Settings">
          <GearSvg />
        </NavLink>
      </div>
    </nav>
  );
}
