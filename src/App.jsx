import React, { useState, useMemo, useEffect } from "react";
import {
  Home, PlusCircle, Bookmark, Bell, User, Scale, Flame, Sparkles,
  MessageCircle, Star, Flag, Search, ChevronLeft, Check, HelpCircle,
  UserPlus, UserCheck, Send, X, Split, Droplet, Tent, ThumbsDown, Plus, Trash2,
  Share, ArrowRight, Crown, Pencil,
} from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { enablePush, pushSupported, isStandalone } from "./lib/push.js";

/* ================================================================== *
 *  QUANDARY  —  Every hypothetical deserves an answer.
 *  Now wired to Supabase: real questions load from the database and
 *  every action (vote, reply, clarify, rate, follow, save, post) writes
 *  to it, then the feed refreshes.
 * ================================================================== */

const C = {
  ink: "#0D0F1A", purple: "#6C4DFF", pink: "#FF4DB8", orange: "#FF9F1C",
  yellow: "#FFD93D", teal: "#21D4C3", lavender: "#F2F3FF", white: "#FFFFFF",
};

const FLAIRS = {
  wyr:   { label: "Would You Rather",  icon: Scale,         tint: C.purple },
  tot:   { label: "This or That",      icon: Split,         tint: C.teal },
  hot:   { label: "Hot Take",          icon: Flame,         tint: C.pink },
  hypo:  { label: "Hypothetical",      icon: Sparkles,      tint: C.orange },
  moral: { label: "Moral Dilemma",     icon: Scale,         tint: "#E0A800" },
  unpop: { label: "Unpopular Opinion", icon: ThumbsDown,    tint: C.pink },
  free:  { label: "Free Form",         icon: MessageCircle, tint: C.purple },
  island:{ label: "Desert Island",     icon: Tent,          tint: C.orange },
  shower:{ label: "Shower Thought",    icon: Droplet,       tint: C.teal },
};

// Profiles are loaded from the database at runtime and cached here, so the
// presentational components can look a user up by id without prop-drilling.
const PROFILES = {};
const userById = (id) =>
  PROFILES[id] || { id, name: "Someone", handle: "someone", color: "#6C4DFF" };

let _id = 100;
const nid = () => `x${_id++}`;
const QOTD_ID = "q1";

const seed = [
  {
    id: "q1", authorId: "u1", flair: "wyr", format: "pollfree", anon: false,
    title: "One ice skate for a year, or 'Hey There Delilah' on loop for 4 months?",
    body: "You can't take the skate off. The song plays in your ears, every waking hour. Choose your suffering.",
    options: [
      { id: "o1", text: "One ice skate, full year", voters: ["u3", "u5"] },
      { id: "o2", text: "Delilah on loop, 4 months", voters: ["u2", "u4", "u6"] },
    ],
    replies: [
      { id: "r1", userId: "u4", text: "The skate at least builds character. And one hell of a calf.", ts: Date.now() - 3.6e6 },
      { id: "r2", userId: "u2", text: "Four months is nothing. I already have it stuck in my head reading this.", ts: Date.now() - 1.2e6 },
    ],
    clarifs: [
      { id: "c1", userId: "u3", text: "Can I wear a shoe on the other foot, or is it skate + bare foot?", ts: Date.now() - 4e6,
        answer: { text: "Normal shoe on the other foot. Just the one skate, always on.", ts: Date.now() - 3.8e6 } },
      { id: "c2", userId: "u6", text: "Is it the studio version of Delilah or live? This matters enormously.", ts: Date.now() - 7e5, answer: null },
    ],
    ratings: { u2: 5, u3: 4, u4: 5, u5: 5 }, reported: false, ts: Date.now() - 6e6,
  },
  {
    id: "q2", authorId: "u3", flair: "moral", format: "poll", anon: true,
    title: "You find a wallet with $500 and a name. No one saw. What now?",
    body: "Anonymous answers on this one — be honest.",
    options: [
      { id: "o3", text: "Return it, every cent", voters: ["u1", "u2", "u5"] },
      { id: "o4", text: "Return it, keep a 'finder's fee'", voters: ["u6"] },
      { id: "o5", text: "Keep it. Finders keepers.", voters: ["u4"] },
    ],
    replies: [], clarifs: [], ratings: { u1: 4, u6: 5 }, reported: false, ts: Date.now() - 1.1e7,
  },
  {
    id: "q3", authorId: "u5", flair: "hot", format: "free", anon: false,
    title: "Cereal is just cold soup and we should treat it with that respect.",
    body: "Bowl, spoon, liquid base, solid garnish. I will not be taking questions. (Okay, I will.)",
    options: [],
    replies: [
      { id: "r3", userId: "u6", text: "Soup implies savoury. This is a dessert beverage at best.", ts: Date.now() - 9e5 },
      { id: "r4", userId: "u3", text: "By this logic a smoothie is a milkshake's lawyer.", ts: Date.now() - 4e5 },
    ],
    clarifs: [], ratings: { u2: 5, u4: 4 }, reported: false, ts: Date.now() - 4e6,
  },
  {
    id: "q4", authorId: "u2", flair: "island", format: "pollfree", anon: false,
    title: "Stranded forever. One album, one book, one snack. The snack is non-negotiable.",
    body: "Pick the snack first. Everything else flows from the snack.",
    options: [
      { id: "o6", text: "Salt & vinegar crisps", voters: ["u1", "u6"] },
      { id: "o7", text: "A perfect, infinite mango", voters: ["u5"] },
      { id: "o8", text: "Dark chocolate, 70%", voters: ["u3", "u4"] },
    ],
    replies: [{ id: "r5", userId: "u4", text: "Infinite mango is a trap. Day 40 you'll be feral for salt.", ts: Date.now() - 2e5 }],
    clarifs: [], ratings: { u3: 4, u5: 5 }, reported: false, ts: Date.now() - 2e6,
  },
  {
    id: "q5", authorId: "u6", flair: "hypo", format: "free", anon: false,
    title: "You can pause time, but only while standing perfectly still. Best use?",
    body: "The catch: any movement un-pauses it. So you can think, but not act.",
    options: [], replies: [{ id: "r6", userId: "u2", text: "Naps. Aggressive, uninterruptible naps.", ts: Date.now() - 1e5 }],
    clarifs: [], ratings: { u1: 5 }, reported: false, ts: Date.now() - 8e5,
  },
  {
    id: "q6", authorId: "u4", flair: "unpop", format: "poll", anon: false,
    title: "Pineapple on pizza is fine. The real crime is bad cheese.",
    options: [
      { id: "o9",  text: "Agree, leave the pineapple alone", voters: ["u1", "u5"] },
      { id: "o10", text: "Disagree, it's a war crime", voters: ["u6"] },
    ],
    body: "", replies: [], clarifs: [], ratings: { u5: 4 }, reported: false, ts: Date.now() - 3e5,
  },
];

const seedActivity = [
  { id: "a1", type: "clarif", userId: "u6", qId: "q1", ts: Date.now() - 7e5 },
  { id: "a2", type: "vote",   userId: "u4", qId: "q1", ts: Date.now() - 3.6e6 },
  { id: "a3", type: "reply",  userId: "u2", qId: "q1", ts: Date.now() - 1.2e6 },
  { id: "a4", type: "follow", userId: "u5", ts: Date.now() - 9e5 },
];

const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
const avg = (r) => { const v = Object.values(r); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const totalVotes = (q) => (q.options || []).reduce((a, o) => a + o.voters.length, 0);

/* ---------- logo ---------- */
function Logo({ size = 40, sparks = true }) {
  // Icon-only Q cropped from the brand wordmark. (sparks kept for API compat.)
  return (
    <img src="/logo.png" alt="" aria-hidden className="logo-img"
      style={{ width: size, height: size }} draggable={false} />
  );
}
function Wordmark({ size = 28 }) {
  // size ≈ the old text height; the image is sized to occupy the same slot.
  return (
    <img src="/wordmark.png" alt="Quandary" className="wordmark-img"
      style={{ height: size * 1.45 }} draggable={false} />
  );
}

/* ---------- small pieces ---------- */
function Avatar({ id, size = 30 }) {
  const u = userById(id);
  return <div className="avatar" style={{ width: size, height: size, background: u.color, fontSize: size * 0.42 }}>
    {u.name === "You" ? "Y" : u.name[0]}</div>;
}
function Stars({ value, onRate, size = 16, mine }) {
  return (
    <div className="stars" role="group" aria-label="Rate this question">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={"starbtn" + (n <= Math.round(value) ? " on" : "")}
          onClick={onRate ? () => onRate(n) : undefined} aria-label={`${n} star${n > 1 ? "s" : ""}`}
          style={{ cursor: onRate ? "pointer" : "default" }}>
          <Star size={size} fill={n <= Math.round(value) ? "currentColor" : "none"} />
        </button>
      ))}
      {mine ? <span className="mine">your {mine}★</span> : null}
    </div>
  );
}
function FlairChip({ k, active, onClick, check }) {
  const f = FLAIRS[k]; const Icon = f.icon;
  return (
    <button className={"flairchip" + (active ? " active" : "")} onClick={onClick}
      style={active ? { borderColor: f.tint, color: f.tint, background: f.tint + "14" } : undefined}>
      {check && active ? <Check size={13} /> : <Icon size={13} />} {f.label}
    </button>
  );
}

