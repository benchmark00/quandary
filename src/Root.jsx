import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { identifyUser, track, resetAnalytics } from "./lib/analytics.js";
import Quandary from "./App.jsx";

/* ---------------------------------------------------------------------------
 *  Root — decides what to show based on whether someone is signed in.
 *    • not signed in  -> the Auth screen below
 *    • signed in      -> the Quandary app (still on sample data for now)
 *  This is "slice 1" of wiring: proving login works end to end.
 * ------------------------------------------------------------------------- */
export default function Root() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) { identifyUser(s.user.id); track("logged_in"); }
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") { setRecovery(false); resetAnalytics(); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return <Centered>Loading…</Centered>;
  if (!session) return <Landing />;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;

  return <Quandary />;
}

function Auth({ onDismiss }) {
  const [mode, setMode] = useState("signup"); // 'signup' | 'login'
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [awaiting, setAwaiting] = useState(null); // email address pending confirmation

  // usernames: lowercase letters, numbers, underscores
  const cleanUsername = (v) => v.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 20);

  const google = async () => {
    setError("");
    track("signup_started", { method: "google" });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (e) { setError(e.message || "Google sign-in failed."); }
  };

  const submit = async () => {
    setError(""); setNote(""); setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        track("password_reset_requested");
        setNote("Reset link sent — check your inbox (and spam). Tap it and you'll be back here setting a new password.");
      } else if (mode === "signup") {
        const handle = cleanUsername(username);
        if (handle.length < 3) throw new Error("Pick a username of at least 3 characters (letters, numbers, underscores).");
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name: name.trim() || handle, handle } },
        });
        if (error) throw error;
        track("signup_started", { method: "email" });
        if (!data.session) { setAwaiting(email); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (awaiting) {
    return (
      <div className="auth-wrap">
        <AuthStyle />
        <div className="auth-card">
          {onDismiss && <button className="auth-x" onClick={onDismiss} aria-label="Close"><X size={20} /></button>}
          <div className="auth-mail">📬</div>
          <h1 className="auth-title">One tap to go!</h1>
          <p className="auth-sub">We've sent a confirmation link to</p>
          <p className="auth-email">{awaiting}</p>
          <p className="auth-copy">Tap the link in that email and the hypotheticals await. Every hypothetical deserves an answer — including "did my email arrive?"</p>
          <div className="auth-spam">
            <b>📁 Can't see it? Check your junk or spam folder.</b>
            <span>New senders often land there. Mark it "not spam" and you'll get future Quandary emails in your inbox.</span>
          </div>
          <button className="auth-btn" onClick={() => { setAwaiting(null); setMode("login"); setError(""); setNote(""); }}>
            I've confirmed — log me in
          </button>
          <button className="auth-switch" onClick={() => { setAwaiting(null); setMode("signup"); }}>Used the wrong email? Start over</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <AuthStyle />
      <div className="auth-card">
        {onDismiss && <button className="auth-x" onClick={onDismiss} aria-label="Close"><X size={20} /></button>}
        <div className="auth-logo">
          <img src="/logo.png" alt="Quandary" width="62" height="62" style={{ objectFit: "contain" }} draggable={false} />
        </div>
        <h1 className="auth-title">{mode === "signup" ? "Join Quandary" : mode === "reset" ? "Reset your password" : "Welcome back"}</h1>
        <p className="auth-sub">{mode === "reset" ? "Tell us your email and we'll send a reset link." : "Every hypothetical deserves an answer."}</p>

        {mode === "signup" && (<>
          <input className="auth-in" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="auth-in" placeholder="Username (e.g. funkyfish23)" value={username}
            onChange={(e) => setUsername(cleanUsername(e.target.value))} />
        </>)}
        <input className="auth-in" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "reset" && (
          <input className="auth-in" type="password" placeholder="Password (6+ characters)" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        )}
        {mode === "login" && (
          <button className="auth-forgot" onClick={() => { setMode("reset"); setError(""); setNote(""); }}>Forgot password?</button>
        )}

        {error && <div className="auth-err">{error}</div>}
        {note && <div className="auth-note">{note}</div>}

        <button className="auth-btn" disabled={busy || !email || (mode !== "reset" && password.length < 6) || (mode === "signup" && cleanUsername(username).length < 3)} onClick={submit}>
          {busy ? "One sec…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Log in"}
        </button>

        {mode !== "reset" && (<>
        <div className="auth-div"><span>or</span></div>
        <button className="auth-google" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41 35.4 44 30.2 44 24c0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          Continue with Google
        </button>
        </>)}
        <button className="auth-switch" onClick={() => { setMode(mode === "reset" || mode === "login" ? (mode === "reset" ? "login" : "signup") : "login"); setError(""); setNote(""); }}>
          {mode === "signup" ? "Already have an account? Log in" : mode === "reset" ? "Back to log in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  NewPassword — shown after tapping a reset link (recovery session active).
 * ------------------------------------------------------------------------- */
function NewPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      track("password_reset_completed");
      onDone();
    } catch (e) { setErr(e.message || "Couldn't set that password."); setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <AuthStyle />
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.png" alt="Quandary" width="62" height="62" style={{ objectFit: "contain" }} draggable={false} />
        </div>
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Pick something you'll actually remember this time. 😉</p>
        <input className="auth-in" type="password" autoFocus placeholder="New password (6+ characters)"
          value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw.length >= 6 && !busy && save()} />
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-btn" disabled={busy || pw.length < 6} onClick={save}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Landing — what signed-out visitors see.
 *  The signup card opens on arrival; X-ing out reveals a read-only preview of
 *  the live feed with a Sign Up CTA pinned in the header. Any tap on the
 *  preview reopens the signup card.
 * ------------------------------------------------------------------------- */
const LAND_FLAIRS = {
  wyr: ["Would You Rather", "#6C4DFF"], tot: ["This or That", "#21D4C3"],
  hot: ["Hot Take", "#FF4DB8"], hypo: ["Hypothetical", "#FF9F1C"],
  moral: ["Moral Dilemma", "#E0A800"], unpop: ["Unpopular Opinion", "#FF4DB8"],
  free: ["Free Form", "#6C4DFF"], island: ["Desert Island", "#FF9F1C"],
  shower: ["Shower Thought", "#21D4C3"],
};

function Landing() {
  const [showAuth, setShowAuth] = useState(true);
  const [items, setItems] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [qs, ps, vs, rs] = await Promise.all([
          supabase.from("questions").select("id, author_id, flair, title, body, created_at").eq("hidden", false).order("created_at", { ascending: false }).limit(20),
          supabase.from("profiles").select("id, name, handle, color, avatar_url"),
          supabase.from("vote_details").select("question_id"),
          supabase.from("reply_details").select("question_id"),
        ]);
        const pmap = {}; (ps.data || []).forEach((p) => { pmap[p.id] = p; });
        const vc = {}; (vs.data || []).forEach((v) => { vc[v.question_id] = (vc[v.question_id] || 0) + 1; });
        const rc = {}; (rs.data || []).forEach((r) => { rc[r.question_id] = (rc[r.question_id] || 0) + 1; });
        setItems((qs.data || []).map((q) => ({
          ...q, author: pmap[q.author_id],
          votes: vc[q.id] || 0, replies: rc[q.id] || 0,
        })));
      } catch { setItems([]); }
    })();
  }, []);

  const ago = (ts) => {
    const sPast = Math.floor((Date.now() - Date.parse(ts)) / 1000);
    if (sPast < 60) return "just now";
    const m = Math.floor(sPast / 60); if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  return (
    <div className="land-wrap">
      <AuthStyle />
      <header className="land-head">
        <img src="/wordmark.png" alt="Quandary" className="land-logo" draggable={false} />
        {!showAuth && <button className="land-cta" onClick={() => setShowAuth(true)}>Sign Up</button>}
      </header>
      <p className="land-tag">Every hypothetical deserves an answer.</p>

      <div className="land-feed" onClick={() => setShowAuth(true)} role="button" aria-label="Sign up to interact">
        {items === null && <p className="land-note">Loading the latest quandaries…</p>}
        {items && items.length === 0 && <p className="land-note">The feed is warming up…</p>}
        {items && items.map((q) => {
          const [label, tint] = LAND_FLAIRS[q.flair] || ["Question", "#6C4DFF"];
          const a = q.author;
          return (
            <article key={q.id} className="land-card">
              <div className="land-byline">
                {a && a.avatar_url
                  ? <img src={a.avatar_url} alt="" className="land-avatar land-avatar-img" draggable={false} />
                  : <span className="land-avatar" style={{ background: a ? a.color : "#C9C9DC" }}>{a ? a.name[0] : "?"}</span>}
                <span className="land-name">{a ? a.name : "Someone"}</span>
                <span className="land-meta">· {ago(q.created_at)}</span>
              </div>
              <div className="land-flair" style={{ color: tint }}>{label}</div>
              <h3 className="land-title">{q.title}</h3>
              {q.body ? <p className="land-body">{q.body}</p> : null}
              <div className="land-foot">
                {q.votes} {q.votes === 1 ? "vote" : "votes"} · {q.replies} {q.replies === 1 ? "reply" : "replies"}
                <span className="land-lock">Sign up to weigh in</span>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="land-footer">
        <p>We use privacy-respecting analytics — including limited session recordings — to make Quandary better.</p>
        <p>© Quandary · Every hypothetical deserves an answer.</p>
      </footer>

      {showAuth && (
        <div className="land-ov">
          <Auth onDismiss={() => setShowAuth(false)} />
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return <div className="auth-wrap"><AuthStyle /><div style={{ color: "#6E6E86", fontFamily: "system-ui" }}>{children}</div></div>;
}

function AuthStyle() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
.auth-wrap{min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
  background:linear-gradient(180deg,#EDEBFF 0%,#F7F5FF 60%,#FFFFFF 100%); font-family:'Plus Jakarta Sans',system-ui,sans-serif;}
.auth-card{position:relative; width:100%; max-width:380px; background:#fff; border:1px solid #E7E7F3; border-radius:24px; padding:32px 26px;
  box-shadow:0 24px 70px rgba(76,61,232,.16); text-align:center;}
.auth-x{position:absolute; top:12px; right:12px; background:#F2F3FF; border:none; border-radius:50%; width:34px; height:34px; display:grid; place-items:center; color:#6E6E86; cursor:pointer;}
.auth-x:hover{color:#0D0F1A;}
.land-wrap{min-height:100vh; background:linear-gradient(180deg,#EDEBFF 0%,#F7F5FF 55%,#FFFFFF 100%); font-family:'Plus Jakarta Sans',system-ui,sans-serif; padding-bottom:40px;}
.land-head{position:sticky; top:0; z-index:30; display:flex; align-items:center; justify-content:space-between; padding:14px 18px; background:rgba(242,243,255,.92); backdrop-filter:blur(10px); border-bottom:1px solid #E7E7F3;}
.land-logo{height:34px; width:auto; display:block;}
.land-cta{background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:10px 22px; border-radius:999px; font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:15px; cursor:pointer; box-shadow:0 8px 20px rgba(108,77,255,.3);}
.land-tag{text-align:center; color:#6E6E86; font-size:14px; margin:14px 16px 6px;}
.land-feed{max-width:430px; margin:0 auto; padding:10px 16px; cursor:pointer;}
.land-note{text-align:center; color:#6E6E86; font-size:14px; padding:30px 0;}
.land-card{background:#fff; border:1px solid #E7E7F3; border-radius:18px; padding:15px; margin-bottom:12px; box-shadow:0 2px 12px rgba(13,15,26,.04);}
.land-byline{display:flex; align-items:center; gap:8px; margin-bottom:8px;}
.land-avatar{width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:#fff; font-family:'Fredoka',sans-serif; font-weight:700; font-size:12px;}
.land-avatar-img{object-fit:cover;}
.land-name{font-weight:700; font-size:13.5px; color:#0D0F1A;}
.land-meta{font-size:12px; color:#6E6E86;}
.land-flair{font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; margin-bottom:5px;}
.land-title{font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:17px; line-height:1.3; color:#0D0F1A; margin:0 0 5px;}
.land-body{font-size:13px; color:#6E6E86; line-height:1.45; margin:0 0 10px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
.land-foot{display:flex; align-items:center; gap:6px; font-size:12.5px; color:#6E6E86; border-top:1px solid #E7E7F3; padding-top:9px;}
.land-lock{margin-left:auto; color:#6C4DFF; font-weight:700; font-size:12px;}
.land-ov{position:fixed; inset:0; z-index:60; background:rgba(13,15,26,.35); backdrop-filter:blur(5px); overflow-y:auto;}
.auth-logo{margin-bottom:14px;}
.auth-mail{font-size:52px; margin-bottom:10px;}
.auth-email{font-weight:800; color:#6C4DFF; font-size:16px; margin:2px 0 14px; word-break:break-all;}
.auth-copy{color:#6E6E86; font-size:14px; line-height:1.55; margin:0 0 16px;}
.auth-spam{display:flex; flex-direction:column; gap:5px; background:#FFF6E6; border:1px solid #FFE2A8; border-radius:14px; padding:14px 16px; margin:0 0 20px; text-align:left;}
.auth-spam b{color:#8A5A00; font-size:14px;}
.auth-spam span{color:#9A6B00; font-size:12.5px; line-height:1.5;}
.auth-title{font-family:'Fredoka',system-ui,sans-serif; font-weight:700; font-size:26px; color:#0D0F1A; margin:0 0 2px;}
.auth-sub{color:#6E6E86; font-size:14px; margin:0 0 22px;}
.auth-in{width:100%; box-sizing:border-box; background:#F2F3FF; border:1.5px solid #E7E7F3; border-radius:12px;
  padding:13px 15px; font-size:15px; font-family:inherit; color:#0D0F1A; outline:none; margin-bottom:11px;}
.auth-in:focus{border-color:#6C4DFF; background:#fff;}
.auth-btn{width:100%; background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:14px;
  border-radius:13px; font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:16px; cursor:pointer; margin-top:4px;
  box-shadow:0 10px 24px rgba(108,77,255,.3);}
.auth-btn:disabled{opacity:.45; cursor:default; box-shadow:none;}
.auth-div{display:flex; align-items:center; gap:12px; color:#A3A3B8; font-size:12.5px; margin:16px 0 12px;}
.auth-div:before,.auth-div:after{content:""; height:1px; background:#E7E7F3; flex:1;}
.auth-google{width:100%; display:inline-flex; align-items:center; justify-content:center; gap:10px; background:#fff; border:1.5px solid #E7E7F3; color:#0D0F1A; padding:13px; border-radius:13px; font-weight:700; font-size:15px; cursor:pointer; font-family:inherit;}
.auth-google:hover{border-color:#C9C9DC;}
.auth-forgot{width:100%; text-align:right; background:none; border:none; color:#6E6E86; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; padding:0 2px 10px; margin-top:-4px;}
.auth-forgot:hover{color:#6C4DFF;}
.land-footer{max-width:430px; margin:22px auto 0; padding:0 18px 26px; text-align:center; color:#A3A3B8; font-size:11.5px; line-height:1.65;}
.land-footer p{margin:0 0 6px;}
.auth-switch{width:100%; background:none; border:none; color:#6C4DFF; font-weight:600; font-size:13.5px; cursor:pointer; margin-top:16px; font-family:inherit;}
.auth-err{background:#FFE9F2; color:#C2185B; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:11px; text-align:left;}
.auth-note{background:#E9FBF6; color:#0C8C73; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:11px; text-align:left;}
.dev-signout{position:fixed; top:12px; right:12px; z-index:999; background:#0D0F1A; color:#fff; border:none;
  border-radius:999px; padding:8px 14px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:system-ui; opacity:.8;}
`}</style>
  );
}
