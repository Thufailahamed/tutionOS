"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileText, Film } from "lucide-react";
import { get, post, del, apiFetch } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Badge } from "../../../src/components/ui";
import { datetime } from "../../../src/lib/format";

type Material = { id: string; title: string; classId: string; folder: string; type: string; fileKey: string | null; url: string | null; visibility: string; createdAt: string; file: { id: string; name: string; sizeBytes: number | null } | null };
type Lesson = { id: string; title: string; classId: string; date: string | null; fileKey: string; durationSeconds: number | null; visibility: string; createdAt: string; file?: { id: string } | null };

export default function Materials() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"materials" | "lessons">("materials");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", classId: "", visibility: "class", type: "file", duration: "" });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");

  const { data: materials, isLoading } = useQuery({ queryKey: ["materials"], queryFn: () => get<Material[]>("/api/materials"), enabled: tab === "materials" });
  const { data: lessons } = useQuery({ queryKey: ["lessons"], queryFn: () => get<Lesson[]>("/api/lessons"), enabled: tab === "lessons" });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });

  async function upload(): Promise<{ id: string; key: string } | null> {
    if (!file) return null;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", tab === "lessons" ? "lesson" : "material");
    return apiFetch<{ id: string; key: string }>("/api/files", { method: "POST", body: fd });
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const up = await upload();
      const body =
        tab === "lessons"
          ? { classId: form.classId, title: form.title, visibility: form.visibility, fileId: up!.id, durationSeconds: form.duration ? Number(form.duration) * 60 : undefined }
          : { classId: form.classId, title: form.title, visibility: form.visibility, type: form.type, fileId: up?.id, url: form.type === "link" ? form.url : undefined };
      if (tab === "lessons" && !up) throw new Error("Choose a file to upload");
      return post(tab === "lessons" ? "/api/lessons" : "/api/materials", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [tab] });
      setOpen(false);
      setForm({ title: "", url: "", classId: "", visibility: "class", type: "file", duration: "" });
      setFile(null);
      setErr("");
    },
    onError: (e) => setErr((e as Error).message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del(tab === "lessons" ? `/api/lessons/${id}` : `/api/materials/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [tab] }),
  });

  const rows = tab === "materials" ? materials : lessons;

  return (
    <div>
      <PageHeader title={tab === "materials" ? "Learning materials" : "Recorded lessons"} action={<Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add {tab === "materials" ? "material" : "lesson"}</Btn>} />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["materials", "lessons"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>{t === "lessons" ? "Recorded lessons" : t}</button>
        ))}
      </div>
      <Card>
        {isLoading ? <Spinner /> : (
          <Table head={["Title", "Class", "File", tab === "materials" ? "Visibility" : "Duration", "Added", ""]}>
            {(rows ?? []).map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 font-medium">
                    {tab === "lessons" ? <Film className="h-4 w-4 text-brand-400" /> : <FileText className="h-4 w-4 text-brand-400" />}
                    {m.title}
                  </div>
                  {tab === "materials" && (m as Material).folder !== "General" && <div className="mt-0.5 text-xs text-gray-400">{(m as Material).folder}</div>}
                </td>
                <td className="px-3 py-2 text-sm">{classList?.find((c) => c.id === m.classId)?.name ?? "—"}</td>
                <td className="px-3 py-2">
                  {tab === "materials" && (m as Material).type === "link" ? (
                    <a className="text-xs text-brand-600 hover:underline" href={(m as Material).url!} target="_blank" rel="noreferrer">Open link</a>
                  ) : (m as Material).file?.id ? (
                    <a className="text-xs text-brand-600 hover:underline" href={`/api/files/${(m as Material).file!.id}`} target="_blank" rel="noreferrer">Download</a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs capitalize">{tab === "materials" ? (m as Material).visibility : (m as Lesson).durationSeconds ? `${Math.round((m as Lesson).durationSeconds! / 60)} min` : "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{datetime(m.createdAt)}</td>
                <td className="px-3 py-2 text-right"><Btn size="sm" variant="ghost" onClick={() => delMut.mutate(m.id)}>Delete</Btn></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">Nothing uploaded yet</td></tr>}
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={`Add ${tab === "materials" ? "material" : "recorded lesson"}`}>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Class"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">—</option>{classList?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          {tab === "materials" && (
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="file">File upload</option>
                <option value="link">External link</option>
              </Select>
            </Field>
          )}
          {form.type === "link" && tab === "materials" && (
            <Field label="URL"><Input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
          )}
          {tab === "lessons" && (
            <Field label="Duration (minutes)"><Input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></Field>
          )}
          <Field label="Visibility" hint="'students' requires per-student grants; 'class' is visible to all enrolled">
            <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="class">Enrolled students</option>
              <option value="batch">Whole batch</option>
              <option value="all">Everyone</option>
              <option value="students">Specific students</option>
            </Select>
          </Field>
          {form.type === "file" && (
            <Field label={`File ${tab === "lessons" ? "(video/audio)" : "(PDF, image, doc)"}`}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-brand-400">
                <Upload className="h-4 w-4" />
                {file ? file.name : "Choose file…"}
                <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept={tab === "lessons" ? "video/*,audio/*" : ".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp"} />
              </label>
            </Field>
          )}
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn onClick={() => createMut.mutate()} disabled={!form.title || !form.classId || createMut.isPending}>{createMut.isPending ? "Uploading…" : "Save"}</Btn>
        </div>
      </Modal>
    </div>
  );
}
