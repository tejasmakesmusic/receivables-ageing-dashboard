import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const links = [
  { href: "/auth/google/login", label: "Stub Login" },
  { href: "/api/health", label: "Health API" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/snapshots", label: "Snapshots" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/follow-ups", label: "Follow-ups" },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Receivables Sidecar
        </h1>
        <p className="text-sm text-slate-600">
          Strangler migration entrypoint (Next.js 16, React 19) for the existing
          Vite stack.
        </p>
        <div className="card-grid">
          <Card>
            <CardHeader>
              <CardTitle>Health</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge>Ready</Badge>
              <p className="mt-2 text-sm text-slate-600">
                `/api/health` is available and returns a lightweight readiness
                payload.
              </p>
              <a
                className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                href="/api/health"
              >
                Check health
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Stack</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Next.js 16 App Router</p>
              <p>React 19 + TypeScript</p>
              <p>Prisma 7 + Neon adapter</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Local Smoke</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              {links.map((link) => (
                <a
                  className="rounded border border-slate-200 bg-white px-3 py-2 hover:bg-slate-100"
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
