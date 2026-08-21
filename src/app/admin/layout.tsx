import { requireAdminPage } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPage();
  return (
    <div className="admin-shell">
      <AdminSidebar user={session} />
      <div className="admin-main">
        <AdminTopbar />
        {children}
      </div>
    </div>
  );
}
