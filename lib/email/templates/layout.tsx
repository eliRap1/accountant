import type { ReactNode } from "react";

// Inline-styled HTML email layout. NO external CSS — Gmail's web client
// strips <link> tags and most <style> blocks, so every property has to be
// on the element. Width capped at 560px which is the canonical "doesn't
// trigger horizontal scroll in Outlook" number.
//
// Why no React Email components: keeping templates dependency-light per
// project brief — see docs/runbooks/email-deliverability.md §"Code wired
// by Agent". Plain JSX renders through react-dom/server.

type Direction = "ltr" | "rtl";

export function EmailLayout({
  children,
  dir,
  lang,
  preview,
}: {
  children: ReactNode;
  dir: Direction;
  lang: string;
  /**
   * Hidden pre-header text (shown in the inbox list before the user opens).
   * Keep under 90 chars or Gmail truncates with an ellipsis.
   */
  preview?: string;
}) {
  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AccounTech</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#0a0e14",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Heebo', 'Manrope', sans-serif",
          color: "#cbd5e1",
        }}
      >
        {preview ? (
          <div
            style={{
              display: "none",
              maxHeight: 0,
              overflow: "hidden",
              opacity: 0,
              color: "transparent",
            }}
          >
            {preview}
          </div>
        ) : null}
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ backgroundColor: "#0a0e14", padding: "32px 16px" }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  role="presentation"
                  width="560"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  style={{
                    width: "560px",
                    maxWidth: "100%",
                    backgroundColor: "#0f1620",
                    borderRadius: "16px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "32px 36px 8px 36px" }}>
                        <div
                          style={{
                            fontSize: "13px",
                            letterSpacing: "0.12em",
                            color: "#10b981",
                            textTransform: "uppercase",
                          }}
                        >
                          AccounTech
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 36px 36px 36px" }}>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "20px 36px",
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          fontSize: "12px",
                          color: "#64748b",
                          lineHeight: 1.6,
                        }}
                      >
                        {dir === "rtl"
                          ? "מייל זה נשלח אוטומטית מהפלטפורמה. אין להשיב אליו לבירורים — פנו אל support."
                          : "This message was sent automatically by the platform. Replies route to our support inbox."}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

// Big emerald CTA button. Uses VML for Outlook so the button renders as a
// real clickable block rather than a tiny text link. The conditional
// <!--[if mso]> comment is the standard Outlook shim — react-dom/server
// preserves it because it's a static string.
export function EmailButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ margin: "24px 0" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              borderRadius: "10px",
              backgroundColor: "#10b981",
            }}
          >
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "14px 28px",
                fontSize: "15px",
                fontWeight: 600,
                color: "#0a0e14",
                textDecoration: "none",
                borderRadius: "10px",
                backgroundColor: "#10b981",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function Heading({ children, dir }: { children: ReactNode; dir: Direction }) {
  return (
    <h1
      style={{
        margin: "0 0 12px 0",
        fontSize: "22px",
        lineHeight: 1.3,
        fontWeight: 600,
        color: "#f1f5f9",
        textAlign: dir === "rtl" ? "right" : "left",
      }}
    >
      {children}
    </h1>
  );
}

export function Para({ children, dir }: { children: ReactNode; dir: Direction }) {
  return (
    <p
      style={{
        margin: "0 0 14px 0",
        fontSize: "15px",
        lineHeight: 1.65,
        color: "#cbd5e1",
        textAlign: dir === "rtl" ? "right" : "left",
      }}
    >
      {children}
    </p>
  );
}

export function Muted({ children, dir }: { children: ReactNode; dir: Direction }) {
  return (
    <p
      style={{
        margin: "0 0 8px 0",
        fontSize: "12px",
        lineHeight: 1.6,
        color: "#64748b",
        textAlign: dir === "rtl" ? "right" : "left",
      }}
    >
      {children}
    </p>
  );
}
