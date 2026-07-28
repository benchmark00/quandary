// ============================================================================
//  prerender.mjs — SEO Phase 2B
//  Runs at build time (after `vite build`). Pulls every public question from
//  the public_questions view and writes a static, crawlable HTML page to
//  dist/q/<slug>/index.html, then regenerates dist/sitemap.xml.
//
//  No secrets needed: it uses the anon key (the public_questions view is
//  granted to anon and exposes no private data). On Netlify these env vars are
//  already present; locally we read them from .env.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

const SITE = "https://www.quandary.live";
const DIST = resolve("dist");

// ---- env: prefer process.env, fall back to a tiny .env parse for local runs
function env(key) {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(resolve(".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env — that's fine on CI */ }
  return undefined;
}

const SUPABASE_URL = env("VITE_SUPABASE_URL");
const SUPABASE_ANON = env("VITE_SUPABASE_ANON_KEY");

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("prerender: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — skipping SEO pages.");
  process.exit(0);   // don't fail the whole build; the app still deploys
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const FLAIR = {
  wyr: "Would You Rather", tot: "This or That", hot: "Hot Take",
  hypo: "Hypothetical", moral: "Moral Dilemma", unpop: "Unpopular Opinion",
  free: "Free Form", island: "Desert Island", shower: "Shower Thought",
};

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---- one question page --------------------------------------------------
function questionPage(q, related) {
  const flairLabel = FLAIR[q.flair] || "Question";
  const url = `${SITE}/q/${q.slug}`;
  const options = Array.isArray(q.options) ? q.options : [];
  const totalVotes = options.reduce((n, o) => n + (o.votes || 0), 0);
  const replies = Array.isArray(q.top_replies) ? q.top_replies : [];

  const pageTitle = clip(`${q.title} — ${flairLabel} | Quandary`, 65);
  const desc = clip(
    q.body?.trim()
      ? `${q.title} ${q.body}`
      : `${flairLabel}: ${q.title} Vote and see how the world answers on Quandary.`,
    155,
  );

  // poll bars (static, current split)
  const pollHtml = options.length ? `
    <div class="poll">
      ${options.map((o) => {
        const pct = totalVotes ? Math.round((o.votes / totalVotes) * 100) : 0;
        return `
        <div class="opt">
          <div class="opt-top"><span>${esc(o.text)}</span><span class="pct">${pct}%</span></div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join("")}
      <p class="votes">${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} so far</p>
    </div>` : "";

  const repliesHtml = replies.length ? `
    <section class="replies">
      <h2>What people are saying</h2>
      ${replies.map((r) => `
        <div class="reply">
          <p class="reply-name">${esc(r.author_name)}</p>
          <p>${esc(r.body)}</p>
        </div>`).join("")}
    </section>` : "";

  const relatedHtml = related.length ? `
    <section class="related">
      <h2>More quandaries to settle</h2>
      <ul>
        ${related.map((r) => `<li><a href="/q/${r.slug}">${esc(clip(r.title, 90))}</a></li>`).join("")}
      </ul>
    </section>` : "";

  // structured data: QAPage when we have replies, else a plain WebPage
  const ld = replies.length ? {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: clip(q.title, 110),
      text: q.title + (q.body ? " " + q.body : ""),
      answerCount: replies.length,
      suggestedAnswer: replies.map((r) => ({
        "@type": "Answer",
        text: r.body,
        author: { "@type": "Person", name: r.author_name },
      })),
    },
  } : {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: clip(q.title, 110),
    description: desc,
    url,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${url}" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#6C4DFF" />
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Quandary" />
  <meta property="og:title" content="${esc(clip(q.title, 90))}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${SITE}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(clip(q.title, 90))}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${SITE}/og-image.png" />

  <script type="application/ld+json">${JSON.stringify(ld)}</script>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{--purple:#6C4DFF;--ink:#0D0F1A;--muted:#6E6E86;--line:#E7E7F3;--lav:#F2F3FF;}
    *{box-sizing:border-box;}
    body{margin:0;background:linear-gradient(180deg,#EDEBFF,#F7F5FF 40%,#fff);font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:var(--ink);}
    .wrap{max-width:680px;margin:0 auto;padding:20px 18px 60px;}
    header{display:flex;align-items:center;justify-content:space-between;padding:6px 0 18px;}
    header img{height:34px;}
    .cta-top{background:var(--purple);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:9px 18px;border-radius:999px;}
    main{background:#fff;border:1px solid var(--line);border-radius:22px;padding:28px 26px;box-shadow:0 12px 40px rgba(76,61,232,.08);}
    .flair{display:inline-block;color:var(--purple);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;}
    h1{font-family:'Fredoka',sans-serif;font-weight:600;font-size:28px;line-height:1.25;margin:0 0 12px;}
    .body{color:var(--muted);font-size:16px;line-height:1.6;margin:0 0 22px;}
    .poll{margin:22px 0;}
    .opt{margin:0 0 14px;}
    .opt-top{display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-bottom:6px;}
    .pct{color:var(--purple);}
    .bar{background:var(--lav);border-radius:999px;height:12px;overflow:hidden;}
    .fill{background:linear-gradient(90deg,#6C4DFF,#9B6BFF);height:100%;border-radius:999px;}
    .votes{color:var(--muted);font-size:13px;margin:8px 0 0;}
    .cta-box{background:var(--lav);border-radius:16px;padding:22px;text-align:center;margin:24px 0 6px;}
    .cta-box p{margin:0 0 14px;font-weight:600;font-size:16px;}
    .cta-btn{display:inline-block;background:var(--purple);color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 30px;border-radius:14px;}
    .replies{margin-top:34px;}
    .replies h2,.related h2{font-family:'Fredoka',sans-serif;font-weight:600;font-size:19px;margin:0 0 14px;}
    .reply{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 10px;}
    .reply-name{font-weight:700;font-size:13.5px;margin:0 0 4px;}
    .reply p{margin:0;font-size:15px;line-height:1.5;}
    .related{margin-top:34px;}
    .related ul{list-style:none;padding:0;margin:0;}
    .related li{margin:0 0 8px;}
    .related a{color:var(--ink);text-decoration:none;font-weight:600;font-size:15.5px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 15px;display:block;}
    .related a:hover{border-color:var(--purple);}
    footer{text-align:center;color:var(--muted);font-size:13px;margin-top:40px;line-height:1.7;}
    footer a{color:var(--purple);text-decoration:none;}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a href="/"><img src="/wordmark.png" alt="Quandary" /></a>
      <a class="cta-top" href="/q/${q.id}" rel="nofollow">Vote now</a>
    </header>
    <main>
      <span class="flair">${esc(flairLabel)}</span>
      <h1>${esc(q.title)}</h1>
      ${q.body?.trim() ? `<p class="body">${esc(q.body)}</p>` : ""}
      ${pollHtml}
      <div class="cta-box">
        <p>What's your answer? Join the debate and see how the world disagrees with you.</p>
        <a class="cta-btn" href="/q/${q.id}" rel="nofollow">Sign up &amp; vote →</a>
      </div>
      ${repliesHtml}
    </main>
    ${relatedHtml}
    <footer>
      <p><a href="/">Quandary</a> — every hypothetical deserves an answer.</p>
      ${footerCats}
    </footer>
  </div>
</body>
</html>`;
}

// ---- sitemap ------------------------------------------------------------
// ---- category definitions (which flairs become hub pages) ---------------
const CATEGORIES = [
  { slug: "would-you-rather", flair: "wyr", h1: "Would You Rather Questions",
    blurb: "Impossible choices, split rooms, and no good options. Vote on the best would-you-rather questions and see how the world answers.",
    metaTitle: "Would You Rather Questions — Vote & See the Results | Quandary",
    metaDesc: "The best would-you-rather questions, with live vote splits. Pick a side on impossible choices and see how everyone else answers on Quandary." },
  { slug: "this-or-that", flair: "tot", h1: "This or That Questions",
    blurb: "Two options, one choice. Settle the great this-or-that debates.",
    metaTitle: "This or That Questions — Vote & Compare | Quandary",
    metaDesc: "Fun this-or-that questions with live results. Pick a side and see how the world splits on Quandary." },
  { slug: "hot-takes", flair: "hot", h1: "Hot Takes",
    blurb: "Spicy opinions that start arguments. Agree or fight about them.",
    metaTitle: "Hot Takes — Controversial Opinions to Debate | Quandary",
    metaDesc: "The internet's spiciest hot takes. See what people actually think and join the debate on Quandary." },
  { slug: "hypotheticals", flair: "hypo", h1: "Hypothetical Questions",
    blurb: "\"What if…\" scenarios worth arguing about for hours.",
    metaTitle: "Hypothetical Questions — Fun What-If Scenarios | Quandary",
    metaDesc: "Thought-provoking hypothetical questions and what-if scenarios. Vote and see how others would answer on Quandary." },
  { slug: "moral-dilemmas", flair: "moral", h1: "Moral Dilemmas",
    blurb: "Hard ethical choices with no clean answer. What would you actually do?",
    metaTitle: "Moral Dilemmas — Ethical Questions to Debate | Quandary",
    metaDesc: "Tough moral dilemmas and ethical questions. See how people really answer and weigh in on Quandary." },
  { slug: "unpopular-opinions", flair: "unpop", h1: "Unpopular Opinions",
    blurb: "Opinions most people disagree with — until they think about it.",
    metaTitle: "Unpopular Opinions — Do People Actually Agree? | Quandary",
    metaDesc: "Share and vote on unpopular opinions. Find out if they're really so unpopular on Quandary." },
  { slug: "desert-island", flair: "island", h1: "Desert Island Questions",
    blurb: "Stranded forever — what one thing do you bring? The classic desert island debates.",
    metaTitle: "Desert Island Questions — What Would You Bring? | Quandary",
    metaDesc: "Classic desert island questions. Choose what you'd bring and see how others answer on Quandary." },
  { slug: "shower-thoughts", flair: "shower", h1: "Shower Thoughts",
    blurb: "The strange little realizations that stop you mid-shampoo.",
    metaTitle: "Shower Thoughts — Weirdly Deep Realizations | Quandary",
    metaDesc: "The best shower thoughts and mini realizations. Vote on the ones that broke your brain on Quandary." },
];

// ---- shared page shell (header + footer with category links) ------------
function categoryNav(activeSlug) {
  return `<nav class="catnav">${CATEGORIES.map((c) =>
    `<a href="/${c.slug}"${c.slug === activeSlug ? ' class="on"' : ""}>${esc(c.h1.replace(/ Questions$| Dilemmas$/, ""))}</a>`
  ).join("")}</nav>`;
}

const SHARED_CSS = `
  :root{--purple:#6C4DFF;--ink:#0D0F1A;--muted:#6E6E86;--line:#E7E7F3;--lav:#F2F3FF;}
  *{box-sizing:border-box;}
  body{margin:0;background:linear-gradient(180deg,#EDEBFF,#F7F5FF 40%,#fff);font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:var(--ink);}
  .wrap{max-width:720px;margin:0 auto;padding:20px 18px 60px;}
  header{display:flex;align-items:center;justify-content:space-between;padding:6px 0 14px;}
  header img{height:34px;}
  .cta-top{background:var(--purple);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:9px 18px;border-radius:999px;}
  .catnav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px;}
  .catnav a{font-size:13px;font-weight:700;color:var(--ink);text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 14px;}
  .catnav a.on,.catnav a:hover{background:#6c4dff14;border-color:var(--purple);color:var(--purple);}
  h1{font-family:'Fredoka',sans-serif;font-weight:600;font-size:30px;line-height:1.2;margin:0 0 10px;}
  .blurb{color:var(--muted);font-size:16px;line-height:1.6;margin:0 0 26px;}
  .qlist{list-style:none;padding:0;margin:0;}
  .qlist li{margin:0 0 12px;}
  .qcard{display:block;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;box-shadow:0 3px 14px rgba(76,61,232,.05);}
  .qcard:hover{border-color:var(--purple);}
  .qcard .flair{display:inline-block;color:var(--purple);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;}
  .qcard .qt{color:var(--ink);font-family:'Fredoka',sans-serif;font-weight:600;font-size:18px;line-height:1.3;margin:0 0 6px;}
  .qcard .qm{color:var(--muted);font-size:12.5px;}
  .cta-box{background:var(--lav);border-radius:16px;padding:24px;text-align:center;margin:30px 0 0;}
  .cta-box p{margin:0 0 14px;font-weight:600;font-size:16px;}
  .cta-btn{display:inline-block;background:var(--purple);color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 30px;border-radius:14px;}
  footer{text-align:center;color:var(--muted);font-size:13px;margin-top:44px;line-height:1.9;}
  footer a{color:var(--purple);text-decoration:none;}
  .footcats{margin-top:8px;font-size:12.5px;}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />`;

const footerCats = `<p class="footcats">${CATEGORIES.map((c) => `<a href="/${c.slug}">${esc(c.h1.replace(/ Questions$| Dilemmas$/, ""))}</a>`).join(" · ")}</p>`;

function qCard(q) {
  const flairLabel = FLAIR[q.flair] || "Question";
  const opts = Array.isArray(q.options) ? q.options : [];
  const total = opts.reduce((n, o) => n + (o.votes || 0), 0);
  return `<li><a class="qcard" href="/q/${q.slug}">
    <span class="flair">${esc(flairLabel)}</span>
    <div class="qt">${esc(clip(q.title, 120))}</div>
    <div class="qm">${total} ${total === 1 ? "vote" : "votes"} · ${q.reply_count || 0} ${q.reply_count === 1 ? "reply" : "replies"}</div>
  </a></li>`;
}

// ---- a category hub page ------------------------------------------------
function categoryPage(cat, questions) {
  const url = `${SITE}/${cat.slug}`;
  const list = questions.filter((q) => q.flair === cat.flair);
  const listHtml = list.length
    ? `<ul class="qlist">${list.map(qCard).join("")}</ul>`
    : `<p class="blurb">No questions here yet — be the first to ask one.</p>`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: cat.h1, description: cat.metaDesc, url,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(cat.metaTitle)}</title>
  <meta name="description" content="${esc(cat.metaDesc)}" />
  <link rel="canonical" href="${url}" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#6C4DFF" />
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Quandary" />
  <meta property="og:title" content="${esc(cat.metaTitle)}" />
  <meta property="og:description" content="${esc(cat.metaDesc)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${SITE}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(cat.metaTitle)}" />
  <meta name="twitter:image" content="${SITE}/og-image.png" />
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  ${FONTS}
  <style>${SHARED_CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a href="/"><img src="/wordmark.png" alt="Quandary" /></a>
      <a class="cta-top" href="/">Join Quandary</a>
    </header>
    ${categoryNav(cat.slug)}
    <h1>${esc(cat.h1)}</h1>
    <p class="blurb">${esc(cat.blurb)}</p>
    ${listHtml}
    <div class="cta-box">
      <p>Got a better one? Ask your own and watch the room split.</p>
      <a class="cta-btn" href="/">Join Quandary &amp; ask →</a>
    </div>
    <footer>
      <p><a href="/">Quandary</a> — every hypothetical deserves an answer.</p>
      ${footerCats}
    </footer>
  </div>
</body>
</html>`;
}

// ---- crawlable homepage content (injected into #root of index.html) -----
// createRoot() clears #root on mount, so this shows to crawlers and is
// replaced by the app for users. A head guard hides it instantly for
// logged-in users so they never see a flash on PWA launch.
function homeInner(questions) {
  const featured = questions.slice(0, 12);
  const cats = CATEGORIES.map((c) =>
    `<a href="/${c.slug}">${esc(c.h1.replace(/ Questions$| Dilemmas$/, ""))}</a>`).join("");
  const qs = featured.map((q) => {
    const label = FLAIR[q.flair] || "Question";
    return `<li><a href="/q/${q.slug}"><b>${esc(label)}</b> ${esc(clip(q.title, 110))}</a></li>`;
  }).join("");
  return `<div id="seo-home">
<style>
#seo-home{max-width:720px;margin:0 auto;padding:26px 18px 60px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0D0F1A;}
#seo-home h1{font-family:'Fredoka',sans-serif;font-weight:600;font-size:34px;line-height:1.2;margin:0 0 12px;text-align:center;}
#seo-home .sub{color:#6E6E86;font-size:17px;line-height:1.6;text-align:center;max-width:540px;margin:0 auto 22px;}
#seo-home h2{font-family:'Fredoka',sans-serif;font-weight:600;font-size:20px;margin:30px 0 12px;}
#seo-home .cats{display:flex;flex-wrap:wrap;gap:8px;}
#seo-home .cats a{font-size:13px;font-weight:700;color:#6C4DFF;text-decoration:none;background:#F2F3FF;border-radius:999px;padding:8px 15px;}
#seo-home ul{list-style:none;padding:0;margin:0;}
#seo-home li{margin:0 0 10px;}
#seo-home li a{color:#0D0F1A;text-decoration:none;background:#fff;border:1px solid #E7E7F3;border-radius:12px;padding:12px 15px;display:block;font-size:15px;line-height:1.4;}
#seo-home li b{color:#6C4DFF;font-size:11px;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;}
#seo-home .cta{display:block;text-align:center;background:#6C4DFF;color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:14px;margin:24px auto 0;max-width:280px;}
</style>
<h1>Every hypothetical deserves an answer.</h1>
<p class="sub">Quandary is where the internet's most impossible questions get settled. Vote on would-you-rathers, hot takes, moral dilemmas and hypotheticals — then find out how the world disagrees with you.</p>
<a class="cta" href="/">Start voting →</a>
<h2>Browse by type</h2>
<div class="cats">${cats}</div>
<h2>Questions people are arguing about</h2>
<ul>${qs}</ul>
<a class="cta" href="/">Join Quandary →</a>
</div>`;
}

function sitemap(questions) {
  const urls = [
    { loc: `${SITE}/`, priority: "1.0", changefreq: "daily" },
    ...CATEGORIES.map((c) => ({
      loc: `${SITE}/${c.slug}`, priority: "0.9", changefreq: "daily",
    })),
    ...questions.map((q) => ({
      loc: `${SITE}/q/${q.slug}`, priority: "0.7", changefreq: "weekly",
    })),
    { loc: `${SITE}/privacy`, priority: "0.3", changefreq: "yearly" },
    { loc: `${SITE}/terms`, priority: "0.3", changefreq: "yearly" },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

// ---- run ----------------------------------------------------------------
async function run() {
  if (!existsSync(DIST)) {
    console.error("prerender: dist/ not found — run `vite build` first.");
    process.exit(0);
  }

  const { data: questions, error } = await supabase
    .from("public_questions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { console.error("prerender: query failed —", error.message); process.exit(0); }
  console.log(`prerender: ${questions.length} public questions`);

  let written = 0;
  for (const q of questions) {
    // related = up to 6 others, prefer same flair
    const sameFlair = questions.filter((r) => r.id !== q.id && r.flair === q.flair);
    const others = questions.filter((r) => r.id !== q.id && r.flair !== q.flair);
    const related = [...sameFlair, ...others].slice(0, 6);

    const dir = resolve(DIST, "q", q.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), questionPage(q, related));
    written++;
  }

  // category hub pages
  let cats = 0;
  for (const cat of CATEGORIES) {
    const dir = resolve(DIST, cat.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), categoryPage(cat, questions));
    cats++;
  }

  // inject crawlable homepage content into the built index.html
  try {
    const idxPath = resolve(DIST, "index.html");
    let idx = readFileSync(idxPath, "utf8");
    const guard = `<style>.has-session #seo-home{display:none!important}</style>`
      + `<script>try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&/^sb-.*-auth-token$/.test(k)){document.documentElement.classList.add('has-session');break;}}}catch(e){}</script>`;
    if (idx.includes("</head>")) idx = idx.replace("</head>", guard + "</head>");
    if (idx.includes('<div id="root"></div>')) {
      idx = idx.replace('<div id="root"></div>', `<div id="root">${homeInner(questions)}</div>`);
    }
    writeFileSync(idxPath, idx);
    console.log("prerender: injected crawlable homepage content");
  } catch (e) {
    console.error("prerender: homepage injection skipped —", e.message);
  }

  writeFileSync(resolve(DIST, "sitemap.xml"), sitemap(questions));
  console.log(`prerender: wrote ${written} question pages, ${cats} category pages + sitemap.xml`);
}

run();
