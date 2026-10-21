// src/scripts/kidtube-admin.js
import { publishVideo } from '/js/server-upload-v1.js';
(() => {
  const root = document.getElementById("tza-root");
  if (!root || window.__tzaMounted) return;
  window.__tzaMounted = true;
  const SESS = "kid-session";
  const esc = (s2) => String(s2 == null ? "" : s2).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;").split("'").join("&#39;");
  const b64u = (s2) => btoa(String.fromCharCode(...new TextEncoder().encode(s2))).split("+").join("-").split("/").join("_").split("=").join("");
  const sessRead = () => {
    try {
      const s2 = JSON.parse(localStorage.getItem(SESS) || "null");
      return s2 && s2.email && s2.exp && s2.exp > Date.now() ? s2 : null;
    } catch (err) {
      return null;
    }
  };
  const sessWrite = (s2) => {
    try {
      localStorage.setItem(SESS, JSON.stringify(s2));
    } catch (err) {
    }
  };
  const sessClear = () => {
    try {
      localStorage.removeItem(SESS);
    } catch (err) {
    }
  };
  const apiPost = async (path, body) => {
    try {
      return await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    } catch (err) {
      return null;
    }
  };
  const staff = () => {
    const s2 = sessRead();
    return s2 && s2.t && (s2.role === "admin" || s2.role === "super") ? s2 : null;
  };
  const isSuper = () => {
    const s2 = sessRead();
    return !!(s2 && s2.t && s2.role === "super");
  };
  const css = document.createElement("style");
  css.id = "tza-style";
  css.textContent = `
.tza-wrap{--tza-line:rgba(247,244,236,.22);--tza-dim:rgba(247,244,236,.55)}
.tztab{display:flex;gap:2px;border-bottom:1px solid var(--tza-line);margin:0 0 18px;flex-wrap:wrap}
.tztab button{appearance:none;background:none;border:none;color:var(--tza-dim);font:500 11px/1 'DM Mono',monospace;
  letter-spacing:.16em;text-transform:uppercase;padding:10px 14px;cursor:pointer;border-bottom:2px solid transparent}
.tztab button[aria-selected='true']{color:#F7F4EC;border-bottom-color:#3265FF}
.tztab button:hover{color:#F7F4EC}
.tzrow{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(247,244,236,.12);font-size:12px}
.tzrow .pos{width:26px;color:var(--tza-dim);text-align:right}
.tzrow .ttl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tzrow input.tzren{flex:1;background:rgba(247,244,236,.08);border:1px solid var(--tza-line);color:#F7F4EC;font:12px 'DM Mono',monospace;padding:4px 8px}
.tzbtn{appearance:none;background:none;border:1px solid var(--tza-line);color:#F7F4EC;font:500 10px/1 'DM Mono',monospace;
  letter-spacing:.14em;text-transform:uppercase;padding:7px 11px;cursor:pointer;border-radius:2px}
.tzbtn:hover{border-color:#3265FF;color:#3265FF}
.tzbtn.primary{border-color:#3265FF;color:#3265FF}
.tzbtn.primary:hover{background:#3265FF;color:#05060A}
.tzbtn:disabled{opacity:.4;cursor:default}
.tzmini{padding:4px 8px;font-size:9px}
.tznote{color:var(--tza-dim);font-size:11px;letter-spacing:.06em;margin:10px 0}
.tzerr{color:#3265FF;font-size:11px;letter-spacing:.06em;min-height:16px;margin:8px 0}
.tzform{display:flex;flex-direction:column;gap:10px;max-width:420px;margin:18px 0}
.tzform label{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--tza-dim)}
.tzform input,.tzform select{background:rgba(247,244,236,.08);border:1px solid var(--tza-line);color:#F7F4EC;
  font:13px 'DM Mono',monospace;padding:9px 10px;border-radius:2px}
.tzstats{display:flex;gap:26px;margin:4px 0 16px;flex-wrap:wrap}
.tzstat b{display:block;font-size:22px;color:#F7F4EC}
.tzstat span{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--tza-dim)}
.tzcard{border:1px solid rgba(247,244,236,.14);padding:12px 14px;margin:10px 0;font-size:12px}
.tzcard .who{color:#3265FF;letter-spacing:.08em}
.tzwho{color:var(--tza-dim);font-size:11px;letter-spacing:.08em}
.tzna-card{position:fixed;inset:0;z-index:230;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(5,6,10,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.tzna-in{width:100%;max-width:380px;background:#0B0D13;border:1px solid rgba(247,244,236,.28);border-radius:4px;
  padding:18px 18px 14px;color:#F7F4EC;font:500 12px/1.5 'DM Mono',monospace;box-shadow:0 18px 60px rgba(5,6,10,.7)}
.tzna-kick{margin:0 0 10px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#3265FF}
.tzna-lbl{display:block;margin:0 0 6px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(247,244,236,.6)}
.tzna-in input{width:100%;box-sizing:border-box;background:rgba(247,244,236,.07);border:1px solid rgba(247,244,236,.3);
  border-radius:2px;color:#F7F4EC;font:500 14px/1 'DM Mono',monospace;padding:11px 10px}
.tzna-in input:focus{outline:none;border-color:#3265FF}
.tzna-meta{margin:8px 0 14px;font-size:10px;letter-spacing:.1em;color:rgba(247,244,236,.5)}
.tzna-acts{display:flex;gap:8px;justify-content:flex-end}
.tzna-acts button{appearance:none;background:none;border:1px solid rgba(247,244,236,.3);color:#F7F4EC;
  font:500 10px/1 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;padding:10px 13px;border-radius:2px;cursor:pointer}
.tzna-go{border-color:#3265FF;color:#3265FF}
.tzna-go:hover{background:#3265FF;color:#05060A}`;
  document.head.appendChild(css);
  let data = null;
  let tab = "videos";
  let note = "";
  let lastGuestCode = null;
  const say = (m) => {
    note = m;
    render();
  };
  async function load() {
    const s2 = staff();
    if (!s2) return;
    const j = await fetch("/api/admin/overview?e=" + b64u(s2.email) + "&t=" + encodeURIComponent(s2.t)).then((r) => r.json()).catch(() => null);
    if (!j || !j.ok) {
      if (j && j.error === "not authorized") {
        sessClear();
        renderLogin("Your session expired. Log in again.");
        return;
      }
      say("Could not reach the channel.");
      return;
    }
    data = j;
    render();
  }
  function renderLogin(msg) {
    root.innerHTML = `
      <p class='tznote'>${esc(msg || "Sign in with a Parent dashboard staff account.")}</p>
      <form class='tzform' id='tza-login'>
        <label for='tza-e'>Email</label>
        <input id='tza-e' type='email' autocomplete='username' required>
        <label for='tza-p'>Password</label>
        <input id='tza-p' type='password' autocomplete='current-password' required>
        <p class='tzerr' id='tza-err'></p>
        <button class='tzbtn primary' type='submit'>Open the panel</button>
      </form>`;
    const f = root.querySelector("#tza-login");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = f.querySelector("#tza-e").value.trim().toLowerCase();
      const pass = f.querySelector("#tza-p").value;
      const err = root.querySelector("#tza-err");
      err.textContent = "Checking...";
      const j = await apiPost("/api/login", { email, pass });
      if (!j || !j.ok) {
        err.textContent = j && j.error || "Login failed.";
        return;
      }
      if (j.role !== "admin" && j.role !== "super") {
        err.textContent = "This panel is for Parent dashboard staff.";
        return;
      }
      sessWrite({ email, exp: Date.now() + 60 * 864e5, t: j.t, role: j.role });
      note = "";
      load();
    });
  }
  function render() {
    const s2 = staff();
    if (!s2) {
      renderLogin();
      return;
    }
    if (!data) {
      root.innerHTML = '<p class="tznote">Loading...</p>';
      return;
    }
    const tabs = [["videos", "Videos"], ["guestCodes", "Guest codes"], ["approvals", "Approvals"], ["people", "People"], ["analytics", "Analytics"]].filter((t) => isSuper() || t[0] !== "approvals" && t[0] !== "people");
    const pending = (data.accounts || []).filter((a) => a.status === "pending").length;
    root.innerHTML = `
      <p class='tzwho'>Signed in: ${esc(s2.email)} \xB7 ${esc(s2.role)} \xB7 <button class='tzbtn tzmini' id='tza-out' type='button'>Log out</button></p>
      <div class='tztab' role='tablist'>${tabs.map((t) => `<button role='tab' aria-selected='${t[0] === tab}' data-tab='${t[0]}'>${t[1]}${t[0] === "approvals" && pending ? " (" + pending + ")" : ""}</button>`).join("")}</div>
      <p class='tzerr'>${esc(note)}</p>
      <div id='tza-pane'></div>`;
    note = "";
    root.querySelector("#tza-out").addEventListener("click", async () => {
      await apiPost('/api/logout', {});
      sessClear();
      renderLogin("Signed out.");
    });
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      render();
    }));
    const pane = root.querySelector("#tza-pane");
    if (tab === "videos") renderVideos(pane);
    else if (tab === "guestCodes") renderGuestCodes(pane);
    else if (tab === "approvals") renderApprovals(pane);
    else if (tab === "people") renderPeople(pane);
    else renderAnalytics(pane);
  }
  function auth(extra) {
    const s2 = staff();
    return Object.assign({ email: s2.email, t: s2.t }, extra || {});
  }
  function renderGuestCodes(pane) {
    pane.innerHTML = `
      <div class='tzcard'>
        <div class='who'>One-time guest access</div>
        <p class='tznote'>Share a four-character code with one person. It can be entered once within 24 hours. After entry, they can watch for 24 hours but cannot like or comment.</p>
        <button class='tzbtn primary' id='tza-generate-code' type='button'>Generate code</button>
        ${lastGuestCode ? `<p class='tznote'>Give this code to your guest:</p><p id='tza-guest-result' style='font:700 32px/1.2 monospace;letter-spacing:.2em;color:#3265FF'>${esc(lastGuestCode.code)}</p><p class='tznote'>Enter by ${esc(new Date(lastGuestCode.expires).toLocaleString())}. This code is shown only here.</p><button class='tzbtn' id='tza-copy-code' type='button'>Copy code</button>` : ''}
      </div>`;
    pane.querySelector("#tza-generate-code").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await apiPost("/api/guest/generate", auth());
      if (!result?.ok) { say(result?.error || "Could not generate a code."); return; }
      lastGuestCode = { code: result.code, expires: result.expires };
      render();
    });
    pane.querySelector("#tza-copy-code")?.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(lastGuestCode.code);
        event.currentTarget.textContent = "Copied";
      } catch {
        event.currentTarget.textContent = "Select the code above to copy";
      }
    });
  }
  function renderVideos(pane) {
    const clips = data.clips || [];
    pane.innerHTML = `
      <div class='tzstats'>
        <div class='tzstat'><b>${clips.length}</b><span>clips</span></div>
        <div class='tzstat'><b>${clips.reduce((a, c) => a + (c.likes || 0), 0)}</b><span>hearts</span></div>
        <div class='tzstat'><b>${clips.reduce((a, c) => a + (c.comments || 0), 0)}</b><span>comments</span></div>
      </div>
      <form class='tzform' id='tza-up'>
        <label for='tza-file'>Upload a video (up to 5 minutes)</label>
        <input id='tza-file' type='file' accept='video/*'>
        <p class='tznote' id='tza-upnote'>You name it next; the server converts it to 480p, then adds it to the top of the reel.</p>
        <button class='tzbtn primary' type='submit'>Upload</button>
      </form>
      <div id='tza-cliplist'></div>`;
    const list = pane.querySelector("#tza-cliplist");
    list.innerHTML = clips.map((c, i) => `
      <div class='tzrow' data-id='${esc(c.id)}'>
        <span class='pos'>${i + 1}</span>
        <span class='ttl' title='${esc(c.title)}'>${esc(c.title)}</span>
        <span class='tznote' style='margin:0'>${c.likes || 0}\u2665 ${c.comments || 0}\u{1F4AC}</span>
        <button class='tzbtn tzmini' data-act='up' ${i === 0 ? "disabled" : ""} type='button'>Up</button>
        <button class='tzbtn tzmini' data-act='down' ${i === clips.length - 1 ? "disabled" : ""} type='button'>Down</button>
        <button class='tzbtn tzmini' data-act='ren' type='button'>Rename</button>
        <button class='tzbtn tzmini' data-act='del' type='button'>Delete</button>
      </div>`).join("");
    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const row = btn.closest(".tzrow");
      const id = row.dataset.id;
      const act = btn.dataset.act;
      if (act === "ren") {
        const ttl = row.querySelector(".ttl");
        const inp = document.createElement("input");
        inp.className = "tzren";
        inp.value = ttl.textContent;
        ttl.replaceWith(inp);
        inp.focus();
        inp.addEventListener("keydown", async (ev) => {
          if (ev.key !== "Enter") return;
          const r2 = await apiPost("/api/clips/rename", auth({ id, title: inp.value }));
          if (r2 && r2.ok) {
            say("Renamed.");
            load();
          } else say(r2 && r2.error || "Rename failed.");
        });
        return;
      }
      if (act === "del") {
        if (!confirm("Delete this clip for everyone?")) return;
        const r2 = await apiPost("/api/clips/delete", auth({ id }));
        say(r2 && r2.ok ? "Deleted." : r2 && r2.error || "Delete failed.");
        load();
        return;
      }
      const ids = clips.map((c) => c.id);
      const i = ids.indexOf(id);
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      const swapped = ids.slice();
      swapped[i] = ids[j];
      swapped[j] = ids[i];
      const r = await apiPost("/api/clips/reorder", auth({ order: swapped }));
      if (r && r.ok) load();
      else say(r && r.error || "Reorder failed.");
    });
    pane.querySelector("#tza-up").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = pane.querySelector("#tza-file").files[0];
      if (!f) {
        say("Pick a video first.");
        return;
      }
      await panelUpload(f, pane);
    });
  }
  function parseMp4Duration(u8) {
    for (let i = 4; i <= u8.length - 24; i++) {
      if (u8[i] === 109 && u8[i + 1] === 118 && u8[i + 2] === 104 && u8[i + 3] === 100) {
        const dv = new DataView(u8.buffer, u8.byteOffset + i + 4);
        const ver = u8[i + 4];
        let ts, dur;
        if (ver === 1) {
          ts = dv.getUint32(20);
          dur = Number(dv.getBigUint64(24));
        } else {
          ts = dv.getUint32(12);
          dur = dv.getUint32(16);
        }
        if (ts > 0 && dur > 0) return dur / ts;
        return 0;
      }
    }
    return 0;
  }
  function parseWebmDuration(u8) {
    for (let i = 0; i <= u8.length - 11; i++) {
      if (u8[i] === 68 && u8[i + 1] === 137 && (u8[i + 2] === 132 || u8[i + 2] === 136)) {
        const dv = new DataView(u8.buffer, u8.byteOffset + i + 3);
        const d = u8[i + 2] === 132 ? dv.getFloat32(0) : dv.getFloat64(0);
        if (d > 0 && Number.isFinite(d)) return d / 1e3;
      }
    }
    return webmClusterSeconds(u8);
  }
  function ebmlVintLen(b) {
    for (let i = 0; i < 8; i++) {
      if (b & 128 >> i) return i + 1;
    }
    return 0;
  }
  function ebmlTimecode(u8, at) {
    const n = ebmlVintLen(u8[at + 1]);
    if (!n) return -1;
    let size = u8[at + 1] & (1 << 8 - n) - 1;
    for (let k = 1; k < n; k++) size = size * 256 + u8[at + 1 + k];
    if (size < 1 || size > 8 || at + 1 + n + size > u8.length) return -1;
    let v = 0;
    for (let k = 0; k < size; k++) v = v * 256 + u8[at + 1 + n + k];
    return v;
  }
  function webmClusterSeconds(u8) {
    let last = 0;
    for (let i = 0; i <= u8.length - 5; i++) {
      if (u8[i] !== 31 || u8[i + 1] !== 67 || u8[i + 2] !== 182 || u8[i + 3] !== 117) continue;
      const at = i + 4 + ebmlVintLen(u8[i + 4]);
      if (at < u8.length && u8[at] === 231) {
        const tc = ebmlTimecode(u8, at);
        if (tc > last) last = tc;
      }
    }
    return last / 1e3;
  }
  function probeDuration(file) {
    return new Promise((res) => {
      const head = file.slice(0, 4 * 1024 * 1024);
      const tailSize = Math.min(4 * 1024 * 1024, Math.max(0, file.size - 4 * 1024 * 1024));
      const tail = tailSize ? file.slice(file.size - tailSize) : null;
      let got = 0, pending = tail ? 2 : 1;
      const take = (buf) => {
        if (buf) {
          try {
            const u8 = new Uint8Array(buf);
            const d = parseMp4Duration(u8) || parseWebmDuration(u8);
            if (d > got && d <= 60 * 60 * 6) got = d;
          } catch (err) {
          }
        }
        pending -= 1;
        if (!pending) res(got);
      };
      const fr = new FileReader();
      fr.onload = () => take(fr.result);
      fr.onerror = () => take(null);
      fr.readAsArrayBuffer(head);
      if (tail) {
        const fr2 = new FileReader();
        fr2.onload = () => take(fr2.result);
        fr2.onerror = () => take(null);
        fr2.readAsArrayBuffer(tail);
      }
    });
  }
  function ebmlId(u8, at) {
    if (at >= u8.length) return null;
    const n = ebmlVintLen(u8[at]);
    if (!n || at + n > u8.length) return null;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + u8[at + k];
    return { id: v, len: n };
  }
  function ebmlSize(u8, at) {
    if (at >= u8.length) return null;
    const n = ebmlVintLen(u8[at]);
    if (!n || at + n > u8.length) return null;
    let v = u8[at] & (1 << 8 - n) - 1, unknown = v === (1 << 8 - n) - 1;
    for (let k = 1; k < n; k++) {
      v = v * 256 + u8[at + k];
      if (u8[at + k] !== 255) unknown = false;
    }
    return { size: v, len: n, unknown };
  }
  function ebmlUint(u8, at, n) {
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + u8[at + k];
    return v;
  }
  function eachEbml(u8, start, end, cb) {
    let i = start;
    while (i < end) {
      const id = ebmlId(u8, i);
      if (!id) return;
      const sz = ebmlSize(u8, i + id.len);
      if (!sz) return;
      const body = i + id.len + sz.len;
      cb(id.id, body, sz.unknown ? end : Math.min(end, body + sz.size));
      const next = sz.unknown ? end : body + sz.size;
      i = next > i ? next : i + 1;
    }
  }
  function webmPicture(u8) {
    const head = ebmlId(u8, 0);
    if (!head || head.id !== 440786851) return null;
    const hs = ebmlSize(u8, head.len);
    if (!hs) return null;
    const segAt = head.len + hs.len + hs.size;
    const seg = ebmlId(u8, segAt);
    if (!seg || seg.id !== 408125543) return null;
    const ss = ebmlSize(u8, segAt + seg.len);
    if (!ss) return null;
    const segBody = segAt + seg.len + ss.len;
    const segEnd = ss.unknown ? u8.length : Math.min(u8.length, segBody + ss.size);
    const tracks = [];
    eachEbml(u8, segBody, segEnd, (id, b, e) => {
      if (id !== 374648427) return;
      eachEbml(u8, b, e, (tid, tb, te) => {
        if (tid !== 174) return;
        let num = 0, type = 0;
        eachEbml(u8, tb, te, (cid, cb, ce) => {
          if (cid === 215) num = ebmlUint(u8, cb, Math.min(ce - cb, 8));
          else if (cid === 131) type = ebmlUint(u8, cb, Math.min(ce - cb, 8));
        });
        if (type === 1 && num) tracks.push(num);
      });
    });
    if (!tracks.length) return false;
    let clusters = 0, blocks = 0;
    for (let i = 0; i <= u8.length - 5; i++) {
      if (u8[i] !== 31 || u8[i + 1] !== 67 || u8[i + 2] !== 182 || u8[i + 3] !== 117) continue;
      const cs = ebmlSize(u8, i + 4);
      if (!cs) continue;
      clusters += 1;
      const cb = i + 4 + cs.len;
      const ce = cs.unknown ? u8.length : Math.min(u8.length, cb + cs.size);
      eachEbml(u8, cb, ce, (bid, bb, be) => {
        if (bid !== 160 && bid !== 163 && bid !== 161) return;
        const t = ebmlVintLen(u8[bb]);
        if (!t || bb + t > u8.length) return;
        const num = (u8[bb] & (1 << 8 - t) - 1) * Math.pow(256, t - 1) + (t > 1 ? ebmlUint(u8, bb + 1, t - 1) : 0);
        if (tracks.indexOf(num) !== -1) blocks += 1;
        if (bid === 160) {
          eachEbml(u8, bb, be, (gid, gb) => {
            if (gid !== 161) return;
            const gt = ebmlVintLen(u8[gb]);
            if (!gt || gb + gt > u8.length) return;
            const gn = (u8[gb] & (1 << 8 - gt) - 1) * Math.pow(256, gt - 1) + (gt > 1 ? ebmlUint(u8, gb + 1, gt - 1) : 0);
            if (tracks.indexOf(gn) !== -1) blocks += 1;
          });
        }
      });
      if (blocks) return true;
    }
    return clusters ? false : null;
  }
  function eachBox(u8, start, end, cb) {
    let i = start;
    while (i + 8 <= end) {
      let size = u8[i] * 16777216 + u8[i + 1] * 65536 + u8[i + 2] * 256 + u8[i + 3], hdr = 8;
      if (size === 1) {
        size = 0;
        for (let k = 0; k < 8; k++) size = size * 256 + u8[i + 8 + k];
        hdr = 16;
      } else if (size === 0) size = end - i;
      if (size < hdr || i + size > end + 1) return;
      cb(String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]), i + hdr, Math.min(end, i + size));
      i += size;
    }
  }
  function findBox(u8, start, end, want, depth) {
    if (depth > 6) return null;
    let hit = null;
    eachBox(u8, start, end, (type, b, e) => {
      if (hit) return;
      if (type === want) {
        hit = { body: b, end: e };
        return;
      }
      if (type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl" || type === "edts" || type === "udta") hit = findBox(u8, b, e, want, depth + 1);
    });
    return hit;
  }
  function hasFourcc(u8, tag) {
    const a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
    for (let i = 0; i <= u8.length - 4; i++) {
      if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) return true;
    }
    return false;
  }
  function mp4Picture(u8) {
    if (hasFourcc(u8, "moof") || hasFourcc(u8, "mvex")) return null;
    for (let i = 4; i <= u8.length - 8; i++) {
      if (!(u8[i] === 109 && u8[i + 1] === 111 && u8[i + 2] === 111 && u8[i + 3] === 118)) continue;
      let samples = 0, sawVideo = false, blind = false;
      eachBox(u8, i + 4, u8.length, (type, b, e) => {
        if (type !== "trak") return;
        const h = findBox(u8, b, e, "hdlr", 0);
        if (!h) return;
        if (String.fromCharCode(u8[h.body + 8], u8[h.body + 9], u8[h.body + 10], u8[h.body + 11]) !== "vide") return;
        sawVideo = true;
        const sz = findBox(u8, b, e, "stsz", 0);
        if (!sz) {
          blind = true;
          return;
        }
        samples += ebmlUint(u8, sz.body + 8, 4);
      });
      if (blind) return null;
      return sawVideo ? samples > 0 : false;
    }
    return null;
  }
  function pictureVerdict(file) {
    return new Promise((resolve) => {
      const CAP = 8 * 1024 * 1024;
      const slices = [file.slice(0, Math.min(file.size, CAP))];
      if (file.size > CAP) slices.push(file.slice(file.size - CAP));
      Promise.all(slices.map((s2) => new Promise((res) => {
        const fr = new FileReader();
        fr.onerror = () => res(null);
        fr.onload = () => res(new Uint8Array(fr.result));
        fr.readAsArrayBuffer(s2);
      }))).then((bufs) => {
        for (const u8 of bufs) {
          if (!u8 || u8.length < 16) continue;
          const webm = webmPicture(u8);
          if (webm !== null) {
            resolve(webm ? "yes" : "no");
            return;
          }
          const mp4 = mp4Picture(u8);
          if (mp4 !== null) {
            resolve(mp4 ? "yes" : "no");
            return;
          }
        }
        resolve("unknown");
      });
    });
  }
  const REENCODE_MAX = 48 * 1024 * 1024;
  const titleFromName = (name) => {
    const base = String(name || "").replace(/\.[^.]+$/, "").trim();
    return (base || "New clip").slice(0, 80);
  };
  function askName(file, secs) {
    return new Promise((resolve) => {
      const card = document.createElement("div");
      card.className = "tzna-card";
      card.innerHTML = `
        <div class='tzna-in' role='dialog' aria-modal='true' aria-label='Name this clip'>
          <p class='tzna-kick'>Ready to publish</p>
          <label class='tzna-lbl' for='tza-clipname'>Name this clip</label>
          <input id='tza-clipname' type='text' maxlength='80' autocomplete='off' spellcheck='false'>
          <p class='tzna-meta'></p>
          <div class='tzna-acts'>
            <button type='button' data-name='cancel'>Cancel</button>
            <button class='tzna-go' type='button' data-name='go'>Publish</button>
          </div>
        </div>`;
      const input = card.querySelector("input");
      const fallback = titleFromName(file && file.name);
      input.value = fallback;
      card.querySelector(".tzna-meta").textContent = [
        secs ? Math.round(secs) + "s" : "",
        file && file.size ? (file.size / 1048576).toFixed(1) + " MB" : "",
        "converted to 480p on the server"
      ].filter(Boolean).join(" \xB7 ");
      document.body.appendChild(card);
      const done = (val) => {
        card.remove();
        document.removeEventListener("keydown", onKey, true);
        resolve(val);
      };
      const go = () => done(input.value.trim() || fallback);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          done(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          go();
        }
      };
      card.addEventListener("click", (e) => {
        const act = e.target.closest("[data-name]");
        if (!act) return;
        if (act.dataset.name === "cancel") done(null);
        else go();
      });
      document.addEventListener("keydown", onKey, true);
      input.focus();
      input.select();
    });
  }
  async function panelUpload(file, pane) {
    const noteEl = pane.querySelector("#tza-upnote");
    const prog = (m) => {
      if (noteEl && noteEl.isConnected) noteEl.textContent = m;
    };
    const secs = await probeDuration(file);
    if (secs > 300) {
      say("Over the 5-minute limit (" + Math.round(secs) + "s). Trim it first.");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      say("Over 512 MB. Trim it first.");
      return;
    }
    const name = await askName(file, secs);
    if (name == null) {
      say("Upload cancelled.");
      return;
    }
    try {
      const clip = await publishVideo(file, name, staff(), prog);
      say('Published "' + clip.title + '".');
      load();
    } catch (err) {
      say(err && err.message || "Couldn't upload this video.");
    }
  }
  function renderApprovals(pane) {
    const pend = (data.accounts || []).filter((a) => a.status === "pending");
    if (!pend.length) {
      pane.innerHTML = '<p class="tznote">No pending signups. Everyone who asked is already in.</p>';
      return;
    }
    pane.innerHTML = pend.map((a) => `
      <div class='tzrow' data-email='${esc(a.email)}'>
        <span class='ttl'>${esc(a.first)} ${esc(a.last)} \xB7 ${esc(a.email)}</span>
        <button class='tzbtn primary tzmini' data-act='approve' type='button'>Approve</button>
        <button class='tzbtn tzmini' data-act='deny' type='button'>Deny</button>
      </div>`).join("");
    pane.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const email = btn.closest(".tzrow").dataset.email;
      const status = btn.dataset.act === "approve" ? "approved" : "denied";
      const r = await apiPost("/api/admin/status", auth({ target: email, status }));
      say(r && r.ok ? status === "approved" ? "Approved." : "Denied." : r && r.error || "Failed.");
      load();
    }, { once: true });
  }
  function renderPeople(pane) {
    pane.innerHTML = '<p class="tznote">Approved accounts. Make someone staff with the role select; a temp password sets them a fresh sign-in.</p>' + (data.accounts || []).filter((a) => a.status === "approved").map((a) => `
      <div class='tzrow' data-email='${esc(a.email)}'>
        <span class='ttl'>${esc(a.first)} ${esc(a.last)} \xB7 ${esc(a.email)} <span class='tzwho'>[${esc(a.role || "viewer")}]</span></span>
        <select class='tzbtn' data-act='role' ${a.role === "super" ? "disabled" : ""}>
          <option value='' ${a.role === "" ? "selected" : ""}>Viewer</option>
          <option value='admin' ${a.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
        <button class='tzbtn tzmini' data-act='pass' type='button'>Set temp password</button>
      </div>`).join("");
    pane.addEventListener("change", async (e) => {
      const sel = e.target.closest('select[data-act="role"]');
      if (!sel) return;
      const email = sel.closest(".tzrow").dataset.email;
      const r = await apiPost("/api/admin/role", auth({ target: email, role: sel.value }));
      say(r && r.ok ? "Role updated." : r && r.error || "Failed.");
      load();
    }, { once: true });
    pane.addEventListener("click", async (e) => {
      const btn = e.target.closest('button[data-act="pass"]');
      if (!btn) return;
      const email = btn.closest(".tzrow").dataset.email;
      const pass = prompt("New password for " + email + " (12+ characters):");
      if (!pass) return;
      const r = await apiPost("/api/admin/password", auth({ target: email, pass }));
      say(r && r.ok ? "Password set." : r && r.error || "Failed.");
    }, { once: true });
  }
  function renderAnalytics(pane) {
    const clips = data.clips || [];
    const fans = data.topFans || [];
    const recent = data.recent || [];
    const titleOf = (id) => {
      const c = clips.find((x) => x.id === id);
      return c ? c.title : "a clip";
    };
    pane.innerHTML = `
      <p class='tznote'>Who likes the channel the most, and what they love.</p>
      <div class='tzcard'><b>Top fans</b></div>
      ${fans.map((f) => `<div class='tzrow'><span class='ttl'>${esc(f.name)} <span class='tzwho'>${esc(f.email)}</span></span><span class='tznote' style='margin:0'>${f.likes} \u2665</span></div>`).join("") || '<p class="tznote">No hearts yet.</p>'}
      <div class='tzcard'><b>Most-loved clips</b></div>
      ${clips.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5).map((c) => `<div class='tzrow'><span class='ttl'>${esc(c.title)}</span><span class='tznote' style='margin:0'>${c.likes || 0} \u2665 \xB7 ${c.comments || 0} \u{1F4AC}</span></div>`).join("")}
      <div class='tzcard'><b>Who liked what</b></div>
      ${clips.filter((c) => (c.likers || []).length).map((c) => `<div class='tzrow'><span class='ttl'>${esc(c.title)}</span><span class='tzwho'>${esc((c.likers || []).join(", "))}</span></div>`).join("") || '<p class="tznote">No per-clip hearts yet.</p>'}
      <div class='tzcard'><b>Recent comments</b></div>
      ${recent.map((m) => `<div class='tzcard'><span class='who'>${esc(m.name)}</span> <span class='tzwho'>on ${esc(titleOf(m.clip))}</span><br>${esc(m.body)}</div>`).join("") || '<p class="tznote">No comments yet.</p>'}`;
  }
  const s = sessRead();
  if (s && s.t && (s.role === "admin" || s.role === "super")) {
    render();
    load();
  } else if (s && s.t) {
    fetch("/api/check?e=" + b64u(s.email) + "&t=" + encodeURIComponent(s.t)).then((r) => r.json()).then((j) => {
      if (j && j.ok) {
        s.role = j.role || "";
        if (j.t) s.t = j.t;
        sessWrite(s);
      }
    }).catch(() => {
    }).finally(() => {
      if (s.role === "admin" || s.role === "super") {
        render();
        load();
      } else renderLogin();
    });
  } else {
    renderLogin();
  }
})();
