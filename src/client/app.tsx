import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppNav, embedded, reportLocation } from "@clawnify/app/client";
import { Briefcase, ListChecks, Scale, Settings2 } from "lucide-react";
import Matters from "./routes/matters";
import Matter from "./routes/matter";
import ReviewGrid from "./routes/review";
import Redline from "./routes/redline";
import Workflows from "./routes/workflows";
import Settings from "./routes/settings";

const NAV = [
  { to: "/matters", label: "Matters", icon: Briefcase },
  { to: "/workflows", label: "Workflows", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

// Inside the Clawnify dashboard the sections live in its sidebar instead.
const HOST_NAV = [{ items: [
  { id: "matters", label: "Matters", icon: "briefcase", href: "/matters", home: true },
  { id: "workflows", label: "Workflows", icon: "list-checks", href: "/workflows" },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings" },
] }];

function activeSection(pathname: string): string {
  if (pathname.startsWith("/workflows")) return "workflows";
  if (pathname.startsWith("/settings")) return "settings";
  return "matters";
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Report every route, including the open matter, review or redline, so a
  // reload of the dashboard reopens the same screen.
  useEffect(() => {
    reportLocation(location.pathname + location.search);
  }, [location.pathname, location.search]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {embedded ? (
        <AppNav
          title="OpenCounsel"
          icon="briefcase"
          groups={HOST_NAV}
          active={activeSection(location.pathname)}
          onNavigate={(item) => navigate(item.href!)}
        />
      ) : (
      <aside className="hidden w-[16.25rem] shrink-0 flex-col border-r border-border bg-surface md:flex">
        {/* h-14 here and on Toolbar: the sidebar brand row and the page header
            must share one height so their bottom borders form a single
            unbroken line across the app. Padding-derived heights drift the
            moment a page title gains or loses a subtitle. */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Scale className="size-4 text-primary" strokeWidth={2.5} />
          <span className="text-sm font-semibold">OpenCounsel</span>
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
      )}

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/matters" replace />} />
          <Route path="/matters" element={<Matters />} />
          <Route path="/matters/:id" element={<Matter />} />
          <Route path="/reviews/:id" element={<ReviewGrid />} />
          <Route path="/documents/:id/redline" element={<Redline />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
