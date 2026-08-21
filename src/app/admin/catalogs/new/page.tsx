import { CatalogCreateForm } from "@/components/admin/CatalogCreateForm";

export const metadata = { title: "Create catalog" };

export default function NewCatalogPage() {
  return (
    <main className="admin-content">
      <div className="page-heading">
        <div><div className="eyebrow" style={{ color: "var(--wine)" }}>New publication</div><h1>Create catalog</h1><p>Upload a PDF and we’ll prepare every page for the digital viewer.</p></div>
      </div>
      <CatalogCreateForm />
    </main>
  );
}
