import { CatalogDashboard } from "@/components/admin/CatalogDashboard";

export const metadata = { title: "Catalogs" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status || "";
  return <CatalogDashboard initialStatus={status} />;
}
