// ============================================================================
//  api.js — the data layer.
//  Each function mirrors an action the prototype already performs, so wiring
//  the UI up is mostly swapping in-memory setState calls for these.
//  RLS on the database enforces "who can do what"; this layer just asks.
// ============================================================================
import { supabase } from "./supabase";

const me = async () => (await supabase.auth.getUser()).data.user?.id;

/* ---------- auth ---------- */
export const signUp = (email, password, name, handle) =>
  supabase.auth.signUp({ email, password, options: { data: { name, handle } } });
export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });
export const signOut = () => supabase.auth.signOut();

/* ---------- feed ---------- *
 * Pulls questions with nested options, plus aggregate counts. For the live
 * vote tallies and rating averages you'd typically expose SQL views or an RPC;
 * shown here as a straightforward nested select to start.
 */
export async function listFeed({ flair = null, sort = "hot", followingOf = null } = {}) {
  let query = supabase
    .from("questions")
    .select(`
      id, author_id, flair, format, title, body, anonymous, created_at,
      author:profiles!questions_author_id_fkey ( name, handle, color ),
      question_options ( id, label, position ),
      vote_details ( option_id, voter_id ),
      replies ( id ),
      clarifications ( id ),
      ratings ( stars )
    `)
    .eq("hidden", false);

  if (flair) query = query.eq("flair", flair);
  if (followingOf) {
    const { data: f } = await supabase.from("follows")
      .select("followee_id").eq("follower_id", followingOf);
    query = query.in("author_id", (f ?? []).map((r) => r.followee_id));
  }
  if (sort === "new" || sort === "following") query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  // "hot" is a derived score — sort client-side after fetch.
  if (sort === "hot") {
    data.sort((a, b) => score(b) - score(a));
  }
  return data;
}
const score = (q) =>
  (q.vote_details?.length ?? 0) +
  (q.replies?.length ?? 0) * 2 +
  (q.ratings?.length ? q.ratings.reduce((s, r) => s + r.stars, 0) / q.ratings.length : 0);

export async function getQotd() {
  const { data } = await supabase
    .from("daily_question")
    .select("question_id, questions(*)")
    .eq("for_date", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  return data?.questions ?? null;
}

/* ---------- create ---------- */
export async function createQuestion({ flair, format, title, body, anonymous, options }) {
  const author_id = await me();
  const { data: q, error } = await supabase
    .from("questions")
    .insert({ author_id, flair, format, title, body, anonymous })
    .select().single();
  if (error) throw error;
  if (options?.length) {
    await supabase.from("question_options")
      .insert(options.map((label, i) => ({ question_id: q.id, label, position: i })));
  }
  return q;   // the questions-insert webhook fans out push notifications
}

/* ---------- interactions ---------- */
export const vote = async (question_id, option_id) =>
  supabase.from("votes").insert({ question_id, option_id, voter_id: await me() });

export const rate = async (question_id, stars) =>
  supabase.from("ratings").upsert({ question_id, stars, rater_id: await me() });

export const reply = async (question_id, body) =>
  supabase.from("replies").insert({ question_id, body, author_id: await me() });

export const askClarification = async (question_id, body) =>
  supabase.from("clarifications").insert({ question_id, body, asker_id: await me() });

export const answerClarification = (clarification_id, answer_body) =>
  supabase.from("clarifications").update({ answer_body }).eq("id", clarification_id);

export const follow = async (followee_id) =>
  supabase.from("follows").insert({ follower_id: await me(), followee_id });
export const unfollow = async (followee_id) =>
  supabase.from("follows").delete().match({ follower_id: await me(), followee_id });

export const save = async (question_id) =>
  supabase.from("saves").insert({ user_id: await me(), question_id });
export const unsave = async (question_id) =>
  supabase.from("saves").delete().match({ user_id: await me(), question_id });

export const report = async (question_id, reason) =>
  supabase.from("reports").insert({ question_id, reporter_id: await me(), reason });

export const search = (term) =>
  supabase.from("questions")
    .select("id, flair, title, author:profiles!questions_author_id_fkey(name)")
    .eq("hidden", false)
    .ilike("title", `%${term}%`)
    .limit(30);

/* ---------- notifications ---------- */
export const getNotifications = async () =>
  supabase.from("notifications")
    .select("id, type, created_at, read, question_id, actor:profiles!notifications_actor_id_fkey(name)")
    .order("created_at", { ascending: false }).limit(50);

export const getPrefs = async () =>
  supabase.from("notification_prefs").select("*").eq("user_id", await me()).single();

export const savePrefs = async ({ every_question, followed_only, categories }) =>
  supabase.from("notification_prefs")
    .update({ every_question, followed_only, categories, updated_at: new Date().toISOString() })
    .eq("user_id", await me());

/* ---------- realtime (optional, makes polls/threads update live) ---------- */
export function subscribeToQuestion(question_id, onChange) {
  return supabase.channel(`q:${question_id}`)
    .on("postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `question_id=eq.${question_id}` }, onChange)
    .on("postgres_changes",
        { event: "*", schema: "public", table: "replies", filter: `question_id=eq.${question_id}` }, onChange)
    .on("postgres_changes",
        { event: "*", schema: "public", table: "clarifications", filter: `question_id=eq.${question_id}` }, onChange)
    .subscribe();
}
