"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Table, Badge } from "../../../src/components/ui";
import { money, date, datetime } from "../../../src/lib/format";
import { Plus, RefreshCcw, Receipt } from "lucide-react";

type Fee = { id: string; studentId: string; studentName: string; studentNo: string; label: string; periodLabel: string | null; amountCents: number; discountCents: number; paidCents: number; status: string; dueDate: string };
type Payment = { id: string; receiptNo: string; studentName: string; studentNo: string; amountCents: number; refundedCents: number; method: string; status: string; paidAt: string; receiverName: string | null };

export default function Finance() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"fees" | "payments" | "plans">("fees");
  const [statusF, setStatusF] = useState("outstanding");
  const [q, setQ] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [payForm, setPayForm] = useState({ studentId: "", amount: "", method: "cash", note: "" });
  const [genPeriod, setGenPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [studentQ, setStudentQ] = useState("");

  const { data: fees, isLoading: feesLoading } = useQuery({
    queryKey: ["fees", statusF, q],
    queryFn: () => get<Fee[]>(`/api/finance/fees?status=${statusF}`),
    enabled: tab === "fees",
  });
  const { data: payments } = useQuery({
    queryKey: ["payments", q],
    queryFn: () => get<{ payments: Payment[]; count: number; totalCents: number }>(`/api/finance/payments`),
    enabled: tab === "payments",
  });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });
  const { data: plans } = useQuery({
    queryKey: ["fee-plans"],
    queryFn: () => get<{ id: string; name: string; amountCents: number; period: string; classId: string | null }[]>("/api/finance/fee-plans"),
    enabled: tab === "plans",
  });
  const { data: outstanding } = useQuery({
    queryKey: ["outstanding"],
    queryFn: () => get<{ totalCents: number; count: number; students: { studentId: string; studentName: string; studentNo: string; outstanding: number; fees: number; oldestDue: string }[] }>("/api/finance/fees/outstanding/summary"),
    enabled: tab === "fees",
  });
  const { data: studentResults } = useQuery({
    queryKey: ["student-search", studentQ],
    queryFn: () => get<{ students: { id: string; fullName: string; studentNo: string }[] }>(`/api/students?q=${encodeURIComponent(studentQ)}&limit=8`),
    enabled: payOpen && studentQ.length > 1,
  });

  const payMut = useMutation({
    mutationFn: () => post<{ id: string; receiptNo: string }>("/api/finance/payments", { studentId: payForm.studentId, amountCents: Math.round(Number(payForm.amount) * 100), method: payForm.method, note: payForm.note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fees"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["outstanding"] });
      setPayOpen(false);
      setPayForm({ studentId: "", amount: "", method: "cash", note: "" });
    },
  });
  const genMut = useMutation({
    mutationFn: () => {
      const [y, m] = genPeriod.split("-").map(Number);
      const periodLabel = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const dueDate = new Date(y, m, 10).toISOString().slice(0, 10); // 10th of the month
      return post<{ created: number }>("/api/finance/fees/generate", { periodLabel, dueDate });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fees"] });
      setGenOpen(false);
    },
  });
  const refundMut = useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents?: number }) => post(`/api/finance/payments/${id}/refund`, amountCents ? { amountCents } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payments"] }); qc.invalidateQueries({ queryKey: ["fees"] }); },
  });

  async function openReceipt(id: string) {
    const r = await get<ReceiptData>(`/api/finance/payments/${id}`);
    setReceipt(r);
  }

  return (
    <div>
      <PageHeader
        title="Finance"
        sub={outstanding ? `${money(outstanding.totalCents)} outstanding across ${outstanding.count} students` : undefined}
        action={
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => setGenOpen(true)}>Generate monthly fees</Btn>
            <Btn onClick={() => setPayOpen(true)}><Plus className="h-4 w-4" /> Record payment</Btn>
          </div>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["fees", "payments", "plans"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "plans" ? "Fee plans" : t}
          </button>
        ))}
      </div>

      {tab === "fees" && (
        <Card>
          <div className="mb-4 flex gap-3">
            <SearchInput value={q} onChange={setQ} className="max-w-xs flex-1" placeholder="Student name or ID…" />
            <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="w-40">
              <option value="outstanding">Outstanding</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
              <option value="all">All</option>
            </Select>
          </div>
          {feesLoading ? <Spinner /> : (
            <Table head={["Student", "Label", "Due", "Amount", "Discount", "Paid", "Balance", "Status"]}>
              {(fees ?? []).filter((f) => !q || f.studentName.toLowerCase().includes(q.toLowerCase()) || f.studentNo.toLowerCase().includes(q.toLowerCase())).map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2"><div className="font-medium">{f.studentName}</div><div className="text-xs text-gray-400">{f.studentNo}</div></td>
                  <td className="px-3 py-2 text-sm">{f.label}</td>
                  <td className="px-3 py-2 text-xs">{date(f.dueDate)}</td>
                  <td className="px-3 py-2">{money(f.amountCents)}</td>
                  <td className="px-3 py-2 text-xs">{f.discountCents ? money(f.discountCents) : "—"}</td>
                  <td className="px-3 py-2">{money(f.paidCents)}</td>
                  <td className="px-3 py-2 font-medium">{money(f.amountCents - f.discountCents - f.paidCents)}</td>
                  <td className="px-3 py-2"><StatusBadge status={f.status} /></td>
                </tr>
              ))}
              {(fees ?? []).length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">No fees matching</td></tr>}
            </Table>
          )}
        </Card>
      )}

      {tab === "payments" && (
        <Card>
          <div className="mb-4"><SearchInput value={q} onChange={setQ} className="max-w-xs" placeholder="Receipt or student…" /></div>
          <Table head={["Receipt", "Student", "Amount", "Method", "Received by", "Date", "Status", ""]}>
            {(payments?.payments ?? []).filter((p) => !q || p.studentName.toLowerCase().includes(q.toLowerCase()) || p.receiptNo.toLowerCase().includes(q.toLowerCase())).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2"><button className="font-mono text-xs text-brand-600 hover:underline" onClick={() => openReceipt(p.id)}>{p.receiptNo}</button></td>
                <td className="px-3 py-2">{p.studentName}</td>
                <td className="px-3 py-2">{money(p.amountCents)}</td>
                <td className="px-3 py-2 text-xs capitalize">{p.method}</td>
                <td className="px-3 py-2 text-xs">{p.receiverName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{datetime(p.paidAt)}</td>
                <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-3 py-2 text-right">
                  {p.status === "paid" && p.refundedCents < p.amountCents && <Btn size="sm" variant="ghost" onClick={() => refundMut.mutate({ id: p.id })} title="Refund"><RefreshCcw className="h-3.5 w-3.5" /></Btn>}
                </td>
              </tr>
            ))}
            {(payments?.payments ?? []).length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">No payments</td></tr>}
          </Table>
        </Card>
      )}

      {tab === "plans" && (
        <Card title="Fee plans">
          <Table head={["Name", "Amount", "Period", "Class"]}>
            {(plans ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2">{money(p.amountCents)}</td>
                <td className="px-3 py-2 text-xs capitalize">{p.period}</td>
                <td className="px-3 py-2 text-xs">{p.classId ? (classList?.find((c) => c.id === p.classId)?.name ?? "—") : "All classes"}</td>
              </tr>
            ))}
            {(plans ?? []).length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No fee plans — fees come from class fee settings</td></tr>}
          </Table>
        </Card>
      )}

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment">
        <div className="space-y-3">
          <Field label="Student">
            <SearchInput value={studentQ} onChange={setStudentQ} placeholder="Search by name…" />
            {studentResults && studentQ.length > 1 && (
              <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1">
                {studentResults.students.map((s) => (
                  <li key={s.id}>
                    <button className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${payForm.studentId === s.id ? "bg-brand-50" : ""}`} onClick={() => { setPayForm({ ...payForm, studentId: s.id }); setStudentQ(s.fullName); }}>
                      {s.fullName} <span className="text-xs text-gray-400">{s.studentNo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (Rs.)"><Input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
            <Field label="Method"><Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="online">Online</option><option value="other">Other</option></Select></Field>
          </div>
          <Field label="Note"><Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} /></Field>
          <p className="text-xs text-gray-400">Payment auto-allocates to the student's oldest unpaid fees.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Btn>
          <Btn onClick={() => payMut.mutate()} disabled={!payForm.studentId || !payForm.amount || payMut.isPending}>Record</Btn>
        </div>
        {payMut.error && <div className="mt-2 text-xs text-red-600">{(payMut.error as Error).message}</div>}
      </Modal>

      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate monthly fees">
        <Field label="Period" hint="Creates a fee for every active enrollment using the class fee — skips existing fees for the period">
          <Input type="month" value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Btn>
          <Btn onClick={() => genMut.mutate()} disabled={genMut.isPending}>Generate</Btn>
        </div>
        {genMut.isSuccess && <div className="mt-2 text-xs text-emerald-600">Done — {genMut.data.created} fees created.</div>}
        {genMut.error && <div className="mt-2 text-xs text-red-600">{(genMut.error as Error).message}</div>}
      </Modal>

      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}

type ReceiptData = {
  id: string; receiptNo: string; amountCents: number; method: string; paidAt: string; status: string;
  studentName: string; studentNo: string; receiverName: string | null; guardianName: string | null;
  org: { name: string; address: string | null; phone: string | null } | null;
  allocations: { id: string; feeLabel: string | null; amountCents: number }[];
};

function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData | null; onClose: () => void }) {
  if (!receipt) return null;
  const p = receipt;
  return (
    <Modal open onClose={onClose} title="Receipt">
      <div className="rounded-lg border border-gray-200 p-5 font-mono text-sm" id="receipt">
        <div className="text-center">
          <div className="text-base font-bold">{receipt.org?.name ?? "ClassFlow"}</div>
          {receipt.org?.address && <div className="text-xs text-gray-500">{receipt.org.address}</div>}
          {receipt.org?.phone && <div className="text-xs text-gray-500">{receipt.org.phone}</div>}
        </div>
        <div className="my-3 border-t border-dashed border-gray-300" />
        <div className="flex justify-between text-xs">
          <span>Receipt: <b>{p.receiptNo}</b></span>
          <span>{datetime(p.paidAt)}</span>
        </div>
        <div className="mt-2 text-xs">Student: {receipt.studentName} ({receipt.studentNo})</div>
        {receipt.receiverName && <div className="mt-0.5 text-xs text-gray-500">Received by: {receipt.receiverName}</div>}
        <div className="mt-3 space-y-1 text-xs">
          {receipt.allocations.map((a) => (
            <div key={a.id} className="flex justify-between"><span>{a.feeLabel ?? "Fee"}</span><span>{money(a.amountCents)}</span></div>
          ))}
        </div>
        <div className="my-3 border-t border-dashed border-gray-300" />
        <div className="flex justify-between font-bold"><span>TOTAL ({p.method})</span><span>{money(p.amountCents)}</span></div>
        <div className="mt-3 text-center text-xs text-gray-500">Thank you</div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="outline" onClick={() => window.print()}><Receipt className="h-4 w-4" /> Print</Btn>
        <Btn onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}
