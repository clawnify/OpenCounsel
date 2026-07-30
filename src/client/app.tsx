import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Briefcase, ListChecks, Scale, Settings2 } from "lucide-react";
import Matters from "./routes/matters";
import Matter from "./routes/matter";
import ReviewGrid from "./routes/review";
import Workflows from "./routes/workflows";
import Settings from "./routes/settings";

const NAV = [
  { to: "/matters", label: "Matters", icon: Briefcase },
  { to: "/workflows", label: "Workflows", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

export default function App() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[16.25rem] shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
          <Scale className="size-4 text-primary" strokeWidth={2.5} />
          <span className="text-sm font-semibold">Open Counsel</span>
        </div>
        <nav className="p-2">
          <div className="px-2 py-1.5">
            <span className="eyebrow">Workspace</span>
          </div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] font-semibold text-primary"
                    : "text-foreground hover:bg-sunken"
                }`
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/matters" replace />} />
          <Route path="/matters" element={<Matters />} />
          <Route path="/matters/:id" element={<Matter />} />
          <Route path="/reviews/:id" element={<ReviewGrid />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
