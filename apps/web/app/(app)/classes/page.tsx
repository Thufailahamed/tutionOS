"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus } from "lucide-react";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Badge } from "../../../src/components/ui";
import { money } from "../../../src/lib/format";

type ClassRow = {
  id: string; name: string; subjectName: string | null; gradeName: string | null; teacherName: string | null;
  type: string; mode: string; medium: string | null; room: string | null; capacity: number | null;
  feeCents: number; feePeriod: string; status: string; enrolled: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Classes() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", subjectId: "", teacherId: "", type: "group", mode: "physical", medium: "sinhala", room: "", capacity: "40", fee: "2500", feePeriod: "monthly" });
  const [sched, setSched] = useState({ weekday: "1", startTime: "16:00", endTime: "18:00" });

  const { data, isLoading } = useQuery({ queryKey: ["classes"], queryFn: () => get<ClassRow[]>("/api/classes") });
  const { data: ref } = useQuery({ queryKey: ["reference"], queryFn: () => get<{ subjects: { id: string; name: string }[]; grades: { id: string; name: string }[] }>("/api/orgs/reference") });
  const { data: teacherList } = useQuery({ queryKey: ["teachers"], queryFn: () => get<{ id: string; fullName: string }[]>("/api/teachers") });

  const createMut = useMutation({
    mutationFn: () =>
      post("/api/classes", {
        name: form.name,
        subjectId: form.subjectId || undefined,
        teacherId: form.teacherId || undefined,
        type: form.type,
        mode: form.mode,
        medium: form.medium,
        room: form.room || undefined,
        capacity: Number(form.capacity) || undefined,
        feeCents: Math.round(Number(form.fee) * 100),
        feePeriod: form.feePeriod,
        schedules: [{ weekday: Number(sched.weekday), startTime: sched.startTime, endTime: sched.endTime, room: form.room || undefined }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes"] });
      setCreateOpen(false);
      setForm({ name: "", subjectId: "", teacherId: "", type: "group", mode: "physical", medium: "sinhala", room: "", capacity: "40", fee: "2500", feePeriod: "monthly" });
    },
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader title="Classes" action={<Btn onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New class</Btn>} />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={["Class", "Subject", "Teacher", "Room", "Enrolled", "Fee", "Status"]}>
            {data!.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/classes/${c.id}`} className="font-medium text-brand-600 hover:underline">{c.name}</Link>
                  <div className="text-xs text-gray-400 capitalize">{c.type} · {c.mode}{c.medium ? ` · ${c.medium}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-sm">{c.subjectName ?? "—"}</td>
                <td className="px-3 py-2 text-sm">{c.teacherName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{c.room ?? "—"}</td>
                <td className="px-3 py-2"><Badge color="brand">{c.enrolled}{c.capacity ? `/${c.capacity}` : ""}</Badge></td>
                <td className="px-3 py-2 text-sm">{money(c.feeCents)}<span className="text-xs text-gray-400">/{c.feePeriod.replace("ly", "")}</span></td>
                <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
              </tr>
            ))}
            {data!.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">No classes yet</td></tr>}
          </Table>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New class" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Mathematics — Grade 11" /></Field>
          <Field label="Subject">
            <Select value={form.subjectId} onChange={(e) => set("subjectId", e.target.value)}>
              <option value="">—</option>
              {ref?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Teacher">
            <Select value={form.teacherId} onChange={(e) => set("teacherId", e.target.value)}>
              <option value="">—</option>
              {teacherList?.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Type"><Select value={form.type} onChange={(e) => set("type", e.target.value)}><option value="group">Group</option><option value="individual">Individual</option><option value="online">Online</option></Select></Field>
          <Field label="Mode"><Select value={form.mode} onChange={(e) => set("mode", e.target.value)}><option value="physical">Physical</option><option value="online">Online</option><option value="hybrid">Hybrid</option></Select></Field>
          <Field label="Medium"><Select value={form.medium} onChange={(e) => set("medium", e.target.value)}><option value="sinhala">Sinhala</option><option value="tamil">Tamil</option><option value="english">English</option></Select></Field>
          <Field label="Room"><Input value={form.room} onChange={(e) => set("room", e.target.value)} /></Field>
          <Field label="Capacity"><Input type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} /></Field>
          <Field label="Fee (Rs.)"><Input type="number" value={form.fee} onChange={(e) => set("fee", e.target.value)} /></Field>
          <Field label="Fee period"><Select value={form.feePeriod} onChange={(e) => set("feePeriod", e.target.value)}><option value="monthly">Monthly</option><option value="term">Per term</option><option value="session">Per session</option><option value="once">One-time</option><option value="free">Free</option></Select></Field>
        </div>
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-600">Weekly schedule</div>
          <div className="grid grid-cols-3 gap-3">
            <Select value={sched.weekday} onChange={(e) => setSched({ ...sched, weekday: e.target.value })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </Select>
            <Input type="time" value={sched.startTime} onChange={(e) => setSched({ ...sched, startTime: e.target.value })} />
            <Input type="time" value={sched.endTime} onChange={(e) => setSched({ ...sched, endTime: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Btn>
          <Btn onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending}>Create</Btn>
        </div>
        {createMut.error && <div className="mt-2 text-xs text-red-600">{(createMut.error as Error).message}</div>}
      </Modal>
    </div>
  );
}
