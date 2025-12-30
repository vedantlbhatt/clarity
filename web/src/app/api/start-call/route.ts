import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone: string | undefined = body?.phone?.toString().trim();

    if (!phone) {
      return NextResponse.json({ error: "Missing phone" }, { status: 400 });
    }

    // TODO: Wire this up to your Ultravox/telephony initiation logic.
    // Example: await startUltravoxCall({ phone, config });

    return NextResponse.json({ ok: true, phone, message: "Call enqueued" });
  } catch (err) {
    return NextResponse.json({ error: "Failed to start call" }, { status: 500 });
  }
}

