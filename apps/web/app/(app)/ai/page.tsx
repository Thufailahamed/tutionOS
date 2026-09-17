"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Badge, Textarea } from "../../../src/components/ui";
import { Sparkles, Send, Check, X, Eye } from "lucide-react";

type Question = { question: string; options: string[]; correctAnswer: string; explanation?: string; difficulty?: string; topic?: string; learningObjective?: string };
type Generation = { id: string; kind: string; status: string; model: string; createdAt: string; input: { subject: string; grade: string; topic: string; count: number; questionType: string; language: string }; output: Question[] };
type Insight = { kind: string; severity: "info" | "warning"; text: string };
type ChatMsg = { role: "user" | "assistant"; text: string };

export default function AiStudio() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"questions" | "insights" | "assistant">("questions");
  const [genForm, setGenForm] = useState({ subject: "", grade: "", topic: "", count: "5", difficulty: "medium", language: "english", questionType: "mcq" });
  const [viewGen, setViewGen] = useState<Generation | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");

  const { data: generations } = useQuery({ queryKey: ["ai-gens"], queryFn: () => get<Generation[]>("/api/ai/generations"), enabled: tab === "questions" });
  const { data: insights, isLoading: insightsLoading } = useQuery({ queryKey: ["ai-insights"], queryFn: () => get<{ insights: Insight[]; generatedAt: string }>("/api/ai/insights"), enabled: tab === "insights" });
  const { data: ref } = useQuery({ queryKey: ["reference"], queryFn: () => get<{ subjects: { id: string; name: string }[] }>("/api/orgs/reference") });

  const genMut = useMutation({
    mutationFn: () => post("/api/ai/questions/generate", { ...genForm, count: Number(genForm.count) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-gens"] }),
  });
  const reviewMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => post(`/api/ai/generations/${id}/review`, { action }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-gens"] }); setViewGen(null); },
  });
  const chatMut = useMutation({
    mutationFn: (text: string) => post<{ answer: string; tool?: string }>("/api/ai/assistant", { question: text }),
    onSuccess: (r) => setChat((c) => [...c, { role: "assistant", text: r.answer }]),
  });

  function sendChat() {
    if (!input.trim()) return;
    setChat((c) => [...c, { role: "user", text: input }]);
    chatMut.mutate(input);
    setInput("");
  }

  return (
    <div>
      <PageHeader title="AI Studio" sub="Question generation, insights, and assistant — grounded in your real data" />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["questions", "insights", "assistant"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>{t}</button>
        ))}
      </div>

      {tab === "questions" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Generate questions">
            <div className="space-y-3">
              <Field label="Subject">
                <Select value={genForm.subject} onChange={(e) => setGenForm({ ...genForm, subject: e.target.value })}>
                  <option value="">—</option>
                  {ref?.subjects.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Topic"><Input value={genForm.topic} onChange={(e) => setGenForm({ ...genForm, topic: e.target.value })} placeholder="Quadratic equations" /></Field>
              <Field label="Grade"><Input value={genForm.grade} onChange={(e) => setGenForm({ ...genForm, grade: e.target.value })} placeholder="Grade 10" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Count"><Input type="number" min={1} max={20} value={genForm.count} onChange={(e) => setGenForm({ ...genForm, count: e.target.value })} /></Field>
                <Field label="Difficulty"><Select value={genForm.difficulty} onChange={(e) => setGenForm({ ...genForm, difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></Field>
                <Field label="Language"><Select value={genForm.language} onChange={(e) => setGenForm({ ...genForm, language: e.target.value })}><option value="english">English</option><option value="sinhala">Sinhala</option><option value="tamil">Tamil</option></Select></Field>
                <Field label="Type"><Select value={genForm.questionType} onChange={(e) => setGenForm({ ...genForm, questionType: e.target.value })}><option value="mcq">MCQ</option><option value="short_answer">Short answer</option><option value="structured">Structured</option><option value="essay">Essay</option><option value="true_false">True/False</option></Select></Field>
              </div>
              <Btn className="w-full justify-center" onClick={() => genMut.mutate()} disabled={!genForm.subject || !genForm.topic || !genForm.grade || genMut.isPending}>
                <Sparkles className="h-4 w-4" /> {genMut.isPending ? "Generating…" : "Generate"}
              </Btn>
              {genMut.error && <div className="text-xs text-red-600">{(genMut.error as Error).message}</div>}
            </div>
          </Card>
          <Card title="Drafts (review before publishing)" className="lg:col-span-2">
            {!generations ? <Spinner /> : (
              <Table head={["Prompt", "Kind", "Status", "Created", ""]}>
                {generations.map((g) => (
                  <tr key={g.id}>
                    <td className="max-w-xs truncate px-3 py-2 text-sm">{g.input.subject} — {g.input.topic}<span className="text-xs text-gray-400"> · {g.input.grade} · {g.input.count}q</span></td>
                    <td className="px-3 py-2 text-xs">{g.kind}</td>
                    <td className="px-3 py-2"><Badge color={g.status === "published" ? "green" : g.status === "approved" ? "blue" : g.status === "rejected" ? "red" : "amber"}>{g.status}</Badge></td>
                    <td className="px-3 py-2 text-xs text-gray-400">{g.createdAt.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right"><Btn size="sm" variant="ghost" onClick={() => setViewGen(g)}><Eye className="h-3.5 w-3.5" /> Review</Btn></td>
                  </tr>
                ))}
                {generations.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">No generations yet</td></tr>}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === "insights" && (
        <Card title="Insights from your data">
          {insightsLoading ? <Spinner /> : (
            <ul className="space-y-3">
              {(insights?.insights ?? []).map((i, idx) => (
                <li key={idx} className={`rounded-lg border-l-4 p-3 ${i.severity === "warning" ? "border-amber-400 bg-amber-50" : "border-blue-400 bg-blue-50"}`}>
                  <div className="text-xs font-semibold uppercase text-gray-500">{i.kind}</div>
                  <div className="mt-0.5 text-sm text-gray-700">{i.text}</div>
                </li>
              ))}
              {(insights?.insights ?? []).length === 0 && <li className="py-8 text-center text-sm text-gray-400">No insights — everything looks healthy.</li>}
            </ul>
          )}
        </Card>
      )}

      {tab === "assistant" && (
        <Card title="Assistant" className="mx-auto max-w-2xl">
          <div className="flex h-96 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto">
              {chat.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">
                  Ask about your data — e.g. <i>"who hasn't paid this month?"</i>, <i>"attendance summary"</i>, <i>"exam results for Grade 11"</i>
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-brand-600 text-white" : "bg-gray-100"}`}>
                  {m.text}
                </div>
              ))}
              {chatMut.isPending && <div className="w-16 rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400">…</div>}
            </div>
            <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about students, fees, attendance…" onKeyDown={(e) => e.key === "Enter" && sendChat()} />
              <Btn onClick={sendChat} disabled={!input.trim() || chatMut.isPending}><Send className="h-4 w-4" /></Btn>
            </div>
          </div>
        </Card>
      )}

      <Modal open={!!viewGen} onClose={() => setViewGen(null)} title="Review generation" wide>
        {viewGen && (
          <>
            <p className="mb-3 text-xs text-gray-500">{viewGen.input.subject} — {viewGen.input.topic} · {viewGen.input.grade} · {viewGen.input.questionType} · {viewGen.input.language}</p>
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {viewGen.output.map((q, i) => (
                <div key={i} className="rounded-lg border border-gray-100 p-3 text-sm">
                  <div className="font-medium">{i + 1}. {q.question}</div>
                  {q.options.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-4 text-xs text-gray-600">
                      {q.options.map((o, j) => <li key={j} className={String(j) === q.correctAnswer || o === q.correctAnswer ? "font-semibold text-emerald-600" : ""}>{String.fromCharCode(65 + j)}. {o}</li>)}
                    </ul>
                  )}
                  {q.options.length === 0 && <div className="mt-1 pl-4 text-xs text-emerald-600">Answer: {q.correctAnswer}</div>}
                  {q.explanation && <div className="mt-1 pl-4 text-xs text-gray-400">{q.explanation}</div>}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="outline" onClick={() => reviewMut.mutate({ id: viewGen.id, action: "reject" })}><X className="h-4 w-4" /> Reject</Btn>
              <Btn variant="outline" onClick={() => reviewMut.mutate({ id: viewGen.id, action: "approve" })}><Check className="h-4 w-4" /> Approve</Btn>
              <Btn onClick={() => reviewMut.mutate({ id: viewGen.id, action: "publish" })}>Publish</Btn>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
