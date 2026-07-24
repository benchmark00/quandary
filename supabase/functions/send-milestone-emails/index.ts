// ============================================================================
//  send-milestone-emails — Supabase Edge Function (Deno)
//  Journey #5: the small emotional wins.
//    a) A question crosses 10 / 50 / 100 votes → "Your question hit 50 votes!"
//    b) One month on Quandary → "You've been debating for a month 🎉"
//  Called daily by pg_cron.
//
//  Secrets: RESEND_API_KEY, EMAIL_SECRET, CRON_SECRET (already configured)
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FROM = "Quandary <hello@quandary.live>";
const SITE = "https://quandary.live";
const FUNCTIONS = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

function shell(headline: string, subline: string, inner: string, ctaLabel: string, ctaUrl: string, unsubUrl: string): string {
  return `
  <div style="margin:0;padding:0;background:#F2F3FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3FF;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #E7E7F3;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <img src="${SITE}/wordmark.png" alt="Quandary" width="190" style="display:block;margin:0 auto 6px;" />
            <p style="color:#6E6E86;font-size:13px;margin:0 0 26px;">Every hypothetical deserves an answer.</p>
            <h1 style="color:#0D0F1A;font-size:24px;font-weight:800;margin:0 0 12px;text-align:center;">${headline}</h1>
            <p style="color:#6E6E86;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">${subline}</p>
          </td></tr>
          ${inner}
          <tr><td align="center">
            <a href="${ctaUrl}" style="display:inline-block;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px;margin:8px 0 22px;">${ctaLabel}</a>
          </td></tr>
          <tr><td align="center" style="padding-top:12px;">
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

const bigNumber = (n: number, label: string) => `
  <tr><td align="center" style="background:linear-gradient(135deg,#6C4DFF,#9B5BFF);border-radius:18px;padding:26px 20px;">
    <div style="color:#fff;font-size:52px;font-weight:800;line-height:1;">${n}</div>
    <div style="color:rgba(255,255,255,.88);font-size:14px;margin-top:6px;">${label}</div>
  </td></tr>
  <tr><td style="height:22px;"></td></tr>`;

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("unauthorized", { status: 401 });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return new Response("missing RESEND_API_KEY", { status: 500 });

  const send = async (to: string, subject: string, html: string) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) { console.error("resend failed", to, await res.text()); return false; }
    return true;
  };

  let voteSent = 0, annivSent = 0;
  try {
    /* ---- a) vote milestones ---- */
    const { data: vm, error: vmErr } = await admin.rpc("get_vote_milestones");
    if (vmErr) console.error("vote milestones:", vmErr.message);
    console.log("vote milestone candidates:", vm?.length ?? 0);

    for (const m of vm ?? []) {
      try {
        const token = await signToken(m.user_id);
        const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${m.user_id}&t=${token}`;
        const inner = `
          ${bigNumber(m.vote_count, m.vote_count === 1 ? "vote" : "votes and counting")}
          <tr><td style="background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:18px 20px;">
            <p style="color:#6C4DFF;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Your question</p>
            <p style="color:#0D0F1A;font-size:16px;font-weight:700;line-height:1.35;margin:0;">${esc(m.question_title)}</p>
          </td></tr>
          <tr><td style="height:22px;"></td></tr>`;
        const ok = await send(
          m.email,
          `Your question hit ${m.threshold} votes! 🎉`,
          shell(
            `${m.threshold} votes and climbing 🎉`,
            "People can't stop weighing in. Go see how the split is shaping up — and who's arguing in the replies.",
            inner, "See the results", `${SITE}/q/${m.question_id}`, unsubUrl,
          ),
        );
        if (!ok) continue;
        await admin.from("email_log").insert({
          user_id: m.user_id,
          email_type: `milestone_q:${m.question_id}:${m.threshold}`,
        });
        voteSent++;
      } catch (e) { console.error("vote milestone error", m.email, (e as Error).message); }
    }

    /* ---- b) one-month anniversaries ---- */
    const { data: anniv, error: aErr } = await admin.rpc("get_anniversary_candidates");
    if (aErr) console.error("anniversary:", aErr.message);
    console.log("anniversary candidates:", anniv?.length ?? 0);

    for (const a of anniv ?? []) {
      try {
        const token = await signToken(a.user_id);
        const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${a.user_id}&t=${token}`;
        const inner = `
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 22px;"><tr>
              <td align="center" style="background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 8px;">
                <div style="color:#6C4DFF;font-size:26px;font-weight:800;line-height:1;">${a.questions_asked}</div>
                <div style="color:#6E6E86;font-size:12px;margin-top:5px;">asked</div></td>
              <td align="center" style="background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 8px;">
                <div style="color:#6C4DFF;font-size:26px;font-weight:800;line-height:1;">${a.votes_cast}</div>
                <div style="color:#6E6E86;font-size:12px;margin-top:5px;">votes cast</div></td>
              <td align="center" style="background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 8px;">
                <div style="color:#6C4DFF;font-size:26px;font-weight:800;line-height:1;">${a.replies_received}</div>
                <div style="color:#6E6E86;font-size:12px;margin-top:5px;">replies received</div></td>
            </tr></table>
          </td></tr>`;
        const ok = await send(
          a.email,
          "You've been debating for a month 🎉",
          shell(
            "One month of impossible questions 🎉",
            "Thirty days ago you joined Quandary. Here's what you've done since.",
            inner, "Ask something impossible", SITE, unsubUrl,
          ),
        );
        if (!ok) continue;
        await admin.from("email_log").insert({ user_id: a.user_id, email_type: "milestone_month" });
        annivSent++;
      } catch (e) { console.error("anniversary error", a.email, (e as Error).message); }
    }

    console.log("milestones sent — votes:", voteSent, "anniversaries:", annivSent);
    return new Response(JSON.stringify({ voteSent, annivSent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("FATAL", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
