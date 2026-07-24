// ============================================================================
//  send-welcome-emails — Supabase Edge Function (Deno)
//  Journey #3: the welcome sequence. One function, three stages.
//    Day 0 — "Welcome — here's how Quandary works"  (+ install/notifications)
//    Day 2 — "This week's best quandaries"          (3 top questions)
//    Day 5 — "Debates are better with your people"  (invite a friend)
//  Called every 6 hours by pg_cron; the SQL decides who's due for what.
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

/* ---- shared shell so every email in the sequence looks the same ---- */
function shell(headline: string, subline: string, inner: string, ctaLabel: string, unsubUrl: string): string {
  return `
  <div style="margin:0;padding:0;background:#F2F3FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F3FF;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #E7E7F3;padding:34px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <img src="${SITE}/wordmark.png" alt="Quandary" width="190" style="display:block;margin:0 auto 6px;" />
            <p style="color:#6E6E86;font-size:13px;margin:0 0 26px;">Every hypothetical deserves an answer.</p>
            <h1 style="color:#0D0F1A;font-size:23px;font-weight:800;margin:0 0 12px;text-align:center;">${headline}</h1>
            <p style="color:#6E6E86;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">${subline}</p>
          </td></tr>
          ${inner}
          <tr><td align="center">
            <a href="${SITE}" style="display:inline-block;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px;margin:8px 0 22px;">${ctaLabel}</a>
          </td></tr>
          <tr><td align="center" style="padding-top:16px;">
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

const questionCards = (qs: { id: string; title: string; flair: string }[]) =>
  `<tr><td>` + qs.map((s) => `
    <a href="${SITE}/q/${s.id}" style="display:block;text-decoration:none;background:#F7F5FF;border:1px solid #E7E7F3;border-radius:14px;padding:16px 18px;margin:0 0 12px;">
      <span style="display:block;color:#6C4DFF;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">${FLAIR_LABEL[s.flair] || "Question"}</span>
      <span style="display:block;color:#0D0F1A;font-size:16px;font-weight:700;line-height:1.35;">${esc(s.title)}</span>
    </a>`).join("") + `</td></tr>`;

const installBlock = `
  <tr><td style="background:#F7F5FF;border-radius:16px;padding:20px 22px;">
    <p style="color:#0D0F1A;font-size:16px;font-weight:800;margin:0 0 12px;">📲 Two things worth 30 seconds</p>
    <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0 0 10px;">
      <b>1. Add Quandary to your home screen.</b> On iPhone: open ${SITE} in
      Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. On Android:
      menu → <b>Install app</b>. It opens full screen, like a real app.
    </p>
    <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0;">
      <b>2. Turn on notifications.</b> Open the app, go to <b>Alerts</b>, tap
      <b>Enable notifications</b>. That's how you'll know when someone answers
      your question. (On iPhone this only works from the installed app.)
    </p>
  </td></tr>
  <tr><td style="height:22px;"></td></tr>`;

/* ---- the three emails ---- */
function dayZero(unsubUrl: string): { subject: string; html: string } {
  const inner = `
    <tr><td style="padding:0 0 8px;">
      <p style="color:#0D0F1A;font-size:15px;font-weight:800;margin:0 0 12px;">How it works</p>
      <p style="color:#3A3A4D;font-size:14.5px;line-height:1.65;margin:0 0 8px;"><b>1. Ask anything impossible.</b> Would-you-rathers, hot takes, moral dilemmas, shower thoughts — the more specific, the better the argument.</p>
      <p style="color:#3A3A4D;font-size:14.5px;line-height:1.65;margin:0 0 8px;"><b>2. Weigh in on everyone else's.</b> Vote, reply, and ask for clarification when a question is missing a crucial detail.</p>
      <p style="color:#3A3A4D;font-size:14.5px;line-height:1.65;margin:0 0 22px;"><b>3. Watch the split.</b> The best part is finding out that 62% of people disagree with you — and having to defend yourself.</p>
    </td></tr>
    ${installBlock}`;
  return {
    subject: "Welcome to Quandary — here's how it works 👋",
    html: shell(
      "You're in 👋",
      "Quandary is where impossible questions go to get settled. Here's the 30-second version.",
      inner, "Find your first quandary", unsubUrl,
    ),
  };
}

function dayTwo(qs: { id: string; title: string; flair: string }[], unsubUrl: string) {
  return {
    subject: "This week's best quandaries 🔥",
    html: shell(
      "This week's best quandaries 🔥",
      "These are the ones people can't agree on. Pick a side.",
      questionCards(qs), "Settle a debate", unsubUrl,
    ),
  };
}

function dayFive(unsubUrl: string) {
  const inner = `
    <tr><td style="background:#F7F5FF;border-radius:16px;padding:22px;">
      <p style="color:#0D0F1A;font-size:15.5px;line-height:1.65;margin:0 0 10px;">
        Here's the thing about Quandary: arguing with strangers is fun, but
        arguing with <b>your people</b> is where it gets properly good. The
        friend who takes everything too seriously. The one with the terrible
        food opinions. You know who they are.
      </p>
      <p style="color:#3A3A4D;font-size:14px;line-height:1.6;margin:0;">
        Open Quandary, go to the <b>You</b> tab, and tap
        <b>Invite your friends</b> — it'll hand you a link to send.
      </p>
    </td></tr>
    <tr><td style="height:22px;"></td></tr>`;
  return {
    subject: "Debates are better with your people 👥",
    html: shell(
      "Debates are better with your people 👥",
      "You've had a few days to settle in. Time to bring the chaos.",
      inner, "Invite your crew", unsubUrl,
    ),
  };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("unauthorized", { status: 401 });
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return new Response("missing RESEND_API_KEY", { status: 500 });

  const results: Record<string, number> = {};
  try {
    // Day 2 needs content — fetch once, reuse.
    const { data: top } = await admin.rpc("top_questions", { days: 14, n: 3 });
    const topQs = top || [];

    for (const stage of [0, 2, 5]) {
      const { data: cands, error } = await admin.rpc("get_welcome_candidates", { stage });
      if (error) { console.error("stage", stage, error.message); continue; }
      console.log(`welcome stage ${stage} candidates:`, cands?.length ?? 0);

      let sent = 0;
      for (const c of cands ?? []) {
        try {
          const token = await signToken(c.user_id);
          const unsubUrl = `${FUNCTIONS}/email-unsubscribe?u=${c.user_id}&t=${token}`;

          let mail;
          if (stage === 0) mail = dayZero(unsubUrl);
          else if (stage === 2) {
            if (topQs.length === 0) { console.log("no questions for day 2 — skipping"); continue; }
            mail = dayTwo(topQs, unsubUrl);
          } else mail = dayFive(unsubUrl);

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: FROM, to: c.email, subject: mail.subject, html: mail.html }),
          });
          if (!res.ok) { console.error("resend failed", c.email, await res.text()); continue; }

          await admin.from("email_log").insert({ user_id: c.user_id, email_type: `welcome_d${stage}` });
          sent++;
        } catch (e) { console.error("send error", c.email, (e as Error).message); }
      }
      results[`day${stage}`] = sent;
      console.log(`welcome stage ${stage} sent:`, sent);
    }

    return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("FATAL", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
