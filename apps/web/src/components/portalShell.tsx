"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, LogOut } from "lucide-react";
import { get, post } from "../lib/api";
import { Spinner } from "./ui";
import type { ReactNode } from "react";

export type PortalMe = {
  user: { id: string; fullName: string };
  children: {
    id: string;
    fullName: string;
    studentNo: string;
    orgName: string;
    gradeName: string | null;
    portalRole: "student" | "guardian";
  }[];
};

export function usePortalMe() {
  return useQuery({ queryKey: ["portal-me"], queryFn: () => get<PortalMe>("/api/portal/me"), retry: false });
}

export function PortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = usePortalMe();

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (error || !data || data.children.length === 0) {
    router.replace("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/portal" className="flex items-center gap-2 font-bold">
            <GraduationCap className="h-5 w-5 text-brand-600" />
            ClassFlow <span className="text-xs font-normal text-gray-400">portal</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{data.user.fullName}</span>
            <button
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              onClick={async () => {
                await post("/api/auth/logout");
                qc.clear();
                router.push("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
