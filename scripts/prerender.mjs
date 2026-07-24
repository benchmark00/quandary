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
      <a class="cta-top" href="/q/${q.id}">Vote now</a>
    </header>
    <main>
      <span class="flair">${esc(flairLabel)}</span>
      <h1>${esc(q.title)}</h1>
      ${q.body?.trim() ? `<p class="body">${esc(q.body)}</p>` : ""}
      ${pollHtml}
      <div class="cta-box">
        <p>What's your answer? Join the debate and see how the world disagrees with you.</p>
        <a class="cta-btn" href="/q/${q.id}">Sign up &amp; vote →</a>
      </div>
      ${repliesHtml}
    </main>
    ${relatedHtml}
    <footer>
      <p><a href="/">Quandary</a> — every hypothetical deserves an answer.</p>
    </footer>
  </div>
</body>
</html>`;
}

// ---- sitemap ------------------------------------------------------------
function sitemap(questions) {
  const urls = [
    { loc: `${SITE}/`, priority: "1.0", changefreq: "daily" },
    ...questions.map((q) => ({
      loc: `${SITE}/q/${q.slug}`, priority: "0.7", changefreq: "weekly",
    })),
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

  writeFileSync(resolve(DIST, "sitemap.xml"), sitemap(questions));
  console.log(`prerender: wrote ${written} pages + sitemap.xml`);
}

run();
