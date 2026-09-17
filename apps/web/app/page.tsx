import Link from "next/link";
import { GraduationCap, CalendarCheck, Banknote, FileText, Users, Sparkles, ArrowRight } from "lucide-react";

const features = [
  { icon: Users, title: "Students & Guardians", desc: "Profiles, emergency contacts, guardian links, CSV import." },
  { icon: CalendarCheck, title: "Attendance", desc: "Session-based marking, analytics, at-risk alerts." },
  { icon: Banknote, title: "Fees & Receipts", desc: "LKR payments, partial payments, waivers, refunds." },
  { icon: FileText, title: "Exams & Report Cards", desc: "Marks entry, GCE grading, rankings, publishing." },
  { icon: Sparkles, title: "AI Assistant", desc: "Question generation, insights on your real data." },
  { icon: GraduationCap, title: "Student Portal", desc: "Students and parents see schedules, results, fees." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-950 via-brand-900 to-brand-800 text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-lg font-bold">
          <GraduationCap className="h-6 w-6 text-brand-300" />
          ClassFlow
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-brand-100 hover:text-white">
            Sign in
          </Link>
          <Link href="/register" className="rounded-lg bg-white px-4 py-1.5 font-medium text-brand-800 hover:bg-brand-50">
            Get started
          </Link>
        </div>
      </nav>

      <header className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand-300">Teach. Manage. Grow.</p>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
          The operating system for
          <br />
          tuition classes.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-brand-200">
          Students, attendance, fees, exams, and parent communication — one secure platform built for Sri Lankan
          tutors and institutes.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="#features" className="rounded-lg border border-brand-400/40 px-6 py-3 font-medium text-brand-100 hover:bg-white/10">
            See features
          </Link>
        </div>
        <p className="mt-4 text-xs text-brand-300">No institute required — teachers can fly solo.</p>
      </header>

      <section id="features" className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <f.icon className="mb-3 h-6 w-6 text-brand-300" />
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-brand-200">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-xs text-brand-300">
        ClassFlow — built for Sri Lankan tuition classes.
      </footer>
    </div>
  );
}
