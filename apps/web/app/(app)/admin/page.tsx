"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../../src/lib/api";
import { Btn, Card, PageHeader, Spinner, StatusBadge, Table, StatCard } from "../../../src/components/ui";
import { money, date } from "../../../src/lib/format";

type Overview = { organizations: number; users: number; students: number; activeClasses: number; activeSubscriptions: number; platformRevenueCents: number; newOrgs30d: number };
type OrgRow = { id: string; name: string; type: string; status: string; planCode: string | null; members: number; students: number; createdAt: string };

export default function Admin() {
  const qc = useQueryClient();
  const { data: ov } = useQuery({ queryKey: ["admin-ov"], queryFn: () => get<Overview>("/api/admin/overview") });
  const { data: orgs } = useQuery({ queryKey: ["admin-orgs"], queryFn: () => get<OrgRow[]>("/api/admin/organizations") });
  const { data: users } = useQuery({ queryKey: ["admin-users"], queryFn: () => get<{ id: string; fullName: string; email: string | null; phone: string | null; status: string; isSuperAdmin: boolean; createdAt: string }[]>("/api/admin/users") });
  const toggleMut = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => post(`/api/admin/organizations/${id}/status`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-orgs"] }) });

  return (
    <div>
      <PageHeader title="Super admin" sub="Platform-wide view" />
      {!ov ? <Spinner /> : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Organizations" value={ov.organizations} />
          <StatCard label="Users" value={ov.users} />
          <StatCard label="Students" value={ov.students} />
          <StatCard label="Revenue" value={money(ov.platformRevenueCents)} />
          <StatCard label="Active subs" value={ov.activeSubscriptions} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Organizations">
          {!orgs ? <Spinner /> : (
            <Table head={["Name", "Type", "Plan", "Students", "Status", ""]}>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2"><div className="font-medium">{o.name}</div><div className="text-xs text-gray-400">{date(o.createdAt)}</div></td>
                  <td className="px-3 py-2 text-xs capitalize">{o.type}</td>
                  <td className="px-3 py-2 text-xs capitalize">{o.planCode ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{o.students}</td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2 text-right">
                    <Btn size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: o.id, status: o.status === "active" ? "suspended" : "active" })}>
                      {o.status === "active" ? "Suspend" : "Activate"}
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Users">
          {!users ? <Spinner /> : (
            <Table head={["Name", "Contact", "Status", "Joined"]}>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">{u.fullName}{u.isSuperAdmin && <span className="ml-1 text-xs text-purple-600">★</span>}</td>
                  <td className="px-3 py-2 text-xs">{u.email ?? u.phone ?? "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={u.status} /></td>
                  <td className="px-3 py-2 text-xs">{date(u.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
