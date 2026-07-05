import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return <Centered>Loading…</Centered>;
  if (!session) return <Auth />;

  return <Quandary />;
}

function Auth() {
  const [mode, setMode] = useState("signup"); // 'signup' | 'login'
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // usernames: lowercase letters, numbers, underscores
  const cleanUsername = (v) => v.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 20);

  const submit = async () => {
    setError(""); setNote(""); setBusy(true);
    try {
      if (mode === "signup") {
        const handle = cleanUsername(username);
        if (handle.length < 3) throw new Error("Pick a username of at least 3 characters (letters, numbers, underscores).");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name: name.trim() || handle, handle } },
        });
        if (error) throw error;
        setNote("Account created! If nothing happens, check your email to confirm, then log in.");
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

  return (
    <div className="auth-wrap">
      <AuthStyle />
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.png" alt="Quandary" width="62" height="62" style={{ objectFit: "contain" }} draggable={false} />
        </div>
        <h1 className="auth-title">{mode === "signup" ? "Join Quandary" : "Welcome back"}</h1>
        <p className="auth-sub">Every hypothetical deserves an answer.</p>

        {mode === "signup" && (<>
          <input className="auth-in" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="auth-in" placeholder="Username (e.g. funkyfish23)" value={username}
            onChange={(e) => setUsername(cleanUsername(e.target.value))} />
        </>)}
        <input className="auth-in" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="auth-in" type="password" placeholder="Password (6+ characters)" value={password}
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />

        {error && <div className="auth-err">{error}</div>}
        {note && <div className="auth-note">{note}</div>}

        <button className="auth-btn" disabled={busy || !email || password.length < 6 || (mode === "signup" && cleanUsername(username).length < 3)} onClick={submit}>
          {busy ? "One sec…" : mode === "signup" ? "Create account" : "Log in"}
        </button>

        <button className="auth-switch" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setNote(""); }}>
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </div>
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
.auth-card{width:100%; max-width:380px; background:#fff; border:1px solid #E7E7F3; border-radius:24px; padding:32px 26px;
  box-shadow:0 24px 70px rgba(76,61,232,.16); text-align:center;}
.auth-logo{margin-bottom:14px;}
.auth-title{font-family:'Fredoka',system-ui,sans-serif; font-weight:700; font-size:26px; color:#0D0F1A; margin:0 0 2px;}
.auth-sub{color:#6E6E86; font-size:14px; margin:0 0 22px;}
.auth-in{width:100%; box-sizing:border-box; background:#F2F3FF; border:1.5px solid #E7E7F3; border-radius:12px;
  padding:13px 15px; font-size:15px; font-family:inherit; color:#0D0F1A; outline:none; margin-bottom:11px;}
.auth-in:focus{border-color:#6C4DFF; background:#fff;}
.auth-btn{width:100%; background:linear-gradient(95deg,#6C4DFF,#9B6BFF); color:#fff; border:none; padding:14px;
  border-radius:13px; font-family:'Fredoka',system-ui,sans-serif; font-weight:600; font-size:16px; cursor:pointer; margin-top:4px;
  box-shadow:0 10px 24px rgba(108,77,255,.3);}
.auth-btn:disabled{opacity:.45; cursor:default; box-shadow:none;}
.auth-switch{width:100%; background:none; border:none; color:#6C4DFF; font-weight:600; font-size:13.5px; cursor:pointer; margin-top:16px; font-family:inherit;}
.auth-err{background:#FFE9F2; color:#C2185B; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:11px; text-align:left;}
.auth-note{background:#E9FBF6; color:#0C8C73; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:11px; text-align:left;}
.dev-signout{position:fixed; top:12px; right:12px; z-index:999; background:#0D0F1A; color:#fff; border:none;
  border-radius:999px; padding:8px 14px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:system-ui; opacity:.8;}
`}</style>
  );
}
