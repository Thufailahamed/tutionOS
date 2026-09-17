"use client";
import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../../../src/lib/api";
import { Btn, Card, Input, PageHeader, Spinner, StatusBadge, Table, Badge } from "../../../../src/components/ui";
import { date, pct } from "../../../../src/lib/format";
import { Send } from "lucide-react";

type Result = { marks: number | null; percentage: number | null; grade: string | null; rank: number | null; remarks: string | null } | null;

type Detail = {
  id: string; title: string; type: string; date: string; maxMarks: number; status: string; className: string; subjectName: string;
  roster: { studentId: string; studentNo: string; fullName: string; result: Result }[];
  stats: { count: number; average: number | null; highest: number | null; lowest: number | null; passRate: number | null } | null;
};

export default function ExamDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [absents, setAbsents] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"entry" | "rankings">("entry");

  const { data, isLoading } = useQuery({ queryKey: ["exam", id], queryFn: () => get<Detail>(`/api/exams/${id}`) });
  const rankings = (data?.roster ?? [])
    .filter((r) => r.result?.marks != null)
    .map((r) => ({ studentNo: r.studentNo, fullName: r.fullName, marks: r.result!.marks!, percentage: r.result!.percentage, grade: r.result!.grade, rank: r.result!.rank }))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  const saveMut = useMutation({
    mutationFn: () => post(`/api/exams/${id}/results`, {
      results: data!.roster.filter((r) => marks[r.studentId] !== undefined || absents[r.studentId]).map((r) => ({ studentId: r.studentId, marks: absents[r.studentId] ? null : Number(marks[r.studentId]) })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exam", id] }); setMarks({}); setAbsents({}); },
  });
  const publishMut = useMutation({ mutationFn: () => post(`/api/exams/${id}/publish`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["exam", id] }) });

  if (isLoading || !data) return <Spinner />;
  const e = data;
  const published = e.status === "published";

  return (
    <div>
      <PageHeader
        title={e.title}
        sub={`${e.className} · ${date(e.date)} · out of ${e.maxMarks}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={e.status} />
            {!published && <Btn size="sm" onClick={() => publishMut.mutate()} disabled={publishMut.isPending}><Send className="h-3.5 w-3.5" /> Publish results</Btn>}
          </div>
        }
      />

      {data.stats && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><div className="text-xs text-gray-500">Average</div><div className="text-xl font-bold">{data.stats.average?.toFixed(1) ?? "—"}</div></Card>
          <Card className="p-4"><div className="text-xs text-gray-500">Highest</div><div className="text-xl font-bold">{data.stats.highest ?? "—"}</div></Card>
          <Card className="p-4"><div className="text-xs text-gray-500">Lowest</div><div className="text-xl font-bold">{data.stats.lowest ?? "—"}</div></Card>
          <Card className="p-4"><div className="text-xs text-gray-500">Pass rate</div><div className="text-xl font-bold">{data.stats.passRate != null ? `${data.stats.passRate.toFixed(0)}%` : "—"}</div></Card>
        </div>
      )}

      {published && (
        <div className="mb-4 flex gap-1 border-b border-gray-200">
          {(["entry", "rankings"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>{t === "entry" ? "Results" : "Rankings"}</button>
          ))}
        </div>
      )}

      {tab === "rankings" && published ? (
        <Card title="Rankings (competition — tied marks share rank)">
          <Table head={["Rank", "ID", "Name", "Marks", "%", "Grade"]}>
            {rankings.map((r) => (
              <tr key={r.studentNo}>
                <td className="px-3 py-2"><Badge color={r.rank === 1 ? "amber" : (r.rank ?? 9) <= 3 ? "brand" : "gray"}>#{r.rank}</Badge></td>
                <td className="px-3 py-2 font-mono text-xs">{r.studentNo}</td>
                <td className="px-3 py-2">{r.fullName}</td>
                <td className="px-3 py-2">{r.marks}</td>
                <td className="px-3 py-2 text-xs">{pct(r.percentage)}</td>
                <td className="px-3 py-2">{r.grade && <Badge color={["A", "B"].includes(r.grade) ? "green" : r.grade === "F" ? "red" : "amber"}>{r.grade}</Badge>}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
        <Card title={published ? "Results" : "Marks entry"}>
          <Table head={["ID", "Name", "Marks", "%", "Grade", "Absent"]}>
            {data.roster.map((r) => (
              <tr key={r.studentId}>
                <td className="px-3 py-2 font-mono text-xs">{r.studentNo}</td>
                <td className="px-3 py-2 text-sm">{r.fullName}</td>
                <td className="px-3 py-2">
                  {published ? (
                    <span>{r.result?.marks ?? "AB"}</span>
                  ) : (
                    <Input type="number" className="w-20 px-2 py-1" min={0} max={e.maxMarks} value={marks[r.studentId] ?? (r.result?.marks?.toString() ?? "")} onChange={(ev) => setMarks((m) => ({ ...m, [r.studentId]: ev.target.value }))} disabled={absents[r.studentId]} />
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{pct(r.result?.percentage ?? null)}</td>
                <td className="px-3 py-2">{r.result?.grade && <Badge color={["A", "B"].includes(r.result.grade) ? "green" : r.result.grade === "F" ? "red" : "amber"}>{r.result.grade}</Badge>}</td>
                <td className="px-3 py-2">
                  {published ? (
                    r.result && r.result.marks == null ? "Yes" : ""
                  ) : (
                    <input type="checkbox" checked={!!absents[r.studentId]} onChange={(ev) => setAbsents((a) => ({ ...a, [r.studentId]: ev.target.checked }))} />
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {!published && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-gray-400">Grades auto-computed on GCE bands (A≥75, B≥65, C≥50, S≥35, F&lt;35)</span>
              <Btn onClick={() => saveMut.mutate()} disabled={Object.keys(marks).length === 0 && Object.keys(absents).length === 0 || saveMut.isPending}>Save marks</Btn>
            </div>
          )}
          {saveMut.error && <div className="mt-2 text-xs text-red-600">{(saveMut.error as Error).message}</div>}
          {publishMut.error && <div className="mt-2 text-xs text-red-600">{(publishMut.error as Error).message}</div>}
        </Card>
      )}
    </div>
  );
}
