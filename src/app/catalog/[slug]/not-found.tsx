import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function CatalogNotFound() {
  return <main className="catalog-not-found"><Brand /><div><span className="eyebrow">Private publication</span><h1 className="editorial">This catalogue is unavailable.</h1><p>It may be unpublished, archived, or the link may have changed.</p><Link className="btn btn-secondary" href="/">Return</Link></div></main>;
}
