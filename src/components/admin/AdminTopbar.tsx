"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function AdminTopbar() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="admin-topbar">
      <span className="eyebrow" style={{ color: "var(--muted)" }}>Digital catalogue studio</span>
      <button className="btn btn-ghost" type="button" onClick={logout}><LogOut size={15} /> Sign out</button>
    </header>
  );
}
