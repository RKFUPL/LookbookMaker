import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RK Digital Catalogs", template: "%s · RK Catalogs" },
  description: "Rashika Kapoor digital fashion catalogues.",
  applicationName: "RK Digital Catalogs",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
