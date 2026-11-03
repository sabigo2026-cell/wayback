// WakaBack Premium: Private trips.
// Hidden trips and their voice are encrypted on the phone (AES-GCM) with a random "vault key".
// The vault key is stored only in locked form: by the private password, by the recovery code,
// and (if the user chose "Let WakaBack help me recover") as a spare in the server's safe.
(function () {
  "use strict";
  const A = () => window.WBApp, PM = () => (window.WBPremium && window.WBPremium._state) || {};
  const $ = (id) => document.getElementById(id);
  const VKEY = "wayback.vault.v1";
  const PW_ITER = 200000, RC_ITER = 60000, LOCK_IDLE = 5 * 60e3, LOCK_AWAY = 60e3;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const pad5 = (n) => String(n).padStart(5, "0");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const newCode = () => { const r = rand(20); let c = ""; for (let i = 0; i < 20; i++) c += CODE_ABC[r[i] % 32]; return "WAKA-" + c.match(/.{4}/g).join("-"); };
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^WAKA/, "");

  async function kdf(secret, saltB64, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(saltB64), iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, bytes) { const iv = rand(12); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes); return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }; }
  async function open_(key, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(o.iv) }, key, fromB64(o.ct))); }
  const importVK = (raw) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  // ---------- stored vault ----------
  let M = null; // { v, mode:"recover"|"only", pw:{salt,iter,w}, rc:{salt,iter,w}, items:{id:{iv,ct,audio,up,vup}}, deleted:[], metaDirty, escrowed }
  try { M = JSON.parse(localStorage.getItem(VKEY) || "null"); } catch (e) {}
  const saveM = () => { try { M ? localStorage.setItem(VKEY, JSON.stringify(M)) : localStorage.removeItem(VKEY); } catch (e) {} };
  const V = { open: false, key: null, raw: null, normal: null, idle: 0, away: 0, view: null, pendingHide: null, msg: "", err: "" };

  async function wrapAll(raw, password, code) {
    const pwSalt = toB64(rand(16)), rcSalt = toB64(rand(16));
    return {
      pw: { salt: pwSalt, iter: PW_ITER, w: await seal(await kdf(password, pwSalt, PW_ITER), raw) },
      rc: { salt: rcSalt, iter: RC_ITER, w: await seal(await kdf(normCode(code), rcSalt, RC_ITER), raw) },
    };
  }
  async function setup(password, mode) {
    const raw = rand(32), code = newCode();
    const w = await wrapAll(raw, password, code);
    M = { v: 1, mode, ...w, items: {}, deleted: [], metaDirty: true, escrowed: false, at: Date.now() };
    saveM(); V.key = await importVK(raw); V.raw = raw;
    if (mode === "recover") escrow(raw);
    pushSoon();
    return code;
  }
  async function escrow(raw) {
    const P = PM(); if (!P.cloud || !P.user) return;
    try { await P.cloud.escrowStore(toB64(raw)); M.escrowed = true; saveM(); } catch (e) { console.warn("spare key will retry", e); }
  }
  async function keyFromPassword(pw) { const raw = await open_(await kdf(pw, M.pw.salt, M.pw.iter), M.pw.w); return raw; }
  async function keyFromCode(code) { const raw = await open_(await kdf(normCode(code), M.rc.salt, M.rc.iter), M.rc.w); return raw; }
  async function rekey(raw, password) { // new private password (+ new recovery code) for the same vault key
    const code = newCode(); const w = await wrapAll(raw, password, code);
    M.pw = w.pw; M.rc = w.rc; M.metaDirty = true; saveM(); pushSoon(); return code;
  }

  // ---------- trips in and out of the vault ----------
  const packTrip = (t) => ({ code: A().encodeTrip(t), name: t.name, created: t.created, audio: t.audio ? { id: t.audio.id, start: t.audio.start, dur: t.audio.dur || 0, mime: t.audio.mime || "audio/webm" } : null });
  async function sealTrip(t, key) {
    const it = await seal(key, enc.encode(JSON.stringify(packTrip(t))));
    const old = M.items[t.id] || {};
    M.items[t.id] = { ...it, audio: t.audio ? t.audio.id : null, up: false, vup: old.vup || 0, at: Date.now() };
  }
  async function unsealTrip(id, key) {
    const o = JSON.parse(dec.decode(await open_(key, M.items[id])));
    const t = A().decodeTrip(o.code); t.id = id; t.name = o.name || t.name; t.created = o.created || t.created; delete t.shared; t.private = true;
    if (o.audio) t.audio = { ...o.audio, fetched: true };
    return t;
  }
  async function sealVoice(audioId, key) { // plain voice → encrypted copy, then delete the plain one
    const rows = await A().vGetAll(audioId);
    for (const r of rows) {
      const iv = rand(12); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await r.blob.arrayBuffer());
      await A().vPut({ k: "x" + audioId + ":" + pad5(r.seg) + ":" + pad5(r.c), seg: r.seg, c: r.c, start: r.start, mime: r.mime, iv, ct });
    }
    await A().vDelete(audioId);
    return rows.length;
  }
  async function encRows(audioId, mime) {
    let rows = await A().vGetAll("x" + audioId);
    if (!rows.length) rows = await fetchVoice(audioId, mime);
    return rows;
  }
  async function plainRows(audioId, key, mime) {
    const rows = await encRows(audioId, mime); const out = [];
    for (const r of rows) {
      try { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv }, key, r.ct); out.push({ seg: r.seg, c: r.c, start: r.start, mime: r.mime, blob: new Blob([pt], { type: (r.mime || "audio/webm").split(";")[0] }) }); } catch (e) {}
    }
    return out;
  }
  async function hideTrip(t, key) {
    const app = A();
    if (t.audio) await sealVoice(t.audio.id, key);
    await sealTrip(t, key); saveM();
    const P = PM();
    if (t.cloudAt && P.cloud && P.user) P.cloud.deleteTrip(t.id, t.audio && t.audio.id).catch(() => {}); // remove the plain backup
    app.S.trips = app.S.trips.filter((x) => x.id !== t.id);
    if (app.S.selId === t.id) app.S.selId = app.S.trips[0] ? app.S.trips[0].id : null;
    app.saveTripsRaw(app.S.trips); app.voiceRelease(); app.renderAll(); pushSoon();
  }
  async function unhideTrip(t) {
    const app = A(), key = V.key; if (!key) return;
    if (t.audio) {
      const rows = await plainRows(t.audio.id, key, t.audio.mime);
      for (const r of rows) await app.vPut({ k: t.audio.id + ":" + pad5(r.seg) + ":" + pad5(r.c), seg: r.seg, c: r.c, start: r.start, mime: r.mime, blob: r.blob });
      await app.vDelete("x" + t.audio.id);
      t.audio = { id: t.audio.id, start: t.audio.start, dur: t.audio.dur, mime: t.audio.mime };
    }
    delete M.items[t.id]; M.deleted.push(t.id); saveM();
    delete t.private; delete t.cloudAt; t.cloudDirty = true;
    app.S.trips = app.S.trips.filter((x) => x.id !== t.id);
    V.normal.unshift(t); app.saveTripsRaw(V.normal);
    app.voiceRelease(); app.renderAll(); renderBar(); pushSoon();
  }

  // ---------- open / lock ----------
  async function openVault(raw) {
    const app = A(); V.raw = raw; V.key = await importVK(raw);
    const list = [];
    for (const id of Object.keys(M.items)) { try { list.push(await unsealTrip(id, V.key)); } catch (e) { console.warn("could not open", id); } }
    list.sort((a, b) => (b.created || 0) - (a.created || 0));
    if (!V.open) V.normal = app.S.trips;
    V.open = true; app.S.trips = list; app.S.selId = list[0] ? list[0].id : null;
    app.voiceRelease(); app.setTab("trips"); app.renderAll(); renderBar(); touch();
  }
  function lock() {
    if (!V.open) return;
    const app = A();
    app.S.trips = V.normal || []; V.normal = null; V.open = false; V.key = null; V.raw = null;
    app.S.selId = app.S.trips[0] ? app.S.trips[0].id : null;
    try { app.voiceRelease(); } catch (e) {}
    app.renderAll(); renderBar();
    setTimeout(() => { if (window.WBPremium && WBPremium.sync) WBPremium.sync(); }, 500); // back up trips moved out of Private
  }
  function touch() { V.idle = Date.now(); }
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => document.addEventListener(ev, touch, { passive: true, capture: true }));
  const busyNow = () => { const S = A() && A().S; return !!(S && (S.rec || (S.back && !S.back.arrived))); };
  setInterval(() => { if (V.open && !busyNow() && Date.now() - V.idle > LOCK_IDLE) lock(); }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") V.away = Date.now();
    else if (V.open && V.away && Date.now() - V.away > LOCK_AWAY && !busyNow()) lock();
  });
  window.addEventListener("pagehide", () => { if (!busyNow()) lock(); });

  // ---------- online backup of the vault (still encrypted) ----------
  let pushT = null, pushing = false;
  function pushSoon() { clearTimeout(pushT); pushT = setTimeout(push, 1500); }
  async function push() {
    const P = PM(); if (!M || !P.premium || !P.user || !P.cloud || pushing) return;
    pushing = true;
    try {
      if (M.mode === "recover" && !M.escrowed && V.raw) await escrow(V.raw);
      if (M.metaDirty) { await P.cloud.vaultMetaPut({ v: M.v, mode: M.mode, pw: M.pw, rc: M.rc }); M.metaDirty = false; saveM(); }
      for (const id of Object.keys(M.items)) {
        const it = M.items[id];
        if (!it.up) { await P.cloud.vaultPut(id, { iv: it.iv, ct: it.ct, audio: it.audio || null }); it.up = true; saveM(); }
        if (it.audio) {
          const rows = await A().vGetAll("x" + it.audio);
          if (rows.length > (it.vup || 0)) {
            const path = P.cloud.vaultVoicePath(it.audio);
            for (const r of rows.slice(it.vup || 0)) {
              const blob = new Blob([r.iv, r.ct], { type: "audio/x-wakaback-encrypted" });
              await P.cloud.putVoice(path, { seg: r.seg, c: r.c, start: r.start, mime: "audio/x-wakaback-encrypted" }, blob);
              it.vup = (it.vup || 0) + 1; saveM();
            }
          }
        }
      }
      while (M.deleted.length) { const id = M.deleted[0]; await P.cloud.vaultDelete(id).catch(() => {}); M.deleted.shift(); saveM(); }
    } catch (e) { console.warn("private backup will retry", e); }
    pushing = false;
  }
  async function pull() { // new phone: bring the locked vault down from the account
    const P = PM(); if (!P.user || !P.cloud) return;
    try {
      const meta = await P.cloud.vaultMetaGet(); if (!meta) return;
      if (!M) { M = { ...meta, items: {}, deleted: [], metaDirty: false, escrowed: meta.mode === "recover" }; }
      else if (M.pw.salt !== meta.pw.salt) return; // a different vault was set up on this phone; keep it
      const items = await P.cloud.vaultList();
      for (const it of items) if (!M.items[it.id] && !M.deleted.includes(it.id)) M.items[it.id] = { iv: it.iv, ct: it.ct, audio: it.audio || null, up: true, vup: 1e9 };
      saveM(); renderEntry();
    } catch (e) { console.warn(e); }
  }
  async function fetchVoice(audioId, mime) {
    const P = PM(); if (!P.user || !P.cloud) return [];
    try {
      const path = P.cloud.vaultVoicePath(audioId); const parts = await P.cloud.listVoice(path); const out = [];
      for (const p of parts) {
        const b = new Uint8Array(await (await P.cloud.getVoice(path, p.name)).arrayBuffer());
        const row = { k: "x" + audioId + ":" + pad5(p.seg) + ":" + pad5(p.c), seg: p.seg, c: p.c, start: p.start, mime: mime || "audio/webm", iv: b.slice(0, 12), ct: b.slice(12).buffer };
        await A().vPut(row); out.push(row);
      }
      return out;
    } catch (e) { return []; }
  }
  setInterval(() => { if (M && (M.metaDirty || M.deleted.length || Object.values(M.items).some((i) => !i.up))) push(); }, 20000);

  // ---------- screens ----------
  const css = document.createElement("style");
  css.textContent = `
  #pvbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--fg);color:var(--bg);border-radius:14px 14px 0 0;padding:8px 12px;font-weight:600}
  #pvbar .btn{background:var(--bg);color:var(--fg);border-color:var(--bg)}
  .pventry{display:flex;justify-content:flex-end}
  .pv h2{font-family:var(--f-display);font-size:1.25rem;margin:0}
  .pv{display:flex;flex-direction:column;gap:10px}
  .pv input[type=password],.pv input[type=text]{border:1px solid var(--line);border-radius:9px;padding:10px;background:var(--bg);width:100%;min-width:0;font:inherit;color:var(--fg)}
  .pv .code{font-family:var(--f-mono);font-size:1.05rem;letter-spacing:.04em;text-align:center;padding:12px;user-select:all}
  .pv .opt{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:10px;cursor:pointer}
  .pv .opt input{margin-top:4px;width:18px;height:18px;accent-color:var(--accent)}
  .pv .opt b{display:block}.pv .opt span{font-size:.84rem;color:var(--muted)}
  .pv .err{color:var(--warn);font-size:.88rem;margin:0}.pv .ok{color:var(--accent);font-weight:600;margin:0}
  .pv .links{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
  .pv .linkbtn{background:none;border:0;padding:0;color:var(--accent);font-weight:600;cursor:pointer;font:inherit;text-decoration:underline}`;
  document.head.appendChild(css);
  const sheet = document.createElement("div");
  sheet.className = "sheet"; sheet.id = "pvsheet"; sheet.hidden = true; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
  sheet.innerHTML = `<div class="card pv" id="pvcard"></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  const closeSheet = () => { sheet.hidden = true; V.view = null; V.msg = V.err = ""; V.pendingHide = null; };
  function show(view, extra) { V.view = view; Object.assign(V, extra || {}); sheet.hidden = false; renderSheet(); }

  async function renderSheet() {
    const c = $("pvcard"); const P = PM(); const email = P.user && P.user.email;
    const msg = (V.err ? `<p class="err" role="alert">${esc(V.err)}</p>` : "") + (V.msg ? `<p class="ok" role="status">${esc(V.msg)}</p>` : "");
    if (V.view === "setup") c.innerHTML = `<h2>Set up Private trips</h2>
      <p class="note">Hidden trips are locked with a <b>private password</b> that's separate from your account password. Someone who signs in with your account won't see them.</p>
      <input type="password" id="pv-p1" placeholder="Private password (at least 6 characters)" autocomplete="new-password" aria-label="Private password">
      <input type="password" id="pv-p2" placeholder="Type it again" autocomplete="new-password" aria-label="Type the private password again">
      <p class="note">Use a different password from your account password.</p>
      <div class="eyebrow">If you forget it</div>
      <label class="opt"><input type="radio" name="pv-mode" value="recover" checked><div><b>Let WakaBack help me recover</b><span>Reset it through ${esc(email || "your account email")}. For your safety a reset takes 7 days and we email you a warning.</span></div></label>
      <label class="opt"><input type="radio" name="pv-mode" value="only"><div><b>Only me</b><span>Strongest privacy. If you forget the password and lose your recovery code, hidden trips are lost forever.</span></div></label>
      ${msg}<div class="row"><button class="btn primary" id="pv-go" type="button">Continue</button><button class="btn" id="pv-x" type="button">Cancel</button></div>`;
    else if (V.view === "code") c.innerHTML = `<h2>Your recovery code</h2>
      <p class="note">Write this down and keep it somewhere safe (not only on this phone). It opens your Private trips if you forget the password.</p>
      <div class="code" id="pv-code">${esc(V.code)}</div>
      <div class="row"><button class="btn sm" id="pv-copy" type="button">Copy code</button></div>
      <label class="sw" style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="pv-saved" style="width:20px;height:20px"> I've written it down</label>
      <div class="row"><button class="btn primary" id="pv-done" type="button" disabled>Done</button></div>`;
    else if (V.view === "unlock") c.innerHTML = `<h2>${V.pendingHide ? "Hide this trip" : "Private trips"}</h2>
      <p class="note">${V.pendingHide ? "Enter your private password to hide “" + esc(V.pendingHide.name) + "”." : "Enter your private password."}</p>
      <form id="pv-form"><input type="password" id="pv-pw" placeholder="Private password" autocomplete="current-password" aria-label="Private password"></form>
      ${msg}<div class="row"><button class="btn primary" id="pv-go" type="button">${V.pendingHide ? "Hide trip" : "Open"}</button><button class="btn" id="pv-x" type="button">Cancel</button></div>
      <div class="links"><button class="linkbtn" id="pv-usecode" type="button">Use my recovery code</button>
      ${M && M.mode === "recover" ? `<button class="linkbtn" id="pv-forgot" type="button">Forgot private password? Reset by email</button>` : ""}</div>`;
    else if (V.view === "usecode") c.innerHTML = `<h2>Use your recovery code</h2>
      <input type="text" id="pv-rc" placeholder="WAKA-XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" aria-label="Recovery code">
      ${msg}<div class="row"><button class="btn primary" id="pv-go" type="button">Open</button><button class="btn" id="pv-back" type="button">Back</button></div>`;
    else if (V.view === "newpw") c.innerHTML = `<h2>Set a new private password</h2>
      <input type="password" id="pv-p1" placeholder="New private password (at least 6 characters)" autocomplete="new-password" aria-label="New private password">
      <input type="password" id="pv-p2" placeholder="Type it again" autocomplete="new-password" aria-label="Type it again">
      ${msg}<div class="row"><button class="btn primary" id="pv-go" type="button">Save</button></div>`;
    else if (V.view === "forgot") {
      c.innerHTML = `<h2>Reset your private password</h2><p class="note">Checking…</p>`;
      let st = { state: "none" };
      try { st = await P.cloud.escrowStatus(); } catch (e) { V.err = "You need internet to reset by email."; }
      if (V.view !== "forgot") return;
      const when = st.readyAt ? new Date(st.readyAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
      let body = "";
      if (st.state === "none") body = `<p class="note">We'll email <b>${esc(email)}</b> a link to confirm. After you confirm, there's a <b>7-day wait</b> for your safety, then you can set a new private password and your hidden trips open again.</p>
        <div class="row"><button class="btn primary" id="pv-req" type="button">Email me a reset link</button><button class="btn" id="pv-back" type="button">Back</button></div>`;
      else if (st.state === "requested") body = `<p class="note">We sent a link to <b>${esc(email)}</b>. Open the email and tap <b>Confirm reset</b>. Then the 7-day wait starts.</p>
        <div class="row"><button class="btn" id="pv-req" type="button">Send the email again</button><button class="btn danger" id="pv-cancel" type="button">Cancel reset</button><button class="btn" id="pv-x" type="button">Close</button></div>`;
      else if (st.state === "waiting") body = `<p class="note">Reset confirmed. You can set a new private password on <b>${esc(when)}</b>.</p><p class="note">Didn't ask for this? Cancel now and change your account password.</p>
        <div class="row"><button class="btn danger" id="pv-cancel" type="button">Cancel reset</button><button class="btn" id="pv-x" type="button">Close</button></div>`;
      else if (st.state === "ready") body = `<p class="ok">Your reset is ready.</p><div class="row"><button class="btn primary" id="pv-release" type="button">Set a new private password</button><button class="btn" id="pv-x" type="button">Close</button></div>`;
      c.innerHTML = `<h2>Reset your private password</h2>${body}${V.err ? `<p class="err">${esc(V.err)}</p>` : ""}${V.msg ? `<p class="ok">${esc(V.msg)}</p>` : ""}`;
    }
    wire();
    const f = c.querySelector("input"); if (f) setTimeout(() => f.focus(), 0);
  }
  function wire() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    const P = PM();
    on("pv-x", closeSheet);
    on("pv-back", () => show("unlock", { err: "", msg: "" }));
    on("pv-usecode", () => show("usecode", { err: "", msg: "" }));
    on("pv-forgot", () => show("forgot", { err: "", msg: "" }));
    const f = $("pv-form"); if (f) f.onsubmit = (e) => { e.preventDefault(); $("pv-go").click(); };
    if (V.view === "setup") on("pv-go", async () => {
      const a = $("pv-p1").value, b = $("pv-p2").value; const mode = (document.querySelector('input[name="pv-mode"]:checked') || {}).value || "recover";
      if (a.length < 6) return err("Use at least 6 characters."); if (a !== b) return err("The two passwords don't match.");
      busyBtn(); const code = await setup(a, mode);
      const t = V.pendingHide; V.pendingHide = null;
      if (t) await hideTrip(t, V.key);
      V.key = null; V.raw = null; show("code", { code, err: "", msg: "" }); renderEntry();
    });
    if (V.view === "code") {
      on("pv-copy", () => { try { navigator.clipboard.writeText(V.code).then(() => ($("pv-copy").textContent = "Copied")); } catch (e) {} });
      const cb = $("pv-saved"); if (cb) cb.onchange = () => ($("pv-done").disabled = !cb.checked);
      on("pv-done", () => { closeSheet(); if (V.afterCode) { const f2 = V.afterCode; V.afterCode = null; f2(); } });
    }
    if (V.view === "unlock") on("pv-go", async () => {
      const pw = $("pv-pw").value; if (!pw) return err("Enter your private password.");
      busyBtn(); let raw;
      try { raw = await keyFromPassword(pw); } catch (e) { return err("That private password isn't right."); }
      const t = V.pendingHide;
      if (t) { await hideTrip(t, await importVK(raw)); closeSheet(); flash("Trip hidden. Open it from 🔒 Private."); return; }
      closeSheet(); await openVault(raw);
    });
    if (V.view === "usecode") on("pv-go", async () => {
      busyBtn(); let raw;
      try { raw = await keyFromCode($("pv-rc").value); } catch (e) { return err("That recovery code isn't right. Check each letter."); }
      V.raw = raw; show("newpw", { err: "", msg: "" });
    });
    if (V.view === "newpw") on("pv-go", async () => {
      const a = $("pv-p1").value, b = $("pv-p2").value;
      if (a.length < 6) return err("Use at least 6 characters."); if (a !== b) return err("The two passwords don't match.");
      busyBtn(); const raw = V.raw; const code = await rekey(raw, a);
      show("code", { code, err: "", msg: "", afterCode: () => openVault(raw) });
    });
    if (V.view === "forgot") {
      on("pv-req", async () => { try { await P.cloud.escrowRequest(); V.msg = "Email sent. Check your inbox (and spam)."; V.err = ""; } catch (e) { V.err = /no spare|not-found/i.test(String(e.code || e.message)) ? "Email reset isn't set up for these Private trips. Use your recovery code." : "Couldn't send the email. Check your internet."; } renderSheet(); });
      on("pv-cancel", async () => { try { await P.cloud.escrowCancel(); V.msg = "Reset cancelled."; } catch (e) { V.err = "Couldn't cancel. Check your internet."; } renderSheet(); });
      on("pv-release", async () => {
        try { const b64 = await P.cloud.escrowRelease(); V.raw = fromB64(b64); show("newpw", { err: "", msg: "" }); }
        catch (e) { V.err = "The reset isn't ready yet."; renderSheet(); }
      });
    }
  }
  function err(m) { V.err = m; V.msg = ""; renderSheet(); }
  function busyBtn() { const b = $("pv-go"); if (b) { b.disabled = true; b.textContent = "Please wait…"; } }
  function flash(m) { const n = $("importnote"); if (n) { n.className = "note"; n.textContent = m; } }

  // ---------- entry button, private bar ----------
  function canUse() { const P = PM(); return !!(P.premium || M); }
  function renderEntry() {
    const v = $("v-trips"); if (!v) return; let e = $("pv-entry");
    const show_ = canUse() && !V.open;
    if (!show_) { if (e) e.remove(); return; }
    if (!e) { e = document.createElement("div"); e.id = "pv-entry"; e.className = "pventry"; v.insertBefore(e, v.firstChild); }
    e.innerHTML = `<button class="btn sm" type="button">🔒 Private</button>`;
    e.querySelector("button").onclick = () => { if (!M) { if (!PM().premium) return; show("setup", { err: "", msg: "" }); } else show("unlock", { pendingHide: null, err: "", msg: "" }); };
  }
  function renderBar() {
    let b = $("pvbar");
    if (!V.open) { if (b) b.remove(); renderEntry(); return; }
    if (!b) { b = document.createElement("div"); b.id = "pvbar"; const panel = document.querySelector(".app .panel"); panel && panel.insertBefore(b, panel.firstChild); }
    const n = A().S.trips.length;
    b.innerHTML = `<span>🔒 Private trips (${n})</span><button class="btn sm" id="pv-home" type="button">🏠 Home</button>`;
    $("pv-home").onclick = lock;
    renderEntry();
  }

  // ---------- hooks from the app (called through premium.js) ----------
  const hooks = {
    ready: () => { renderEntry(); },
    saveTrips: () => { if (!V.open) return undefined; const key = V.key; const list = A().S.trips.slice();
      (async () => { for (const t of list) { t.private = true; await sealTrip(t, key); } saveM(); pushSoon(); renderBar(); })(); return true; },
    tripSaved: (t) => { if (V.open && t.audio) { const key = V.key; setTimeout(() => sealVoice(t.audio.id, key).then(() => { t.audio.fetched = true; }), 4000); } return V.open ? true : undefined; },
    tripDeleted: (t) => { if (!V.open) return undefined; delete M.items[t.id]; M.deleted.push(t.id); saveM(); if (t.audio) A().vDelete("x" + t.audio.id); pushSoon(); setTimeout(renderBar, 0); return true; },
    tripButtons: (t) => {
      const app = A();
      if (V.open) return [app.mk("Unhide", "btn sm", () => unhideTrip(t))];
      if (!PM().premium || t.sample) return [];
      return [app.mk("🔒 Hide", "btn sm", () => { if (!M) show("setup", { pendingHide: t, err: "", msg: "" }); else show("unlock", { pendingHide: t, err: "", msg: "" }); })];
    },
    vaultRows: (t) => (V.open && t.private && t.audio && V.key ? plainRows(t.audio.id, V.key, t.audio.mime) : undefined),
    signedIn: () => { pull(); push(); },
  };
  window.WBVault = { on: (n, d) => (hooks[n] ? hooks[n](d) : undefined), isOpen: () => V.open, lock, renderEntry, _m: () => M };
  const boot = () => { if (!window.WBApp) return setTimeout(boot, 60); renderEntry(); };
  boot();
})();
