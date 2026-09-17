"use client";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get } from "../../../src/lib/api";
import { Card, PageHeader, SearchInput, Spinner } from "../../../src/components/ui";

type Results = {
  students: { id: string; name: string; no: string; status: string }[];
  classes: { id: string; name: string }[];
  exams: { id: string; title: string; date: string }[];
  payments: { id: string; receiptNo: string; amount: number }[];
  materials: { id: string; title: string }[];
  guardians: { id: string; name: string; phone: string }[];
};

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => get<Results>(`/api/dashboard/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 1,
  });

  const sections: { key: keyof Results; label: string; href: (id: string) => string; text: (r: never) => string }[] = [
    { key: "students", label: "Students", href: (id) => `/students/${id}`, text: (r: Results["students"][0]) => `${r.name} · ${r.no}` },
    { key: "classes", label: "Classes", href: (id) => `/classes/${id}`, text: (r: Results["classes"][0]) => r.name },
    { key: "exams", label: "Exams", href: (id) => `/exams/${id}`, text: (r: Results["exams"][0]) => r.title },
    { key: "payments", label: "Payments", href: () => "/finance", text: (r: Results["payments"][0]) => `${r.receiptNo} · Rs.${(r.amount / 100).toFixed(2)}` },
    { key: "materials", label: "Materials", href: () => "/materials", text: (r: Results["materials"][0]) => r.title },
    { key: "guardians", label: "Guardians", href: () => "/students", text: (r: Results["guardians"][0]) => `${r.name} · ${r.phone}` },
  ];

  return (
    <div>
      <PageHeader title="Search" />
      <SearchInput value={q} onChange={setQ} placeholder="Search students, classes, exams, receipts…" className="mb-6 max-w-xl" autoFocus />
      {debounced.length > 1 && (isLoading || !data ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((s) => {
            const items = data[s.key] as unknown[];
            if (!items?.length) return null;
            return (
              <Card key={s.key} title={s.label}>
                <ul className="divide-y divide-gray-50">
                  {items.map((r) => {
                    const row = r as { id: string };
                    return (
                      <li key={row.id}>
                        <Link href={s.href(row.id)} className="block px-2 py-2 text-sm text-brand-600 hover:bg-gray-50">
                          {s.text(r as never)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
          {sections.every((s) => !(data[s.key] as unknown[])?.length) && (
            <p className="text-sm text-gray-400">No results for “{debounced}”</p>
          )}
        </div>
      ))}
    </div>
  );
}
