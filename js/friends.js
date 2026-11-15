/* Darcam friends: add friends with a code or link, see what they're playing, send them songs,
   and invite them to your Jam. Uses friends.php on your Darcam website (Vercel + Upstash). */
'use strict';

const Friends = (() => {
    const ID = 'dc_friend_id';
    let me = LS.get(ID, null);            // { code, secret }
    let data = { friends: [], requests: [], messages: [] };
    let seenMsgs = new Set(LS.get('dc_friend_seen', []));
    let seenReqs = new Set();
    let timer = null, busy = false, lastPicSent = '';
    const share = () => LS.get('dc_friend_share', true);

    async function call(body) {
        const url = Site.api('friends.php');
        if (!url) { const e = new Error('Add your Darcam website in Settings → Sharing & Jam first'); e.status = 0; throw e; }
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(j.error || 'Friends: HTTP ' + r.status); e.status = r.status; throw e; }
        return j;
    }
    const profile = () => (typeof Profiles !== 'undefined' ? Profiles.current() : { name: localStorage.getItem('dc_name') || 'Me', pic64: '' });
    async function ensure() {
        if (me && me.code) return me;
        const p = profile();
        const r = await call({ op: 'register', name: p.name, pic: p.pic64 || '' });
        me = { code: r.code, secret: r.secret }; LS.set(ID, me);
        return me;
    }
    const auth = () => ({ code: me.code, secret: me.secret });
    const slim = (t) => t && ({ id: t.youtube_id || t.id, name: T.title(t), artist: T.artist(t), dur: Math.round((t.duration_ms || 0) / 1000), cover: T.cover(t) });
    const toTrack = (x) => ({ id: x.id, youtube_id: x.id, name: x.name, artists: [{ name: x.artist || 'Unknown', id: '' }], album: { name: x.artist, images: [{ url: x.cover || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg` }] },
        cover: x.cover || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`, cover_lg: x.cover ? x.cover.replace(/=w\d+-h\d+/, '=w544-h544') : `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`, duration_ms: (x.dur || 0) * 1000, kind: 'song', _n: 1 });

    async function sync(force) {
        if (busy || !Site.api('friends.php')) return;
        if (!me && !force) return;            // only make a friend code once you open Friends
        busy = true;
        try {
            await ensure();
            const p = profile(), t = Player.current();
            const body = { op: 'sync', ...auth(), name: p.name, share: share(), findable: LS.get('dc_friend_findable', true),
                now: share() && t && !t.pending ? { ...slim(t), playing: !!Player.state.playing } : null,
                jam: share() && typeof Jam !== 'undefined' && Jam.active ? { room: Jam.room, host: Jam.host } : null };
            if ((p.pic64 || '') !== lastPicSent) { body.pic = p.pic64 || ''; }
            const r = await call(body);
            lastPicSent = p.pic64 || '';
            const prevFriends = new Set(data.friends.map((f) => f.code));
            data = { friends: r.friends || [], requests: r.requests || [], messages: r.messages || [] };
            // tell about new things
            data.requests.forEach((q) => { if (!seenReqs.has(q.code)) { seenReqs.add(q.code); if (!force) UI.toast(`${q.name} wants to be your friend`); } });
            data.messages.forEach((m) => {
                if (seenMsgs.has(m.id)) return;
                seenMsgs.add(m.id);
                if (m.kind === 'jam') UI.toast(`${m.name} invited you to a Jam`);
                else if (m.kind === 'song') UI.toast(`${m.name} sent you “${m.track.name}”`);
            });
            if (prevFriends.size) data.friends.forEach((f) => { if (!prevFriends.has(f.code)) UI.toast(`You and ${f.name} are friends now`, 'success'); });
            LS.set('dc_friend_seen', [...seenMsgs].slice(-200));
            badge();
            if (location.hash.startsWith('#/friends')) renderPage();
        } catch (e) {
            if (e.status === 404 || e.status === 403) { me = null; LS.del(ID); }      // code was forgotten: make a new one next time
            console.warn('friends', e.message);
            if (force) throw e;
        } finally { busy = false; }
    }
    function badge() {
        const n = data.requests.length + data.messages.filter((m) => !LS.get('dc_friend_read', []).includes(m.id)).length;
        document.querySelectorAll('[data-friends-badge]').forEach((b) => { b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n; });
    }
    const syncSoon = debounce(() => sync(), 2500);
    function start() {
        Bus.on('track', syncSoon);
        Bus.on('state', syncSoon);
        timer = setInterval(() => { if (!document.hidden) sync(); }, 20000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
        setTimeout(() => sync(), 4000);
    }

    // ---------- actions ----------
    async function addByCode(code) {
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 4) { UI.toast('Type your friend’s code'); return; }
        try {
            await ensure();
            const r = await call({ op: 'request', ...auth(), to: code });
            if (r.already) UI.toast(`You and ${r.name} are already friends`);
            else if (r.friends) UI.toast(`You and ${r.name} are friends now`, 'success');
            else UI.toast(`Friend request sent to ${r.name}`, 'success');
            sync();
        } catch (e) { UI.toast(e.message, 'error'); }
    }
    async function answer(from, yes) {
        try { await call({ op: yes ? 'accept' : 'decline', ...auth(), from }); data.requests = data.requests.filter((q) => q.code !== from); renderPage(); badge(); sync(); if (yes) UI.toast('Friend added', 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
    }
    function remove(f) {
        UI.confirmModal('Remove ' + f.name + '?', 'You won’t see each other’s music any more. You can add each other again with your codes.', 'Remove', async () => {
            try { await call({ op: 'remove', ...auth(), who: f.code }); data.friends = data.friends.filter((x) => x.code !== f.code); renderPage(); UI.toast(f.name + ' removed'); }
            catch (e) { UI.toast(e.message, 'error'); }
        });
    }
    async function send(to, payload) {
        await call({ op: 'send', ...auth(), to, ...payload });
    }
    async function clearMsgs(ids) {
        data.messages = data.messages.filter((m) => !ids.includes(m.id)); renderPage(); badge();
        try { await call({ op: 'clear', ...auth(), ids }); } catch (e) {}
    }
    function pickFriends(title, onPick) {
        if (!data.friends.length) { UI.toast('Add a friend first (Friends in the menu)'); return; }
        UI.modal(`<h3>${esc(title)}</h3><div class="pick-list fr-pick">${data.friends.map((f) => `<button class="pick-row" data-to="${esc(f.code)}">${avatar(f, 'sm')}<span>${esc(f.name)}<small>${f.online ? 'Online' : lastSeen(f.seen)}</small></span></button>`).join('')}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button></div>`, (m, close) => {
            m.querySelectorAll('[data-to]').forEach((b) => (b.onclick = () => { close(); onPick(data.friends.find((f) => f.code === b.dataset.to)); }));
        });
    }
    function sendSong(t) {
        t = Catalog.normalize(t);
        pickFriends('Send to a friend', async (f) => {
            try { await ensure(); await send(f.code, { kind: 'song', track: slim(t) }); UI.toast(`Sent to ${f.name}`, 'success'); }
            catch (e) { UI.toast(e.message, 'error'); }
        });
    }
    async function inviteToJam(f) {
        if (!(typeof Jam !== 'undefined' && Jam.active)) { UI.toast('Start a Jam first: Library → Listen together'); return; }
        try { await send(f.code, { kind: 'jam', room: Jam.room }); UI.toast(`Invited ${f.name} to your Jam`, 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
    }

    // ---------- screen ----------
    function avatar(f, cls = '') {
        if (f.pic) return `<span class="pf-av ${cls}"><img src="${esc(f.pic)}" alt=""></span>`;
        let h = 0; for (const c of f.code || f.name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const C = [['#ff4f93', '#e5243b'], ['#f59e0b', '#ea580c'], ['#22c55e', '#0d9488'], ['#38bdf8', '#6366f1'], ['#a78bfa', '#db2777'], ['#facc15', '#f97316']][h % 6];
        return `<span class="pf-av ${cls}" style="background:linear-gradient(135deg,${C[0]},${C[1]})">${esc((f.name || '?').trim()[0] || '?').toUpperCase()}</span>`;
    }
    function lastSeen(ts) {
        if (!ts) return '';
        const m = Math.round((Date.now() - ts) / 60000);
        if (m < 2) return 'Active now';
        if (m < 60) return `Active ${m} min ago`;
        const h = Math.round(m / 60);
        if (h < 24) return `Active ${h} h ago`;
        return `Active ${Math.round(h / 24)} d ago`;
    }
    const link = () => (me && Site.base() ? Site.base() + '#/friend/' + me.code : '');
    async function page(r) {
        document.getElementById('tbTitle').textContent = 'Friends';
        const v = document.getElementById('view');
        if (!Site.api('friends.php')) {
            v.innerHTML = `<div class="page"><h1 class="page-h">Friends</h1><div class="empty big">${ic('users')}<p>Friends need your Darcam website</p><small>Add it in Settings → Sharing & Jam (for example darcam-vercel.vercel.app).</small><a class="btn primary" href="#/settings">Open Settings</a></div></div>`;
            hydrateIcons(v); return;
        }
        v.innerHTML = `<div class="page"><h1 class="page-h">Friends</h1><p class="muted">Loading…</p></div>`;
        try { await sync(true); } catch (e) {
            v.innerHTML = `<div class="page"><h1 class="page-h">Friends</h1><div class="empty big">${ic('info')}<p>${esc(e.message)}</p></div></div>`; hydrateIcons(v); return;
        }
        renderPage(true);
        LS.set('dc_friend_read', data.messages.map((m) => m.id)); badge();
    }
    function renderPage(force) {
        const v = document.getElementById('view');
        if (!location.hash.startsWith('#/friends') || !v) return;
        if (!force && v.querySelector('.fr-page') && document.activeElement && document.activeElement.closest('.fr-page input')) return;   // don't redraw while typing
        const inJam = typeof Jam !== 'undefined' && Jam.active;
        const msgs = data.messages;
        const html = `<div class="page fr-page">
            <h1 class="page-h">Friends</h1>
            <section class="fr-me">
                <div class="fr-find"><span class="fr-find-ic">${ic('search')}</span><input class="field" data-fr-find placeholder="Find friends by name" maxlength="24" autocomplete="off"></div>
                <div class="fr-results" data-fr-results></div>
                <div class="fr-code-box"><small>Or share your code</small><b class="fr-code">${esc(me ? me.code : '······')}</b>
                    <span class="fr-code-btns"><button class="btn primary sm" data-fr="copy">${ic('link')}<span>Copy link</span></button>
                    ${navigator.share ? `<button class="btn ghost sm" data-fr="share">${ic('share')}<span>Share</span></button>` : ''}
                    <button class="btn ghost sm" data-fr="qr">${ic('qr')}<span>QR code</span></button></span></div>
            </section>
            ${data.requests.length ? `<section class="fr-sec"><h2>Friend requests</h2>${data.requests.map((q) => `<div class="fr-row">${avatar(q, 'md')}<span class="fr-tx"><b>${esc(q.name)}</b><small>Code ${esc(q.code)}</small></span>
                <button class="btn primary sm" data-acc="${esc(q.code)}">Accept</button><button class="btn ghost sm" data-dec="${esc(q.code)}">Decline</button></div>`).join('')}</section>` : ''}
            ${msgs.length ? `<section class="fr-sec"><h2>For you <button class="btn ghost sm" data-fr="clearall">Clear</button></h2>${msgs.map((m) => m.kind === 'jam'
                ? `<div class="fr-row">${avatar(m, 'md')}<span class="fr-tx"><b>${esc(m.name)} invited you to a Jam</b><small>${lastSeen(m.at).replace('Active ', '')}</small></span><button class="btn primary sm" data-join="${esc(m.room)}" data-mid="${esc(m.id)}">${ic('users')}<span>Join</span></button><button class="icon-btn sm" data-dismiss="${esc(m.id)}" aria-label="Dismiss">${ic('x')}</button></div>`
                : `<div class="fr-row">${avatar(m, 'md')}<span class="fr-tx"><b>${esc(m.name)} sent you a song</b><small class="fr-song"><img src="${esc(m.track.cover || `https://i.ytimg.com/vi/${m.track.id}/mqdefault.jpg`)}" alt="">${esc(m.track.name)} · ${esc(m.track.artist)}</small></span><button class="icon-btn" data-playmsg="${esc(m.id)}" aria-label="Play">${ic('play')}</button><button class="icon-btn sm" data-queuemsg="${esc(m.id)}" aria-label="Add to queue">${ic('queue')}</button><button class="icon-btn sm" data-dismiss="${esc(m.id)}" aria-label="Dismiss">${ic('x')}</button></div>`).join('')}</section>` : ''}
            <section class="fr-sec"><h2>Your friends <span>${data.friends.length || ''}</span></h2>
            ${data.friends.length ? data.friends.map((f) => `<div class="fr-row friend">
                <span class="fr-av-wrap">${avatar(f, 'md')}${f.online ? '<i class="fr-dot"></i>' : ''}</span>
                <span class="fr-tx"><b>${esc(f.name)}</b>
                    ${f.now ? `<small class="fr-song ${f.now.playing ? 'live' : ''}">${f.now.playing ? '<i class="fr-eq"><i></i><i></i><i></i></i>' : ''}<img src="${esc(f.now.cover || `https://i.ytimg.com/vi/${f.now.id}/mqdefault.jpg`)}" alt="">${esc(f.now.name)} · ${esc(f.now.artist)}</small>` : `<small>${esc(lastSeen(f.seen))}</small>`}
                    ${f.jam ? `<small class="fr-jam">${ic('users')} In a Jam</small>` : ''}</span>
                ${f.jam ? `<button class="btn primary sm" data-join="${esc(f.jam.room)}">Join Jam</button>` : f.now ? `<button class="icon-btn" data-playf="${esc(f.code)}" aria-label="Play this song">${ic('play')}</button>` : ''}
                <button class="icon-btn sm" data-fmore="${esc(f.code)}" aria-label="More">${ic('more')}</button></div>`).join('')
                : `<div class="empty"><p>No friends yet</p><small>Search your friend’s name above, or send them your code or link. When they accept, you’ll see what they’re playing here.</small></div>`}
            </section>
            <label class="set-row fr-share"><span><b>Share what I’m listening to</b><small>Friends see your song and your Jam. Turn off to listen privately.</small></span><input type="checkbox" class="switch" id="frShare" ${share() ? 'checked' : ''}></label>
            <label class="set-row fr-share"><span><b>Let people find me by name</b><small>Turn off and friends can only add you with your code.</small></span><input type="checkbox" class="switch" id="frFind" ${LS.get('dc_friend_findable', true) ? 'checked' : ''}></label>
        </div>`;
        if (v.dataset.frh === html && !force) return;
        v.dataset.frh = html;
        v.innerHTML = html; hydrateIcons(v);
        wire(v, inJam);
    }
    function wire(v, inJam) {
        const msg = (id) => data.messages.find((m) => m.id === id);
        const findIn = v.querySelector('[data-fr-find]'), box = v.querySelector('[data-fr-results]');
        let seq = 0;
        const runFind = debounce(async () => {
            const q = findIn.value.trim(), my = ++seq;
            if (q.length < 2) { box.innerHTML = ''; return; }
            box.innerHTML = '<p class="muted small">Searching…</p>';
            try {
                await ensure();
                const r = await call({ op: 'find', ...auth(), q });
                if (my !== seq) return;
                box.innerHTML = r.people.length ? r.people.map((u) => `<div class="fr-row">${avatar(u, 'md')}<span class="fr-tx"><b>${esc(u.name)}</b><small>${u.friend ? 'Already your friend' : u.asksYou ? 'Wants to be your friend' : 'Darcam · ' + esc(u.code)}</small></span>
                    ${u.friend ? '' : u.requested ? '<span class="muted small">Request sent</span>' : u.asksYou ? `<button class="btn primary sm" data-acc2="${esc(u.code)}">Accept</button>` : `<button class="btn primary sm" data-addu="${esc(u.code)}">${ic('plus')}<span>Add</span></button>`}</div>`).join('')
                    : `<p class="muted small">No one called “${esc(q)}” yet. Check the spelling, or ask them for their code.</p>`;
                hydrateIcons(box);
                box.querySelectorAll('[data-addu]').forEach((b) => (b.onclick = async () => { b.disabled = true; await addByCode(b.dataset.addu); b.outerHTML = '<span class="muted small">Request sent</span>'; }));
                box.querySelectorAll('[data-acc2]').forEach((b) => (b.onclick = () => { answer(b.dataset.acc2, true); b.outerHTML = '<span class="muted small">Friends</span>'; }));
            } catch (e) { if (my === seq) box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
        }, 350);
        findIn.addEventListener('input', runFind);
        v.querySelectorAll('[data-fr]').forEach((b) => (b.onclick = async () => {
            const a = b.dataset.fr, l = link();
            if (a === 'copy') { try { await navigator.clipboard.writeText(l || me.code); UI.toast('Link copied', 'success'); } catch (e) { UI.toast(me.code); } }
            if (a === 'share') navigator.share({ title: 'Add me on Darcam', text: 'Add me as a friend on Darcam. My code: ' + me.code, url: l || undefined }).catch(() => {});
            if (a === 'qr') {
                let svg = ''; try { const q = qrcode(0, 'M'); q.addData(l || me.code); q.make(); svg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
                UI.modal(`<h3>Your friend code</h3><p class="muted small">Your friend scans this with their phone camera.</p><div class="jam-box"><div class="jam-qr">${svg}</div><div class="jam-info"><small>Code</small><b class="jam-code">${esc(me.code)}</b></div></div><div class="modal-actions"><button class="btn ghost" data-close>Done</button></div>`);
            }
            if (a === 'clearall') clearMsgs(data.messages.map((m) => m.id));
        }));
        v.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => answer(b.dataset.acc, true)));
        v.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => answer(b.dataset.dec, false)));
        v.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => { if (b.dataset.mid) clearMsgs([b.dataset.mid]); Jam.join(b.dataset.join); }));
        v.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => clearMsgs([b.dataset.dismiss])));
        v.querySelectorAll('[data-playmsg]').forEach((b) => (b.onclick = () => { const m = msg(b.dataset.playmsg); if (m) Player.playList([toTrack(m.track)], 0, { type: 'friend', name: 'From ' + m.name }); }));
        v.querySelectorAll('[data-queuemsg]').forEach((b) => (b.onclick = () => { const m = msg(b.dataset.queuemsg); if (m) Player.addToQueue(toTrack(m.track)); }));
        v.querySelectorAll('[data-playf]').forEach((b) => (b.onclick = () => { const f = data.friends.find((x) => x.code === b.dataset.playf); if (f && f.now) Player.playList([toTrack(f.now)], 0, { type: 'friend', name: f.name + '’s song' }); }));
        v.querySelectorAll('[data-fmore]').forEach((b) => (b.onclick = () => {
            const f = data.friends.find((x) => x.code === b.dataset.fmore); if (!f) return;
            UI.openMenu(b, [
                f.now ? { icon: 'play', label: 'Play ' + f.now.name, run: () => Player.playList([toTrack(f.now)], 0, { type: 'friend', name: f.name + '’s song' }) } : null,
                f.now ? { icon: 'queue', label: 'Add their song to queue', run: () => Player.addToQueue(toTrack(f.now)) } : null,
                { icon: 'users', label: inJam ? 'Invite to my Jam' : 'Invite to a Jam (start one first)', run: () => inviteToJam(f) },
                Player.current() ? { icon: 'share', label: 'Send what I’m playing', run: async () => { try { await send(f.code, { kind: 'song', track: slim(Player.current()) }); UI.toast('Sent to ' + f.name, 'success'); } catch (e) { UI.toast(e.message, 'error'); } } } : null,
                { icon: 'x', label: 'Remove friend', danger: true, run: () => remove(f) },
            ]);
        }));
        const sh = v.querySelector('#frShare');
        const fd = v.querySelector('#frFind');
        if (fd) fd.onchange = () => { LS.set('dc_friend_findable', fd.checked); UI.toast(fd.checked ? 'People can find you by name' : 'Only people with your code can add you'); sync(); };
        if (sh) sh.onchange = () => { LS.set('dc_friend_share', sh.checked); UI.toast(sh.checked ? 'Friends can see what you play' : 'Listening privately'); sync(); };
    }
    function friendLink(r) {
        location.replace('#/friends');
        setTimeout(() => addByCode(r.id), 600);
    }
    if (typeof Pages !== 'undefined' && Pages.addRoute) { Pages.addRoute('friends', page); Pages.addRoute('friend', friendLink); }
    return { start, sync, sendSong, inviteToJam, addByCode, get ready() { return !!Site.api('friends.php'); }, get code() { return me && me.code; }, get friends() { return data.friends; } };
})();
