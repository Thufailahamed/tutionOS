"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, PageHeader, Select, Spinner, StatusBadge, Table, Badge } from "../../../src/components/ui";
import { date } from "../../../src/lib/format";
import { Bell, Check } from "lucide-react";

type SessionRow = {
  id: string; date: string; startTime: string; endTime: string; status: string;
  className: string; subjectName: string; teacherName: string | null; enrolled: number;
  counts: { present: number; absent: number; late: number; excused: number };
};

type Roster = {
  session: { id: string; date: string; startTime: string; endTime: string; status: string; className: string; subjectName: string };
  roster: { studentId: string; studentNo: string; fullName: string; record: { id: string; status: string } | null }[];
};

const STATUSES = ["present", "absent", "late", "excused"] as const;

function AttendanceInner() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10));
  const [sessionId, setSessionId] = useState(params.get("session") ?? "");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState(false);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["att-sessions", from, to],
    queryFn: () => get<SessionRow[]>(`/api/attendance/sessions?from=${from}&to=${to}`),
  });
  const { data: roster } = useQuery({
    queryKey: ["att-roster", sessionId],
    queryFn: () => get<Roster>(`/api/attendance/sessions/${sessionId}`),
    enabled: !!sessionId,
  });

  const saveMut = useMutation({
    mutationFn: () => post(`/api/attendance/sessions/${sessionId}/records${notify ? "?notify=1" : ""}`, {
      records: roster!.roster.filter((s) => marks[s.studentId]).map((s) => ({ studentId: s.studentId, status: marks[s.studentId]! })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["att-roster", sessionId] });
      qc.invalidateQueries({ queryKey: ["att-sessions"] });
      setMarks({});
    },
  });

  const markAll = (status: string) => {
    const m: Record<string, string> = {};
    for (const s of roster?.roster ?? []) m[s.studentId] = s.record ? (marks[s.studentId] ?? s.record.status ?? status) : status;
    setMarks(m);
  };

  return (
    <div>
      <PageHeader title="Attendance" sub="Mark and review session attendance" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sessions">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          {isLoading ? (
            <Spinner />
          ) : (
            <ul className="max-h-[560px] divide-y divide-gray-50 overflow-y-auto">
              {sessions!.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => { setSessionId(s.id); setMarks({}); }}
                    className={`w-full px-3 py-2.5 text-left text-sm hover:bg-gray-50 ${sessionId === s.id ? "bg-brand-50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.className}</span>
                      <Badge color={s.counts.present + s.counts.absent + s.counts.late + s.counts.excused >= s.enrolled && s.enrolled > 0 ? "green" : "amber"}>{s.counts.present + s.counts.absent + s.counts.late + s.counts.excused}/{s.enrolled}</Badge>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-xs text-gray-400">
                      <span>{date(s.date)} · {s.startTime}–{s.endTime}</span>
                      <StatusBadge status={s.status} />
                    </div>
                  </button>
                </li>
              ))}
              {sessions!.length === 0 && <li className="px-3 py-8 text-center text-sm text-gray-400">No sessions in this range</li>}
            </ul>
          )}
        </Card>

        <Card title={roster ? `Roster — ${roster.session.className}` : "Roster"}>
          {!roster ? (
            <p className="py-10 text-center text-sm text-gray-400">Pick a session to mark attendance</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-gray-500">{date(roster.session.date)} · {roster.session.startTime}</span>
                <Btn size="sm" variant="outline" onClick={() => markAll("present")}><Check className="h-3.5 w-3.5" /> All present</Btn>
              </div>
              <Table head={["Student", "Present", "Absent", "Late", "Excused"]}>
                {roster.roster.map((s) => {
                  const current = marks[s.studentId] ?? s.record?.status ?? "";
                  return (
                    <tr key={s.studentId}>
                      <td className="px-3 py-2">
                        <div className="text-sm font-medium">{s.fullName}</div>
                        <div className="text-xs text-gray-400">{s.studentNo}</div>
                      </td>
                      {STATUSES.map((st) => (
                        <td key={st} className="px-2 py-2 text-center">
                          <button
                            onClick={() => setMarks((m) => ({ ...m, [s.studentId]: st }))}
                            className={`h-7 w-7 rounded-full border text-xs font-medium transition ${
                              current === st
                                ? st === "present" ? "border-emerald-500 bg-emerald-500 text-white"
                                  : st === "absent" ? "border-red-500 bg-red-500 text-white"
                                  : st === "late" ? "border-amber-500 bg-amber-500 text-white"
                                  : "border-purple-500 bg-purple-500 text-white"
                                : "border-gray-300 text-gray-400 hover:border-gray-400"
                            }`}
                          >
                            {st[0]!.toUpperCase()}
                          </button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Table>
              <div className="mt-4 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                  <Bell className="h-3.5 w-3.5" /> Notify guardians of absent/late
                </label>
                <Btn onClick={() => saveMut.mutate()} disabled={Object.keys(marks).length === 0 || saveMut.isPending}>
                  Save ({Object.keys(marks).length} marks)
                </Btn>
              </div>
              {saveMut.error && <div className="mt-2 text-xs text-red-600">{(saveMut.error as Error).message}</div>}
              {saveMut.isSuccess && <div className="mt-2 text-xs text-emerald-600">Saved.</div>}
            </>
          )}
        </Card>
      </div>

      <AtRisk />
    </div>
  );
}

function AtRisk() {
  const { data } = useQuery({
    queryKey: ["at-risk"],
    queryFn: () => get<{ threshold: number; students: { studentId: string; studentName: string; studentNo: string; rate: number; total: number; absences: number }[] }>("/api/attendance/analytics/at-risk"),
  });
  const rows = data?.students ?? [];
  if (rows.length === 0) return null;
  return (
    <Card title={`At-risk students (below ${data!.threshold}% attendance)`} className="mt-4">
      <Table head={["Student", "ID", "Attendance rate", "Sessions"]}>
        {rows.map((r) => (
          <tr key={r.studentId}>
            <td className="px-3 py-2">{r.studentName}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.studentNo}</td>
            <td className="px-3 py-2"><Badge color={r.rate < 60 ? "red" : "amber"}>{r.rate}%</Badge></td>
            <td className="px-3 py-2 text-xs text-gray-400">{r.total}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export default function Attendance() {
  return (
    <Suspense fallback={<Spinner />}>
      <AttendanceInner />
    </Suspense>
  );
}
