"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, Upload, UserPlus } from "lucide-react";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Table, Badge } from "../../../src/components/ui";
import { money, date } from "../../../src/lib/format";

type StudentRow = {
  id: string;
  studentNo: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  gradeName: string | null;
  createdAt: string;
};

export default function Students() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", gradeId: "", guardianName: "", guardianPhone: "", classId: "" });
  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; errors: string[] }[] } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["students", q, status, page],
    queryFn: () => get<{ students: StudentRow[]; total: number }>(`/api/students?q=${encodeURIComponent(q)}${status === "all" ? "" : `&status=${status}`}&page=${page + 1}&limit=25`),
  });
  const { data: ref } = useQuery({ queryKey: ["reference"], queryFn: () => get<{ grades: { id: string; name: string }[] }>("/api/orgs/reference") });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });

  const createMut = useMutation({
    mutationFn: () =>
      post("/api/students", {
        fullName: form.fullName,
        phone: form.phone || undefined,
        email: form.email || undefined,
        gradeId: form.gradeId || undefined,
        guardianName: form.guardianName || undefined,
        guardianPhone: form.guardianPhone || undefined,
        classId: form.classId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      setCreateOpen(false);
      setForm({ fullName: "", phone: "", email: "", gradeId: "", guardianName: "", guardianPhone: "", classId: "" });
    },
  });

  const importMut = useMutation({
    mutationFn: () => {
      const rows = csv
        .split("\n")
        .map((l) => l.split(",").map((c) => c.trim()))
        .filter((c) => c[0])
        .map((c) => ({ name: c[0]!, phone: c[1], grade: c[2], class: c[3], guardian: c[4], guardianPhone: c[5] }));
      return post<{ imported: number; errors: { row: number; errors: string[] }[] }>("/api/students/import", { rows });
    },
    onSuccess: (r) => {
      setImportResult(r);
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title="Students"
        sub={data ? `${data.total} total` : undefined}
        action={
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import CSV
            </Btn>
            <Btn onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Add student
            </Btn>
          </div>
        }
      />
      <Card>
        <div className="mb-4 flex gap-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(0); }} className="max-w-xs flex-1" placeholder="Name, ID, or phone…" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="w-36">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={["ID", "Name", "Grade", "Status", "Registered"]}>
            {data!.students.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{s.studentNo}</td>
                <td className="px-3 py-2">
                  <Link href={`/students/${s.id}`} className="font-medium text-brand-600 hover:underline">
                    {s.fullName}
                  </Link>
                  {s.phone && <div className="text-xs text-gray-400">{s.phone}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{s.gradeName ?? "—"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-3 py-2 text-xs text-gray-400">{date(s.createdAt)}</td>
              </tr>
            ))}
            {data!.students.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                  No students found
                </td>
              </tr>
            )}
          </Table>
        )}
        {data && data.total > 25 && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Page {page + 1} of {Math.ceil(data.total / 25)}</span>
            <div className="flex gap-2">
              <Btn size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Btn>
              <Btn size="sm" variant="outline" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add student" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name">
            <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Grade">
            <Select value={form.gradeId} onChange={(e) => set("gradeId", e.target.value)}>
              <option value="">—</option>
              {ref?.grades.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Guardian name">
            <Input value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
          </Field>
          <Field label="Guardian phone">
            <Input value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} />
          </Field>
          <Field label="Enroll in class">
            <Select value={form.classId} onChange={(e) => set("classId", e.target.value)}>
              <option value="">—</option>
              {classList?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Btn>
          <Btn onClick={() => createMut.mutate()} disabled={!form.fullName || createMut.isPending}>
            <UserPlus className="h-4 w-4" /> Create
          </Btn>
        </div>
        {createMut.error && <div className="mt-2 text-xs text-red-600">{(createMut.error as Error).message}</div>}
      </Modal>

      <Modal open={importOpen} onClose={() => { setImportOpen(false); setImportResult(null); }} title="Import students (CSV)" wide>
        {!importResult ? (
          <>
            <p className="mb-2 text-xs text-gray-500">
              Columns: <code>name, phone, grade, class, guardian name, guardian phone</code> — one student per line.
            </p>
            <textarea
              className="h-48 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={"Kasun Silva, 0771234567, Grade 11, Mathematics — Grade 11, Priya Silva, 0777654321"}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Btn>
              <Btn onClick={() => importMut.mutate()} disabled={!csv.trim() || importMut.isPending}>Import</Btn>
            </div>
            {importMut.error && <div className="mt-2 text-xs text-red-600">{(importMut.error as Error).message}</div>}
          </>
        ) : (
          <div>
            <p className="text-sm">
              Imported <b>{importResult.imported}</b> students.
              {importResult.errors.length > 0 && ` ${importResult.errors.length} rows failed:`}
            </p>
            {importResult.errors.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-red-600">
                {importResult.errors.map((e) => (
                  <li key={e.row}>Row {e.row}: {e.errors.join(", ")}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <Btn onClick={() => { setImportOpen(false); setImportResult(null); setCsv(""); }}>Done</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
