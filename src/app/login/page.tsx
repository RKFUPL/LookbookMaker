import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { Brand } from "@/components/Brand";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata = { title: "Staff sign in" };

export default async function LoginPage() {
  if (await getStaffSession()) redirect("/admin");
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <Brand />
        <div className="auth-form-wrap">
          <div className="eyebrow" style={{ color: "var(--wine)" }}>Private catalog studio</div>
          <h1 className="editorial">Welcome<br />back.</h1>
          <p>Sign in to create, publish, and manage Rashika Kapoor digital catalogues.</p>
          <LoginForm />
        </div>
      </section>
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-quote">
          <p>Rashika Kapoor · New Delhi</p>
          <blockquote>Every collection deserves to be experienced.</blockquote>
        </div>
      </aside>
    </main>
  );
}
