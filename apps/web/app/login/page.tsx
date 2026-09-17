"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2 } from "lucide-react";
import { post } from "../../src/lib/api";
import { Btn, Card, Field, Input } from "../../src/components/ui";

export default function Login() {
  const router = useRouter();
  const qc = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "password") {
        await post("/api/auth/login", { identifier, password });
      } else if (!otpSent) {
        const r = await post<{ sent: boolean; devCode?: string }>("/api/auth/otp/send", { channel: identifier.includes("@") ? "email" : "phone", destination: identifier, purpose: "login" });
        setOtpSent(true);
        if (r.devCode) setDevCode(r.devCode);
        setBusy(false);
        return;
      } else {
        await post("/api/auth/otp/verify", { destination: identifier, code: otp, purpose: "login" });
      }
      qc.clear();
      router.push("/dashboard");
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-950 to-brand-800 p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <GraduationCap className="h-7 w-7 text-brand-600" />
          <div>
            <div className="font-bold">ClassFlow</div>
            <div className="text-xs text-gray-400">Teach. Manage. Grow.</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email or phone">
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com or +94 7X XXX XXXX" required />
          </Field>
          {mode === "password" ? (
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          ) : otpSent ? (
            <Field label="Verification code" hint={devCode ? `Dev code: ${devCode}` : "Check your email/SMS for the 6-digit code"}>
              <Input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} placeholder="123456" required />
            </Field>
          ) : null}
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <Btn type="submit" className="w-full justify-center" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "password" ? "Sign in" : otpSent ? "Verify & sign in" : "Send code"}
          </Btn>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs">
          <button className="text-brand-600 hover:underline" onClick={() => setMode(mode === "password" ? "otp" : "password")}>
            {mode === "password" ? "Sign in with a code instead" : "Use password instead"}
          </button>
          <Link href="/reset" className="text-gray-400 hover:text-gray-600">
            Forgot password?
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          New here?{" "}
          <Link href="/register" className="text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
