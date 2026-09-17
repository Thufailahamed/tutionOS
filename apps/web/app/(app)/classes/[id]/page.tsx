"use client";
import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { get, post, patch, del } from "../../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Table, Badge } from "../../../../src/components/ui";
import { money, date } from "../../../../src/lib/format";
import { CalendarPlus, Trash2 } from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Detail = {
  id: string; name: string; type: string; mode: string; medium: string | null; room: string | null;
  capacity: number | null; feeCents: number; feePeriod: string; status: string;
  schedules: { id: string; weekday: number; startTime: string; endTime: string }[];
  enrollments: { enrollmentId: string; status: string; enrolledAt: string; studentId: string; studentNo: string; fullName: string }[];
  subject: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  waitlist: { w: { id: string; position: number; status: string }; studentName: string; studentNo: string }[];
  enrolledCount: number;
};

export default function ClassDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [schedOpen, setSchedOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [sched, setSched] = useState({ weekday: "1", startTime: "16:00", endTime: "18:00" });
  // Next calendar date for the selected weekday — the conflict check works on concrete session dates
  const nextDateForWeekday = (weekday: number) => {
    const d = new Date();
    d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  };
  const [q, setQ] = useState("");
  const [studentId, setStudentId] = useState("");
  const [conflict, setConflict] = useState<{ conflicts: { type: string; detail: string }[] } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["class", id], queryFn: () => get<Detail>(`/api/classes/${id}`) });
  const { data: studentResults } = useQuery({
    queryKey: ["student-search", q],
    queryFn: () => get<{ students: { id: string; fullName: string; studentNo: string }[] }>(`/api/students?q=${encodeURIComponent(q)}&limit=8`),
    enabled: enrollOpen && q.length > 1,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["class", id] });
  const schedMut = useMutation({ mutationFn: () => post(`/api/classes/${id}/schedules`, { ...sched, weekday: Number(sched.weekday) }), onSuccess: () => { invalidate(); setSchedOpen(false); } });
  const delSchedMut = useMutation({ mutationFn: (sid: string) => del(`/api/classes/${id}/schedules/${sid}`), onSuccess: invalidate });
  const enrollMut = useMutation({ mutationFn: (sid: string) => post(`/api/classes/${id}/enrollments`, { studentId: sid }), onSuccess: () => { invalidate(); setEnrollOpen(false); setQ(""); setStudentId(""); } });
  const unenrollMut = useMutation({ mutationFn: (sid: string) => del(`/api/classes/${id}/enrollments/${sid}`), onSuccess: invalidate });
  const waitlistMut = useMutation({ mutationFn: (wid: string) => post(`/api/classes/${id}/waitlist/${wid}/accept`, {}), onSuccess: invalidate });
  const conflictMut = useMutation({
    mutationFn: () =>
      post<{ conflicts: { type: string; detail: string }[] }>(`/api/classes/conflicts/check`, {
        date: nextDateForWeekday(Number(sched.weekday)),
        startTime: sched.startTime,
        endTime: sched.endTime,
        teacherId: data?.teacher?.id ?? undefined,
        room: data?.room ?? undefined,
      }),
    onSuccess: (r) => { setConflict(r); setConflictOpen(true); },
  });

  if (isLoading || !data) return <Spinner />;
  const k = data;
  const active = data.enrollments;

  return (
    <div>
      <PageHeader
        title={k.name}
        sub={`${data.subject?.name ?? "No subject"} · ${data.teacher?.fullName ?? "No teacher"} · ${money(k.feeCents)}/${k.feePeriod}`}
        action={<StatusBadge status={k.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Type</dt><dd className="capitalize">{k.type}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Mode</dt><dd className="capitalize">{k.mode}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Medium</dt><dd className="capitalize">{k.medium ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Room</dt><dd>{k.room ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Capacity</dt><dd>{active.length}{k.capacity ? ` / ${k.capacity}` : ""}</dd></div>
            </dl>
          </Card>
          <Card title="Weekly schedule" action={<Btn size="sm" variant="outline" onClick={() => setSchedOpen(true)}><CalendarPlus className="h-3.5 w-3.5" /> Add</Btn>}>
            <ul className="space-y-2">
              {data.schedules.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span>{WEEKDAYS[s.weekday]} {s.startTime}–{s.endTime}</span>
                  <Btn size="sm" variant="ghost" onClick={() => delSchedMut.mutate(s.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Btn>
                </li>
              ))}
              {data.schedules.length === 0 && <li className="text-sm text-gray-400">No recurring schedule — sessions created manually only.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title={`Students (${data.enrolledCount})`} action={<Btn size="sm" onClick={() => setEnrollOpen(true)}>Enroll</Btn>}>
            <Table head={["ID", "Name", "Status", "Joined", ""]}>
              {data.enrollments.map((e) => (
                <tr key={e.enrollmentId}>
                  <td className="px-3 py-2 font-mono text-xs">{e.studentNo}</td>
                  <td className="px-3 py-2"><Link className="text-brand-600 hover:underline" href={`/students/${e.studentId}`}>{e.fullName}</Link></td>
                  <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                  <td className="px-3 py-2 text-xs text-gray-400">{date(e.enrolledAt)}</td>
                  <td className="px-3 py-2 text-right">{e.status === "active" && <Btn size="sm" variant="ghost" onClick={() => unenrollMut.mutate(e.studentId)}>Remove</Btn>}</td>
                </tr>
              ))}
              {data.enrollments.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">No students enrolled</td></tr>}
            </Table>
          </Card>

          {data.waitlist.length > 0 && (
            <Card title={`Waitlist (${data.waitlist.length})`}>
              <Table head={["#", "ID", "Name", ""]}>
                {data.waitlist.map(({ w, studentName, studentNo }) => (
                  <tr key={w.id}>
                    <td className="px-3 py-2">{w.position}</td>
                    <td className="px-3 py-2 font-mono text-xs">{studentNo}</td>
                    <td className="px-3 py-2">{studentName}</td>
                    <td className="px-3 py-2 text-right"><Btn size="sm" variant="outline" onClick={() => waitlistMut.mutate(w.id)}>Accept</Btn></td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      </div>

      <Modal open={schedOpen} onClose={() => setSchedOpen(false)} title="Add schedule slot">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Day"><Select value={sched.weekday} onChange={(e) => setSched({ ...sched, weekday: e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <Field label="Start"><Input type="time" value={sched.startTime} onChange={(e) => setSched({ ...sched, startTime: e.target.value })} /></Field>
          <Field label="End"><Input type="time" value={sched.endTime} onChange={(e) => setSched({ ...sched, endTime: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="outline" onClick={() => conflictMut.mutate()} disabled={conflictMut.isPending}>Check conflicts</Btn>
          <Btn onClick={() => schedMut.mutate()} disabled={schedMut.isPending}>Add</Btn>
        </div>
        {schedMut.error && <div className="mt-2 text-xs text-red-600">{(schedMut.error as Error).message}</div>}
      </Modal>

      <Modal open={conflictOpen} onClose={() => setConflictOpen(false)} title="Conflict check">
        {conflict && conflict.conflicts.length === 0 ? (
          <p className="text-sm text-emerald-600">No conflicts — teacher, room, and enrolled students are free.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {conflict?.conflicts.map((c, i) => (
              <li key={i} className="rounded-lg bg-red-50 px-3 py-2 text-red-700"><b className="capitalize">{c.type}</b>: {c.detail}</li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Enroll student">
        <SearchInput value={q} onChange={setQ} placeholder="Search students…" />
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {studentResults?.students.map((s) => (
            <li key={s.id}>
              <button
                className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 ${studentId === s.id ? "bg-brand-50 ring-1 ring-brand-400" : ""}`}
                onClick={() => setStudentId(s.id)}
              >
                {s.fullName} <span className="text-xs text-gray-400">{s.studentNo}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setEnrollOpen(false)}>Cancel</Btn>
          <Btn onClick={() => enrollMut.mutate(studentId)} disabled={!studentId || enrollMut.isPending}>Enroll</Btn>
        </div>
        {enrollMut.error && <div className="mt-2 text-xs text-red-600">{(enrollMut.error as Error).message}</div>}
      </Modal>
    </div>
  );
}
