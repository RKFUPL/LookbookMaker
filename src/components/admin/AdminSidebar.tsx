"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, BookOpen, FileClock, LayoutGrid, Plus, Send } from "lucide-react";
import { Brand } from "@/components/Brand";
import type { StaffSession } from "@/lib/auth";

const links = [
  { href: "/admin", label: "Catalogs", icon: LayoutGrid, status: null },
  { href: "/admin/catalogs/new", label: "Create", icon: Plus, status: null },
  { href: "/admin?status=draft", label: "Drafts", icon: FileClock, status: "draft" },
  { href: "/admin?status=published", label: "Published", icon: Send, status: "published" },
  { href: "/admin?status=archived", label: "Archived", icon: Archive, status: "archived" },
];

export function AdminSidebar({ user }: { user: StaffSession }) {
  const pathname = usePathname();
  return (
    <aside className="admin-sidebar">
      <Brand />
      <nav className="admin-nav" aria-label="Catalog management">
        {links.map(({ href, label, icon: Icon, status: linkStatus }) => {
          const active = linkStatus ? false : linkStatus === null && (href === "/admin" ? pathname === "/admin" : pathname === href);
          return <Link key={href} href={href} className={active ? "active" : ""}><Icon size={17} /><span>{label}</span></Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <BookOpen size={16} style={{ marginBottom: 14, opacity: .6 }} />
        <div className="staff-name">{user.name}</div>
        <div className="staff-role">{user.role}</div>
      </div>
    </aside>
  );
}
