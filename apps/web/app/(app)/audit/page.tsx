"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../../src/lib/api";
import { Card, PageHeader, Spinner, Table, Badge } from "../../../src/components/ui";
import { datetime } from "../../../src/lib/format";

type Row = { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; metadata: string | null; createdAt: string };

export default function Audit() {
  const [page, setPage] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ["audit", page],
    queryFn: () => get<{ rows: Row[]; hasMore: boolean }>(`/api/dashboard/audit?page=${page + 1}&limit=50`),
  });

  return (
    <div>
      <PageHeader title="Audit log" />
      <Card>
        {isLoading ? <Spinner /> : (
          <>
            <Table head={["When", "Actor", "Action", "Entity", "Detail"]}>
              {data!.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{datetime(r.createdAt)}</td>
                  <td className="px-3 py-2 text-sm">{r.actorName ?? "system"}</td>
                  <td className="px-3 py-2"><Badge color="brand">{r.action}</Badge></td>
                  <td className="px-3 py-2 text-xs">{r.entity}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-400">{r.metadata ?? "—"}</td>
                </tr>
              ))}
              {data!.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-400">No events</td></tr>}
            </Table>
            <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
              <span>Page {page + 1}</span>
              <div className="flex gap-2">
                <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
                <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={!data!.hasMore} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
