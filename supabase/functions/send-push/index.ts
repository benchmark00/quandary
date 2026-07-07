// ============================================================================
//  send-push — Supabase Edge Function (Deno)
//  Handles four event types (sent by database triggers):
//    question      -> fan out to everyone whose prefs match
//    reply         -> notify the question's author
//    clarif        -> notify the question's author (context requested)
//    clarif_answer -> notify the person who asked the clarifying question
//  Logs each step so Edge Functions → Logs shows exactly what happened.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const FLAIR_LABEL: Record<string, string> = {
  wyr: "Would You Rather", tot: "This or That", hot: "Hot Take",
  hypo: "Hypothetical", moral: "Moral Dilemma", unpop: "Unpopular Opinion",
  free: "Free Form", island: "Desert Island", shower: "Shower Thought",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const name = async (id: string) => {
  const { data } = await admin.from("profiles").select("name").eq("id", id).single();
  return data?.name ?? "Someone";
};

const question = async (id: string) => {
  const { data } = await admin.from("questions")
    .select("id, title, flair, author_id, anonymous_replies").eq("id", id).single();
  return data;
};

async function sendToUsers(userIds: string[], payload: string) {
  if (userIds.length === 0) { console.log("no recipients"); return 0; }
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, user_agent")
    .in("user_id", userIds);
  console.log("devices to notify:", subs?.length ?? 0);

  let ok = 0;
  const dead: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      ok++;
      console.log("  ✓ sent to", (s.user_agent || "device").slice(0, 40));
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      console.error("  ✗ FAILED — status", code, "—", (err as Error).message || String(err));
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }
  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  console.log("done. sent:", ok, "| pruned dead:", dead.length);
  return ok;
}

const payload = (title: string, body: string, url = "/") =>
  JSON.stringify({ title, body, url });

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const type = body.type || "question"; // older question trigger sends no type
    const rec = body.record;
    console.log("invoked — type:", type, "record:", rec?.id);
    if (!rec) return new Response("no record", { status: 400 });

    const pub = Deno.env.get("VAPID_PUBLIC_KEY");
    const priv = Deno.env.get("VAPID_PRIVATE_KEY");
    const subj = Deno.env.get("VAPID_SUBJECT");
    if (!pub || !priv || !subj) {
      console.error("Missing VAPID secrets.");
      return new Response("missing vapid", { status: 500 });
    }
    webpush.setVapidDetails(subj, pub, priv);

    let sent = 0;

    if (type === "question") {
      const author = await name(rec.author_id);
      const { data: followerRows } = await admin
        .from("follows").select("follower_id").eq("followee_id", rec.author_id);
      const followers = new Set((followerRows ?? []).map((r) => r.follower_id));
      const { data: prefs } = await admin
        .from("notification_prefs")
        .select("user_id, every_question, followed_only, categories");
      const recipients = (prefs ?? [])
        .filter((p) => p.user_id !== rec.author_id && (
          p.every_question ||
          (p.categories ?? []).includes(rec.flair) ||
          (p.followed_only && followers.has(p.user_id))
        ))
        .map((p) => p.user_id);
      console.log("question recipients:", recipients.length);
      sent = await sendToUsers(recipients,
        payload(`${author} asked a ${FLAIR_LABEL[rec.flair] ?? "question"}`, rec.title, `/q/${rec.id}`));

    } else if (type === "reply") {
      const q = await question(rec.question_id);
      if (q && q.author_id !== rec.author_id) {
        const actor = q.anonymous_replies ? "Someone" : await name(rec.author_id);
        sent = await sendToUsers([q.author_id],
          payload(`${actor} replied to your question`, `"${q.title}" — ${rec.body}`.slice(0, 160), `/q/${q.id}`));
      } else console.log("reply by the author themselves — skipping");

    } else if (type === "clarif") {
      const q = await question(rec.question_id);
      if (q && q.author_id !== rec.asker_id) {
        const actor = await name(rec.asker_id);
        sent = await sendToUsers([q.author_id],
          payload(`${actor} asked for more context`, `On "${q.title}": ${rec.body}`.slice(0, 160), `/q/${q.id}`));
      }

    } else if (type === "clarif_answer") {
      const q = await question(rec.question_id);
      if (q && rec.asker_id !== q.author_id) {
        const actor = await name(q.author_id);
        sent = await sendToUsers([rec.asker_id],
          payload(`${actor} answered your clarifying question`, `${rec.answer_body}`.slice(0, 160), `/q/${q.id}`));
      }
    }

    return new Response(JSON.stringify({ type, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("FATAL:", (e as Error).message || String(e));
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
