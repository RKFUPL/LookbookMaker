import { CatalogEditForm } from "@/components/admin/CatalogEditForm";

export const metadata = { title: "Edit catalog" };

export default async function EditCatalogPage({ params }: { params: Promise<{ id: string }> }) {
  return <CatalogEditForm id={(await params).id} />;
}
