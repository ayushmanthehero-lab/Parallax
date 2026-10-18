"use client";

import { ReactNode, useEffect, useRef } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Info,
  Loader2,
  X,
} from "lucide-react";

export type Data = Record<string, any>;

export function list(value: any, keys: string[] = []): Data[] {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

export function readable(value: any): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.replaceAll("_", " ");
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return (
    value.text ||
    value.label ||
    value.title ||
    value.name ||
    value.description ||
    JSON.stringify(value)
  );
}

export function time(value: any, full = false) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(
    "en",
    full
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" },
  ).format(date);
}

export function initials(value = "") {
  return value
    .split(/[\s_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

export function Status({ value }: { value: any }) {
  const v = String(value || "pending").toLowerCase();
  const tone = /violate|mismatch|failed|error|rejected/.test(v)
    ? "coral"
    : /valid_within|resolved|complete|approved|connected|accepted|success|passed/.test(
          v,
        )
      ? "teal"
      : /unknown|pending|stale|review|not_disproved|running|open/.test(v)
        ? "amber"
        : "neutral";
  const labels: Record<string, string> = {
    violated: "Mismatch found",
    valid_within_bound: "Valid within bounds",
    not_disproved: "Search incomplete",
    unknown: "Evidence missing",
    implementation_pending: "Implementation pending",
    verification_pending: "Ready to verify",
    decision_approved: "Decision approved",
    decision_proposed: "Awaiting decision",
    not_run: "Not run yet",
  };
  return (
    <Badge tone={tone} dot>
      {labels[v] || readable(value || "pending")}
    </Badge>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-symbol" aria-hidden="true">
        <i />
        <i />
      </span>
      {!compact && (
        <span>
          PARALLAX<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  busy = false,
  icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  busy?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={`button button-${variant} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? <Loader2 size={15} className="spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  count,
  description,
  action,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>
          {title}
          {count != null && <span className="count-label">{count}</span>}
        </h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        {icon || <Database size={25} strokeWidth={1.5} />}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Loading({
  label = "Reading your workspace graph…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state">
      <Loader2 size={23} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertTriangle size={19} />
      <div>
        <strong>We couldn’t complete that request</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <Info size={17} />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current
      ?.querySelector<HTMLElement>(
        "button, input, select, textarea, [tabindex='0']",
      )
      ?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const fields = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']",
            ) || []),
          ];
          const first = fields[0],
            last = fields.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

export function JsonView({
  value,
  title = "Structured details",
  open = false,
}: {
  value: any;
  title?: string;
  open?: boolean;
}) {
  return (
    <details className="json-details" open={open}>
      <summary>
        {title}
        <ChevronRight size={14} />
      </summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function DepartmentChips({ departments }: { departments: any }) {
  return (
    <div className="department-chips">
      {list(departments).map((d, i) => (
        <span key={d.id || i}>
          <i
            style={{
              background:
                d.color || ["#517d74", "#cc755e", "#a188b0", "#d6a14c"][i % 4],
            }}
          />
          {typeof d === "string" ? readable(d) : d.name || d.title || d.id}
        </span>
      ))}
    </div>
  );
}

export function SourceType({ type }: { type?: string }) {
  return (
    <span className="source-type">
      {String(type || "document").replaceAll("_", " ")}
    </span>
  );
}

export function External({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="external-link">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}

export function Timeline({ items }: { items: Data[] }) {
  return (
    <div className="timeline">
      {items.map((item, index) => (
        <div className="timeline-item" key={item.id || index}>
          <div className="timeline-point">
            {/complete|success|approved|resolved/.test(
              item.action || item.status || "",
            ) ? (
              <Check size={12} />
            ) : (
              <Clock3 size={12} />
            )}
          </div>
          <div>
            <div className="timeline-title">
              {readable(item.title || item.action || item.tool || item.type)}
              <time>{time(item.createdAt || item.timestamp, true)}</time>
            </div>
            <p>
              {item.description ||
                item.body ||
                item.details?.message ||
                item.actor ||
                "Workspace event recorded"}
            </p>
            {item.details && (
              <JsonView value={item.details} title="Event details" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
