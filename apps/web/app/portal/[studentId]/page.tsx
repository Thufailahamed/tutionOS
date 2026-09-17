"use client";
import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { get, post, apiFetch } from "../../../src/lib/api";
import { Btn, Card, PageHeader, Spinner, StatusBadge, Table, Badge, StatCard } from "../../../src/components/ui";
import { money, date, datetime, pct } from "../../../src/lib/format";
import { ArrowLeft, Upload } from "lucide-react";

type Summary = {
  nextClass: { className: string; subjectName: string; date: string; startTime: string; endTime: string } | null;
  attendanceRate: number | null;
  latestResult: { title: string; date: string; marks: number | null; maxMarks: number; grade: string | null; percentage: number | null } | null;
  pendingHomework: number;
  upcomingExam: { title: string; date: string } | null;
  outstandingCents: number;
};

export default function PortalStudent({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params);
  const [tab, setTab] = useState<"overview" | "schedule" | "attendance" | "results" | "homework" | "fees" | "materials" | "certificates">("overview");
  const { data: s, isLoading } = useQuery({ queryKey: ["portal-summary", studentId], queryFn: () => get<Summary>(`/api/portal/student/${studentId}/summary`) });

  return (
    <div>
      <Link href="/portal" className="mb-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"><ArrowLeft className="h-3 w-3" /> Back</Link>
      {isLoading || !s ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Attendance" value={s.attendanceRate != null ? `${s.attendanceRate}%` : "—"} />
            <StatCard label="Latest result" value={s.latestResult ? `${s.latestResult.marks}/${s.latestResult.maxMarks}` : "—"} sub={s.latestResult ? `${s.latestResult.title} · ${s.latestResult.grade}` : undefined} />
            <StatCard label="Homework due" value={s.pendingHomework} />
            <StatCard label="Fees due" value={money(s.outstandingCents)} />
          </div>
          {(s.nextClass || s.upcomingExam) && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {s.nextClass && (
                <Card className="border-brand-200 bg-brand-50">
                  <div className="text-xs font-medium text-brand-600">NEXT CLASS</div>
                  <div className="mt-1 font-semibold">{s.nextClass.className}</div>
                  <div className="text-xs text-gray-500">{date(s.nextClass.date)} · {s.nextClass.startTime}–{s.nextClass.endTime}</div>
                </Card>
              )}
              {s.upcomingExam && (
                <Card className="border-amber-200 bg-amber-50">
                  <div className="text-xs font-medium text-amber-600">UPCOMING EXAM</div>
                  <div className="mt-1 font-semibold">{s.upcomingExam.title}</div>
                  <div className="text-xs text-gray-500">{date(s.upcomingExam.date)}</div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
        {(["overview", "schedule", "attendance", "results", "homework", "fees", "materials", "certificates"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>{t}</button>
        ))}
      </div>
      {tab === "overview" && <ClassesTab studentId={studentId} />}
      {tab === "schedule" && <ScheduleTab studentId={studentId} />}
      {tab === "attendance" && <AttendanceTab studentId={studentId} />}
      {tab === "results" && <ResultsTab studentId={studentId} />}
      {tab === "homework" && <HomeworkTab studentId={studentId} />}
      {tab === "fees" && <FeesTab studentId={studentId} />}
      {tab === "materials" && <MaterialsTab studentId={studentId} />}
      {tab === "certificates" && <CertificatesTab studentId={studentId} />}
    </div>
  );
}

function ClassesTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-classes", studentId], queryFn: () => get<{ className: string; subjectName: string; mode: string; medium: string | null; feeCents: number; feePeriod: string; enrolledAt: string }[]>(`/api/portal/student/${studentId}/classes`) });
  const { data: anns } = useQuery({ queryKey: ["portal-anns", studentId], queryFn: () => get<{ id: string; title: string; body: string; createdAt: string }[]>(`/api/portal/student/${studentId}/announcements`) });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="My classes">
        <Table head={["Class", "Mode", "Fee", "Since"]}>
          {data.map((c, i) => (
            <tr key={i}>
              <td className="px-3 py-2"><div className="font-medium">{c.className}</div><div className="text-xs text-gray-400">{c.subjectName}</div></td>
              <td className="px-3 py-2 text-xs capitalize">{c.mode}{c.medium ? ` · ${c.medium}` : ""}</td>
              <td className="px-3 py-2 text-xs">{money(c.feeCents)}/{c.feePeriod}</td>
              <td className="px-3 py-2 text-xs">{date(c.enrolledAt)}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">Not enrolled in any class</td></tr>}
        </Table>
      </Card>
      <Card title="Announcements">
        <ul className="space-y-3">
          {(anns ?? []).slice(0, 5).map((a) => (
            <li key={a.id} className="border-b border-gray-50 pb-2 last:border-0">
              <div className="text-sm font-medium">{a.title}</div>
              <div className="text-xs text-gray-500">{a.body}</div>
              <div className="mt-0.5 text-xs text-gray-400">{datetime(a.createdAt)}</div>
            </li>
          ))}
          {(anns ?? []).length === 0 && <li className="py-6 text-center text-sm text-gray-400">No announcements</li>}
        </ul>
      </Card>
    </div>
  );
}

function ScheduleTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-sched", studentId], queryFn: () => get<{ id: string; date: string; startTime: string; endTime: string; status: string; className: string; subjectName: string; room: string | null; mode: string }[]>(`/api/portal/student/${studentId}/schedule`) });
  if (!data) return <Spinner />;
  return (
    <Card title="Next 30 days">
      <Table head={["Date", "Time", "Class", "Room", "Status"]}>
        {data.map((s) => (
          <tr key={s.id}>
            <td className="px-3 py-2 text-sm">{date(s.date)}</td>
            <td className="px-3 py-2 text-xs">{s.startTime}–{s.endTime}</td>
            <td className="px-3 py-2"><div className="text-sm">{s.className}</div><div className="text-xs text-gray-400">{s.subjectName}</div></td>
            <td className="px-3 py-2 text-xs">{s.room ?? s.mode}</td>
            <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">No sessions scheduled</td></tr>}
      </Table>
    </Card>
  );
}

function AttendanceTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-att", studentId], queryFn: () => get<{ date: string; className: string; subjectName: string; status: string; note: string | null }[]>(`/api/portal/student/${studentId}/attendance`) });
  if (!data) return <Spinner />;
  return (
    <Card title="Last 90 days">
      <Table head={["Date", "Class", "Status", "Note"]}>
        {data.map((r, i) => (
          <tr key={i}>
            <td className="px-3 py-2 text-xs">{date(r.date)}</td>
            <td className="px-3 py-2"><div className="text-sm">{r.className}</div><div className="text-xs text-gray-400">{r.subjectName}</div></td>
            <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
            <td className="px-3 py-2 text-xs text-gray-400">{r.note ?? "—"}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No records</td></tr>}
      </Table>
    </Card>
  );
}

function ResultsTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-results", studentId], queryFn: () => get<{ title: string; type: string; date: string; className: string; subjectName: string; marks: number | null; maxMarks: number; percentage: number | null; grade: string | null; rank: number | null; remarks: string | null }[]>(`/api/portal/student/${studentId}/results`) });
  if (!data) return <Spinner />;
  return (
    <Card title="Published results">
      <Table head={["Exam", "Class", "Date", "Marks", "%", "Grade", "Rank"]}>
        {data.map((r, i) => (
          <tr key={i}>
            <td className="px-3 py-2"><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-gray-400 capitalize">{r.type}</div></td>
            <td className="px-3 py-2 text-xs">{r.className}</td>
            <td className="px-3 py-2 text-xs">{date(r.date)}</td>
            <td className="px-3 py-2">{r.marks ?? "—"}/{r.maxMarks}</td>
            <td className="px-3 py-2 text-xs">{pct(r.percentage)}</td>
            <td className="px-3 py-2">{r.grade && <Badge color={["A", "B"].includes(r.grade) ? "green" : r.grade === "F" ? "red" : "amber"}>{r.grade}</Badge>}</td>
            <td className="px-3 py-2 text-xs">{r.rank ? `#${r.rank}` : "—"}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-400">No published results</td></tr>}
      </Table>
    </Card>
  );
}

function HomeworkTab({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState("");
  const { data } = useQuery({ queryKey: ["portal-hw", studentId], queryFn: () => get<{ submissionId: string; homeworkId: string; title: string; description: string | null; className: string; dueAt: string; maxMarks: number | null; status: string; marks: number | null; feedback: string | null }[]>(`/api/portal/student/${studentId}/homework`) });

  const submitMut = useMutation({
    mutationFn: async (submissionId: string) => {
      const fileIds: string[] = [];
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "homework");
        const up = await apiFetch<{ id: string }>("/api/files", { method: "POST", body: fd });
        fileIds.push(up.id);
      }
      return post(`/api/portal/student/${studentId}/homework/${submissionId}/submit`, { fileIds });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-hw", studentId] }); setSubmitting(""); setFile(null); },
  });

  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      {data.map((h) => (
        <Card key={h.submissionId}>
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold">{h.title} <span className="ml-1 text-xs font-normal text-gray-400">{h.className}</span></div>
              {h.description && <div className="mt-1 text-sm text-gray-600">{h.description}</div>}
              <div className="mt-1 text-xs text-gray-400">Due {datetime(h.dueAt)}{h.maxMarks ? ` · ${h.maxMarks} marks` : ""}</div>
            </div>
            <StatusBadge status={h.status} />
          </div>
          {h.status === "graded" && (
            <div className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm">
              <b>{h.marks}</b>{h.maxMarks ? ` / ${h.maxMarks}` : ""}{h.feedback && <span className="ml-2 text-gray-600">{h.feedback}</span>}
            </div>
          )}
          {["assigned", "viewed"].includes(h.status) && (
            <div className="mt-3 flex items-center gap-2">
              {submitting === h.submissionId ? (
                <>
                  <input type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <Btn size="sm" onClick={() => submitMut.mutate(h.submissionId)} disabled={submitMut.isPending}>{submitMut.isPending ? "Submitting…" : "Submit"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setSubmitting("")}>Cancel</Btn>
                </>
              ) : (
                <Btn size="sm" variant="outline" onClick={() => { setSubmitting(h.submissionId); post(`/api/portal/student/${studentId}/homework/${h.submissionId}/view`, {}); }}>
                  <Upload className="h-3.5 w-3.5" /> Submit work
                </Btn>
              )}
            </div>
          )}
        </Card>
      ))}
      {data.length === 0 && <Card><p className="py-6 text-center text-sm text-gray-400">No homework</p></Card>}
    </div>
  );
}

function FeesTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-fees", studentId], queryFn: () => get<{ fees: { id: string; label: string; dueDate: string; amountCents: number; discountCents: number; paidCents: number; status: string }[]; payments: { id: string; receiptNo: string; amountCents: number; method: string; paidAt: string }[]; outstandingCents: number }>(`/api/portal/student/${studentId}/fees`) });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Fees" action={<Badge color={data.outstandingCents > 0 ? "amber" : "green"}>{money(data.outstandingCents)} due</Badge>}>
        <Table head={["Label", "Due", "Amount", "Paid", "Status"]}>
          {data.fees.map((f) => (
            <tr key={f.id}>
              <td className="px-3 py-2 text-sm">{f.label}</td>
              <td className="px-3 py-2 text-xs">{date(f.dueDate)}</td>
              <td className="px-3 py-2">{money(f.amountCents - f.discountCents)}</td>
              <td className="px-3 py-2">{money(f.paidCents)}</td>
              <td className="px-3 py-2"><StatusBadge status={f.status} /></td>
            </tr>
          ))}
          {data.fees.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">No fees</td></tr>}
        </Table>
      </Card>
      <Card title="Payment history">
        <Table head={["Receipt", "Amount", "Method", "Date"]}>
          {data.payments.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 font-mono text-xs">{p.receiptNo}</td>
              <td className="px-3 py-2">{money(p.amountCents)}</td>
              <td className="px-3 py-2 text-xs capitalize">{p.method}</td>
              <td className="px-3 py-2 text-xs">{datetime(p.paidAt)}</td>
            </tr>
          ))}
          {data.payments.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No payments</td></tr>}
        </Table>
      </Card>
    </div>
  );
}

function MaterialsTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-mats", studentId], queryFn: () => get<{ id: string; title: string; folder: string; url: string | null; type: string; file: { id: string; name: string } | null; createdAt: string }[]>(`/api/portal/student/${studentId}/materials`) });
  const { data: lessons } = useQuery({ queryKey: ["portal-lessons", studentId], queryFn: () => get<{ id: string; title: string; file: { id: string; name: string } | null; durationSeconds: number | null }[]>(`/api/portal/student/${studentId}/lessons`) });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Materials">
        <ul className="divide-y divide-gray-50">
          {data.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2.5">
              <div><div className="text-sm font-medium">{m.title}</div>{m.folder !== "General" && <div className="text-xs text-gray-400">{m.folder}</div>}</div>
              {m.type === "link" && m.url ? (
                <a className="text-xs text-brand-600 hover:underline" href={m.url} target="_blank" rel="noreferrer">Open</a>
              ) : m.file ? (
                <a className="text-xs text-brand-600 hover:underline" href={`/api/files/${m.file.id}`} target="_blank" rel="noreferrer">Download</a>
              ) : null}
            </li>
          ))}
          {data.length === 0 && <li className="py-6 text-center text-sm text-gray-400">No materials</li>}
        </ul>
      </Card>
      <Card title="Recorded lessons">
        <ul className="divide-y divide-gray-50">
          {(lessons ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between py-2.5">
              <div><div className="text-sm font-medium">{l.title}</div>{l.durationSeconds ? <div className="text-xs text-gray-400">{Math.round(l.durationSeconds / 60)} min</div> : null}</div>
              {l.file && <a className="text-xs text-brand-600 hover:underline" href={`/api/files/${l.file.id}`} target="_blank" rel="noreferrer">Watch</a>}
            </li>
          ))}
          {(lessons ?? []).length === 0 && <li className="py-6 text-center text-sm text-gray-400">No lessons</li>}
        </ul>
      </Card>
    </div>
  );
}

function CertificatesTab({ studentId }: { studentId: string }) {
  const { data } = useQuery({ queryKey: ["portal-certs", studentId], queryFn: () => get<{ id: string; title: string; type: string; issuedAt: string; fileKey: string | null }[]>(`/api/portal/student/${studentId}/certificates`) });
  if (!data) return <Spinner />;
  return (
    <Card title="Certificates">
      <Table head={["Title", "Type", "Issued", ""]}>
        {data.map((c) => (
          <tr key={c.id}>
            <td className="px-3 py-2 font-medium">{c.title}</td>
            <td className="px-3 py-2 text-xs capitalize">{c.type}</td>
            <td className="px-3 py-2 text-xs">{date(c.issuedAt)}</td>
            <td className="px-3 py-2 text-right text-xs text-gray-400">{c.fileKey ? "PDF available" : ""}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No certificates</td></tr>}
      </Table>
    </Card>
  );
}
