"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get, post, patch } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Badge, Textarea } from "../../../src/components/ui";
import { datetime } from "../../../src/lib/format";

type Hw = {
  id: string; title: string; className: string; subjectName: string; dueAt: string; maxMarks: number | null;
  counts: { total: number; submissions: number; pending: number };
};

type HwDetail = Hw & {
  description: string | null;
  attachments: string[];
  submissions: { id: string; studentId: string; studentNo: string; studentName: string; status: string; marks: number | null; feedback: string | null; submittedAt: string | null; files: string[] }[];
};

export default function Homework() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [form, setForm] = useState({ title: "", description: "", classId: "", dueAt: "", maxMarks: "" });
  const [grades, setGrades] = useState<Record<string, { marks: string; feedback: string }>>({});

  const { data, isLoading } = useQuery({ queryKey: ["homework"], queryFn: () => get<Hw[]>("/api/homework") });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });
  const { data: detail } = useQuery({ queryKey: ["homework", detailId], queryFn: () => get<HwDetail>(`/api/homework/${detailId}`), enabled: !!detailId });

  const createMut = useMutation({
    mutationFn: () => post("/api/homework", { ...form, dueAt: new Date(form.dueAt).toISOString(), maxMarks: form.maxMarks ? Number(form.maxMarks) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["homework"] }); setOpen(false); setForm({ title: "", description: "", classId: "", dueAt: "", maxMarks: "" }); },
  });
  const gradeMut = useMutation({
    mutationFn: ({ studentId, marks, feedback }: { studentId: string; marks?: number; feedback?: string }) => post(`/api/homework/${detailId}/submissions/${studentId}/grade`, { marks, feedback }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["homework", detailId] }),
  });

  return (
    <div>
      <PageHeader title="Homework" action={<Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Assign</Btn>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={["Title", "Class", "Due", "Progress"]}>
            {data!.map((h) => (
              <tr key={h.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetailId(h.id)}>
                <td className="px-3 py-2 font-medium">{h.title}</td>
                <td className="px-3 py-2 text-sm">{h.className}<div className="text-xs text-gray-400">{h.subjectName}</div></td>
                <td className="px-3 py-2 text-xs">{datetime(h.dueAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full bg-emerald-500" style={{ width: `${h.counts.total ? (h.counts.submissions / h.counts.total) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{h.counts.submissions}/{h.counts.total}</span>
                    {h.counts.pending > 0 && <Badge color="amber">{h.counts.pending} to grade</Badge>}
                  </div>
                </td>
              </tr>
            ))}
            {data!.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-gray-400">No homework assigned</td></tr>}
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Assign homework">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Instructions"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Class"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">—</option>{classList?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Due"><Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
            <Field label="Max marks"><Input type="number" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} /></Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn onClick={() => createMut.mutate()} disabled={!form.title || !form.classId || !form.dueAt || createMut.isPending}>Assign</Btn>
        </div>
        {createMut.error && <div className="mt-2 text-xs text-red-600">{(createMut.error as Error).message}</div>}
      </Modal>

      <Modal open={!!detailId} onClose={() => setDetailId("")} title={detail?.title ?? "Submissions"} wide>
        {!detail ? <Spinner /> : (
          <>
            <p className="mb-3 text-xs text-gray-500">{detail.description}</p>
            <Table head={["Student", "Status", "Submitted", "Files", "Marks", "Feedback", ""]}>
              {detail.submissions.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2"><div className="text-sm">{s.studentName}</div><div className="text-xs text-gray-400">{s.studentNo}</div></td>
                  <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2 text-xs">{s.submittedAt ? datetime(s.submittedAt) : "—"}</td>
                  <td className="px-3 py-2 text-xs">{s.files.length} file{s.files.length === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2">
                    <Input type="number" className="w-16 px-2 py-1" value={grades[s.id]?.marks ?? s.marks?.toString() ?? ""} onChange={(e) => setGrades({ ...grades, [s.id]: { marks: e.target.value, feedback: grades[s.id]?.feedback ?? s.feedback ?? "" } })} />
                  </td>
                  <td className="px-3 py-2">
                    <Input className="w-32 px-2 py-1" value={grades[s.id]?.feedback ?? s.feedback ?? ""} onChange={(e) => setGrades({ ...grades, [s.id]: { marks: grades[s.id]?.marks ?? s.marks?.toString() ?? "", feedback: e.target.value } })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Btn size="sm" variant="outline" onClick={() => gradeMut.mutate({ studentId: s.studentId, marks: grades[s.id]?.marks ? Number(grades[s.id].marks) : s.marks ?? undefined, feedback: grades[s.id]?.feedback ?? s.feedback ?? undefined })} disabled={gradeMut.isPending}>Grade</Btn>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Modal>
    </div>
  );
}
