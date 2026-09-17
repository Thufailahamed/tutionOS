"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "../../../src/lib/api";
import { Btn, Card, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Badge } from "../../../src/components/ui";
import { money } from "../../../src/lib/format";
import { useMe } from "../../../src/components/shell";
import { UserPlus, Plus } from "lucide-react";

export default function Settings() {
  const [tab, setTab] = useState<"org" | "members" | "reference" | "billing">("org");
  const { data: me } = useMe();

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(["org", "members", "reference", "billing"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}>
            {t === "org" ? "Organization" : t === "reference" ? "Reference data" : t}
          </button>
        ))}
      </div>
      {tab === "org" && <OrgTab />}
      {tab === "members" && <MembersTab me={me} />}
      {tab === "reference" && <ReferenceTab />}
      {tab === "billing" && <BillingTab />}
    </div>
  );
}

function OrgTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["org"], queryFn: () => get<{ name: string; email: string | null; phone: string | null; address: string | null; studentIdPrefix: string; type: string; settings: Record<string, unknown> }>("/api/orgs/current") });
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const mut = useMutation({ mutationFn: (body: unknown) => patch("/api/orgs/current", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }) });
  if (!data) return <Spinner />;
  const f = form ?? { name: data.name, email: data.email ?? "", phone: data.phone ?? "", address: data.address ?? "", studentIdPrefix: data.studentIdPrefix };
  return (
    <Card title="Organization">
      <div className="grid max-w-2xl grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} /></Field>
        <Field label="Type"><Input value={data.type} disabled /></Field>
        <Field label="Email"><Input value={f.email} onChange={(e) => setForm({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setForm({ ...f, phone: e.target.value })} /></Field>
        <Field label="Address"><Input value={f.address} onChange={(e) => setForm({ ...f, address: e.target.value })} /></Field>
        <Field label="Student ID prefix"><Input value={f.studentIdPrefix} onChange={(e) => setForm({ ...f, studentIdPrefix: e.target.value.toUpperCase().slice(0, 4) })} maxLength={4} /></Field>
      </div>
      <div className="mt-4">
        <Btn onClick={() => mut.mutate({ name: f.name, email: f.email || undefined, phone: f.phone || undefined, address: f.address || undefined, studentIdPrefix: f.studentIdPrefix })} disabled={mut.isPending}>Save</Btn>
        {mut.isSuccess && <span className="ml-3 text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

function MembersTab({ me }: { me: ReturnType<typeof useMe>["data"] }) {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ identifier: "", role: "staff" });
  const [perms, setPerms] = useState<{ memberId: string; grants: string[]; revokes: string[] } | null>(null);
  const { data } = useQuery({ queryKey: ["members"], queryFn: () => get<{ id: string; userId: string; fullName: string; email: string | null; role: string; status: string; grants: string[]; revokes: string[] }[]>("/api/orgs/members") });
  const { data: invites } = useQuery({ queryKey: ["invites"], queryFn: () => get<{ id: string; email: string | null; phone: string | null; role: string; status: string }[]>("/api/orgs/invites") });
  const { data: permList } = useQuery({ queryKey: ["perm-catalog"], queryFn: () => get<string[]>("/api/orgs/permissions"), enabled: !!perms });
  const inviteMut = useMutation({
    mutationFn: () => {
      const isEmail = invite.identifier.includes("@");
      return post("/api/orgs/invites", { role: invite.role, ...(isEmail ? { email: invite.identifier } : { phone: invite.identifier }) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invites"] }); setInviteOpen(false); },
  });
  const memberMut = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => patch(`/api/orgs/members/${id}`, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ["members"] }); setPerms(null); } });

  if (!data) return <Spinner />;
  const canManage = me?.member?.permissions.includes("staff.manage");

  return (
    <div className="space-y-4">
      <Card title="Members" action={canManage && <Btn size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Invite</Btn>}>
        <Table head={["Name", "Email", "Role", "Status", ""]}>
          {data.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 font-medium">{m.fullName}</td>
              <td className="px-3 py-2 text-xs">{m.email ?? "—"}</td>
              <td className="px-3 py-2">
                {canManage && m.role !== "owner" ? (
                  <Select value={m.role} className="w-28 px-2 py-1" onChange={(e) => memberMut.mutate({ id: m.id, body: { role: e.target.value } })}>
                    {["admin", "teacher", "staff"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                ) : <Badge color={m.role === "owner" ? "purple" : "brand"}>{m.role}</Badge>}
              </td>
              <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
              <td className="px-3 py-2 text-right">
                {canManage && m.role !== "owner" && (
                  <>
                    <Btn size="sm" variant="ghost" onClick={() => setPerms({ memberId: m.id, grants: m.grants, revokes: m.revokes })}>Permissions</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => memberMut.mutate({ id: m.id, body: { status: m.status === "active" ? "suspended" : "active" } })}>
                      {m.status === "active" ? "Suspend" : "Activate"}
                    </Btn>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Pending invites">
        <Table head={["Identifier", "Role", "Status"]}>
          {(invites ?? []).map((i) => (
            <tr key={i.id}><td className="px-3 py-2">{i.email ?? i.phone ?? "—"}</td><td className="px-3 py-2 capitalize">{i.role}</td><td className="px-3 py-2"><StatusBadge status={i.status} /></td></tr>
          ))}
          {(invites ?? []).length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-gray-400">No pending invites</td></tr>}
        </Table>
      </Card>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite member">
        <div className="space-y-3">
          <Field label="Email or phone"><Input value={invite.identifier} onChange={(e) => setInvite({ ...invite, identifier: e.target.value })} /></Field>
          <Field label="Role"><Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="staff">Staff</option><option value="teacher">Teacher</option><option value="admin">Admin</option></Select></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Btn>
          <Btn onClick={() => inviteMut.mutate()} disabled={!invite.identifier || inviteMut.isPending}>Send invite</Btn>
        </div>
        {inviteMut.error && <div className="mt-2 text-xs text-red-600">{(inviteMut.error as Error).message}</div>}
      </Modal>

      <Modal open={!!perms} onClose={() => setPerms(null)} title="Member permissions (overrides)" wide>
        {perms && (
          <>
            <p className="mb-3 text-xs text-gray-500">Grant extra permissions or revoke role defaults. Role grants apply unless revoked.</p>
            <div className="grid max-h-80 grid-cols-2 gap-1.5 overflow-y-auto">
              {(permList ?? []).map((p) => {
                const granted = perms.grants.includes(p);
                const revoked = perms.revokes.includes(p);
                return (
                  <div key={p} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1.5 text-xs">
                    <span className="font-mono">{p}</span>
                    <div className="flex gap-1">
                      <button className={`rounded px-1.5 py-0.5 ${granted ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`} onClick={() => setPerms({ ...perms, grants: granted ? perms.grants.filter((g) => g !== p) : [...perms.grants, p] })}>grant</button>
                      <button className={`rounded px-1.5 py-0.5 ${revoked ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-400"}`} onClick={() => setPerms({ ...perms, revokes: revoked ? perms.revokes.filter((r) => r !== p) : [...perms.revokes, p] })}>revoke</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPerms(null)}>Cancel</Btn>
              <Btn onClick={() => memberMut.mutate({ id: perms.memberId, body: { grants: perms.grants, revokes: perms.revokes } })} disabled={memberMut.isPending}>Save</Btn>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function ReferenceTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["reference"], queryFn: () => get<{ subjects: { id: string; name: string }[]; grades: { id: string; name: string }[]; streams: { id: string; name: string }[] }>("/api/orgs/reference") });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"subjects" | "grades" | "streams">("subjects");
  const addMut = useMutation({ mutationFn: () => post(`/api/orgs/reference/${kind}`, { name }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["reference"] }); setName(""); } });
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(["subjects", "grades", "streams"] as const).map((k) => (
        <Card key={k} title={k[0]!.toUpperCase() + k.slice(1)}>
          <ul className="mb-3 space-y-1">
            {data[k].map((r) => <li key={r.id} className="rounded bg-gray-50 px-2.5 py-1.5 text-sm">{r.name}</li>)}
            {data[k].length === 0 && <li className="text-sm text-gray-400">None yet</li>}
          </ul>
          {kind === k && (
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${k.slice(0, -1)}…`} />
              <Btn size="sm" onClick={() => addMut.mutate()} disabled={!name || addMut.isPending}><Plus className="h-3.5 w-3.5" /></Btn>
            </div>
          )}
          {kind !== k && <Btn size="sm" variant="ghost" onClick={() => setKind(k)}>Add</Btn>}
        </Card>
      ))}
    </div>
  );
}

function BillingTab() {
  const qc = useQueryClient();
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => get<{ id: string; code: string; name: string; priceCents: number; interval: string; studentLimit: number | null; teacherLimit: number | null; aiCreditsMonthly: number; features: string[] }[]>("/api/billing/plans") });
  const { data: sub } = useQuery({ queryKey: ["subscription"], queryFn: () => get<{ subscription: { id: string; status: string; currentPeriodEnd: string; plan: { id: string; code: string; name: string; priceCents: number; interval: string; studentLimit: number | null; teacherLimit: number | null } } | null; usage: { students: number; teachers: number; aiCreditsUsed: number } }>("/api/billing/subscription") });
  const { data: invoices } = useQuery({ queryKey: ["invoices"], queryFn: () => get<{ id: string; amountCents: number; status: string; issuedAt: string; paidAt: string | null }[]>("/api/billing/invoices") });
  const changeMut = useMutation({ mutationFn: (planCode: string) => post("/api/billing/subscription/change", { planCode }), onSuccess: () => qc.invalidateQueries({ queryKey: ["subscription"] }) });

  if (!plans || !sub) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const current = sub.subscription?.plan.code === p.code;
          return (
            <Card key={p.id} className={current ? "ring-2 ring-brand-500" : ""}>
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="mt-1 text-2xl font-bold">{p.priceCents === 0 ? "Free" : money(p.priceCents)}<span className="text-xs font-normal text-gray-400">/{p.interval === "yearly" ? "yr" : "mo"}</span></div>
              <ul className="mt-3 space-y-1 text-xs text-gray-500">
                <li>{p.studentLimit == null ? "Unlimited" : p.studentLimit} students</li>
                <li>{p.teacherLimit == null ? "Unlimited" : p.teacherLimit} staff</li>
                <li>{p.aiCreditsMonthly} AI credits/mo</li>
                {p.features.slice(0, 3).map((f) => <li key={f}>· {f.replace(/_/g, " ")}</li>)}
              </ul>
              <Btn size="sm" className="mt-4 w-full justify-center" variant={current ? "ghost" : "primary"} disabled={current || changeMut.isPending} onClick={() => changeMut.mutate(p.code)}>
                {current ? "Current plan" : "Switch"}
              </Btn>
            </Card>
          );
        })}
      </div>
      {sub.subscription && (
        <Card title="Usage">
          <div className="flex gap-8 text-sm">
            <span>Students: <b>{sub.usage.students}</b></span>
            <span>Staff: <b>{sub.usage.teachers}</b></span>
            <span>AI credits used: <b>{sub.usage.aiCreditsUsed}</b></span>
            <span>Renews: <b>{sub.subscription.currentPeriodEnd}</b></span>
          </div>
        </Card>
      )}
      <Card title="Invoices">
        <Table head={["Number", "Amount", "Status", "Date"]}>
          {(invoices ?? []).map((i) => (
            <tr key={i.id}><td className="px-3 py-2 font-mono text-xs">{i.id.slice(0, 8)}</td><td className="px-3 py-2">{money(i.amountCents)}</td><td className="px-3 py-2"><StatusBadge status={i.status} /></td><td className="px-3 py-2 text-xs">{i.issuedAt.slice(0, 10)}</td></tr>
          ))}
          {(invoices ?? []).length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No invoices</td></tr>}
        </Table>
      </Card>
    </div>
  );
}
