import "../../globals.css";
// No locale lookup — the portal is locale-neutral. Hebrew default (RTL).
export const metadata = { title: "Client portal · AccounTech" };

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
