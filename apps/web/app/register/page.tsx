"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2 } from "lucide-react";
import { post } from "../../src/lib/api";
import { Btn, Card, Field, Input, Select } from "../../src/components/ui";

export default function Register() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", orgName: "", mode: "teacher" as "teacher" | "institute" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await post("/api/auth/register", {
        fullName: form.fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        password: form.password,
        orgName: form.mode === "institute" ? form.orgName : undefined,
      });
      qc.clear();
      router.push("/onboarding");
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-950 to-brand-800 p-6">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-brand-600" />
          <div>
            <div className="font-bold">Create your account</div>
            <div className="text-xs text-gray-400">Free plan included — no card needed</div>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(
            [
              ["teacher", "I'm a teacher", "Solo classes, no institute needed"],
              ["institute", "I run an institute", "Multiple teachers & staff"],
            ] as const
          ).map(([v, t, d]) => (
            <button
              key={v}
              type="button"
              onClick={() => set("mode", v)}
              className={`rounded-lg border p-3 text-left text-xs transition ${form.mode === v ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-gray-200 hover:border-gray-300"}`}
            >
              <div className="text-sm font-semibold">{t}</div>
              <div className="mt-0.5 text-gray-500">{d}</div>
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Your full name">
            <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="07X XXX XXXX" />
            </Field>
          </div>
          <p className="text-xs text-gray-400">At least one of email or phone is required.</p>
          {form.mode === "institute" && (
            <Field label="Institute name">
              <Input value={form.orgName} onChange={(e) => set("orgName", e.target.value)} required={form.mode === "institute"} />
            </Field>
          )}
          <Field label="Password" hint="Minimum 8 characters">
            <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} minLength={8} required />
          </Field>
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <Btn type="submit" className="w-full justify-center" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create account
          </Btn>
        </form>
        <p className="mt-4 text-center text-xs text-gray-400">
          Have an account?{" "}
          <Link href="/login" className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
