// WakaBack Premium: account, purchase, online backup, live sharing with voice, SOS live link.
// Talks to the app through window.WBApp (index.html) and to the server through WBCloud (cloud.js).
(function () {
  "use strict";
  const CFG = window.WAKA_CONFIG || {};
  const ON = !!(CFG.firebase || CFG.mockServer);
  const DAY = 864e5, MIN = 6e4;
  const pad5 = (n) => String(n).padStart(5, "0");
  const PKEY = "wayback.premium.v1", SKEY = "wayback.premium.settings", LKEY = "wayback.live.v1", YKEY = "wayback.premium.sync";
  const P = { cloud: null, user: null, premium: false, live: null, busy: false, msg: "", err: "", sync: { last: 0, busy: false, err: "" },
    settings: { shareVoice: false, sosVoice: true, name: "", emails: [] }, offerings: null, view: "signin" };
  try { Object.assign(P.settings, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (e) {}
  try { P.sync.last = +localStorage.getItem(YKEY) || 0; } catch (e) {}
  const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} };
  const A = () => window.WBApp;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + " s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; };
  const myName = () => P.settings.name || (P.user && P.user.email ? P.user.email.split("@")[0] : "") || "Your family member";
  const liveLink = (id) => (CFG.liveUrl || A().SITE + "live.html") + "#s=" + id;
  const errText = (e) => {
    const c = (e && (e.code || e.message)) || "";
    if (/email-already-in-use/.test(c)) return "An account with this email already exists. Sign in instead.";
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "Email or password is wrong.";
    if (/weak-password/.test(c)) return "Use a password of at least 8 characters.";
    if (/invalid-email/.test(c)) return "That email address doesn't look right.";
    if (/network|Failed to fetch|offline/i.test(c)) return "No internet connection. Try again when you have data.";
    if (/too-many-requests/.test(c)) return "Too many tries. Wait a few minutes and try again.";
    if (/requires-recent-login/.test(c)) return "Please sign in again, then try once more.";
    return "Something went wrong. Please try again.";
  };

  // ---------- styles (use the app's colour tokens) ----------
  const css = document.createElement("style");
  css.textContent = `
  .pm h2{font-family:var(--f-display);font-size:1.15rem;margin:0}
  .pm{display:flex;flex-direction:column;gap:10px}
  .pm .perks{margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px;font-size:.9rem}
  .pm form,.pm .fields{display:flex;flex-direction:column;gap:8px}
  .pm input[type=email],.pm input[type=password],.pm input[type=text]{border:1px solid var(--line);border-radius:9px;padding:9px 10px;background:var(--bg);width:100%;min-width:0;font:inherit;color:var(--fg)}
  .pm .ok{color:var(--accent);font-weight:600}
  .pm .err{color:var(--warn);font-size:.88rem}
  .pm .linkbtn{background:none;border:0;padding:0;color:var(--accent);font-weight:600;cursor:pointer;font:inherit;text-decoration:underline}
  .pm .plans{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .pm .plan{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--bg);text-align:left;cursor:pointer;font:inherit;color:var(--fg);display:flex;flex-direction:column;gap:2px}
  .pm .plan b{font-size:1.05rem}.pm .plan span{font-size:.8rem;color:var(--muted)}
  .pm .badge{display:inline-block;background:var(--signal);color:#1d1600;font-size:.72rem;font-weight:700;border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:2px}
  .pm label.sw{display:flex;align-items:center;gap:8px;font-weight:600;font-size:.9rem}
  .pm label.sw input{width:20px;height:20px;accent-color:var(--accent)}
  .pm details summary{cursor:pointer;color:var(--muted);font-size:.86rem}
  .livebar{border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--accent) 14%,transparent);display:flex;flex-direction:column;gap:8px}
  .livebar.sos{background:var(--warn-bg)}
  .livebar .rec{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--accent)}
  .livebar.sos .rec{color:var(--warn)}
  .livebar .rec::before{content:"";width:10px;height:10px;border-radius:50%;background:currentColor;animation:pulse 1.2s infinite}
  .chips2{display:flex;flex-wrap:wrap;gap:6px}
  .chips2 button{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:6px 11px;font:inherit;font-size:.85rem;cursor:pointer;color:var(--fg)}
  .chips2 button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .upsell.warnbox{border-color:var(--signal,#f2b705);background:color-mix(in srgb,var(--signal,#f2b705) 12%,transparent);color:var(--fg)}
  .upsell{border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:.86rem;color:var(--muted);display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  @media (prefers-reduced-motion:reduce){.livebar .rec::before{animation:none}}`;
  document.head.appendChild(css);

  // ---------- live-sharing sheet ----------
  const sheet = document.createElement("div");
  sheet.className = "sheet"; sheet.id = "livesheet"; sheet.hidden = true;
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "ls-title");
  sheet.innerHTML = `<div class="card pm">
    <h2 id="ls-title">Share your trip live</h2>
    <p class="note">Family can watch you move on a map from any phone, with no app needed. Your location updates about every 15 seconds while you have data.</p>
    <label class="fields"><span style="font-weight:600;font-size:.88rem">Your name (shown to family)</span><input type="text" id="ls-name" maxlength="40" placeholder="e.g. Emmanuel"></label>
    <div><div class="eyebrow" style="margin-bottom:6px">When do you expect to arrive?</div><div class="chips2" id="ls-eta"></div>
      <p class="note" style="margin-top:6px">If you haven't ended the trip 30 minutes after this, your family alert emails and anyone who tapped “Notify me” get an email.</p></div>
    <label class="sw" id="ls-voicewrap"><input type="checkbox" id="ls-voice"> Let them hear our conversation too</label>
    <p class="note" id="ls-voicenote"></p>
    <div class="row"><button class="btn primary" id="ls-go" type="button">Start sharing</button><button class="btn" id="ls-cancel" type="button">Cancel</button></div>
  </div>`;
  document.body.appendChild(sheet);
  const ETAS = [[15, "15 min"], [30, "30 min"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [0, "Not sure"]];
  let etaPick = 60;

  // ---------- account section in Help ----------
  function perksHTML() {
    return `<ul class="perks">
      <li><b>Online backup</b> of your trips and voice recordings. Get them back on a new phone.</li>
      <li><b>Live tracking link</b>: family watch you move, with no app needed.</li>
      <li><b>Hear the conversation</b> on the live link (about 1 minute behind).</li>
      <li><b>Alerts</b>: family get an email if you're late or your phone goes silent.</li>
      <li><b>SOS</b> sends a live link and records voice automatically.</li>
      <li><b>Hide trips</b>: hide trips, their notes and voice behind a private password only you know.</li>
      <li><b>No adverts.</b></li></ul>`;
  }
  function renderAcct() {
    const box = $("acctsec"); if (!box) return;
    let h = `<div class="pm">`;
    if (!ON) { h += `<h2>WakaBack Premium</h2>${perksHTML()}<p class="note">Premium is coming soon.</p></div>`; box.innerHTML = h; return; }
    if (!P.cloud) { h += `<h2>WakaBack Premium</h2><p class="note">Loading…</p></div>`; box.innerHTML = h; return; }
    if (!P.user) {
      const up = P.view === "signup", reset = P.view === "reset";
      h += `<h2>WakaBack Premium</h2>${perksHTML()}
        <form id="pm-form" novalidate>
          <input type="email" id="pm-email" autocomplete="email" placeholder="Email address" aria-label="Email address">
          ${reset ? "" : `<input type="password" id="pm-pw" autocomplete="${up ? "new-password" : "current-password"}" placeholder="${up ? "Choose a password (8+ characters)" : "Password"}" aria-label="Password">`}
          <div class="row"><button class="btn primary" type="submit">${up ? "Create account" : reset ? "Send reset link" : "Sign in"}</button></div>
        </form>
        <div class="row">${up ? `<button class="linkbtn" data-v="signin">I already have an account</button>` : `<button class="linkbtn" data-v="signup">Create an account</button>`}
          ${reset ? `<button class="linkbtn" data-v="signin">Back to sign in</button>` : `<button class="linkbtn" data-v="reset">Forgot password?</button>`}</div>`;
    } else {
      h += `<h2>${P.premium ? "WakaBack Premium <span class=\"badge\">Active</span>" : "WakaBack Premium"}</h2>
        <p class="note">Signed in as <b>${esc(P.user.email)}</b></p>`;
      if (!P.user.verified) h += `<p class="note">Please confirm your email: open the link we sent to ${esc(P.user.email)}.
        <button class="linkbtn" id="pm-reverify">Send again</button> · <button class="linkbtn" id="pm-checkverify">I've confirmed</button></p>`;
      if (P.premium) {
        const n = (A().S.trips || []).filter((t) => t.cloudAt && !t.sample).length;
        h += `<p class="note">☁️ ${n} trip${n === 1 ? "" : "s"} backed up${P.sync.last ? " · last backup " + ago(P.sync.last) : ""}${P.sync.busy ? " · backing up now…" : ""}</p>
          ${P.sync.err ? `<p class="err">${esc(P.sync.err)}</p>` : ""}
          <div class="row"><button class="btn sm" id="pm-sync" type="button">Back up now</button></div>
          <label class="fields"><span style="font-weight:600;font-size:.88rem">Your name (shown to family on live links and alerts)</span><input type="text" id="pm-name" maxlength="40" value="${esc(P.settings.name || "")}" placeholder="e.g. Emmanuel"></label>
          <label class="fields"><span style="font-weight:600;font-size:.88rem">Family emails for alerts (up to 3)</span><input type="text" id="pm-emails" inputmode="email" value="${esc((P.settings.emails || []).join(", "))}" placeholder="brother@gmail.com, mama@yahoo.com"></label>
          <p class="note">They get an email straight away when you press SOS, and when a shared trip is late, goes silent or ends.</p>
          <label class="sw"><input type="checkbox" id="pm-sharevoice" ${P.settings.shareVoice ? "checked" : ""}> Share my voice on live links by default</label>
          <label class="sw"><input type="checkbox" id="pm-sosvoice" ${P.settings.sosVoice ? "checked" : ""}> SOS records voice automatically</label>
          <p class="note">Recording voice with SOS shows the red recording sign. It helps family and police know what happened.</p>
          ${A().NATIVE ? `<p class="note"><a href="${A().IS_ANDROID ? "https://play.google.com/store/account/subscriptions" : "https://apps.apple.com/account/subscriptions"}" target="_blank" rel="noopener">Manage or cancel your subscription</a></p>` : ""}`;
      } else {
        h += perksHTML();
        if (A().NATIVE && P.offerings && P.offerings.length) {
          h += `<div class="plans">${P.offerings.map((o, i) => `<button class="plan" data-pkg="${i}" type="button"><b>${esc(o.price)}</b><span>${esc(o.label)}</span></button>`).join("")}</div>
            <div class="row"><button class="linkbtn" id="pm-restore">Restore purchases</button></div>`;
        } else if (A().NATIVE) {
          h += `<p class="note">Loading Premium plans…</p>`;
        } else {
          h += `<p class="note">Get Premium in the WakaBack app from Google Play or the App Store. Once you're Premium, it works here too when you sign in.</p>`;
        }
        h += `<div class="row"><button class="btn sm" id="pm-check" type="button">I've paid, check again</button></div>`;
      }
      h += `<div class="row"><button class="btn sm" id="pm-signout" type="button">Sign out</button></div>
        <details><summary>Delete my account</summary>
          <div class="fields" style="margin-top:8px"><p class="note">This deletes your account, online backups and live links. Trips saved on this phone stay here.</p>
          <input type="password" id="pm-delpw" placeholder="Your password" aria-label="Your password">
          <div class="row"><button class="btn sm danger" id="pm-del" type="button">Delete my account for good</button></div></div></details>`;
    }
    if (P.err) h += `<p class="err" role="alert">${esc(P.err)}</p>`;
    if (P.msg) h += `<p class="ok" role="status">${esc(P.msg)}</p>`;
    box.innerHTML = h + `</div>`;
    wireAcct();
  }
  function setMsg(msg, err) { P.msg = msg || ""; P.err = err || ""; renderAcct(); }
  async function busy(fn) { if (P.busy) return; P.busy = true; P.err = ""; P.msg = ""; try { await fn(); } catch (e) { P.err = errText(e); console.warn(e); } P.busy = false; renderAcct(); }
  function wireAcct() {
    const f = $("pm-form");
    if (f) f.onsubmit = (e) => { e.preventDefault(); const email = $("pm-email").value.trim(), pw = $("pm-pw") ? $("pm-pw").value : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg("", "Enter your email address."); return; }
      if (P.view === "reset") return busy(async () => { await P.cloud.resetPassword(email); P.msg = "Check your email for a link to set a new password."; P.view = "signin"; });
      if (P.view === "signup" && pw.length < 8) { setMsg("", "Use a password of at least 8 characters."); return; }
      if (!pw) { setMsg("", "Enter your password."); return; }
      busy(async () => { if (P.view === "signup") { await P.cloud.signUp(email, pw); P.msg = "Account created. We sent you an email to confirm your address."; } else { await P.cloud.signIn(email, pw); P.msg = "Signed in."; } }); };
    document.querySelectorAll("#acctsec [data-v]").forEach((b) => (b.onclick = () => { P.view = b.dataset.v; setMsg(); }));
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on("pm-signout", () => busy(async () => { await P.cloud.signOut(); setPremium(false); P.msg = "Signed out. Your trips are still on this phone."; }));
    on("pm-reverify", () => busy(async () => { await P.cloud.sendVerify(); P.msg = "Email sent."; }));
    on("pm-checkverify", () => busy(async () => { P.user = await P.cloud.reloadUser(); P.msg = P.user && P.user.verified ? "Email confirmed." : "Not confirmed yet. Open the link in the email first."; }));
    on("pm-check", () => busy(async () => { const v = await P.cloud.premium(true); setPremium(v); P.msg = v ? "Premium is active. Thank you!" : "Premium isn't active on this account yet. It can take a minute after paying."; }));
    on("pm-sync", () => syncNow(true));
    on("pm-restore", () => busy(restorePurchases));
    on("pm-del", () => { const pw = $("pm-delpw").value; if (!pw) { setMsg("", "Enter your password to delete your account."); return; }
      busy(async () => { await endLive("account deleted"); await P.cloud.deleteAccount(pw); setPremium(false); P.msg = "Your account and online data were deleted."; }); });
    const sv = $("pm-sharevoice"); if (sv) sv.onchange = () => { P.settings.shareVoice = sv.checked; save(SKEY, P.settings); };
    const nm = $("pm-name"); if (nm) nm.onchange = () => { P.settings.name = nm.value.trim(); save(SKEY, P.settings); };
    const em = $("pm-emails"); if (em) em.onchange = () => { const list = em.value.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 3);
      P.settings.emails = list; save(SKEY, P.settings); em.value = list.join(", "); P.msg = list.length ? "Saved " + list.length + " family email" + (list.length === 1 ? "" : "s") + "." : "No valid emails saved."; renderAcct(); };
    const so = $("pm-sosvoice"); if (so) so.onchange = () => { P.settings.sosVoice = so.checked; save(SKEY, P.settings); };
    document.querySelectorAll("#acctsec .plan").forEach((b) => (b.onclick = () => busy(() => buy(+b.dataset.pkg))));
  }

  // ---------- Premium status and purchases (RevenueCat, phone app only) ----------
  function setPremium(v) {
    const was = P.premium; P.premium = !!v;
    save(PKEY, P.premium ? "active" : null);
    try { A().renderAds(); } catch (e) {}
    renderAcct(); renderLive(); renderUpsell(); if (window.WBVault) WBVault.renderEntry();
    if (P.premium && !was) { syncNow(false); if (window.WBVault) WBVault.on("signedIn"); }
  }
  const RC = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases) || null;
  async function rcSetup() {
    const rc = RC(); if (!rc || !P.user) return;
    const key = A().IS_ANDROID ? CFG.revenuecat && CFG.revenuecat.android : CFG.revenuecat && CFG.revenuecat.ios;
    if (!key) return;
    try {
      if (!P.rcReady) { await rc.configure({ apiKey: key, appUserID: P.user.uid }); P.rcReady = true; } else await rc.logIn({ appUserID: P.user.uid });
      const o = await rc.getOfferings();
      const pk = (o && o.current && o.current.availablePackages) || [];
      P.offerings = pk.map((p) => ({ pkg: p, price: p.product.priceString, label: /annual|year/i.test(p.packageType || p.identifier) ? "per year · best value" : /month/i.test(p.packageType || p.identifier) ? "per month" : p.product.title }));
      renderAcct();
    } catch (e) { console.warn("RevenueCat", e); }
  }
  async function buy(i) {
    const rc = RC(); const o = P.offerings && P.offerings[i]; if (!rc || !o) return;
    try { await rc.purchasePackage({ aPackage: o.pkg }); } catch (e) { if (e && (e.userCancelled || /cancel/i.test(e.message || ""))) return; throw e; }
    P.msg = "Payment received. Turning on Premium…"; renderAcct();
    for (let k = 0; k < 15; k++) { if (await P.cloud.premium(true)) { setPremium(true); P.msg = "Premium is active. Thank you!"; return; } await new Promise((r) => setTimeout(r, 3000)); }
    P.msg = "Payment received. Premium can take a few minutes to switch on. Tap “I've paid, check again”.";
  }
  async function restorePurchases() { const rc = RC(); if (!rc) return; await rc.restorePurchases(); const v = await P.cloud.premium(true); setPremium(v); P.msg = v ? "Premium restored." : "No Premium purchase found for this Google or Apple account."; }

  // ---------- online backup ----------
  let syncTimer = null;
  function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 4000); }
  async function syncNow(manual) {
    if (!P.premium || !P.user || P.sync.busy || (window.WBVault && WBVault.isOpen())) return;
    P.sync.busy = true; P.sync.err = ""; renderAcct();
    const app = A(); let changed = false;
    try {
      if (app.tripsReady) await app.tripsReady;
      for (const t of app.S.trips.slice()) {
        if (t.sample) continue;
        if (!t.cloudAt || t.cloudDirty) {
          await P.cloud.putTrip({ id: t.id, name: t.name, created: t.created, note: (t.note || "").slice(0, 1000), code: app.encodeTrip(t), audio: t.audio ? { id: t.audio.id, start: t.audio.start, dur: t.audio.dur || 0, mime: t.audio.mime || "" } : null });
          t.cloudAt = Date.now(); delete t.cloudDirty; changed = true;
        }
        if (t.audio && !t.audio.fetched) { // upload voice parts not uploaded yet (late parts included)
          const rows = await app.vGetAll(t.audio.id); const done = t.audio.up || 0;
          if (rows.length > done) {
            const path = P.cloud.userVoicePath(t.audio.id);
            for (const r of rows.slice(done)) { await P.cloud.putVoice(path, { seg: r.seg, c: r.c, start: r.start, mime: r.mime }, r.blob); t.audio.up = (t.audio.up || 0) + 1; }
            t.audio.cloud = true; changed = true;
          }
        }
      }
      // bring back trips from the account that aren't on this phone (new phone, reinstall)
      const remote = await P.cloud.listTrips();
      const have = new Set(app.S.trips.map((t) => t.id));
      for (const r of remote) {
        if (have.has(r.id)) continue;
        try {
          const t = app.decodeTrip(r.code); t.id = r.id; t.name = r.name || t.name; t.created = r.created || t.created; t.cloudAt = Date.now(); delete t.shared;
          if (r.note) t.note = String(r.note).slice(0, 1000);
          if (r.audio && r.audio.id) t.audio = { ...r.audio, cloud: true, fetched: false, up: 1e9 };
          app.S.trips.push(t); changed = true;
        } catch (e) {}
      }
      if (changed) { app.S.trips.sort((a, b) => (b.created || 0) - (a.created || 0)); app.saveTrips(); app.renderAll(); }
      P.sync.last = Date.now(); save(YKEY, String(P.sync.last));
      if (manual) P.msg = "Backup complete.";
    } catch (e) { P.sync.err = /network|fetch|offline/i.test(String(e && (e.code || e.message))) ? "Backup will continue when you have data." : "Backup didn't finish. It will try again."; console.warn(e); }
    P.sync.busy = false; renderAcct();
  }
  async function fetchVoice(t) { // voice for a trip restored from backup
    if (!P.premium || !P.user || !t.audio) return false;
    try {
      const path = P.cloud.userVoicePath(t.audio.id); const parts = await P.cloud.listVoice(path);
      for (const p of parts) { const blob = await P.cloud.getVoice(path, p.name); await A().vPut({ k: t.audio.id + ":" + pad5(p.seg) + ":" + pad5(p.c), seg: p.seg, c: p.c, start: p.start, mime: p.mime, blob }); }
      return parts.length > 0;
    } catch (e) { console.warn(e); return false; }
  }

  // ---------- live sharing ----------
  // P.live = { id, n, pending:[[lat,lon,t]], last, voice, audioId, startedAt, status, flushAt, uploads:[] }
  try { P.live = JSON.parse(localStorage.getItem(LKEY) || "null"); if (P.live) { P.live.pending = P.live.pending || []; P.live.uploads = []; } } catch (e) {}
  const persistLive = () => save(LKEY, P.live ? { ...P.live, uploads: undefined } : null);
  function canLive() { return ON && P.cloud && P.user && P.premium; }
  function renderLive() {
    const box = $("livebox"); if (!box) return;
    const app = A(); const rec = app.S.rec;
    if (P.live) {
      const sos = P.live.status === "sos";
      box.innerHTML = `<div class="livebar${sos ? " sos" : ""}"><span class="rec">${sos ? "SOS live link is on" : "Sharing live"}${P.live.voice ? " · with voice" : ""}</span>
        <span class="note" id="lv-status">${P.live.lastSent ? "Last update sent " + ago(P.live.lastSent) : "Waiting for data to send the first update…"}${P.live.pending.length > 40 ? " · no data now, updates will catch up" : ""}</span>
        <div class="row"><button class="btn sm" id="lv-again" type="button">Send link again</button><button class="btn sm danger" id="lv-stop" type="button">Stop sharing</button></div></div>`;
      $("lv-again").onclick = () => openLiveMessage();
      $("lv-stop").onclick = () => endLive("stopped");
      return;
    }
    if (!rec || rec.demo) { box.innerHTML = ""; return; }
    if (canLive()) { box.innerHTML = `<div class="row"><button class="btn" id="lv-start" type="button">📡 Share live with family</button></div>`; $("lv-start").onclick = openLiveSheet; }
    else if (ON) { box.innerHTML = `<div class="row"><button class="btn" id="lv-start" type="button">📡 Share live <span class="badge">Premium</span></button></div>`; $("lv-start").onclick = () => { app.setTab("help"); setTimeout(() => $("acctsec") && $("acctsec").scrollIntoView({ behavior: "smooth" }), 50); }; }
    else box.innerHTML = "";
  }
  function renderEta() {
    const eb = $("ls-eta"); eb.innerHTML = "";
    ETAS.forEach(([m, l]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.setAttribute("aria-pressed", String(m === etaPick)); b.onclick = () => { etaPick = m; renderEta(); }; eb.appendChild(b); });
  }
  function openLiveSheet() {
    const app = A(); const rec = app.S.rec; if (!rec) return;
    $("ls-name").value = myName() === "Your family member" ? "" : myName();
    renderEta();
    const hasVoice = !!(rec.voice && rec.voice.ok);
    $("ls-voicewrap").hidden = !hasVoice; $("ls-voice").checked = hasVoice && P.settings.shareVoice;
    $("ls-voicenote").textContent = hasVoice ? "Voice reaches them about 1 minute behind and uses about 10–15 MB of data per hour. Anyone with the link can listen, so send it only to people you trust." : "Tip: tick “Also record voice” before you start a trip if you want family to hear the conversation.";
    sheet.hidden = false; setTimeout(() => $("ls-go").focus(), 0);
  }
  $("ls-cancel").onclick = () => (sheet.hidden = true);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.hidden = true; });
  $("ls-go").onclick = () => {
    const name = $("ls-name").value.trim(); P.settings.name = name; save(SKEY, P.settings);
    startLive({ who: name || myName(), eta: etaPick ? Date.now() + etaPick * MIN : null, voice: !$("ls-voicewrap").hidden && $("ls-voice").checked, status: "active" });
    sheet.hidden = true; openLiveMessage();
  };
  async function startLive(o) {
    const app = A(); const rec = app.S.rec; const now = Date.now();
    const id = P.cloud.newId(); const pts = rec ? rec.B.points.map((p) => [p.lat, p.lon, p.t]) : [];
    const last = rec && rec.cur ? { lat: rec.cur.lat, lon: rec.cur.lon, acc: rec.cur.acc || null, t: rec.cur.t } : null;
    P.live = { id, n: 0, pending: pts, last, voice: !!o.voice, audioId: rec && rec.voice && rec.voice.ok ? rec.voice.id : null, startedAt: now, status: o.status, who: o.who, eta: o.eta, uploads: [], lastSent: 0, created: false };
    persistLive(); renderLive();
    const data = { owner: P.user.uid, who: o.who, status: o.status, startedAt: now, lastAt: now, last, expectedArrival: o.eta, voice: !!o.voice,
      overdueAlerted: false, silentAlerted: false, expireAt: now + 30 * DAY, alertEmails: (P.settings.emails || []).slice(0, 3), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "") };
    try { await P.cloud.liveCreate(id, data); P.live.created = true; persistLive(); } catch (e) { P.live.createData = data; persistLive(); }
    if (P.live.voice && P.live.audioId) uploadExistingVoice(P.live.audioId);
    flushLive(true);
  }
  function openLiveMessage() {
    if (!P.live) return; const app = A();
    const eta = P.live.eta ? "\nI expect to arrive around " + app.fmtClock(P.live.eta) + "." : "";
    const text = (P.live.status === "sos" ? "SOS: I need help. Follow me live on WakaBack: " : "Follow my trip live on WakaBack: ") + liveLink(P.live.id) + eta +
      (P.live.voice ? "\nYou can also hear our conversation (about 1 minute behind)." : "") + ((P.settings.emails || []).length ? "" : "\nOpen the link and tap “Notify me” to get an email if I'm late.");
    app.openText("Send your live link", "Family can open it on any phone, with no app needed. SMS works without data.", text);
  }
  let flushing = false;
  async function flushLive(force) {
    const L = P.live; if (!L || flushing || !P.cloud) return;
    if (!force && L.flushAt && Date.now() - L.flushAt < 15000) return;
    flushing = true; L.flushAt = Date.now();
    try {
      if (!L.created) { await P.cloud.liveCreate(L.id, L.createData); L.created = true; delete L.createData; }
      if (L.pending.length) { const batch = L.pending.slice(0, 500); await P.cloud.liveAddPoints(L.id, L.n, batch); L.n++; L.pending.splice(0, batch.length); }
      const now = Date.now();
      await P.cloud.liveUpdate(L.id, { lastAt: now, last: L.last, silentAlerted: false, expireAt: now + 30 * DAY, status: L.status, voice: L.voice });
      L.lastSent = now; persistLive();
      while (L.uploads.length) { const u = L.uploads[0]; await P.cloud.putVoice(P.cloud.liveVoicePath(L.id), u.part, u.blob); L.uploads.shift(); }
    } catch (e) { console.warn("live upload will retry", e); }
    flushing = false; renderLiveStatus();
  }
  function renderLiveStatus() { const s = $("lv-status"); if (s && P.live) s.textContent = (P.live.lastSent ? "Last update sent " + ago(P.live.lastSent) : "Waiting for data to send the first update…") + (P.live.pending.length > 40 ? " · no data now, updates will catch up" : ""); }
  async function uploadExistingVoice(audioId) {
    try { const rows = await A().vGetAll(audioId); rows.forEach((r) => P.live && P.live.uploads.push({ part: { seg: r.seg, c: r.c, start: r.start, mime: r.mime }, blob: r.blob })); flushLive(true); } catch (e) {}
  }
  // Ending is retried until it reaches the server, so the link always switches to "arrived".
  const EKEY = "wayback.live.ending";
  async function endLive(why) {
    const L = P.live; if (!L) return;
    try { L.flushAt = 0; await flushLive(true); } catch (e) {}
    P.live = null; persistLive(); renderLive();
    const now = Date.now(); const end = { id: L.id, fields: { status: "ended", endedAt: now, lastAt: now, expireAt: now + 7 * DAY } };
    let q = []; try { q = JSON.parse(localStorage.getItem(EKEY) || "[]"); } catch (e) {}
    q.push(end); save(EKEY, q); retryEnds();
  }
  async function retryEnds() {
    if (!P.cloud) return; let q = []; try { q = JSON.parse(localStorage.getItem(EKEY) || "[]"); } catch (e) {}
    const left = [];
    for (const e of q) { try { await P.cloud.liveUpdate(e.id, e.fields); } catch (err) { left.push(e); } }
    save(EKEY, left.length ? left : null);
  }
  setInterval(() => { if (P.live) { flushLive(false); renderLiveStatus(); } if (P.cloud) retryEnds(); if (P.premium && navigator.onLine !== false && Date.now() - P.sync.last > 10 * MIN) syncNow(false); }, 5000);
  window.addEventListener("online", () => { if (P.live) flushLive(true); retryEnds(); syncSoon(); });

  // ---------- SOS (Premium): live link + voice, automatically ----------
  async function onSOS() {
    if (!canLive()) return;
    const app = A();
    if (P.live) { if (P.live.status !== "sos") { P.live.status = "sos"; persistLive(); renderLive(); flushLive(true); } app.refreshSOS(); return; }
    if (!app.S.rec) {
      const vb = $("recvoice"); if (vb) vb.checked = !!P.settings.sosVoice;
      app.recStart(false);
    }
    await new Promise((r) => setTimeout(r, P.settings.sosVoice ? 1500 : 200)); // give the microphone a moment to start
    const rec = app.S.rec;
    await startLive({ who: myName(), eta: null, voice: !!(rec && rec.voice && rec.voice.ok && P.settings.sosVoice), status: "sos" });
    app.refreshSOS();
  }

  // ---------- small upsell on Trips for people without backup ----------
  function renderUpsell() {
    const v = $("v-trips"); if (!v) return; let u = $("pm-upsell");
    // Free users: a standing reminder that their trips live only on this phone.
    const show = !P.premium && (A().S.trips || []).some((t) => !t.sample);
    if (!show) { if (u) u.remove(); return; }
    if (!u) { u = document.createElement("div"); u.id = "pm-upsell"; u.className = "upsell warnbox"; v.insertBefore(u, v.firstChild); }
    u.innerHTML = `<span>⚠️ <b>Your trips are saved on this phone only.</b> If the phone is lost, stolen, damaged or reset, your trips and recordings are gone for good. ${ON ? "Premium keeps them safe online so you can get them back anytime, on any phone." : "Premium online backup is coming soon."}</span>${ON ? `<button class="btn sm primary" type="button">Keep my trips safe</button>` : ""}`;
    if (!ON) return;
    u.querySelector("button").onclick = () => { A().setTab("help"); setTimeout(() => $("acctsec") && $("acctsec").scrollIntoView({ behavior: "smooth" }), 50); };
  }

  // ---------- hooks from the app ----------
  const hooks = {
    ready: () => { renderAcct(); renderLive(); renderUpsell(); },
    recStart: () => { renderLive(); if (P.live && !P.live.audioId) { const r = A().S.rec; if (r && r.voice) P.live.audioId = r.voice.id; } },
    recFix: (p) => { if (!P.live) return; P.live.pending.push([p.lat, p.lon, p.t]); P.live.last = { lat: p.lat, lon: p.lon, acc: p.acc || null, t: p.t }; if (P.live.pending.length % 10 === 0) persistLive(); flushLive(false); },
    voiceChunk: (d) => { if (P.live && P.live.voice && (!P.live.audioId || P.live.audioId === d.audioId)) { P.live.audioId = d.audioId; P.live.uploads.push({ part: { seg: d.seg, c: d.c, start: d.start, mime: d.mime }, blob: d.blob }); flushLive(false); } },
    recStopped: () => { if (P.live) endLive("trip ended"); renderLive(); },
    tripSaved: (t) => { renderUpsell(); if (P.premium) syncSoon(); },
    tripDeleted: (t) => { if (P.premium && P.user && t.cloudAt) P.cloud.deleteTrip(t.id, t.audio && t.audio.id).catch(() => {}); setTimeout(renderUpsell, 0); },
    sos: () => { onSOS(); },
    sosLine: () => (P.live ? (P.live.voice ? "Live location and voice: " : "Live location: ") + liveLink(P.live.id) : ""),
  };
  // Private trips (vault.js) get first say; when it handles a call it returns a value.
  const SHARED = { ready: 1, signedIn: 1 };
  window.WBPremium = { on: (n, d) => {
    const V = window.WBVault; let r;
    if (V && V.on) { r = V.on(n, d); if (r !== undefined && !SHARED[n]) return r; }
    return hooks[n] ? hooks[n](d) : r;
  }, fetchVoice, sync: () => syncNow(false), enabled: ON, perksHTML,
    // App lock "Forgot PIN?": proves the account password (needs internet)
    checkPassword: async (pw) => { if (!P.cloud || !P.user || !P.user.email) throw new Error("not signed in"); await P.cloud.signIn(P.user.email, pw); return true; },
    _state: P };

  // ---------- start ----------
  function boot() {
    if (!window.WBApp) return setTimeout(boot, 50);
    hooks.ready();
    if (A().tripsReady) A().tripsReady.then(() => renderUpsell());
    if (!ON) return;
    if (P.live && !A().S.rec) { // the app closed while sharing live
      setTimeout(() => { if (P.live && !A().S.rec) { const box = $("livebox"); if (box) { renderLive(); const n = document.createElement("p"); n.className = "note"; n.textContent = "Your live link from your last trip is still open. Tap Stop sharing if you've arrived."; box.appendChild(n); } } }, 300);
    }
    const s = document.createElement("script"); s.src = "cloud.js"; s.async = true;
    s.onload = () => {
      try { P.cloud = window.WBCloud.create(CFG); } catch (e) { console.warn(e); return; }
      P.cloud.onUser(async (u) => {
        P.user = u; P.view = "signin";
        if (u) { try { setPremium(await P.cloud.premium(false)); } catch (e) { setPremium(localStorage.getItem(PKEY) === "active"); } rcSetup(); if (window.WBVault) WBVault.on("signedIn"); }
        else setPremium(false);
        renderAcct(); renderLive();
        if (P.live) flushLive(true);
      });
    };
    s.onerror = () => { const box = $("acctsec"); if (box) box.innerHTML = `<div class="pm"><h2>WakaBack Premium</h2><p class="note">Connect to the internet to sign in.</p></div>`; };
    document.body.appendChild(s);
    renderAcct();
  }
  boot();
})();
