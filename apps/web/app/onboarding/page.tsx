"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "../../src/lib/api";
import { Btn, Card, Field, Input, Select, Spinner } from "../../src/components/ui";
import { useMe } from "../../src/components/shell";

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState({ name: "", phone: "", address: "", studentIdPrefix: "" });
  const [klass, setKlass] = useState({ name: "", subjectId: "", gradeIds: [] as string[], weekday: "1", startTime: "16:00", endTime: "18:00", feeCents: "250000" });
  const [students, setStudents] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { data: refData } = useQuery({
    queryKey: ["reference"],
    queryFn: async () => {
      await post("/api/orgs/reference/seed");
      return get<{ subjects: { id: string; name: string }[]; grades: { id: string; name: string }[] }>("/api/orgs/reference");
    },
    enabled: !!me?.orgId,
  });

  if (isLoading) return <Spinner />;
  if (!me?.orgId) {
    router.replace("/login");
    return null;
  }

  const steps = ["Welcome", "Your organization", "First class", "Invite students", "Done"];

  async function saveOrg() {
    setBusy(true);
    setErr("");
    try {
      await patch("/api/orgs/current", {
        name: org.name || undefined,
        phone: org.phone || undefined,
        address: org.address || undefined,
        studentIdPrefix: org.studentIdPrefix || undefined,
      });
      setStep(2);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveClass() {
    setBusy(true);
    setErr("");
    try {
      const r = await post<{ id: string }>("/api/classes", {
        name: klass.name,
        subjectId: klass.subjectId || undefined,
        type: "group",
        mode: "physical",
        feeCents: Number(klass.feeCents) || 0,
        schedules: [{ weekday: Number(klass.weekday), startTime: klass.startTime, endTime: klass.endTime }],
      });
      setKlass((k) => ({ ...k, id: r.id }));
      setStep(3);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importStudents() {
    setBusy(true);
    setErr("");
    try {
      const rows = students
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((name) => ({ name, class: klass.name }));
      if (rows.length) await post("/api/students/import", { rows });
      setStep(4);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <Card className="w-full max-w-lg">
        <div className="mb-5 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand-500" : "bg-gray-200"}`} />
          ))}
        </div>
        <h1 className="mb-1 text-lg font-bold">{steps[step]}</h1>
        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Welcome to ClassFlow, {me.user.fullName.split(" ")[0]}. Let&apos;s set up your workspace — it takes
              about a minute.
            </p>
            <Btn onClick={() => setStep(1)}>Get started</Btn>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <Field label="Organization name">
              <Input defaultValue={me.memberships[0]?.orgName} onChange={(e) => setOrg((o) => ({ ...o, name: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input value={org.phone} onChange={(e) => setOrg((o) => ({ ...o, phone: e.target.value }))} />
              </Field>
              <Field label="Student ID prefix" hint="e.g. VID → VID-000001">
                <Input value={org.studentIdPrefix} onChange={(e) => setOrg((o) => ({ ...o, studentIdPrefix: e.target.value.toUpperCase().slice(0, 4) }))} maxLength={4} />
              </Field>
            </div>
            <Field label="Address">
              <Input value={org.address} onChange={(e) => setOrg((o) => ({ ...o, address: e.target.value }))} />
            </Field>
            <div className="flex gap-2">
              <Btn onClick={saveOrg} disabled={busy}>Continue</Btn>
              <Btn variant="ghost" onClick={() => setStep(2)}>Skip</Btn>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <Field label="Class name">
              <Input value={klass.name} onChange={(e) => setKlass((k) => ({ ...k, name: e.target.value }))} placeholder="Mathematics — Grade 11" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Subject">
                <Select value={klass.subjectId} onChange={(e) => setKlass((k) => ({ ...k, subjectId: e.target.value }))}>
                  <option value="">—</option>
                  {refData?.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Monthly fee (Rs.)">
                <Input type="number" value={String(Number(klass.feeCents) / 100)} onChange={(e) => setKlass((k) => ({ ...k, feeCents: String(Math.round(Number(e.target.value) * 100)) }))} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Day">
                <Select value={klass.weekday} onChange={(e) => setKlass((k) => ({ ...k, weekday: e.target.value }))}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Start">
                <Input type="time" value={klass.startTime} onChange={(e) => setKlass((k) => ({ ...k, startTime: e.target.value }))} />
              </Field>
              <Field label="End">
                <Input type="time" value={klass.endTime} onChange={(e) => setKlass((k) => ({ ...k, endTime: e.target.value }))} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Btn onClick={saveClass} disabled={busy || !klass.name}>Create class</Btn>
              <Btn variant="ghost" onClick={() => setStep(3)}>Skip</Btn>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <Field label="Student names" hint="One name per line — guardians and details can be added later">
              <textarea className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={6} value={students} onChange={(e) => setStudents(e.target.value)} placeholder={"Kasun Silva\nAmaya Perera"} />
            </Field>
            <div className="flex gap-2">
              <Btn onClick={importStudents} disabled={busy}>Import</Btn>
              <Btn variant="ghost" onClick={() => setStep(4)}>Skip</Btn>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">You&apos;re all set. Your dashboard is ready.</p>
            <Btn
              onClick={async () => {
                qc.clear();
                router.push("/dashboard");
              }}
            >
              Go to dashboard
            </Btn>
          </div>
        )}
      </Card>
    </div>
  );
}
