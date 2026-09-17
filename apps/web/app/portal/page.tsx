"use client";
import Link from "next/link";
import { usePortalMe } from "../../src/components/portalShell";
import { Card, Spinner, Badge } from "../../src/components/ui";

export default function PortalHome() {
  const { data, isLoading } = usePortalMe();
  if (isLoading || !data) return <Spinner />;

  return (
    <div>
      <h1 className="mb-4 text-lg font-bold">My {data.children[0]?.portalRole === "guardian" ? "children" : "classes"}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.children.map((c) => (
          <Link key={c.id} href={`/portal/${c.id}`}>
            <Card className="transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{c.fullName}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{c.orgName}</div>
                  <div className="mt-0.5 text-xs text-gray-400">{c.studentNo} {c.gradeName && `· ${c.gradeName}`}</div>
                </div>
                <Badge color="brand">{c.portalRole === "guardian" ? "parent" : "student"}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
