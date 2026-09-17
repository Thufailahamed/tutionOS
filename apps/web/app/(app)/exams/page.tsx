"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus } from "lucide-react";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table } from "../../../src/components/ui";
import { date } from "../../../src/lib/format";

type ExamRow = { id: string; title: string; type: string; date: string; maxMarks: number; status: string; className: string; subjectName: string | null; resultCount: number };

export default function Exams() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", classId: "", type: "term", date: new Date().toISOString().slice(0, 10), maxMarks: "100" });
  const { data, isLoading } = useQuery({ queryKey: ["exams"], queryFn: () => get<ExamRow[]>("/api/exams") });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });

  const createMut = useMutation({
    mutationFn: () => post("/api/exams", { title: form.title, classId: form.classId, type: form.type, date: form.date, maxMarks: Number(form.maxMarks) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exams"] }); setOpen(false); },
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader title="Exams" action={<Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New exam</Btn>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={["Title", "Class", "Type", "Date", "Max", "Results", "Status"]}>
            {data!.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><Link href={`/exams/${e.id}`} className="font-medium text-brand-600 hover:underline">{e.title}</Link></td>
                <td className="px-3 py-2 text-sm">{e.className}</td>
                <td className="px-3 py-2 text-xs capitalize">{e.type}</td>
                <td className="px-3 py-2 text-xs">{date(e.date)}</td>
                <td className="px-3 py-2 text-xs">{e.maxMarks}</td>
                <td className="px-3 py-2 text-xs">{e.resultCount}</td>
                <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
              </tr>
            ))}
            {data!.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">No exams yet</td></tr>}
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New exam">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Term Test 1 — Algebra" /></Field>
          <Field label="Class">
            <Select value={form.classId} onChange={(e) => set("classId", e.target.value)}>
              <option value="">Choose…</option>
              {classList?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Type"><Select value={form.type} onChange={(e) => set("type", e.target.value)}><option value="term">Term</option><option value="monthly">Monthly</option><option value="quiz">Quiz</option><option value="mock">Mock</option><option value="other">Other</option></Select></Field>
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Max marks"><Input type="number" value={form.maxMarks} onChange={(e) => set("maxMarks", e.target.value)} /></Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn onClick={() => createMut.mutate()} disabled={!form.title || !form.classId || createMut.isPending}>Create</Btn>
        </div>
        {createMut.error && <div className="mt-2 text-xs text-red-600">{(createMut.error as Error).message}</div>}
      </Modal>
    </div>
  );
}
