import { NextResponse } from "next/server";
import twilio from "twilio";

export const runtime = "nodejs"; // ensure Node runtime for Twilio SDK

type Body = {
  phone?: string;
};

export async function POST(request: Request) {
  try {
    const { phone }: Body = await request.json().catch(() => ({}));
    const to = phone?.trim();
    const from = process.env.TWILIO_FROM_NUMBER;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_URL || "";

    const missing: string[] = [];
    if (!to) missing.push("phone");
    if (!from) missing.push("TWILIO_FROM_NUMBER");
    if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!baseUrl) missing.push("NEXT_PUBLIC_BASE_URL");

    if (missing.length) {
      console.error("Twilio call missing:", missing);
      return NextResponse.json(
        { error: `Missing required: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const client = twilio(accountSid, authToken);
    const twimlUrl = `${baseUrl.replace(/\/+$/, "")}/api/incoming-call`;

    const call = await client.calls.create({
      to,
      from,
      url: twimlUrl,
    });

    return NextResponse.json({
      success: true,
      callSid: call.sid,
      message: "Call initiated successfully",
    });
  } catch (error: any) {
    console.error("Error making call:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to make call" },
      { status: 500 }
    );
  }
}

