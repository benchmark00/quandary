// ============================================================================
//  send-weekly-digest — Supabase Edge Function (Deno)
//  Journey #4: "Your week in Quandary" — sent to ACTIVE users on Sundays.
//  This is habit reinforcement, not a rescue email: it only goes to people who
//  did something in the last 7 days.
//
//  Uses a dated email type ('digest:2026-30') so it can recur weekly while
//  never double-sending within the same ISO week.
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

const FLAIR_LABEL: Record<string, string> = {
  wyr: "Would You Rather", tot: "This or That", hot: "Hot Take",
  hypo: "Hypothetical", moral: "Moral Dilemma", unpop: "Unpopular Opinion",
  free: "Free Form", island: "Desert Island", shower: "Shower Thought",
};

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

type TopQ = { id: string; title: string; flair: string; votes: number; replies: number };

function statBox(n: number, label: string) {
  return `<td align="center" style="background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 8px;">
    <div style="color:#6C4DFF;font-size:26px;font-weight:800;line-height:1;">${n}</div>
    <div style="color:#6E6E86;font-size:12px;margin-top:5px;">${label}</div>
  </td>`;
}

function digestHtml(
  qs: TopQ[],
  stats: { votes_cast: number; questions_asked: number; replies_received: number },
  unsubUrl: string,
): string {
  const cards = qs.map((s) => `
    <a href="${SITE}/q/${s.id}" style="display:block;text-decoration:none;background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 18px;margin:0 0 12px;">
      <span style="display:block;color:#6C4DFF;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">${FLAIR_LABEL[s.flair] || "Question"}</span>
      <span style="display:block;color:#0D0F1A;font-size:16px;font-weight:700;line-height:1.35;margin:0 0 6px;">${esc(s.title)}</span>
      <span style="display:block;color:#6E6E86;font-size:12.5px;">${s.votes} ${s.votes === 1 ? "vote" : "votes"} · ${s.replies} ${s.replies === 1 ? "reply" : "replies"}</span>
    </a>`).join("");

  return `
  <div style="margin:0;padding:0;background:#F2F3FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3FF;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #E7E7F3;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <img src="${SITE}/wordmark.png" alt="Quandary" width="190" style="display:block;margin:0 auto 6px;" />
            <p style="color:#6E6E86;font-size:13px;margin:0 0 26px;">Every hypothetical deserves an answer.</p>
            <h1 style="color:#0D0F1A;font-size:23px;font-weight:800;margin:0 0 12px;text-align:center;">Your week in Quandary 📊</h1>
            <p style="color:#6E6E86;font-size:15px;line-height:1.6;margin:0 0 22px;text-align:center;">
              Here's what you got up to, and what everyone else was arguing about.
            </p>
          </td></tr>

          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 24px;"><tr>
              ${statBox(stats.votes_cast, "votes cast")}
              ${statBox(stats.questions_asked, "asked")}
              ${statBox(stats.replies_received, "replies received")}
            </tr></table>
          </td></tr>

          <tr><td>
            <p style="color:#0D0F1A;font-size:15px;font-weight:800;margin:0 0 12px;">The week's most-argued-about</p>
            ${cards}
          </td></tr>

          <tr><td align="center">
            <a href="${SITE}" style="display:inline-block;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px;margin:8px 0 22px;">Keep the debate going</a>
          </td></tr>

          <tr><td align="center" style="padding-top:12px;">
            <p style="color:#A3A3B8;font-size:12px;line-height:1.6;margin:0;">
              You're getting this because you've been active on Quandary.<br/>
              <a href="${unsubUrl}" style="color:#A3A3B8;text-decoration:underline;">Unsubscribe from these emails</a> · © Quandary
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("unauthorized", { status: 401 });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return new Response("missing RESEND_API_KEY", { status: 500 });

  try {
    const { data: candidates, error } = await admin.rpc("get_digest_candidates");
    if (error) throw error;
    console.log("digest candidates:", candidates?.length ?? 0);
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ candidates: 0, sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: top } = await admin.rpc("top_questions", { days: 7, n: 3 });
    const topQs: TopQ[] = top || [];
    if (topQs.length === 0) {
      console.log("no questions this week — skipping the whole run");
      return new Response(JSON.stringify({ candidates: candidates.length, sent: 0, reason: "no content" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: stamp } = await admin.rpc("current_week_stamp");
    const emailType = `digest:${stamp}`;

    let sent = 0;
    for (const c of candidates) {
      try {
        const token = await signToken(c.user_id);
        const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${c.user_id}&t=${token}`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM, to: c.email,
            subject: "Your week in Quandary 📊",
            html: digestHtml(topQs, c, unsubUrl),
          }),
        });
        if (!res.ok) { console.error("resend failed", c.email, await res.text()); continue; }
        await admin.from("email_log").insert({ user_id: c.user_id, email_type: emailType });
        sent++;
      } catch (e) { console.error("send error", c.email, (e as Error).message); }
    }

    console.log("digest emails sent:", sent);
    return new Response(JSON.stringify({ candidates: candidates.length, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("FATAL", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
