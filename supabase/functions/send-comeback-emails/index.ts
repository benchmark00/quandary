// ============================================================================
//  send-comeback-emails — Supabase Edge Function (Deno)
//  Called once a day by pg_cron. Finds people who were active and then went
//  quiet for 7+ days, and sends one personalised "we miss your hot takes"
//  email: what they've missed, whether anyone replied to their questions
//  while they were away, and a nudge to turn notifications on.
//
//  Re-sendable: someone who lapses again in a few months gets another one
//  (the SQL enforces a 30-day cooldown).
//
//  Secrets required (already set up for journey #1):
//    RESEND_API_KEY, EMAIL_SECRET, CRON_SECRET
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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Q = { id: string; title: string; flair: string; created_at: string };

function emailHtml(
  qs: Q[],
  repliesWhileAway: number,
  replyQuestionTitle: string | null,
  daysAway: number,
  unsubUrl: string,
): string {
  const cards = qs.map((s) => `
    <a href="${SITE}/q/${s.id}" style="display:block;text-decoration:none;background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 18px;margin:0 0 12px;">
      <span style="display:block;color:#6C4DFF;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">${FLAIR_LABEL[s.flair] || "Question"}</span>
      <span style="display:block;color:#0D0F1A;font-size:16px;font-weight:700;line-height:1.35;">${esc(s.title)}</span>
    </a>`).join("");

  // Only shown when someone actually replied to their question while away.
  const replyBlock = repliesWhileAway > 0 ? `
    <tr><td style="background:#EEF9F6;border:1px solid #C9EDE4;border-radius:16px;padding:18px 20px;margin:0 0 8px;">
      <p style="color:#0C6B57;font-size:15px;font-weight:800;margin:0 0 6px;">💬 You've got ${repliesWhileAway} ${repliesWhileAway === 1 ? "reply" : "replies"} waiting</p>
      <p style="color:#12806A;font-size:14px;line-height:1.55;margin:0;">
        ${replyQuestionTitle ? `People have been weighing in on <b>“${esc(replyQuestionTitle)}”</b> while you were away.` : "People have been weighing in on your questions while you were away."}
        Go see what they said.
      </p>
    </td></tr>
    <tr><td style="height:16px;"></td></tr>` : "";

  return `
  <div style="margin:0;padding:0;background:#F2F3FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3FF;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #E7E7F3;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <img src="${SITE}/wordmark.png" alt="Quandary" width="190" style="display:block;margin:0 auto 6px;" />
            <p style="color:#6E6E86;font-size:13px;margin:0 0 26px;">Every hypothetical deserves an answer.</p>
            <h1 style="color:#0D0F1A;font-size:23px;font-weight:800;margin:0 0 12px;text-align:center;">The debates aren't the same without you 👀</h1>
            <p style="color:#6E6E86;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">
              It's been about ${daysAway} days. The arguments have carried on without
              you — and frankly, some of them need your take.
            </p>
          </td></tr>

          ${replyBlock}

          <tr><td>
            <p style="color:#0D0F1A;font-size:15px;font-weight:800;margin:0 0 12px;">Here's what you've missed</p>
            ${cards}
          </td></tr>

          <tr><td align="center">
            <a href="${SITE}" style="display:inline-block;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px;margin:8px 0 26px;">
              Settle a debate
            </a>
          </td></tr>

          <tr><td style="background:#F7F5FF;border-radius:16px;padding:20px 22px;">
            <p style="color:#0D0F1A;font-size:16px;font-weight:800;margin:0 0 12px;">🔔 Never miss a good one</p>
            <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0 0 10px;">
              Most people who drift away simply never turned notifications on. Open
              Quandary, go to <b>Alerts</b>, and tap <b>Enable notifications</b> —
              you'll know the moment someone answers your question.
            </p>
            <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0;">
              Not on your home screen yet? On iPhone: open ${SITE} in Safari, tap
              <b>Share</b>, then <b>Add to Home Screen</b>. On Android: menu →
              <b>Install app</b>. (Notifications only work from the installed app
              on iPhone.)
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
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return new Response("missing RESEND_API_KEY", { status: 500 });

  try {
    const { data: candidates, error } = await admin.rpc("get_comeback_candidates");
    if (error) throw error;
    console.log("comeback candidates:", candidates?.length ?? 0);
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ candidates: 0, sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch a pool of recent questions ONCE, then pick per-person below.
    const { data: pool } = await admin.rpc("recent_questions", { n: 25 });
    const recent: Q[] = pool || [];

    let sent = 0;
    for (const c of candidates) {
      try {
        // "What you've missed" = questions posted since they last did anything.
        let missed = recent.filter((q) => Date.parse(q.created_at) > Date.parse(c.last_active));
        if (missed.length === 0) missed = recent;      // fallback: just show the newest
        missed = missed.slice(0, 3);
        if (missed.length === 0) { console.log("no questions to feature — skipping", c.email); continue; }

        const daysAway = Math.max(
          1, Math.round((Date.now() - Date.parse(c.last_active)) / 86400000),
        );

        const token = await signToken(c.user_id);
        const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${c.user_id}&t=${token}`;

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM,
            to: c.email,
            subject: c.replies_while_away > 0
              ? `You've got ${c.replies_while_away} ${c.replies_while_away === 1 ? "reply" : "replies"} waiting 👀`
              : "The debates aren't the same without you 👀",
            html: emailHtml(missed, c.replies_while_away, c.reply_question_title, daysAway, unsubUrl),
          }),
        });
        if (!res.ok) { console.error("resend failed", c.email, await res.text()); continue; }

        await admin.from("email_log").insert({ user_id: c.user_id, email_type: "comeback" });
        sent++;
      } catch (e) { console.error("send error", c.email, (e as Error).message); }
    }

    console.log("comeback emails sent:", sent);
    return new Response(JSON.stringify({ candidates: candidates.length, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("FATAL", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
