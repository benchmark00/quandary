// ============================================================================
//  send-push  —  Supabase Edge Function (Deno)
//
//  Fires from a Database Webhook on INSERT into public.questions and pushes a
//  Web Push notification to everyone whose preferences match the new question:
//    • every_question = true              ("All, so I don't miss a thing")
//    • flair ∈ their categories[]         (per-category opt-in)
//    • followed_only and they follow the author
//
//  Deploy:   supabase functions deploy send-push --no-verify-jwt
//  Secrets:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//                                 VAPID_SUBJECT=mailto:you@quandary.app
//  (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
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

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  const { record: q } = await req.json();
  if (!q?.id) return new Response("no record", { status: 400 });

  // author (for the notification copy + to exclude from recipients)
  const { data: author } = await admin
    .from("profiles").select("name").eq("id", q.author_id).single();

  // who follows the author
  const { data: followerRows } = await admin
    .from("follows").select("follower_id").eq("followee_id", q.author_id);
  const followers = new Set((followerRows ?? []).map((r) => r.follower_id));

  // resolve recipients from preferences
  const { data: prefs } = await admin
    .from("notification_prefs")
    .select("user_id, every_question, followed_only, categories");

  const recipients = (prefs ?? [])
    .filter((p) =>
      p.user_id !== q.author_id && (
        p.every_question ||
        (p.categories ?? []).includes(q.flair) ||
        (p.followed_only && followers.has(p.user_id))
      )
    )
    .map((p) => p.user_id);

  if (recipients.length === 0) return new Response("no recipients", { status: 200 });

  // gather their devices
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", recipients);

  const payload = JSON.stringify({
    title: `${author?.name ?? "Someone"} asked a ${FLAIR_LABEL[q.flair] ?? "question"}`,
    body: q.title,
    url: `/q/${q.id}`,
  });

  // send, pruning any subscription the push service has retired
  const dead: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }));
  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);

  return new Response(JSON.stringify({ sent: (subs?.length ?? 0) - dead.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
