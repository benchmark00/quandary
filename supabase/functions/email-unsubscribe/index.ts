// ============================================================================
//  email-unsubscribe — Supabase Edge Function (Deno)
//  Visited when someone taps "Unsubscribe" in an email. Verifies the signed
//  token, sets profiles.email_opt_out = true, and shows a simple page.
//
//  IMPORTANT: this function must have "Verify JWT" turned OFF (it's opened
//  directly from an email in a browser, with no login). The token in the URL
//  is what makes it secure — you can only unsubscribe yourself.
//
//  Secret required: EMAIL_SECRET (same value as the sender function).
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function signToken(userId: string): Promise<string> {
  const secret = Deno.env.get("EMAIL_SECRET") || "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function page(msg: string): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Quandary</title></head>
    <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F2F3FF;display:grid;place-items:center;min-height:100vh;">
      <div style="background:#fff;border:1px solid #E7E7F3;border-radius:20px;padding:40px 32px;max-width:400px;text-align:center;">
        <img src="https://quandary.live/wordmark.png" alt="Quandary" width="180" style="margin-bottom:18px;" />
        <p style="color:#0D0F1A;font-size:16px;line-height:1.6;">${msg}</p>
        <a href="https://quandary.live" style="color:#6C4DFF;font-weight:700;text-decoration:none;">Back to Quandary →</a>
      </div>
    </body></html>`, { headers: { "Content-Type": "text/html" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") || "";
  const t = url.searchParams.get("t") || "";
  try {
    const expected = await signToken(u);
    if (!u || t !== expected) return page("This unsubscribe link looks invalid or expired. Nothing was changed.");
    await admin.from("profiles").update({ email_opt_out: true }).eq("id", u);
    return page("You're unsubscribed from Quandary emails. You'll still get essential account emails (like password resets). Changed your mind? Just reply to any email.");
  } catch {
    return page("Something went wrong. Please try again later.");
  }
});
