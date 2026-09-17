"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  GraduationCap,
  LayoutDashboard,
  Users,
  School,
  CalendarCheck,
  Banknote,
  FileText,
  BookOpen,
  FolderOpen,
  Megaphone,
  BarChart3,
  Settings,
  ShieldCheck,
  Sparkles,
  Search,
  LogOut,
  ScrollText,
  Home,
} from "lucide-react";
import { get, post } from "../lib/api";
import type { ReactNode } from "react";

type Me = {
  user: { id: string; fullName: string; email: string | null; isSuperAdmin: boolean };
  memberships: { orgId: string; orgName: string; role: string; orgType: string }[];
  studentLinks: unknown[];
  guardianLinks: unknown[];
  member: { role: string; permissions: string[] } | null;
  orgId: string | null;
};

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/students", label: "Students", icon: Users },
  { href: "/classes", label: "Classes", icon: School },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/finance", label: "Finance", icon: Banknote },
  { href: "/exams", label: "Exams", icon: FileText },
  { href: "/homework", label: "Homework", icon: BookOpen },
  { href: "/materials", label: "Materials", icon: FolderOpen },
  { href: "/comms", label: "Communication", icon: Megaphone },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/ai", label: "AI Studio", icon: Sparkles },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/auth/me"), retry: false });
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = useMe();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-gray-400">Loading…</div>;
  }
  if (error || !data?.member) {
    if (data && !data.member && (data.studentLinks.length || data.guardianLinks.length)) {
      router.replace("/portal");
      return null;
    }
    router.replace("/login");
    return null;
  }

  const member = data.member;
  const can = (p: string) => member.permissions.includes(p);
  const nav = NAV.filter((n) => {
    if (n.href === "/finance") return can("payments.view");
    if (n.href === "/audit") return can("audit.view");
    if (n.href === "/settings") return can("settings.view") || can("org.manage") || can("members.manage");
    return true;
  });

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-brand-950 text-white">
        <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4 text-lg font-bold">
          <GraduationCap className="h-6 w-6 text-brand-300" />
          ClassFlow
        </Link>
        <div className="px-5 pb-3 text-xs text-brand-300">
          {data.memberships.find((m) => m.orgId === data.orgId)?.orgName}
          <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 capitalize">{member.role}</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  active ? "bg-white/15 font-medium text-white" : "text-brand-200 hover:bg-white/5 hover:text-white",
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
          {data.user.isSuperAdmin && (
            <Link
              href="/admin"
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                pathname.startsWith("/admin") ? "bg-white/15 font-medium" : "text-brand-200 hover:bg-white/5",
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Super admin
            </Link>
          )}
        </nav>
        <div className="border-t border-white/10 p-3">
          <Link href="/search" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-brand-200 hover:bg-white/5">
            <Search className="h-4 w-4" /> Search
          </Link>
          <Link href="/portal" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-brand-200 hover:bg-white/5">
            <Home className="h-4 w-4" /> Student portal
          </Link>
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-brand-200 hover:bg-white/5"
            onClick={async () => {
              await post("/api/auth/logout");
              qc.clear();
              router.push("/login");
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <div className="mt-2 truncate px-3 text-xs text-brand-300">{data.user.fullName}</div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
    </div>
  );
}
