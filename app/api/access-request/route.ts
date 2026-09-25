import { NextRequest, NextResponse } from "next/server";
import { accessEmailConfigured, sendOwnerAccessEmail, sendRequesterAccessEmail } from "@/lib/access-email";
import { markSpotifyAccessEmailSent, requestSpotifyAccess, verifyTurnstile } from "@/lib/portfolio";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: unknown; turnstileToken?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!accessEmailConfigured()) {
      return NextResponse.json({ error: "Access requests are temporarily unavailable. Please try later." }, { status: 503 });
    }
    if (!await verifyTurnstile(body.turnstileToken, "access_request")) {
      return NextResponse.json({ error: "Human verification failed. Please retry." }, { status: 403 });
    }
    const result = await requestSpotifyAccess(email);
    if (!result.accepted) return NextResponse.json({ error: "Access requests are full today. Please try again tomorrow." }, { status: 429 });
    if (!result.requestId) throw new Error("Accepted access request has no ID");
    let emailFailed = false;
    if (!result.ownerNotified) {
      try {
        await sendOwnerAccessEmail(email, result.requestId);
        await markSpotifyAccessEmailSent(result.requestId, "owner");
      } catch (error) {
        console.error("Access request owner notification failed:", error);
        emailFailed = true;
      }
    }
    if (!result.requesterNotified) {
      try {
        await sendRequesterAccessEmail(email, result.requestId);
        await markSpotifyAccessEmailSent(result.requestId, "requester");
      } catch (error) {
        console.error("Access request confirmation failed:", error);
        emailFailed = true;
      }
    }
    if (emailFailed) return NextResponse.json({ error: "Your request was saved, but one or more emails could not be sent. Please retry." }, { status: 503 });
    return NextResponse.json({ ok: true, alreadyRequested: result.alreadyRequested });
  } catch (error) {
    console.error("Access request failed:", error);
    return NextResponse.json({ error: "Could not save your request. Please try later." }, { status: 503 });
  }
}
