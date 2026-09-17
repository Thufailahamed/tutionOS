"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Users, Banknote, CalendarCheck, FileText, BookOpen, AlertTriangle, ArrowRight } from "lucide-react";
import { get } from "../../../src/lib/api";
import { Card, PageHeader, StatCard, Table, Spinner, StatusBadge, Badge } from "../../../src/components/ui";
import { money, date } from "../../../src/lib/format";

type Summary = {
  greeting: {
    students: number;
    newStudents30d: number;
    todayClasses: number;
    attendanceRate30d: number | null;
    outstandingCents: number;
    outstandingStudents: number;
    monthRevenueCents: number;
    pendingHomeworkSubmissions: number;
    upcomingExams: number;
  };
  todaySessions: { id: string; className: string; subjectName: string; startTime: string; endTime: string; status: string }[];
  upcoming: { id: string; className: string; subjectName: string; date: string; startTime: string }[];
  upcomingExams: { id: string; title: string; date: string; className: string }[];
  recentPayments: { id: string; receiptNo: string; studentName: string; amountCents: number; paidAt: string }[];
  recentRegistrations: { id: string; fullName: string; studentNo: string; createdAt: string }[];
};

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dash"], queryFn: () => get<Summary>("/api/dashboard/summary") });

  if (isLoading || !data) return <Spinner />;

  return (
    <div>
      <PageHeader title="Dashboard" sub="Live numbers from your workspace" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active students" value={data.greeting.students} sub={`+${data.greeting.newStudents30d} this month`} icon={<Users className="h-4 w-4 text-brand-500" />} />
        <StatCard label="Revenue this month" value={money(data.greeting.monthRevenueCents)} icon={<Banknote className="h-4 w-4 text-emerald-500" />} />
        <StatCard
          label="Outstanding fees"
          value={money(data.greeting.outstandingCents)}
          sub={data.greeting.outstandingStudents ? `${data.greeting.outstandingStudents} students owing` : "all clear"}
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        />
        <StatCard label="Attendance (30d)" value={data.greeting.attendanceRate30d != null ? `${data.greeting.attendanceRate30d}%` : "—"} icon={<CalendarCheck className="h-4 w-4 text-blue-500" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today's classes">
          {data.todaySessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No classes today</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.todaySessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm font-medium">{s.className}</div>
                    <div className="text-xs text-gray-400">
                      {s.startTime}–{s.endTime} · {s.subjectName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status} />
                    <Link href={`/attendance?session=${s.id}`} className="text-xs text-brand-600 hover:underline">
                      Mark
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Coming up">
          <ul className="space-y-2.5">
            {data.upcoming.slice(0, 3).map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-sm">
                <CalendarCheck className="h-4 w-4 shrink-0 text-brand-400" />
                <span className="flex-1">{s.className}</span>
                <span className="text-xs text-gray-400">
                  {date(s.date)} {s.startTime}
                </span>
              </li>
            ))}
            {data.upcomingExams.slice(0, 3).map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="flex-1">
                  {e.title} <span className="text-xs text-gray-400">({e.className})</span>
                </span>
                <span className="text-xs text-gray-400">{date(e.date)}</span>
              </li>
            ))}
            {data.upcoming.length === 0 && data.upcomingExams.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-400">Nothing scheduled</p>
            )}
          </ul>
          {data.greeting.pendingHomeworkSubmissions > 0 && (
            <Link href="/homework" className="mt-4 flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
              <BookOpen className="h-3.5 w-3.5" /> {data.greeting.pendingHomeworkSubmissions} homework items awaiting review <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </Card>

        <Card title="Recent payments">
          <Table head={["Receipt", "Student", "Amount", "When"]}>
            {data.recentPayments.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs">{p.receiptNo}</td>
                <td className="px-3 py-2">{p.studentName}</td>
                <td className="px-3 py-2">{money(p.amountCents)}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{date(p.paidAt)}</td>
              </tr>
            ))}
            {data.recentPayments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">
                  No payments yet
                </td>
              </tr>
            )}
          </Table>
        </Card>

        <Card title="New students">
          <Table head={["ID", "Name", "Joined"]}>
            {data.recentRegistrations.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-mono text-xs">{s.studentNo}</td>
                <td className="px-3 py-2">{s.fullName}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{date(s.createdAt)}</td>
              </tr>
            ))}
            {data.recentRegistrations.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-gray-400">
                  No students yet — <Link href="/students" className="text-brand-600">add your first</Link>
                </td>
              </tr>
            )}
          </Table>
        </Card>
      </div>
    </div>
  );
}
