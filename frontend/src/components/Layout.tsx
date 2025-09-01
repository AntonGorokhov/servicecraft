import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ContentHeader } from "./ContentHeader";

export function Layout() {
  return (
    <div className="min-h-screen bg-[var(--color-page)]">
      <Sidebar />
      <div className="ml-60">
        <ContentHeader />
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
