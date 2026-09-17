"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../../src/lib/api";
import { Btn, Card, Field, PageHeader, Spinner, Table, Badge } from "../../../src/components/ui";
import { money, date } from "../../../src/lib/format";
import { Download } from "lucide-react";

type ReportId = "attendance" | "fees" | "exam-performance" | "enrollment" | "teacher-performance";
type Row = Record<string, unknown>;
type FeesSummary = { from: string; to: string; byMethod: { method: string; n: number; total: number }[]; collectedCents: number; outstandingCents: number };
type ReportData = { rows?: Row[]; byMethod?: FeesSummary["byMethod"]; collectedCents?: number; outstandingCents?: number; from?: string; to?: string } | Row[];

export default function Reports() {
  const [report, setReport] = useState<ReportId>("attendance");
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ["report", report, from, to],
    queryFn: () => get<ReportData>(`/api/dashboard/reports/${report}?from=${from}&to=${to}`),
  });

  const rows = Array.isArray(data) ? data : data?.rows ?? [];

  return (
    <div>
      <PageHeader title="Reports" action={
        <div className="flex gap-2">
          {(["students", "payments", "attendance"] as const).map((e) => (
            <Btn key={e} size="sm" variant="outline" onClick={() => window.open(`/api/dashboard/export/${e}`, "_blank")}>
              <Download className="h-3.5 w-3.5" /> {e} CSV
            </Btn>
          ))}
          <Btn size="sm" variant="outline" onClick={() => window.open(`/api/dashboard/reports/attendance?format=csv&from=${from}&to=${to}`, "_blank")}>
            <Download className="h-3.5 w-3.5" /> Report CSV
          </Btn>
        </div>
      } />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["attendance", "fees", "exam-performance", "enrollment", "teacher-performance"] as const).map((t) => (
          <button key={t} onClick={() => setReport(t)} className={`px-4 py-2 text-sm font-medium capitalize ${report === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>
            {t === "exam-performance" ? "Exam performance" : t === "teacher-performance" ? "Teacher performance" : t === "fees" ? "Collections" : t}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-3">
        <Field label="From"><input type="date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Card>
        {isLoading || !data ? <Spinner /> : report === "fees" ? <FeesTable data={data as FeesSummary} /> : <ReportTable report={report} rows={rows} />}
      </Card>
    </div>
  );
}

function FeesTable({ data }: { data: FeesSummary }) {
  return (
    <div className="p-4">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-emerald-50 p-4">
          <div className="text-xs font-medium uppercase text-emerald-600">Collected ({data.from} → {data.to})</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{money(data.collectedCents)}</div>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <div className="text-xs font-medium uppercase text-amber-600">Currently outstanding</div>
          <div className="mt-1 text-2xl font-bold text-amber-700">{money(data.outstandingCents)}</div>
        </div>
      </div>
      <Table head={["Method", "Payments", "Total"]}>
        {data.byMethod.map((r) => (
          <tr key={r.method}>
            <td className="px-3 py-2 font-medium capitalize">{r.method}</td>
            <td className="px-3 py-2 text-xs">{r.n}</td>
            <td className="px-3 py-2">{money(r.total)}</td>
          </tr>
        ))}
        {data.byMethod.length === 0 && <tr><td colSpan={3} className="px-3 py-10 text-center text-sm text-gray-400">No payments in range</td></tr>}
      </Table>
    </div>
  );
}

function ReportTable({ report, rows }: { report: ReportId; rows: Row[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-gray-400">No data in range</p>;
  if (report === "attendance") {
    return (
      <Table head={["Student", "Sessions", "Present", "Absent", "Late", "Excused", "Rate"]}>
        {rows.map((r) => {
          const rate = (r.total as number) ? Math.round((((r.present as number) + (r.late as number)) / (r.total as number)) * 1000) / 10 : 0;
          return (
            <tr key={r.studentId as string}>
              <td className="px-3 py-2"><div className="font-medium">{r.studentName as string}</div><div className="text-xs text-gray-400">{r.studentNo as string}</div></td>
              <td className="px-3 py-2 text-xs">{r.total as number}</td>
              <td className="px-3 py-2 text-xs">{r.present as number}</td>
              <td className="px-3 py-2 text-xs">{r.absent as number}</td>
              <td className="px-3 py-2 text-xs">{r.late as number}</td>
              <td className="px-3 py-2 text-xs">{r.excused as number}</td>
              <td className="px-3 py-2"><Badge color={rate >= 80 ? "green" : "amber"}>{rate}%</Badge></td>
            </tr>
          );
        })}
      </Table>
    );
  }
  if (report === "exam-performance") {
    return (
      <Table head={["Exam", "Class", "Date", "Avg", "Top", "Low", "Graded"]}>
        {rows.map((r) => {
          const maxMarks = (r.maxMarks as number) || 100;
          return (
            <tr key={r.examId as string}>
              <td className="px-3 py-2 font-medium">{r.title as string}</td>
              <td className="px-3 py-2 text-sm">{r.className as string}<span className="text-xs text-gray-400"> · {r.subjectName as string}</span></td>
              <td className="px-3 py-2 text-xs">{date(r.date as string)}</td>
              <td className="px-3 py-2">{Math.round(((r.avg as number) / maxMarks) * 100)}%</td>
              <td className="px-3 py-2">{Math.round(((r.maxMark as number) / maxMarks) * 100)}%</td>
              <td className="px-3 py-2">{Math.round(((r.minMark as number) / maxMarks) * 100)}%</td>
              <td className="px-3 py-2 text-xs">{r.n as number}</td>
            </tr>
          );
        })}
      </Table>
    );
  }
  if (report === "enrollment") {
    return (
      <Table head={["Class", "Subject", "Teacher", "Enrolled", "Capacity", "Dropped"]}>
        {rows.map((r) => (
          <tr key={r.classId as string}>
            <td className="px-3 py-2 font-medium">{r.className as string}</td>
            <td className="px-3 py-2 text-sm">{r.subjectName as string}</td>
            <td className="px-3 py-2 text-sm">{r.teacherName as string}</td>
            <td className="px-3 py-2"><Badge color="blue">{r.enrolled as number}</Badge></td>
            <td className="px-3 py-2 text-xs">{(r.capacity as number | null) ?? "—"}</td>
            <td className="px-3 py-2 text-xs">{r.dropped as number}</td>
          </tr>
        ))}
      </Table>
    );
  }
  return (
    <Table head={["Teacher", "Classes", "Students", "Revenue"]}>
      {rows.map((r) => (
        <tr key={r.teacherId as string}>
          <td className="px-3 py-2 font-medium">{r.teacherName as string}</td>
          <td className="px-3 py-2">{r.classCount as number}</td>
          <td className="px-3 py-2">{r.studentCount as number}</td>
          <td className="px-3 py-2">{money(r.revenue as number)}</td>
        </tr>
      ))}
    </Table>
  );
}
