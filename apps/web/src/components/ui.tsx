"use client";
import { clsx } from "clsx";
import { X, Loader2, Search, Inbox } from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Btn({ className, variant = "primary", size = "md", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "ghost" && "text-gray-600 hover:bg-gray-100",
        variant === "outline" && "border border-gray-300 text-gray-700 hover:bg-gray-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: string; action?: ReactNode }) {
  return (
    <div className={clsx("rounded-xl border border-gray-200 bg-white shadow-sm", className)}>
      {title && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputCls, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputCls, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputCls, "min-h-20", className)} {...props} />;
}

const badgeColors: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-blue-100 text-blue-700",
  brand: "bg-brand-100 text-brand-700",
  purple: "bg-purple-100 text-purple-700",
};

export function Badge({ color = "gray", children }: { color?: keyof typeof badgeColors; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", badgeColors[color])}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, keyof typeof badgeColors> = {
    active: "green",
    completed: "green",
    paid: "green",
    sent: "green",
    present: "green",
    published: "green",
    pending: "amber",
    partial: "amber",
    late: "amber",
    scheduled: "amber",
    viewed: "blue",
    submitted: "blue",
    draft: "gray",
    absent: "red",
    failed: "red",
    overdue: "red",
    cancelled: "red",
    suspended: "red",
    excused: "purple",
    inactive: "gray",
    waitlisted: "purple",
    graded: "purple",
    dropped: "gray",
    refunded: "purple",
    approved: "green",
    rejected: "red",
    left: "gray",
  };
  return <Badge color={map[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 justify-center text-sm text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function Empty({ label = "Nothing here yet", icon = true }: { label?: string; icon?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-sm text-gray-400">
      {icon && <Inbox className="h-8 w-8 text-gray-300" />}
      {label}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className={clsx("mt-10 w-full rounded-xl bg-white shadow-xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} className={clsx(inputCls, "pl-9")} />
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-gray-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
