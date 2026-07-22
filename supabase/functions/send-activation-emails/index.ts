// ============================================================================
//  send-activation-emails — Supabase Edge Function (Deno)
//  Called every 6h by pg_cron. Finds new signups who've gone quiet and sends
//  them one branded "come find your first quandary" email — with a strong
//  push to install the app + turn on notifications. Logs each send so nobody
//  is emailed twice.
//
//  Secrets required (Edge Functions → Secrets):
//    RESEND_API_KEY   — from resend.com (reuse your SMTP key or make a new one)
//    EMAIL_SECRET     — any long random string (signs unsubscribe links)
//    CRON_SECRET      — any long random string (must match the cron job header)
//  (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FROM = "Quandary <hello@quandary.live>";
const SITE = "https://quandary.live";
const FUNCTIONS = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const FLAIR_LABEL: Record<string, string> = {
  wyr: "Would You Rather", tot: "This or That", hot: "Hot Take",
  hypo: "Hypothetical", moral: "Moral Dilemma", unpop: "Unpopular Opinion",
  free: "Free Form", island: "Desert Island", shower: "Shower Thought",
};

// Sign an unsubscribe token (HMAC-SHA256, url-safe base64).
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

function emailHtml(samples: { id: string; title: string; flair: string }[], unsubUrl: string): string {
  const rows = samples.map((s) => `
    <a href="${SITE}/q/${s.id}" style="display:block;text-decoration:none;background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 18px;margin:0 0 12px;">
      <span style="display:block;color:#6C4DFF;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">${FLAIR_LABEL[s.flair] || "Question"}</span>
      <span style="display:block;color:#0D0F1A;font-size:16px;font-weight:700;line-height:1.35;">${s.title}</span>
    </a>`).join("");

  return `
  <div style="margin:0;padding:0;background:#F2F3FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3FF;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #E7E7F3;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <img src="${SITE}/wordmark.png" alt="Quandary" width="190" style="display:block;margin:0 auto 6px;" />
            <p style="color:#6E6E86;font-size:13px;margin:0 0 26px;">Every hypothetical deserves an answer.</p>
            <h1 style="color:#0D0F1A;font-size:23px;font-weight:800;margin:0 0 12px;text-align:center;">Your first quandary awaits 👀</h1>
            <p style="color:#6E6E86;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">
              You're in — but the debates don't start until you weigh in. Here are
              a couple people are arguing about right now:
            </p>
          </td></tr>
          <tr><td>${rows}</td></tr>
          <tr><td align="center">
            <a href="${SITE}" style="display:inline-block;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px;margin:8px 0 26px;">
              Jump in and vote
            </a>
          </td></tr>

          <!-- Install + notifications reinforcement -->
          <tr><td style="background:#F7F5FF;border-radius:16px;padding:20px 22px;">
            <p style="color:#0D0F1A;font-size:16px;font-weight:800;margin:0 0 12px;">📲 Get the full experience (30 seconds)</p>
            <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0 0 10px;">
              <b>1. Add Quandary to your home screen.</b> On iPhone: open
              ${SITE} in Safari, tap the <b>Share</b> icon, then
              <b>Add to Home Screen</b>. On Android: tap the menu, then
              <b>Install app</b>. It opens like a real app — full screen, one tap.
            </p>
            <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0;">
              <b>2. Turn on notifications.</b> Open the app from your home screen,
              go to <b>Alerts</b>, and tap <b>Enable notifications</b>. That's how
              you'll know when someone answers your question or a new debate drops
              — the difference between trying Quandary once and actually enjoying it.
            </p>
          </td></tr>

          <tr><td align="center" style="padding-top:24px;">
            <p style="color:#A3A3B8;font-size:12px;line-height:1.6;margin:0;">
              You're getting this because you signed up for Quandary.<br/>
              <a href="${unsubUrl}" style="color:#A3A3B8;text-decoration:underline;">Unsubscribe from these emails</a> · © Quandary
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

Deno.serve(async (req) => {
  // Only our cron job (which knows CRON_SECRET) may trigger a send run.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return new Response("missing RESEND_API_KEY", { status: 500 });

  try {
    const { data: candidates, error } = await admin.rpc("get_activation_candidates");
    if (error) throw error;
    console.log("activation candidates:", candidates?.length ?? 0);

    const { data: samples } = await admin.rpc("sample_questions", { n: 2 });
    const feature = samples || [];

    let sent = 0;
    for (const c of candidates ?? []) {
      try {
        const token = await signToken(c.user_id);
        const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${c.user_id}&t=${token}`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM, to: c.email,
            subject: "Your first quandary is waiting 👀",
            html: emailHtml(feature, unsubUrl),
          }),
        });
        if (!res.ok) { console.error("resend failed", c.email, await res.text()); continue; }
        await admin.from("email_log").insert({ user_id: c.user_id, email_type: "activation" });
        sent++;
      } catch (e) { console.error("send error", c.email, (e as Error).message); }
    }

    console.log("activation emails sent:", sent);
    return new Response(JSON.stringify({ candidates: candidates?.length ?? 0, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("FATAL", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
