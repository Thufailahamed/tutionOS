"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Bell } from "lucide-react";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Badge, Textarea } from "../../../src/components/ui";
import { datetime } from "../../../src/lib/format";

type Announcement = { id: string; title: string; body: string; audience: string; classId: string | null; studentIds: string[]; authorName: string; createdAt: string };
type Notification = { id: string; title: string; body: string | null; type: string; status: string; readAt: string | null; createdAt: string };
type Thread = { id: string; kind: string; subject: string | null; studentId: string | null; studentName: string | null; lastMessageAt: string; participants: { userId: string; name: string }[] };
type Message = { id: string; senderUserId: string; senderName: string; body: string; createdAt: string };
type Contacts = { members: { userId: string; name: string; role: string }[]; guardians: { userId: string; name: string }[] };

export default function Comms() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"announcements" | "inbox" | "messages">("announcements");
  const [open, setOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [form, setForm] = useState({ title: "", body: "", audience: "all", classId: "" });
  const [msgForm, setMsgForm] = useState({ subject: "", body: "", toUserId: "" });
  const [reply, setReply] = useState("");

  const { data: announcements } = useQuery({ queryKey: ["announcements"], queryFn: () => get<Announcement[]>("/api/comms/announcements"), enabled: tab === "announcements" });
  const { data: notifs } = useQuery({ queryKey: ["notifs"], queryFn: () => get<{ notifications: Notification[]; unread: number }>("/api/comms/notifications"), enabled: tab === "inbox" });
  const { data: threads } = useQuery({ queryKey: ["threads"], queryFn: () => get<Thread[]>("/api/comms/threads"), enabled: tab === "messages" });
  const { data: messages } = useQuery({ queryKey: ["thread", threadId], queryFn: () => get<Message[]>(`/api/comms/threads/${threadId}/messages`), enabled: !!threadId });
  const { data: classList } = useQuery({ queryKey: ["classes"], queryFn: () => get<{ id: string; name: string }[]>("/api/classes") });
  const { data: contacts } = useQuery({ queryKey: ["contacts"], queryFn: () => get<Contacts>("/api/comms/contacts"), enabled: msgOpen });

  const annMut = useMutation({
    mutationFn: () => post("/api/comms/announcements", { title: form.title, body: form.body, audience: form.audience, classId: form.classId || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); setOpen(false); setForm({ title: "", body: "", audience: "all", classId: "" }); },
  });
  const msgMut = useMutation({
    mutationFn: () => post("/api/comms/threads", { subject: msgForm.subject || undefined, body: msgForm.body, participantUserIds: [msgForm.toUserId] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["threads"] }); setMsgOpen(false); setMsgForm({ subject: "", body: "", toUserId: "" }); },
  });
  const replyMut = useMutation({
    mutationFn: () => post(`/api/comms/threads/${threadId}/messages`, { body: reply }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["thread", threadId] }); setReply(""); },
  });
  const readMut = useMutation({ mutationFn: (id: string) => post(`/api/comms/notifications/read`, { ids: [id] }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifs"] }) });

  const activeThread = threads?.find((t) => t.id === threadId);

  return (
    <div>
      <PageHeader
        title="Communication"
        action={
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => setMsgOpen(true)}><Send className="h-4 w-4" /> Message</Btn>
            <Btn onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Announcement</Btn>
          </div>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["announcements", "inbox", "messages"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>
            {t === "inbox" ? `Notifications${notifs?.unread ? ` (${notifs.unread})` : ""}` : t}
          </button>
        ))}
      </div>

      {tab === "announcements" && (
        <Card>
          {!announcements ? <Spinner /> : (
            <Table head={["Title", "Audience", "Author", "Sent"]}>
              {announcements.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2"><div className="font-medium">{a.title}</div><div className="max-w-md truncate text-xs text-gray-400">{a.body}</div></td>
                  <td className="px-3 py-2 text-xs capitalize">
                    {a.audience}
                    {a.studentIds.length > 0 && <Badge color="blue">{a.studentIds.length} students</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs">{a.authorName}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{datetime(a.createdAt)}</td>
                </tr>
              ))}
              {announcements.length === 0 && <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-gray-400">No announcements sent</td></tr>}
            </Table>
          )}
        </Card>
      )}

      {tab === "inbox" && (
        <Card title="Notification center">
          {!notifs ? <Spinner /> : (
            <ul className="divide-y divide-gray-50">
              {notifs.notifications.map((n) => (
                <li key={n.id} className={`flex items-start gap-3 px-2 py-3 ${n.readAt ? "opacity-60" : ""}`}>
                  <Bell className={`mt-0.5 h-4 w-4 ${n.readAt ? "text-gray-300" : "text-brand-500"}`} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500">{n.body}</div>}
                    <div className="mt-0.5 text-xs text-gray-400">{datetime(n.createdAt)} · {n.type}</div>
                  </div>
                  {!n.readAt && <Btn size="sm" variant="ghost" onClick={() => readMut.mutate(n.id)}>Mark read</Btn>}
                </li>
              ))}
              {notifs.notifications.length === 0 && <li className="py-10 text-center text-sm text-gray-400">No notifications</li>}
            </ul>
          )}
        </Card>
      )}

      {tab === "messages" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Threads">
            {!threads ? <Spinner /> : (
              <ul className="divide-y divide-gray-50">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button className={`w-full px-2 py-2.5 text-left hover:bg-gray-50 ${threadId === t.id ? "bg-brand-50" : ""}`} onClick={() => setThreadId(t.id)}>
                      <div className="truncate text-sm font-medium">{t.subject ?? "Conversation"}</div>
                      <div className="mt-0.5 truncate text-xs text-gray-400">
                        {t.participants.map((p) => p.name).join(", ")} · {datetime(t.lastMessageAt)}
                      </div>
                    </button>
                  </li>
                ))}
                {threads.length === 0 && <li className="py-8 text-center text-sm text-gray-400">No conversations</li>}
              </ul>
            )}
          </Card>
          <Card title={activeThread?.subject ?? "Conversation"} className="lg:col-span-2">
            {!threadId ? <p className="py-10 text-center text-sm text-gray-400">Pick a thread</p> : !messages ? <Spinner /> : (
              <>
                <div className="max-h-96 space-y-3 overflow-y-auto">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-lg bg-gray-50 p-3">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <b>{m.senderName}</b>
                        <span>{datetime(m.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-sm">{m.body}</div>
                    </div>
                  ))}
                  {messages.length === 0 && <p className="py-6 text-center text-sm text-gray-400">No messages yet</p>}
                </div>
                <div className="mt-4 flex gap-2">
                  <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" onKeyDown={(e) => e.key === "Enter" && reply && replyMut.mutate()} />
                  <Btn onClick={() => replyMut.mutate()} disabled={!reply || replyMut.isPending}><Send className="h-4 w-4" /></Btn>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New announcement" wide>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Audience">
              <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="all">Everyone</option>
                <option value="class">One class</option>
                <option value="students">Students only</option>
                <option value="parents">Parents only</option>
              </Select>
            </Field>
            {form.audience === "class" && (
              <Field label="Class"><Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">—</option>{classList?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            )}
          </div>
          <p className="text-xs text-gray-400">Delivered in-app now; SMS/email/WhatsApp send automatically to recipients who enabled them in notification preferences.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn onClick={() => annMut.mutate()} disabled={!form.title || !form.body || annMut.isPending}>Send</Btn>
        </div>
        {annMut.error && <div className="mt-2 text-xs text-red-600">{(annMut.error as Error).message}</div>}
      </Modal>

      <Modal open={msgOpen} onClose={() => setMsgOpen(false)} title="New message">
        <div className="space-y-3">
          <Field label="To">
            <Select value={msgForm.toUserId} onChange={(e) => setMsgForm({ ...msgForm, toUserId: e.target.value })}>
              <option value="">Choose…</option>
              <optgroup label="Staff">
                {(contacts?.members ?? []).map((c) => <option key={c.userId} value={c.userId}>{c.name} ({c.role})</option>)}
              </optgroup>
              <optgroup label="Parents">
                {(contacts?.guardians ?? []).map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
              </optgroup>
            </Select>
          </Field>
          <Field label="Subject"><Input value={msgForm.subject} onChange={(e) => setMsgForm({ ...msgForm, subject: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={4} value={msgForm.body} onChange={(e) => setMsgForm({ ...msgForm, body: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setMsgOpen(false)}>Cancel</Btn>
          <Btn onClick={() => msgMut.mutate()} disabled={!msgForm.toUserId || !msgForm.body || msgMut.isPending}>Send</Btn>
        </div>
      </Modal>
    </div>
  );
}
