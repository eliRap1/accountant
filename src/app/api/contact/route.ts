import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, company, message } = body as {
      name?: string;
      email?: string;
      company?: string;
      message?: string;
    };

    if (!name || !email) {
      return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
    }

    // TODO: integrate a delivery service (e.g. Resend, Formspree, SendGrid) to
    // forward submissions to the team inbox. For now the handler accepts the
    // request and logs it server-side so form data is no longer silently dropped.
    console.log("[contact] new submission", { name, email, company, message });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
