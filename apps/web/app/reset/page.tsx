"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post } from "../../src/lib/api";
import { Btn, Card, Field, Input } from "../../src/components/ui";

export default function Reset() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [devCode, setDevCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (step === 1) {
        const r = await post<{ sent: boolean; devCode?: string }>("/api/auth/otp/send", { identifier, purpose: "password_reset" });
        if (r.devCode) setDevCode(r.devCode);
        setStep(2);
      } else {
        await post("/api/auth/password/reset", { identifier, code, newPassword: password });
        router.push("/login");
      }
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-950 to-brand-800 p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 font-bold">Reset password</h1>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email or phone">
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required disabled={step === 2} />
          </Field>
          {step === 2 && (
            <>
              <Field label="Code" hint={devCode ? `Dev code: ${devCode}` : undefined}>
                <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} required />
              </Field>
              <Field label="New password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              </Field>
            </>
          )}
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <Btn type="submit" className="w-full justify-center" disabled={busy}>
            {step === 1 ? "Send reset code" : "Reset password"}
          </Btn>
        </form>
        <p className="mt-4 text-center text-xs">
          <Link href="/login" className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