/* ================================================================== */
export default function Quandary() {
  const [onboarded, setOnboarded] = useState(true);
  const [tab, setTab] = useState("feed");
  const [questions, setQuestions] = useState([]);
  const [following, setFollowing] = useState(new Set());
  const [saved, setSaved] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("new");
  const [open, setOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [activity, setActivity] = useState([]);
  const [prefs, setPrefs] = useState({ every: false, followed: true, cats: new Set() });
  const [me, setMe] = useState(null);
  const [qotdId, setQotdId] = useState(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const flash = (m) => setToast(m);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);

  async function loadAll() {
    try {
      setError("");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("You're not signed in."); setLoading(false); return; }
      setMe(user.id);

      const [{ data: profiles }, { data: baseQs }] = await Promise.all([
        supabase.from("profiles").select("id, name, handle, color, onboarded"),
        supabase.from("questions").select("id, author_id, flair, format, title, body, anonymous, created_at").eq("hidden", false),
      ]);
      (profiles || []).forEach((p) => { PROFILES[p.id] = p; });
      const myProfile = (profiles || []).find((p) => p.id === user.id);
      setOnboarded(myProfile ? myProfile.onboarded === true : true);

      const ids = (baseQs || []).map((q) => q.id);
      const inIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];

      const [opts, votes, myVotes, replies, clarifs, ratings, myFollows, mySaves, myFollowers, notifs, myPrefs, qotdRes] = await Promise.all([
        supabase.from("question_options").select("id, question_id, label, position").in("question_id", inIds),
        supabase.from("vote_details").select("question_id, option_id, voter_id").in("question_id", inIds),
        supabase.from("votes").select("question_id, option_id").eq("voter_id", user.id),
        supabase.from("replies").select("id, question_id, author_id, body, created_at").in("question_id", inIds),
        supabase.from("clarifications").select("id, question_id, asker_id, body, answer_body, answered_at, created_at").in("question_id", inIds),
        supabase.from("ratings").select("question_id, rater_id, stars").in("question_id", inIds),
        supabase.from("follows").select("followee_id").eq("follower_id", user.id),
        supabase.from("saves").select("question_id").eq("user_id", user.id),
        supabase.from("follows").select("follower_id").eq("followee_id", user.id),
        supabase.from("notifications").select("id, actor_id, type, question_id, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(40),
        supabase.from("notification_prefs").select("every_question, followed_only, categories").eq("user_id", user.id).maybeSingle(),
        supabase.rpc("get_qotd"),
      ]);

      const myVoteByQ = {};
      (myVotes.data || []).forEach((v) => { myVoteByQ[v.question_id] = v.option_id; });

      const grp = (rows, key) => { const m = {}; (rows || []).forEach((r) => { (m[r[key]] = m[r[key]] || []).push(r); }); return m; };
      const optG = grp(opts.data, "question_id");
      const voteG = grp(votes.data, "question_id");
      const repG = grp(replies.data, "question_id");
      const clarG = grp(clarifs.data, "question_id");
      const ratG = grp(ratings.data, "question_id");

      const shaped = (baseQs || []).map((q) => {
        const options = (optG[q.id] || []).sort((a, b) => a.position - b.position).map((o) => {
          const rows = (voteG[q.id] || []).filter((v) => v.option_id === o.id);
          const real = rows.filter((v) => v.voter_id).map((v) => v.voter_id);
          const nulls = rows.length - real.length;
          const voters = [...real, ...Array(nulls).fill(null)];
          if (myVoteByQ[q.id] === o.id && !real.includes(user.id)) {
            const ni = voters.indexOf(null);
            if (ni >= 0) voters[ni] = user.id; else voters.push(user.id);
          }
          return { id: o.id, text: o.label, voters };
        });
        const reps = (repG[q.id] || []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
          .map((r) => ({ id: r.id, userId: r.author_id, text: r.body, ts: Date.parse(r.created_at) }));
        const clars = (clarG[q.id] || []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
          .map((c) => ({ id: c.id, userId: c.asker_id, text: c.body, ts: Date.parse(c.created_at),
            answer: c.answer_body ? { text: c.answer_body, ts: Date.parse(c.answered_at || c.created_at) } : null }));
        const rts = {}; (ratG[q.id] || []).forEach((r) => { rts[r.rater_id] = r.stars; });
        return { id: q.id, authorId: q.author_id, flair: q.flair, format: q.format, anon: q.anonymous,
          title: q.title, body: q.body || "", options, replies: reps, clarifs: clars, ratings: rts, reported: false, ts: Date.parse(q.created_at) };
      });

      setQuestions(shaped);
      setFollowing(new Set((myFollows.data || []).map((f) => f.followee_id)));
      setSaved(new Set((mySaves.data || []).map((s) => s.question_id)));
      setFollowerCount((myFollowers.data || []).length);
      setActivity((notifs.data || []).map((n) => ({ id: n.id, userId: n.actor_id, type: n.type, qId: n.question_id, ts: Date.parse(n.created_at) })));
      if (myPrefs.data) setPrefs({ every: !!myPrefs.data.every_question, followed: !!myPrefs.data.followed_only, cats: new Set(myPrefs.data.categories || []) });
      setQotdId(qotdRes && qotdRes.data ? qotdRes.data : null);
      setLoading(false);
    } catch (e) {
      setError(e.message || "Couldn't load your data.");
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  // Item 10 — live feed: when anyone posts a question or reply, refresh.
  useEffect(() => {
    const ch = supabase.channel("live-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "questions" }, () => loadAll())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "replies" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Onboarding uses updater-style setPrefs; persist those picks as well.
  const setPrefsPersist = (updater) => setPrefs((p) => {
    const next = typeof updater === "function" ? updater(p) : updater;
    supabase.from("notification_prefs").update({
      every_question: next.every, followed_only: next.followed, categories: [...next.cats],
      updated_at: new Date().toISOString(),
    }).eq("user_id", me).then(({ error }) => { if (error) flash("Couldn't save preferences: " + error.message); });
    return next;
  });

  // Items 3 + 11 — prefs save to the database, and the two toggles are exclusive.
  const updatePrefs = async (next) => {
    setPrefs(next);
    try {
      const { error } = await supabase.from("notification_prefs").update({
        every_question: next.every,
        followed_only: next.followed,
        categories: [...next.cats],
        updated_at: new Date().toISOString(),
      }).eq("user_id", me);
      if (error) throw error;
    } catch (e) { flash("Couldn't save preferences: " + e.message); }
  };

  const vote = async (qId, optId) => {
    try {
      const { error } = await supabase.from("votes").insert({ question_id: qId, option_id: optId, voter_id: me });
      if (error && error.code === "23505") flash("You've already weighed in on this one");
      else if (error) throw error;
      await loadAll();
    } catch (e) { flash(e.message); }
  };
  const rate = async (qId, n) => {
    try { await supabase.from("ratings").upsert({ question_id: qId, rater_id: me, stars: n }, { onConflict: "question_id,rater_id" }); await loadAll(); }
    catch (e) { flash(e.message); }
  };
  const reply = async (qId, text) => {
    try { await supabase.from("replies").insert({ question_id: qId, author_id: me, body: text }); await loadAll(); }
    catch (e) { flash(e.message); }
  };
  const askClarif = async (qId, text) => {
    try { await supabase.from("clarifications").insert({ question_id: qId, asker_id: me, body: text }); flash("Sent to the asker"); await loadAll(); }
    catch (e) { flash(e.message); }
  };
  const answerClarif = async (qId, cId, text) => {
    try { await supabase.from("clarifications").update({ answer_body: text }).eq("id", cId); await loadAll(); }
    catch (e) { flash(e.message); }
  };
  const report = async (qId) => {
    try { await supabase.from("reports").insert({ question_id: qId, reporter_id: me }); flash("Reported — a moderator will take a look."); }
    catch (e) { flash(e.code === "23505" ? "You've already reported this." : e.message); }
  };
  const toggleSave = async (qId) => {
    const has = saved.has(qId);
    try {
      if (has) await supabase.from("saves").delete().match({ user_id: me, question_id: qId });
      else await supabase.from("saves").insert({ user_id: me, question_id: qId });
      setSaved((s) => { const n = new Set(s); has ? n.delete(qId) : n.add(qId); return n; });
      flash(has ? "Removed from saved" : "Saved to your list");
    } catch (e) { flash(e.message); }
  };
  const toggleFollow = async (uId) => {
    const has = following.has(uId);
    try {
      if (has) await supabase.from("follows").delete().match({ follower_id: me, followee_id: uId });
      else await supabase.from("follows").insert({ follower_id: me, followee_id: uId });
      setFollowing((s) => { const n = new Set(s); has ? n.delete(uId) : n.add(uId); return n; });
      flash(has ? `Unfollowed ${userById(uId).name}` : `Following ${userById(uId).name}`);
    } catch (e) { flash(e.message); }
  };
  const editQuestion = async (qId, title, body) => {
    try {
      const { error } = await supabase.from("questions").update({ title, body }).eq("id", qId);
      if (error) throw error;
      await loadAll(); flash("Question updated");
    } catch (e) { flash(e.message); }
  };
  const deleteQuestion = async (qId) => {
    try {
      const { error } = await supabase.from("questions").delete().eq("id", qId);
      if (error) throw error;
      setOpen(null); await loadAll(); flash("Question deleted");
    } catch (e) { flash(e.message); }
  };
  const createQuestion = async (q) => {
    try {
      const { data: inserted, error } = await supabase.from("questions")
        .insert({ author_id: me, flair: q.flair, format: q.format, title: q.title, body: q.body, anonymous: q.anon })
        .select().single();
      if (error) throw error;
      if (q.options && q.options.length) {
        const { error: oErr } = await supabase.from("question_options")
          .insert(q.options.map((o, i) => ({ question_id: inserted.id, label: o.text, position: i })));
        if (oErr) throw oErr;
      }
      await loadAll(); setTab("feed"); setFilter("all"); setSort("new"); flash("Posted — your question is live");
    } catch (e) { flash(e.message); }
  };

  const visible = useMemo(() => {
    let list = [...questions];
    if (filter !== "all") list = list.filter((q) => q.flair === filter);
    if (sort === "new") list.sort((a, b) => b.ts - a.ts);
    else if (sort === "hot") list.sort((a, b) => (totalVotes(b) + b.replies.length * 2 + avg(b.ratings)) - (totalVotes(a) + a.replies.length * 2 + avg(a.ratings)));
    else if (sort === "following") { list = list.filter((q) => following.has(q.authorId)); list.sort((a, b) => b.ts - a.ts); }
    if (filter === "all" && sort !== "following" && qotdId) list = list.filter((q) => q.id !== qotdId);
    return list;
  }, [questions, filter, sort, following, qotdId]);

  const openQ = questions.find((q) => q.id === open);

  if (loading) return (<div className="q-root"><Style /><div className="phone"><div className="boot"><Logo size={54} /><div>Loading Quandary…</div></div></div></div>);
  if (error) return (<div className="q-root"><Style /><div className="phone"><div className="boot"><div className="booterr">{error}</div><button className="bootbtn" onClick={() => { setLoading(true); loadAll(); }}>Try again</button></div></div></div>);
  const finishOnboarding = () => {
    setOnboarded(true);
    supabase.from("profiles").update({ onboarded: true }).eq("id", me)
      .then(({ error }) => { if (error) console.error("Couldn't save onboarding state:", error.message); });
  };
  if (!onboarded) return (<div className="q-root"><Style /><div className="phone"><Onboarding onDone={finishOnboarding} prefs={prefs} setPrefs={setPrefsPersist} /></div></div>);

  return (
    <div className="q-root">
      <Style />
      <div className="phone">
        {tab === "feed" && (
          <header className="topbar">
            <Wordmark size={24} />
            <button className="iconbtn" aria-label="Search" onClick={() => setSearchOpen(true)}><Search size={20} /></button>
          </header>
        )}

        <main className="scroll">
          {tab === "feed" && (
            <Feed list={visible} qotd={filter === "all" && sort !== "following" ? questions.find((q) => q.id === qotdId) : null}
              filter={filter} setFilter={setFilter} sort={sort} setSort={setSort}
              saved={saved} following={following} onOpen={setOpen} onSave={toggleSave} onFollow={toggleFollow} me={me} />
          )}
          {tab === "create" && <Create onPost={createQuestion} me={me} />}
          {tab === "saved" && <Saved list={questions.filter((q) => saved.has(q.id))} onOpen={setOpen} saved={saved} onSave={toggleSave} following={following} onFollow={toggleFollow} me={me} />}
          {tab === "alerts" && <Alerts activity={activity} prefs={prefs} updatePrefs={updatePrefs} onOpen={setOpen} />}
          {tab === "you" && <Profile me={me} questions={questions} following={following} followerCount={followerCount} onFollow={toggleFollow} onOpen={setOpen} replay={() => setOnboarded(false)} />}
        </main>

        <nav className="tabbar">
          {[["feed", Home, "Feed"], ["create", PlusCircle, "Ask"], ["saved", Bookmark, "Saved"], ["alerts", Bell, "Alerts"], ["you", User, "You"]].map(([k, Icon, label]) => (
            <button key={k} className={"tabbtn" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>
              <Icon size={22} strokeWidth={tab === k ? 2.4 : 1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>

        {openQ && (
          <Detail q={openQ} me={me} following={following} saved={saved} onClose={() => setOpen(null)}
            onVote={vote} onRate={rate} onReply={reply} onReport={report} onSave={toggleSave} onFollow={toggleFollow}
            onAskClarif={askClarif} onAnswerClarif={answerClarif}
            onEdit={editQuestion} onDelete={deleteQuestion} />
        )}
        {searchOpen && <SearchOverlay questions={questions} onClose={() => setSearchOpen(false)} onOpen={(id) => { setSearchOpen(false); setOpen(id); }} />}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}

/* ---------- ONBOARDING ---------- */
function Onboarding({ onDone, prefs, setPrefs }) {
  const [step, setStep] = useState(0);
  const [plat, setPlat] = useState("ios");
  const setCat = (k) => setPrefs((p) => { const c = new Set(p.cats); c.has(k) ? c.delete(k) : c.add(k); return { ...p, cats: c, every: false }; });
  const setAll = () => setPrefs((p) => ({ ...p, every: true }));
  const next = () => setStep((s) => s + 1);

  return (
    <div className="onb">
      <div className="onb-dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i === step ? "on" : ""} />)}</div>

      {step === 0 && (
        <div className="onb-screen center">
          <div className="onb-logo"><Logo size={96} /></div>
          <h1 className="onb-brand"><Wordmark size={40} /></h1>
          <p className="onb-tag">Every hypothetical <span>deserves an answer.</span></p>
          <p className="onb-lead">The home for the impossible hypotheticals you'd bring to the dinner table — and the people ready to argue about them.</p>
          <button className="btn-primary" onClick={next}>Get started <ArrowRight size={18} /></button>
        </div>
      )}

      {step === 1 && (
        <div className="onb-screen">
          <h2 className="onb-h">Here's how it works</h2>
          <div className="howlist">
            {[
              [Scale, C.purple, "Ask the impossible", "Would-you-rathers, hot takes, moral dilemmas. Pick a poll, open replies, or both."],
              [HelpCircle, C.teal, "Ask for clarification", "Need the rules pinned down? Ask the question-asker directly — everyone sees their answer."],
              [Star, C.orange, "Weigh in & rate", "Vote, reply, rate out of five, and save the best ones for your next dinner."],
            ].map(([Icon, tint, t, b], i) => (
              <div className="how" key={i}>
                <div className="how-ic" style={{ background: tint + "1A", color: tint }}><Icon size={22} /></div>
                <div><div className="how-t">{t}</div><div className="how-b">{b}</div></div>
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={next}>Next <ArrowRight size={18} /></button>
        </div>
      )}

      {step === 2 && (
        <div className="onb-screen">
          <h2 className="onb-h">Add Quandary to your home screen</h2>
          <p className="onb-sub">It runs like a real app — and it's the only way to get push notifications when a new question drops.</p>
          <div className="segrow">
            <button className={"seg" + (plat === "ios" ? " on" : "")} onClick={() => setPlat("ios")}>iPhone</button>
            <button className={"seg" + (plat === "android" ? " on" : "")} onClick={() => setPlat("android")}>Android</button>
          </div>
          <div className="install">
            {plat === "ios" ? (
              <ol>
                <li><b>Tap the Share icon</b> <Share size={15} /> in Safari's bottom bar.</li>
                <li>Scroll and choose <b>Add to Home Screen</b>.</li>
                <li>Tap <b>Add</b> — the Q lands on your home screen.</li>
              </ol>
            ) : (
              <ol>
                <li>Tap the <b>⋮ menu</b> in Chrome's top-right.</li>
                <li>Choose <b>Install app</b> (or <b>Add to Home screen</b>).</li>
                <li>Confirm — Quandary installs like any app.</li>
              </ol>
            )}
          </div>
          <button className="btn-primary" onClick={next}>I've added it</button>
          <button className="btn-text" onClick={next}>Maybe later</button>
        </div>
      )}

      {step === 3 && (
        <div className="onb-screen">
          <h2 className="onb-h">What should we ping you about?</h2>
          <p className="onb-sub">Get everything, or pick the categories you care about. Change this any time in Alerts.</p>
          <button className={"all-pill" + (prefs.every ? " on" : "")} onClick={setAll}>
            <Bell size={17} /> All, so I don't miss a thing
            {prefs.every && <Check size={17} className="all-check" />}
          </button>
          <div className="or-div"><span>or just your favourites</span></div>
          <div className="chiprow wrap big">
            {Object.keys(FLAIRS).map((k) => <FlairChip key={k} k={k} active={!prefs.every && prefs.cats.has(k)} onClick={() => setCat(k)} check />)}
          </div>
          <button className="btn-primary" onClick={onDone}>Start exploring</button>
        </div>
      )}
    </div>
  );
}

/* ---------- SEARCH ---------- */
function SearchOverlay({ questions, onClose, onOpen }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return questions.filter((x) => (x.title + " " + x.body + " " + FLAIRS[x.flair].label).toLowerCase().includes(t));
  }, [q, questions]);
  return (
    <div className="search-ov">
      <div className="search-head">
        <Search size={18} className="search-ic" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" />
        <button className="iconbtn" onClick={onClose} aria-label="Close search"><X size={20} /></button>
      </div>
      <div className="search-body">
        {!q.trim() && <p className="empty-inline">Try “mango”, “time”, or a category like “moral”.</p>}
        {q.trim() && results.length === 0 && <p className="empty-inline">No questions match “{q.trim()}”.</p>}
        {results.map((x) => {
          const f = FLAIRS[x.flair]; const Icon = f.icon;
          return (
            <button key={x.id} className="sresult" onClick={() => onOpen(x.id)}>
              <span className="flairtag" style={{ color: f.tint }}><Icon size={12} /> {f.label}</span>
              <span className="sres-title">{x.title}</span>
              <span className="meta">{userById(x.authorId).name} · {totalVotes(x) + x.replies.length} answers</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- FEED ---------- */
function Feed({ list, qotd, filter, setFilter, sort, setSort, saved, following, onOpen, onSave, onFollow, me }) {
  return (
    <>
      <div className="sortrow">
        {[["hot", "Hot"], ["new", "New"], ["following", "Following"]].map(([k, l]) => (
          <button key={k} className={"sortbtn" + (sort === k ? " active" : "")} onClick={() => setSort(k)}>{l}</button>
        ))}
      </div>
      <div className="chiprow">
        <button className={"flairchip" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}
          style={filter === "all" ? { borderColor: C.purple, color: C.purple, background: C.purple + "14" } : undefined}>All</button>
        {Object.keys(FLAIRS).map((k) => <FlairChip key={k} k={k} active={filter === k} onClick={() => setFilter(filter === k ? "all" : k)} />)}
      </div>

      {qotd && <Qotd q={qotd} onOpen={() => onOpen(qotd.id)} />}

      {list.length === 0 ? (
        <Empty title={sort === "following" ? "No questions from your circle yet" : "Nothing here yet"}
          body={sort === "following" ? "Follow a few people, or be the one who starts the argument." : "Be the first to ask one."} />
      ) : (
        <div className="cards">
          {list.map((q) => <Card key={q.id} q={q} me={me} saved={saved.has(q.id)} isFollowing={following.has(q.authorId)}
            onOpen={() => onOpen(q.id)} onSave={() => onSave(q.id)} onFollow={() => onFollow(q.authorId)} />)}
        </div>
      )}
    </>
  );
}

function Qotd({ q, onOpen }) {
  const f = FLAIRS[q.flair];
  const votes = totalVotes(q);
  return (
    <button className="qotd" onClick={onOpen}>
      <div className="qotd-ribbon"><Crown size={13} /> Question of the day</div>
      <h2 className="qotd-title">{q.title}</h2>
      <div className="qotd-foot">
        <span><Scale size={15} /> {votes} votes</span>
        <span><MessageCircle size={15} /> {q.replies.length}</span>
        <span><HelpCircle size={15} /> {q.clarifs.length}</span>
        <span className="qotd-go">Weigh in <ArrowRight size={15} /></span>
      </div>
    </button>
  );
}

function Card({ q, me, saved, isFollowing, onOpen, onSave, onFollow }) {
  const f = FLAIRS[q.flair]; const Icon = f.icon;
  const votes = totalVotes(q); const a = avg(q.ratings); const author = userById(q.authorId);
  return (
    <article className="card" onClick={onOpen} style={{ "--accent": f.tint }}>
      <div className="card-top">
        <div className="byline">
          <Avatar id={q.authorId} />
          <div className="byline-txt"><span className="name">{author.name}</span><span className="meta">@{author.handle} · {ago(q.ts)}</span></div>
        </div>
        {q.authorId !== me && (
          <button className={"followmini" + (isFollowing ? " on" : "")} onClick={(e) => { e.stopPropagation(); onFollow(); }} aria-label="Follow">
            {isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
          </button>
        )}
      </div>
      <div className="flairtag" style={{ color: f.tint }}><Icon size={13} /> {f.label}{q.anon ? " · anon" : ""}</div>
      <h3 className="card-title">{q.title}</h3>
      {q.body ? <p className="card-body">{q.body}</p> : null}
      <div className="card-foot">
        <span className="stat">{q.format === "free" ? <MessageCircle size={15} /> : <Scale size={15} />}{q.format === "free" ? `${q.replies.length}` : `${votes}`}</span>
        {q.clarifs.length > 0 && <span className="stat"><HelpCircle size={15} />{q.clarifs.length}</span>}
        <span className="stat"><Star size={15} fill={a ? "currentColor" : "none"} />{a ? a.toFixed(1) : "—"}</span>
        <button className={"stat tap" + (saved ? " saved" : "")} onClick={(e) => { e.stopPropagation(); onSave(); }} aria-label="Save">
          <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
    </article>
  );
}

/* ---------- DETAIL ---------- */
function Detail({ q, me, following, saved, onClose, onVote, onRate, onReply, onReport, onSave, onFollow, onAskClarif, onAnswerClarif, onEdit, onDelete }) {
  const f = FLAIRS[q.flair]; const Icon = f.icon; const author = userById(q.authorId);
  const isAuthor = q.authorId === me;
  const [editing, setEditing] = useState(false);
  const [tDraft, setTDraft] = useState(q.title);
  const [bDraft, setBDraft] = useState(q.body);
  const [confirmDel, setConfirmDel] = useState(false);
  const myVote = (q.options || []).find((o) => o.voters.includes(me));
  const hasVoted = !!myVote; const votes = totalVotes(q); const myRating = q.ratings[me];
  const [draft, setDraft] = useState("");
  const [clarDraft, setClarDraft] = useState("");
  const [answering, setAnswering] = useState(null);
  const [ansDraft, setAnsDraft] = useState("");
  const isPoll = q.format === "poll" || q.format === "pollfree";
  const isThread = q.format === "free" || q.format === "pollfree";

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="iconbtn" onClick={onClose} aria-label="Back"><ChevronLeft size={20} /></button>
          <span className="flairtag" style={{ color: f.tint }}><Icon size={13} /> {f.label}</span>
          {isAuthor ? (
            <span style={{ display: "inline-flex", gap: 2 }}>
              <button className="iconbtn" onClick={() => { setTDraft(q.title); setBDraft(q.body); setEditing(true); }} aria-label="Edit" title="Edit"><Pencil size={17} /></button>
              <button className="iconbtn" onClick={() => setConfirmDel(true)} aria-label="Delete" title="Delete"><Trash2 size={17} /></button>
            </span>
          ) : (
            <button className="iconbtn" onClick={() => onReport(q.id)} aria-label="Report" title="Report"><Flag size={17} /></button>
          )}
        </div>

        {confirmDel && (
          <div className="confirmbar">
            <span>Delete this question and all its votes and replies?</span>
            <button className="confirm-del" onClick={() => onDelete(q.id)}>Delete</button>
            <button className="confirm-keep" onClick={() => setConfirmDel(false)}>Keep it</button>
          </div>
        )}

        <div className="sheet-scroll">
          <div className="byline big">
            <Avatar id={q.authorId} size={38} />
            <div className="byline-txt"><span className="name">{author.name}</span><span className="meta">@{author.handle} · {ago(q.ts)}</span></div>
            {!isAuthor && (
              <button className={"followmini wide" + (following.has(q.authorId) ? " on" : "")} onClick={() => onFollow(q.authorId)}>
                {following.has(q.authorId) ? "Following" : "Follow"}
              </button>
            )}
          </div>

          {editing ? (
            <div className="editbox">
              <textarea rows={3} maxLength={400} value={tDraft} onChange={(e) => setTDraft(e.target.value)} />
              <textarea rows={2} placeholder="More context (optional)" value={bDraft} onChange={(e) => setBDraft(e.target.value)} />
              <div className="editrow">
                <button className="confirm-keep" onClick={() => setEditing(false)}>Cancel</button>
                <button className="edit-save" disabled={tDraft.trim().length < 5}
                  onClick={() => { onEdit(q.id, tDraft.trim(), bDraft.trim()); setEditing(false); }}>Save changes</button>
              </div>
            </div>
          ) : (<>
            <h2 className="sheet-title">{q.title}</h2>
            {q.body ? <p className="sheet-body">{q.body}</p> : null}
          </>)}

          {isPoll && (
            <div className="poll">
              {q.options.map((o) => {
                const pct = votes ? Math.round((o.voters.length / votes) * 100) : 0;
                const mine = o.voters.includes(me);
                return (
                  <div key={o.id}>
                    <button className={"polopt" + (hasVoted ? " revealed" : "") + (mine ? " mine" : "")}
                      onClick={() => !hasVoted && onVote(q.id, o.id)} disabled={hasVoted} style={{ "--accent": f.tint }}>
                      <span className="polfill" style={{ width: hasVoted ? `${pct}%` : "0%" }} />
                      <span className="poltext">{mine && <Check size={15} />}{o.text}</span>
                      {hasVoted && <span className="polpct">{pct}%</span>}
                    </button>
                    {hasVoted && !q.anon && o.voters.length > 0 && (
                      <div className="voters">{o.voters.map((v) => <span key={v} className="vchip"><Avatar id={v} size={18} />{userById(v).name.split(" ")[0]}</span>)}</div>
                    )}
                  </div>
                );
              })}
              <div className="pollmeta">{hasVoted ? `${votes} ${votes === 1 ? "vote" : "votes"}` : "Tap to weigh in"}{q.anon ? " · answers are anonymous" : ""}</div>
            </div>
          )}

          {/* clarifying questions */}
          <div className="clarsec">
            <div className="clarsec-h"><HelpCircle size={15} /> Clarifying questions</div>
            {q.clarifs.length === 0 && <p className="empty-inline">No one's asked for clarification yet.</p>}
            {q.clarifs.map((c) => (
              <div key={c.id} className="clar">
                <div className="clar-q"><Avatar id={c.userId} size={22} /><div><span className="name sm">{userById(c.userId).name.split(" ")[0]} asks</span><p>{c.text}</p></div></div>
                {c.answer ? (
                  <div className="clar-a"><span className="clar-badge">{author.name.split(" ")[0]} answered</span><p>{c.answer.text}</p></div>
                ) : isAuthor ? (
                  answering === c.id ? (
                    <div className="clar-answerbox">
                      <input autoFocus value={ansDraft} onChange={(e) => setAnsDraft(e.target.value)} placeholder="Answer this…"
                        onKeyDown={(e) => { if (e.key === "Enter" && ansDraft.trim()) { onAnswerClarif(q.id, c.id, ansDraft.trim()); setAnsDraft(""); setAnswering(null); } }} />
                      <button className="sendbtn sm" disabled={!ansDraft.trim()} onClick={() => { if (ansDraft.trim()) { onAnswerClarif(q.id, c.id, ansDraft.trim()); setAnsDraft(""); setAnswering(null); } }}><Send size={15} /></button>
                    </div>
                  ) : <button className="clar-answer" onClick={() => setAnswering(c.id)}>Answer this</button>
                ) : <span className="clar-pending">Waiting on the asker…</span>}
              </div>
            ))}
            {!isAuthor && (
              <div className="composer inline">
                <input value={clarDraft} onChange={(e) => setClarDraft(e.target.value)} placeholder="Ask the asker for context…"
                  onKeyDown={(e) => { if (e.key === "Enter" && clarDraft.trim()) { onAskClarif(q.id, clarDraft.trim()); setClarDraft(""); } }} />
                <button className="sendbtn" disabled={!clarDraft.trim()} onClick={() => { if (clarDraft.trim()) { onAskClarif(q.id, clarDraft.trim()); setClarDraft(""); } }}><Send size={18} /></button>
              </div>
            )}
          </div>

          <div className="ratebar"><span className="ratelabel">Rate it</span><Stars value={avg(q.ratings)} onRate={(n) => onRate(q.id, n)} mine={myRating} /></div>
          <div className="sheet-actions">
            <button className={"actbtn" + (saved.has(q.id) ? " on" : "")} onClick={() => onSave(q.id)}>
              <Bookmark size={16} fill={saved.has(q.id) ? "currentColor" : "none"} /> {saved.has(q.id) ? "Saved" : "Save"}
            </button>
          </div>

          {isThread && (
            <div className="thread">
              <div className="thread-h">{q.replies.length} {q.replies.length === 1 ? "reply" : "replies"}</div>
              {q.replies.map((r) => (
                <div key={r.id} className="reply">
                  <Avatar id={r.userId} size={28} />
                  <div className="reply-body"><div className="reply-head"><span className="name">{userById(r.userId).name}</span><span className="meta">{ago(r.ts)}</span></div><p>{r.text}</p></div>
                </div>
              ))}
              {q.replies.length === 0 && <p className="empty-inline">No replies yet — go first.</p>}
            </div>
          )}
        </div>

        {isThread && (
          <div className="composer">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add your take…"
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { onReply(q.id, draft.trim()); setDraft(""); } }} />
            <button className="sendbtn" disabled={!draft.trim()} onClick={() => { if (draft.trim()) { onReply(q.id, draft.trim()); setDraft(""); } }}><Send size={18} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- CREATE ---------- */
function Create({ onPost, me }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [flair, setFlair] = useState("wyr"); const [format, setFormat] = useState("pollfree");
  const [anon, setAnon] = useState(false); const [opts, setOpts] = useState(["", ""]);
  const needsPoll = format === "poll" || format === "pollfree";
  const validOpts = opts.map((o) => o.trim()).filter(Boolean);
  const canPost = title.trim().length > 4 && (!needsPoll || validOpts.length >= 2);
  const post = () => onPost({
    id: nid(), authorId: me, flair, format, anon, title: title.trim(), body: body.trim(),
    options: needsPoll ? validOpts.map((t) => ({ id: nid(), text: t, voters: [] })) : [],
    replies: [], clarifs: [], ratings: {}, reported: false, ts: Date.now(),
  });
  return (
    <div className="create">
      <h1 className="screen-title">Ask the table</h1>
      <p className="screen-sub">Make it impossible to answer. That's the fun.</p>
      <label className="fld"><span>The question</span>
        <textarea rows={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Would you rather…" maxLength={400} />
        <small>{title.length}/400</small></label>
      <label className="fld"><span>More context <em>(optional)</em></span>
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Set the rules. Add the catch." /></label>
      <div className="fld"><span>Flair</span>
        <div className="chiprow wrap">{Object.keys(FLAIRS).map((k) => <FlairChip key={k} k={k} active={flair === k} onClick={() => setFlair(k)} />)}</div></div>
      <div className="fld"><span>How do people answer?</span>
        <div className="segrow">{[["poll", "Poll"], ["free", "Free form"], ["pollfree", "Poll + replies"]].map(([k, l]) => (
          <button key={k} className={"seg" + (format === k ? " on" : "")} onClick={() => setFormat(k)}>{l}</button>))}</div></div>
      {needsPoll && (
        <div className="fld"><span>Options</span>
          {opts.map((o, i) => (
            <div className="optrow" key={i}>
              <input value={o} onChange={(e) => setOpts((p) => p.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
              {opts.length > 2 && <button className="iconbtn sm" onClick={() => setOpts((p) => p.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button>}
            </div>))}
          {opts.length < 5 && <button className="addopt" onClick={() => setOpts((p) => [...p, ""])}><Plus size={15} /> Add option</button>}
          <label className="toggle"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
            <span>Hide who voted for what <em>— good for spicy or honest questions</em></span></label>
        </div>
      )}
      <button className="postbtn" disabled={!canPost} onClick={post}>Ask Quandary</button>
    </div>
  );
}

/* ---------- SAVED ---------- */
function Saved({ list, onOpen, saved, onSave, following, onFollow, me }) {
  return (
    <div className="padtop">
      <h1 className="screen-title">Saved</h1>
      <p className="screen-sub">The ones to bring to your next dinner.</p>
      {list.length === 0 ? <Empty title="Nothing saved yet" body="Tap the bookmark on any question to keep it here." />
        : <div className="cards">{list.map((q) => <Card key={q.id} q={q} me={me} saved={saved.has(q.id)} isFollowing={following.has(q.authorId)}
            onOpen={() => onOpen(q.id)} onSave={() => onSave(q.id)} onFollow={() => onFollow(q.authorId)} />)}</div>}
    </div>
  );
}

/* ---------- ALERTS ---------- */
function Alerts({ activity, prefs, updatePrefs, onOpen }) {
  const setCat = (k) => {
    const c = new Set(prefs.cats); c.has(k) ? c.delete(k) : c.add(k);
    updatePrefs({ ...prefs, cats: c });
  };
  // "Every new question" and "Only people I follow" are mutually exclusive.
  const setEvery = (on) => updatePrefs({ ...prefs, every: on, followed: on ? false : prefs.followed });
  const setFollowed = (on) => updatePrefs({ ...prefs, followed: on, every: on ? false : prefs.every });
  const [pushState, setPushState] = useState("idle");
  const [pushMsg, setPushMsg] = useState("");
  const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
  useEffect(() => {
    if (isIOS && !isStandalone()) { setPushState("ios-install"); return; }
    if (!pushSupported()) { setPushState("unsupported"); return; }
  }, []);
  const turnOn = async () => {
    setPushMsg(""); setPushState("working");
    try { await enablePush(); setPushState("on"); setPushMsg("Subscribed on this device."); }
    catch (e) {
      setPushState("error");
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setPushMsg(isIOS
          ? "Notifications are blocked for Quandary. Open iPhone Settings → Notifications → Quandary, turn on Allow Notifications, then come back and tap Enable again."
          : "Notifications are blocked for this site in your browser settings. Allow them for this site, reload, and tap Enable again.");
      } else {
        setPushMsg(e.message || "Couldn't enable notifications.");
      }
    }
  };
  const line = (a) => {
    const n = userById(a.userId).name;
    return { vote: `${n} weighed in on your question`, reply: `${n} replied to your question`, follow: `${n} started following you`, rate: `${n} rated your question`, clarif: `${n} asked you to clarify` }[a.type];
  };
  return (
    <div className="padtop">
      <h1 className="screen-title">Alerts</h1>
      <div className="prefbox">
        <div className="prefhead"><Bell size={16} /> Push notifications</div>
        <p className="prefnote">Get pinged when a new question drops. <em>On iPhone this works once Quandary is on your home screen.</em></p>
        {pushState === "ios-install"
          ? <div className="push-hint"><b>One step first:</b> notifications on iPhone only work from the installed app. Tap Safari's <b>Share</b> button → <b>Add to Home Screen</b> → <b>Add</b>, then open Quandary from the new icon and enable notifications here.</div>
          : pushState === "unsupported"
          ? <div className="push-hint">This browser can't do web push yet. On iPhone, add Quandary to your home screen first, then enable here.</div>
          : pushState === "on"
            ? <div className="push-on"><Check size={15} /> Notifications are on for this device</div>
            : <button className="push-btn" onClick={turnOn} disabled={pushState === "working"}>{pushState === "working" ? "Enabling…" : "Enable notifications on this device"}</button>}
        {pushMsg && <div className={"push-msg" + (pushState === "error" ? " err" : "")}>{pushMsg}</div>}
        <label className="prefrow"><input type="checkbox" checked={prefs.every} onChange={(e) => setEvery(e.target.checked)} /><span>Every new question</span></label>
        <label className="prefrow"><input type="checkbox" checked={prefs.followed} onChange={(e) => setFollowed(e.target.checked)} /><span>Only people I follow</span></label>
        <div className="prefsub">By category</div>
        <div className="chiprow wrap">{Object.keys(FLAIRS).map((k) => <FlairChip key={k} k={k} active={prefs.cats.has(k)} onClick={() => setCat(k)} check />)}</div>
      </div>
      <div className="actfeed">
        <div className="prefsub">Recent activity</div>
        {activity.map((a) => (
          <button key={a.id} className="actrow" onClick={() => a.qId && onOpen(a.qId)}>
            <Avatar id={a.userId} size={32} /><span className="acttext">{line(a)}</span><span className="meta">{ago(a.ts)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- PROFILE ---------- */
function Profile({ me, questions, following, followerCount = 0, onFollow, onOpen, replay }) {
  const mine = questions.filter((q) => q.authorId === me); const u = userById(me);
  return (
    <div className="padtop">
      <div className="profhead"><Avatar id={me} size={64} /><div><div className="profname">{u.name}</div><div className="meta">@{u.handle}</div></div></div>
      <div className="profstats">
        <div><b>{mine.length}</b><span>asked</span></div><div><b>{followerCount}</b><span>followers</span></div><div><b>{following.size}</b><span>following</span></div>
      </div>
      <div className="prefsub">People you follow</div>
      <div className="follist">
        {[...following].map((id) => (
          <div key={id} className="folrow"><Avatar id={id} size={34} />
            <div className="byline-txt"><span className="name">{userById(id).name}</span><span className="meta">@{userById(id).handle}</span></div>
            <button className="followmini wide on" onClick={() => onFollow(id)}>Following</button></div>
        ))}
        {following.size === 0 && <p className="empty-inline">You're not following anyone yet.</p>}
      </div>
      <div className="prefsub">Your questions</div>
      {mine.length === 0 ? <p className="empty-inline">You haven't asked anything yet.</p> :
        <div className="cards">{mine.map((q) => { const f = FLAIRS[q.flair]; const Icon = f.icon;
          return (<button key={q.id} className="minirow" onClick={() => onOpen(q.id)}>
            <Icon size={15} style={{ color: f.tint, flexShrink: 0 }} /><span className="minititle">{q.title}</span>
            <span className="meta">{totalVotes(q) + q.replies.length}</span></button>); })}</div>}
      <button className="btn-text full" onClick={replay}>View the intro again</button>
      <button className="signout-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}

function Empty({ title, body }) {
  return <div className="emptystate"><Logo size={44} sparks={false} /><div className="es-title">{title}</div><div className="es-body">{body}</div></div>;
}

/* ---------- styles ---------- */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

.q-root{
  --ink:#0D0F1A; --purple:#6C4DFF; --pink:#FF4DB8; --orange:#FF9F1C;
  --yellow:#FFD93D; --teal:#21D4C3; --lav:#F2F3FF; --white:#FFFFFF;
  --muted:#6E6E86; --line:#E7E7F3; --surface:#FFFFFF;
  --disp:'Fredoka',system-ui,sans-serif; --body:'Plus Jakarta Sans',system-ui,sans-serif;
  display:flex; justify-content:center; align-items:flex-start; min-height:100vh;
  background:linear-gradient(180deg,#EDEBFF 0%, #F4F2FF 40%, #FCFBFF 100%); font-family:var(--body);
}
/* Lock the page itself so only the feed scrolls — keeps the tab bar pinned,
   including in iOS Safari where the browser toolbar collapses. */
html, body{height:100%; margin:0; overflow:hidden; overscroll-behavior:none;}
@media(max-width:479px){
  .q-root{position:fixed; inset:0; overflow:hidden; min-height:0;}
  .phone{height:100%;}
}
.q-root *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
.phone{position:relative; width:100%; max-width:430px; height:100dvh; background:var(--lav);
  color:var(--ink); display:flex; flex-direction:column; box-shadow:0 24px 80px rgba(76,61,232,.18); overflow:hidden;}
@supports not (height:100dvh){ .phone{height:100vh;} }
@media(min-width:480px){ .phone{height:min(780px, calc(100vh - 44px)); margin:22px 0; border-radius:34px; border:1px solid var(--line);} .q-root{align-items:center;} }

.wordmark{display:inline-flex; align-items:center; font-family:var(--disp); font-weight:700; color:var(--ink); letter-spacing:-.01em;}
.wm-text{margin-left:-0.18em; transform:translateY(.02em);}
.wordmark-img{display:block; width:auto; user-select:none;}
.logo-img{display:block; object-fit:contain; user-select:none;}

.topbar{display:flex; align-items:center; justify-content:space-between; padding:16px 18px 8px;}
.iconbtn{background:none; border:none; color:var(--ink); padding:7px; cursor:pointer; border-radius:11px; display:grid; place-items:center;}
.iconbtn:hover{background:var(--lav);}
.iconbtn.sm{padding:3px; color:var(--muted);}

.scroll{flex:1; overflow-y:auto; padding-bottom:84px;}
.scroll::-webkit-scrollbar{width:0;}

.sortrow{display:flex; gap:14px; padding:4px 18px 6px;}
.sortbtn{font-family:var(--disp); font-weight:600; font-size:16px; background:none; border:none; color:var(--muted); padding:4px 0; cursor:pointer; border-bottom:2.5px solid transparent;}
.sortbtn.active{color:var(--ink); border-color:var(--purple);}

.chiprow{display:flex; gap:8px; overflow-x:auto; padding:6px 18px 12px; scrollbar-width:none;}
.chiprow::-webkit-scrollbar{display:none;}
.chiprow.wrap{flex-wrap:wrap; overflow:visible;}
.chiprow.big{gap:10px; padding:6px 0 18px; margin-bottom:auto;}
.all-pill{display:flex; align-items:center; gap:9px; width:100%; justify-content:center; background:#6c4dff0d; border:1.5px solid var(--purple); color:var(--purple); padding:15px; border-radius:15px; font-family:var(--disp); font-weight:600; font-size:16px; cursor:pointer; margin-bottom:4px;}
.all-pill.on{background:var(--purple); color:#fff;}
.all-pill .all-check{margin-left:auto;}
.or-div{display:flex; align-items:center; gap:12px; color:var(--muted); font-size:12.5px; margin:14px 0 6px;}
.or-div:before,.or-div:after{content:""; height:1px; background:var(--line); flex:1;}
.flairchip{display:inline-flex; align-items:center; gap:5px; white-space:nowrap; flex-shrink:0; font-size:12.5px; font-weight:600;
  color:var(--muted); background:var(--white); border:1.5px solid var(--line); padding:7px 12px; border-radius:999px; cursor:pointer; font-family:var(--body);}

.cards{display:flex; flex-direction:column; gap:12px; padding:4px 18px 20px;}
.card{position:relative; background:var(--white); border:1px solid var(--line); border-radius:20px; padding:16px; cursor:pointer;
  box-shadow:0 2px 12px rgba(13,15,26,.04); transition:transform .12s ease, box-shadow .12s, border-color .12s;}
.card:hover{transform:translateY(-2px); box-shadow:0 10px 26px rgba(76,61,232,.12); border-color:color-mix(in srgb,var(--accent) 40%,var(--line));}
.card-top{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;}
.byline{display:flex; gap:9px; align-items:center;}
.byline.big{width:100%; margin:2px 0 14px;}
.avatar{border-radius:50%; display:grid; place-items:center; font-family:var(--disp); font-weight:700; color:#fff; flex-shrink:0;}
.byline-txt{display:flex; flex-direction:column; line-height:1.2;}
.name{font-weight:700; font-size:14px;} .name.sm{font-size:12.5px;}
.meta{font-size:12px; color:var(--muted);}
.followmini{background:var(--lav); border:1.5px solid var(--line); color:var(--ink); border-radius:999px; width:30px; height:30px; display:grid; place-items:center; cursor:pointer;}
.followmini.on{color:var(--purple); border-color:var(--purple); background:#6c4dff14;}
.followmini.wide{width:auto; padding:7px 16px; font-size:13px; font-weight:700; margin-left:auto;}

.flairtag{display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;}
.card .flairtag{margin-bottom:6px;}
.card-title{font-family:var(--disp); font-weight:600; font-size:18px; line-height:1.28; letter-spacing:-.005em; margin:2px 0 6px; color:var(--ink);}
.card-body{font-size:13.5px; color:var(--muted); line-height:1.45; margin:0 0 12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
.card-foot{display:flex; align-items:center; gap:16px; padding-top:12px; border-top:1px solid var(--line);}
.stat{display:inline-flex; align-items:center; gap:5px; font-size:13px; color:var(--muted); font-weight:600; background:none; border:none;}
.stat.tap{margin-left:auto; cursor:pointer;} .stat.saved{color:var(--purple);}

/* QOTD */
.qotd{display:block; width:100%; text-align:left; margin:2px 18px 14px; width:calc(100% - 36px); cursor:pointer;
  background:linear-gradient(135deg,#6C4DFF 0%, #8A5BFF 55%, #B14DFF 100%); color:#fff; border:none; border-radius:22px; padding:18px 18px 16px;
  box-shadow:0 14px 34px rgba(108,77,255,.32); position:relative; overflow:hidden;}
.qotd:after{content:""; position:absolute; right:-30px; top:-30px; width:120px; height:120px; border-radius:50%; background:rgba(255,255,255,.12);}
.qotd-ribbon{display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#FFD93D; margin-bottom:8px;}
.qotd-title{font-family:var(--disp); font-weight:600; font-size:21px; line-height:1.22; margin:0 0 14px; position:relative;}
.qotd-foot{display:flex; align-items:center; gap:15px; font-size:13px; font-weight:600; color:rgba(255,255,255,.92); position:relative;}
.qotd-foot span{display:inline-flex; align-items:center; gap:5px;}
.qotd-go{margin-left:auto; background:rgba(255,255,255,.18); padding:7px 12px; border-radius:999px; font-weight:700;}

/* sheet */
.sheet-wrap{position:absolute; inset:0; background:rgba(13,15,26,.4); backdrop-filter:blur(2px); z-index:40; display:flex; align-items:flex-end; animation:fade .18s ease;}
.sheet{width:100%; max-height:96%; background:var(--lav); border-radius:26px 26px 0 0; display:flex; flex-direction:column; animation:rise .22s cubic-bezier(.2,.8,.2,1);}
@keyframes rise{from{transform:translateY(40px); opacity:.6;} to{transform:none; opacity:1;}}
@keyframes fade{from{opacity:0;} to{opacity:1;}}
.sheet-head{display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--line); background:var(--white); border-radius:26px 26px 0 0;}
.sheet-scroll{overflow-y:auto; padding:16px 20px 10px;}
.sheet-scroll::-webkit-scrollbar{width:0;}
.sheet-title{font-family:var(--disp); font-weight:600; font-size:23px; line-height:1.22; margin:2px 0 8px;}
.sheet-body{color:var(--muted); font-size:14.5px; line-height:1.5; margin:0 0 18px;}

.poll{display:flex; flex-direction:column; gap:10px; margin-bottom:6px;}
.polopt{position:relative; width:100%; text-align:left; background:var(--white); border:1.5px solid var(--line); border-radius:14px; padding:14px; font-size:14.5px; font-weight:600; color:var(--ink); cursor:pointer; overflow:hidden; min-height:50px; display:flex; align-items:center; font-family:var(--body);}
.polopt:not(.revealed):hover{border-color:var(--accent);}
.polopt.revealed{cursor:default;} .polopt.mine{border-color:var(--accent);}
.polfill{position:absolute; left:0; top:0; bottom:0; background:color-mix(in srgb,var(--accent) 16%,transparent); border-right:2.5px solid var(--accent); transition:width .5s cubic-bezier(.2,.8,.2,1); z-index:0;}
.poltext{position:relative; z-index:1; display:inline-flex; align-items:center; gap:6px;}
.polpct{position:relative; z-index:1; margin-left:auto; font-family:var(--disp); font-weight:600;}
.voters{display:flex; flex-wrap:wrap; gap:6px; padding:6px 2px 2px;}
.vchip{display:inline-flex; align-items:center; gap:4px; font-size:11.5px; color:var(--muted); background:var(--white); border:1px solid var(--line); padding:2px 9px 2px 2px; border-radius:999px;}
.pollmeta{font-size:12.5px; color:var(--muted); padding:4px 2px;}

/* clarifications */
.clarsec{margin:18px 0 6px; background:var(--white); border:1px solid var(--line); border-radius:18px; padding:14px 14px 12px;}
.clarsec-h{display:flex; align-items:center; gap:6px; font-family:var(--disp); font-weight:600; font-size:14px; margin-bottom:10px; color:var(--ink);}
.clar{border-top:1px solid var(--line); padding:11px 0;}
.clar:first-of-type{border-top:none; padding-top:2px;}
.clar-q{display:flex; gap:8px; align-items:flex-start;}
.clar-q p{margin:2px 0 0; font-size:14px; line-height:1.4;}
.clar-a{margin:8px 0 0 30px; background:#6c4dff0f; border-left:3px solid var(--purple); border-radius:0 10px 10px 0; padding:8px 12px;}
.clar-a p{margin:3px 0 0; font-size:13.5px; line-height:1.45;}
.clar-badge{font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--purple);}
.clar-answer{margin:8px 0 0 30px; background:var(--purple); color:#fff; border:none; padding:7px 14px; border-radius:999px; font-weight:700; font-size:12.5px; cursor:pointer; font-family:var(--body);}
.clar-pending{display:inline-block; margin:8px 0 0 30px; font-size:12px; color:var(--muted); font-style:italic;}
.clar-answerbox{display:flex; gap:7px; margin:8px 0 0 30px;}
.clar-answerbox input{flex:1; background:var(--lav); border:1.5px solid var(--line); border-radius:999px; padding:8px 13px; font-size:13px; outline:none; font-family:var(--body);}
.clar-answerbox input:focus{border-color:var(--purple);}

.ratebar{display:flex; align-items:center; justify-content:space-between; margin:16px 0 4px; padding:13px 15px; background:var(--white); border:1px solid var(--line); border-radius:14px;}
.ratelabel{font-family:var(--disp); font-weight:600; font-size:14px;}
.stars{display:inline-flex; align-items:center; gap:3px; color:var(--orange);}
.starbtn{background:none; border:none; padding:1px; color:#E2E2EE; display:grid; place-items:center;}
.starbtn.on{color:var(--orange);}
.mine{font-size:11px; color:var(--muted); margin-left:6px;}

.sheet-actions{display:flex; gap:10px; margin:12px 0 4px;}
.actbtn{flex:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; background:var(--white); border:1.5px solid var(--line); color:var(--ink); padding:11px; border-radius:13px; font-weight:700; font-size:14px; cursor:pointer; font-family:var(--body);}
.actbtn.on{color:var(--purple); border-color:var(--purple); background:#6c4dff0d;}

.thread{margin-top:18px; border-top:1px solid var(--line); padding-top:14px;}
.thread-h{font-family:var(--disp); font-weight:600; font-size:14px; margin-bottom:12px; color:var(--muted);}
.reply{display:flex; gap:10px; margin-bottom:14px;}
.reply-body{background:var(--white); border:1px solid var(--line); border-radius:4px 14px 14px 14px; padding:9px 13px; flex:1;}
.reply-head{display:flex; gap:8px; align-items:baseline; margin-bottom:2px;}
.reply-body p{margin:0; font-size:14px; line-height:1.45;}
.empty-inline{color:var(--muted); font-size:13.5px; padding:6px 2px;}

.composer{display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--line); background:var(--white);}
.composer.inline{padding:10px 0 2px; border:none; background:none; margin-top:6px;}
.composer input{flex:1; background:var(--lav); border:1.5px solid var(--line); border-radius:999px; padding:11px 16px; color:var(--ink); font-family:var(--body); font-size:14px; outline:none;}
.composer input:focus{border-color:var(--purple);}
.sendbtn{background:var(--purple); border:none; color:#fff; width:42px; height:42px; border-radius:50%; display:grid; place-items:center; cursor:pointer; flex-shrink:0;}
.sendbtn.sm{width:34px; height:34px;}
.sendbtn:disabled{opacity:.4; cursor:default;}

/* create */
.create,.padtop{padding:18px 20px 26px;}
.screen-title{font-family:var(--disp); font-weight:700; font-size:27px; letter-spacing:-.01em; margin:4px 0 2px;}
.screen-sub{color:var(--muted); font-size:14px; margin:0 0 18px;}
.fld{display:block; margin-bottom:18px;}
.fld>span{display:block; font-family:var(--disp); font-weight:600; font-size:14.5px; margin-bottom:8px;}
.fld em{color:var(--muted); font-style:normal; font-weight:500;}
.fld textarea,.optrow input{width:100%; background:var(--white); border:1.5px solid var(--line); border-radius:13px; padding:12px 14px; color:var(--ink); font-family:var(--body); font-size:15px; outline:none; resize:none;}
.fld textarea:focus,.optrow input:focus{border-color:var(--purple);}
.fld small{display:block; text-align:right; color:var(--muted); font-size:11px; margin-top:4px;}
.segrow{display:flex; gap:8px;}
.seg{flex:1; background:var(--white); border:1.5px solid var(--line); color:var(--muted); padding:11px 4px; border-radius:12px; font-weight:700; font-size:13.5px; cursor:pointer; font-family:var(--body);}
.seg.on{color:var(--purple); border-color:var(--purple); background:#6c4dff0d;}
.optrow{display:flex; gap:8px; align-items:center; margin-bottom:8px;}
.addopt{display:inline-flex; align-items:center; justify-content:center; gap:5px; background:none; border:1.5px dashed var(--line); color:var(--muted); padding:10px 14px; border-radius:12px; font-weight:600; font-size:13.5px; cursor:pointer; width:100%; font-family:var(--body);}
.toggle{display:flex; gap:10px; align-items:flex-start; margin-top:12px; font-size:13.5px; cursor:pointer;}
.toggle input{margin-top:2px; accent-color:var(--purple); width:17px; height:17px;}
.postbtn{width:100%; background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:15px; border-radius:15px; font-family:var(--disp); font-weight:600; font-size:17px; cursor:pointer; margin-top:6px; box-shadow:0 10px 24px rgba(108,77,255,.3);}
.postbtn:disabled{opacity:.45; cursor:default; box-shadow:none;}

/* alerts */
.prefbox{background:var(--white); border:1px solid var(--line); border-radius:18px; padding:16px; margin-bottom:22px;}
.prefhead{display:flex; align-items:center; gap:8px; font-family:var(--disp); font-weight:600; font-size:15px; margin-bottom:6px;}
.prefnote{font-size:12.5px; color:var(--muted); line-height:1.45; margin:0 0 12px;}
.prefnote em{color:var(--purple); font-style:normal; font-weight:600;}
.prefrow{display:flex; align-items:center; gap:10px; padding:8px 0; font-size:14.5px; cursor:pointer;}
.prefrow input{accent-color:var(--purple); width:18px; height:18px;}
.prefsub{font-family:var(--disp); font-weight:600; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:14px 0 10px;}
.actrow{display:flex; align-items:center; gap:11px; width:100%; background:none; border:none; border-bottom:1px solid var(--line); padding:12px 2px; cursor:pointer; text-align:left;}
.acttext{flex:1; font-size:14px; color:var(--ink);}

/* profile */
.profhead{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
.profname{font-family:var(--disp); font-weight:700; font-size:23px;}
.profstats{display:flex; gap:8px; margin-bottom:6px;}
.profstats>div{flex:1; background:var(--white); border:1px solid var(--line); border-radius:14px; padding:13px; text-align:center;}
.profstats b{display:block; font-family:var(--disp); font-weight:600; font-size:21px;}
.profstats span{font-size:12px; color:var(--muted);}
.follist{display:flex; flex-direction:column; gap:2px;}
.folrow{display:flex; align-items:center; gap:11px; padding:9px 0;}
.minirow{display:flex; align-items:center; gap:10px; width:100%; background:var(--white); border:1px solid var(--line); border-radius:13px; padding:12px 14px; cursor:pointer; text-align:left; color:var(--ink); margin-bottom:8px;}
.minititle{flex:1; font-size:14px; font-weight:600; line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical;}

/* empty */
.emptystate{text-align:center; color:var(--muted); padding:54px 30px;}
.emptystate svg{opacity:.55; margin-bottom:14px;}
.es-title{font-family:var(--disp); font-weight:600; font-size:18px; color:var(--ink); margin-bottom:6px;}
.es-body{font-size:14px; line-height:1.5;}

/* tabbar */
.tabbar{position:absolute; bottom:0; left:0; right:0; display:flex; background:rgba(255,255,255,.94); backdrop-filter:blur(12px); border-top:1px solid var(--line); padding:8px 0 max(12px, env(safe-area-inset-bottom));}
.tabbtn{flex:1; background:none; border:none; color:var(--muted); display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; font-size:10.5px; font-weight:600; font-family:var(--body);}
.tabbtn.active{color:var(--purple);}

.toast{position:absolute; bottom:88px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:11px 18px; border-radius:999px; font-size:13.5px; font-weight:600; box-shadow:0 12px 34px rgba(13,15,26,.3); z-index:60; animation:rise .2s ease; max-width:88%; text-align:center;}

/* search */
.search-ov{position:absolute; inset:0; background:var(--lav); z-index:55; display:flex; flex-direction:column; animation:fade .15s ease;}
.search-head{display:flex; align-items:center; gap:8px; padding:14px 14px; background:var(--white); border-bottom:1px solid var(--line);}
.search-ic{color:var(--muted); flex-shrink:0; margin-left:4px;}
.search-head input{flex:1; border:none; outline:none; font-size:16px; font-family:var(--body); background:none; color:var(--ink);}
.search-body{flex:1; overflow-y:auto; padding:12px 16px;}
.sresult{display:flex; flex-direction:column; gap:4px; width:100%; text-align:left; background:var(--white); border:1px solid var(--line); border-radius:14px; padding:13px 15px; margin-bottom:10px; cursor:pointer;}
.sres-title{font-family:var(--disp); font-weight:600; font-size:15px; line-height:1.3; color:var(--ink);}

/* onboarding */
.onb{flex:1; display:flex; flex-direction:column; padding:26px 24px 30px; background:linear-gradient(180deg,#EFEDFF 0%, #FBFAFF 60%);}
.onb-dots{display:flex; gap:7px; justify-content:center; margin-bottom:8px;}
.onb-dots span{width:7px; height:7px; border-radius:50%; background:var(--line);}
.onb-dots span.on{background:var(--purple); width:20px; border-radius:4px;}
.onb-screen{flex:1; display:flex; flex-direction:column; padding-top:10px;}
.onb-screen.center{justify-content:center; align-items:center; text-align:center;}
.onb-logo{margin-bottom:14px;}
.onb-brand{margin:0 0 4px;}
.onb-tag{font-family:var(--disp); font-weight:600; font-size:18px; margin:0 0 18px; color:var(--ink);}
.onb-tag span{color:var(--pink);}
.onb-lead{color:var(--muted); font-size:15px; line-height:1.55; max-width:330px; margin:0 0 30px;}
.onb-h{font-family:var(--disp); font-weight:700; font-size:25px; line-height:1.2; margin:6px 0 8px;}
.onb-sub{color:var(--muted); font-size:14.5px; line-height:1.5; margin:0 0 18px;}
.howlist{display:flex; flex-direction:column; gap:16px; margin:18px 0 auto;}
.how{display:flex; gap:14px; align-items:flex-start;}
.how-ic{width:46px; height:46px; border-radius:14px; display:grid; place-items:center; flex-shrink:0;}
.how-t{font-family:var(--disp); font-weight:600; font-size:16px; margin-bottom:3px;}
.how-b{font-size:13.5px; color:var(--muted); line-height:1.45;}
.install{background:var(--white); border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin-bottom:auto;}
.install ol{margin:0; padding-left:20px; display:flex; flex-direction:column; gap:11px;}
.install li{font-size:14px; line-height:1.5; color:var(--ink);}
.install li b{font-weight:700;}
.install svg{vertical-align:-2px; color:var(--purple);}
.btn-primary{width:100%; display:inline-flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:16px; border-radius:16px; font-family:var(--disp); font-weight:600; font-size:17px; cursor:pointer; margin-top:18px; box-shadow:0 12px 28px rgba(108,77,255,.32);}
.btn-text{width:100%; background:none; border:none; color:var(--muted); font-weight:600; font-size:14px; padding:12px; cursor:pointer; font-family:var(--body);}
.btn-text.full{margin-top:12px; border-top:1px solid var(--line); padding-top:16px;}
.segrow{margin-bottom:16px;}

.push-btn{width:100%; background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:13px; border-radius:13px; font-family:var(--disp); font-weight:600; font-size:15px; cursor:pointer; margin:4px 0 12px; box-shadow:0 8px 20px rgba(108,77,255,.28);}
.push-btn:disabled{opacity:.6; cursor:default;}
.push-on{display:flex; align-items:center; gap:7px; background:#E9FBF6; color:#0C8C73; border-radius:11px; padding:11px 14px; font-weight:600; font-size:13.5px; margin:4px 0 12px;}
.push-hint{background:#FFF6E6; color:#9A6B00; border-radius:11px; padding:11px 14px; font-size:13px; line-height:1.45; margin:4px 0 12px;}
.push-msg{font-size:12.5px; color:var(--muted); margin:-6px 0 12px;}
.push-msg.err{color:#C2185B;}

.confirmbar{display:flex; align-items:center; gap:9px; flex-wrap:wrap; background:#FFE9F2; padding:11px 16px; font-size:13px; color:#C2185B; font-weight:600;}
.confirm-del{background:#C2185B; color:#fff; border:none; border-radius:999px; padding:7px 14px; font-weight:700; font-size:12.5px; cursor:pointer; font-family:var(--body); margin-left:auto;}
.confirm-keep{background:var(--white); color:var(--ink); border:1.5px solid var(--line); border-radius:999px; padding:7px 14px; font-weight:700; font-size:12.5px; cursor:pointer; font-family:var(--body);}
.editbox{display:flex; flex-direction:column; gap:9px; margin:4px 0 14px;}
.editbox textarea{width:100%; box-sizing:border-box; background:var(--white); border:1.5px solid var(--purple); border-radius:13px; padding:12px 14px; color:var(--ink); font-family:var(--body); font-size:15px; outline:none; resize:none;}
.editrow{display:flex; gap:9px; justify-content:flex-end;}
.edit-save{background:var(--purple); color:#fff; border:none; border-radius:999px; padding:8px 18px; font-weight:700; font-size:13px; cursor:pointer; font-family:var(--body);}
.edit-save:disabled{opacity:.45; cursor:default;}
.signout-btn{width:100%; background:none; border:1.5px solid var(--line); color:#C2185B; font-weight:700; font-size:14px; padding:12px; border-radius:13px; cursor:pointer; font-family:var(--body); margin-top:10px;}

.boot{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:40px; text-align:center; color:var(--muted); font-family:var(--disp); font-weight:600;}
.booterr{color:#C2185B; background:#FFE9F2; border-radius:12px; padding:12px 16px; font-family:var(--body); font-weight:500; font-size:14px; max-width:300px;}
.bootbtn{background:var(--purple); color:#fff; border:none; border-radius:12px; padding:11px 20px; font-family:var(--disp); font-weight:600; font-size:15px; cursor:pointer;}

@media(prefers-reduced-motion:reduce){ *{animation:none !important; transition:none !important;} }
`}</style>
  );
}
