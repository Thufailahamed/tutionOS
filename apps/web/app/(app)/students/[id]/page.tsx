"use client";
import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, patch, post, del } from "../../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Badge } from "../../../../src/components/ui";
import { money, date } from "../../../../src/lib/format";
import Link from "next/link";
import { KeyRound, UserMinus } from "lucide-react";

type Detail = {
  id: string; studentNo: string; fullName: string; phone: string | null; email: string | null;
  status: string; createdAt: string; notes: string | null; userId: string | null;
  emergencyContact: { name?: string; phone?: string; relation?: string };
  guardians: { link: { id: string; relationship: string | null; isPrimary: boolean }; guardian: { id: string; fullName: string; phone: string; email: string | null; userId: string | null } }[];
  enrollments: { id: string; status: string; enrolledAt: string; classId: string; className: string; subjectName: string; feeCents: number; feePeriod: string }[];
  grade: { id: string; name: string } | null;
};

type Finance = {
  outstandingCents: number; paidTotalCents: number; nextDueDate: string | null;
  fees: { id: string; label: string; status: string; dueDate: string; amountCents: number; paidCents: number; discountCents: number }[];
  payments: { id: string; receiptNo: string; amountCents: number; status: string; paidAt: string }[];
};

export default function StudentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [guardianOpen, setGuardianOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [gform, setGform] = useState({ fullName: "", phone: "", relationship: "mother" });
  const [enrollClass, setEnrollClass] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["student", id], queryFn: () => get<Detail>(`/api/students/${id}`) });
  const { data: finance } = useQuery({ queryKey: ["student-finance", id], queryFn: () => get<Finance>(`/api/finance/students/${id}/finance`) });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["student", id] });
  const patchMut = useMutation({ mutationFn: (body: unknown) => patch(`/api/students/${id}`, body), onSuccess: () => { invalidate(); setEditOpen(false); } });
  const enrollMut = useMutation({ mutationFn: (classId: string) => post(`/api/classes/${classId}/enrollments`, { studentId: id }), onSuccess: invalidate });
  const unenrollMut = useMutation({ mutationFn: (classId: string) => del(`/api/classes/${classId}/enrollments/${id}`), onSuccess: invalidate });
  const guardianMut = useMutation({
    mutationFn: () => post(`/api/students/${id}/guardians`, { ...gform, isPrimary: data!.guardians.length === 0 }),
    onSuccess: () => { invalidate(); setGuardianOpen(false); setGform({ fullName: "", phone: "", relationship: "mother" }); },
  });
  const unlinkMut = useMutation({ mutationFn: (gid: string) => del(`/api/students/${id}/guardians/${gid}`), onSuccess: invalidate });
  const accountMut = useMutation({ mutationFn: () => post(`/api/students/${id}/account`, {}), onSuccess: invalidate });
  const gAccountMut = useMutation({ mutationFn: (gid: string) => post(`/api/students/${id}/guardians/${gid}/account`, {}), onSuccess: invalidate });

  if (isLoading || !data) return <Spinner />;
  const s = data;
  const emergency = s.emergencyContact;

  return (
    <div>
      <PageHeader
        title={s.fullName}
        sub={`${s.studentNo} · joined ${date(s.createdAt)}`}
        action={
          <div className="flex gap-2">
            <StatusBadge status={s.status} />
            <Btn variant="outline" size="sm" onClick={() => { setForm({ fullName: s.fullName, phone: s.phone ?? "", email: s.email ?? "", status: s.status, notes: s.notes ?? "", ecName: emergency.name ?? "", ecPhone: emergency.phone ?? "", ecRelation: emergency.relation ?? "" }); setEditOpen(true); }}>
              Edit
            </Btn>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Phone</dt><dd>{s.phone ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd>{s.email ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Grade</dt><dd>{data.grade?.name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Portal login</dt><dd>{s.userId ? <Badge color="green">active</Badge> : <Btn size="sm" variant="outline" onClick={() => accountMut.mutate()} disabled={accountMut.isPending}><KeyRound className="h-3 w-3" /> Create</Btn>}</dd></div>
              {emergency.name && <div className="flex justify-between"><dt className="text-gray-500">Emergency</dt><dd>{emergency.name} {emergency.phone && `· ${emergency.phone}`}</dd></div>}
            </dl>
          </Card>

          <Card title="Guardians" action={<Btn size="sm" variant="outline" onClick={() => setGuardianOpen(true)}>Link</Btn>}>
            <ul className="space-y-2.5">
              {data.guardians.map(({ link, guardian: g }) => (
                <li key={link.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{g.fullName} {link.isPrimary && <Badge color="brand">primary</Badge>}</div>
                    <div className="text-xs text-gray-400">{g.phone} {link.relationship && `· ${link.relationship}`}</div>
                  </div>
                  <div className="flex gap-1">
                    {!g.userId && <Btn size="sm" variant="ghost" onClick={() => gAccountMut.mutate(g.id)} title="Create portal login"><KeyRound className="h-3.5 w-3.5" /></Btn>}
                    <Btn size="sm" variant="ghost" onClick={() => unlinkMut.mutate(link.id)} title="Unlink"><UserMinus className="h-3.5 w-3.5 text-red-400" /></Btn>
                  </div>
                </li>
              ))}
              {data.guardians.length === 0 && <li className="text-sm text-gray-400">No guardians linked</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Enrollments" action={<Btn size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>Enroll</Btn>}>
            <Table head={["Class", "Subject", "Fee", "Status", ""]}>
              {data.enrollments.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">{e.className}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{e.subjectName}</td>
                  <td className="px-3 py-2">{money(e.feeCents)}<span className="text-xs text-gray-400">/{e.feePeriod === "monthly" ? "mo" : e.feePeriod}</span></td>
                  <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                  <td className="px-3 py-2 text-right">
                    {e.status === "active" && <Btn size="sm" variant="ghost" onClick={() => unenrollMut.mutate(e.classId)}>Remove</Btn>}
                  </td>
                </tr>
              ))}
              {data.enrollments.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">Not enrolled in any class</td></tr>}
            </Table>
          </Card>

          <Card title="Fees" action={<Link href="/finance" className="text-xs text-brand-600 hover:underline">Open finance</Link>}>
            <div className="mb-3 text-sm">
              Outstanding: <b className={(finance?.outstandingCents ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}>{money(finance?.outstandingCents ?? 0)}</b>
              {finance?.nextDueDate && <span className="ml-3 text-xs text-gray-400">next due {date(finance.nextDueDate)}</span>}
            </div>
            <Table head={["Label", "Due", "Amount", "Paid", "Status"]}>
              {(finance?.fees ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">{f.label}</td>
                  <td className="px-3 py-2 text-xs">{date(f.dueDate)}</td>
                  <td className="px-3 py-2">{money(f.amountCents - f.discountCents)}</td>
                  <td className="px-3 py-2">{money(f.paidCents)}</td>
                  <td className="px-3 py-2"><StatusBadge status={f.status} /></td>
                </tr>
              ))}
              {(finance?.fees ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">No fees</td></tr>}
            </Table>
          </Card>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit student" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><Input value={form.fullName ?? ""} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">active</option><option value="inactive">inactive</option></Select></Field>
          <Field label="Emergency contact name"><Input value={form.ecName ?? ""} onChange={(e) => setForm({ ...form, ecName: e.target.value })} /></Field>
          <Field label="Emergency phone"><Input value={form.ecPhone ?? ""} onChange={(e) => setForm({ ...form, ecPhone: e.target.value })} /></Field>
          <Field label="Emergency relation"><Input value={form.ecRelation ?? ""} onChange={(e) => setForm({ ...form, ecRelation: e.target.value })} /></Field>
          <Field label="Notes"><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Btn>
          <Btn onClick={() => patchMut.mutate({ fullName: form.fullName, phone: form.phone || undefined, email: form.email || undefined, status: form.status, notes: form.notes, emergencyContact: { name: form.ecName, phone: form.ecPhone, relation: form.ecRelation } })} disabled={patchMut.isPending}>Save</Btn>
        </div>
      </Modal>

      <Modal open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Enroll in class">
        <Select value={enrollClass} onChange={(e) => setEnrollClass(e.target.value)}>
          <option value="">Choose a class…</option>
          {classList?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setEnrollOpen(false)}>Cancel</Btn>
          <Btn onClick={() => { enrollMut.mutate(enrollClass); setEnrollOpen(false); }} disabled={!enrollClass || enrollMut.isPending}>Enroll</Btn>
        </div>
      </Modal>

      <Modal open={guardianOpen} onClose={() => setGuardianOpen(false)} title="Link guardian">
        <div className="space-y-3">
          <Field label="Name"><Input value={gform.fullName} onChange={(e) => setGform({ ...gform, fullName: e.target.value })} /></Field>
          <Field label="Phone" hint="If a guardian with this phone exists, they'll be linked"><Input value={gform.phone} onChange={(e) => setGform({ ...gform, phone: e.target.value })} /></Field>
          <Field label="Relation">
            <Select value={gform.relationship} onChange={(e) => setGform({ ...gform, relationship: e.target.value })}>
              <option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setGuardianOpen(false)}>Cancel</Btn>
          <Btn onClick={() => guardianMut.mutate()} disabled={!gform.fullName || !gform.phone || guardianMut.isPending}>Link</Btn>
        </div>
      </Modal>
    </div>
  );
}
