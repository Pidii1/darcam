/* Darcam profiles: a name and picture for you, and more than one person on the same device.
   Each profile has its own library, likes, history, stats and settings. No accounts: it all stays on this device. */
'use strict';

const Profiles = (() => {
    const LIST = 'dc_profiles', ACTIVE = 'dc_profile_active', BUCKET = 'dcp_';
    // kept for the whole device, not per profile
    const SHARED = new Set([LIST, ACTIVE, 'dc_site', 'dc_update_skip', 'dc_last_version', 'dc_vbg_251', 'dc_lang', 'dc_ilog', 'dc_island_asked', 'dc_artists', 'dc_artists_v', 'dc_lyrics', 'dc_lyrics_idx', 'dc_ly_offset']);
    const mine = (k) => (k.startsWith('dc_') || k.startsWith('darcam')) && !SHARED.has(k) && !k.startsWith('dc_cache') && !k.startsWith('dc_vbg');
    const uid = () => 'p' + Math.random().toString(36).slice(2, 9);

    let list = LS.get(LIST, null);
    let active = LS.get(ACTIVE, null);
    if (!Array.isArray(list) || !list.length) {           // first time: today's library becomes the first profile
        list = [{ id: uid(), name: localStorage.getItem('dc_name') || 'Me', pic: '', pic64: '' }];
        active = list[0].id;
        LS.set(LIST, list); LS.set(ACTIVE, active);
    }
    if (!list.some((p) => p.id === active)) { active = list[0].id; LS.set(ACTIVE, active); }
    const save = () => LS.set(LIST, list);
    const current = () => list.find((p) => p.id === active);
    if (current().name && localStorage.getItem('dc_name') !== current().name) localStorage.setItem('dc_name', current().name);

    const COLORS = [['#ff4f93', '#e5243b'], ['#f59e0b', '#ea580c'], ['#22c55e', '#0d9488'], ['#38bdf8', '#6366f1'], ['#a78bfa', '#db2777'], ['#facc15', '#f97316']];
    function avatarHTML(p, cls = '') {
        if (!p) return '';
        if (p.pic) return `<span class="pf-av ${cls}"><img src="${esc(p.pic)}" alt=""></span>`;
        let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const [a, b] = COLORS[h % COLORS.length];
        return `<span class="pf-av ${cls}" style="background:linear-gradient(135deg,${a},${b})">${esc((p.name || '?').trim()[0] || '?').toUpperCase()}</span>`;
    }

    // ---------- pictures ----------
    function readPicture(file) {
        return new Promise((ok, bad) => {
            const img = new Image(), url = URL.createObjectURL(file);
            img.onload = () => {
                const cut = (size, q) => {
                    const c = document.createElement('canvas'); c.width = c.height = size;
                    const s = Math.min(img.width, img.height);
                    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
                    return c.toDataURL('image/jpeg', q);
                };
                const out = { pic: cut(256, 0.82), pic64: cut(64, 0.7) };
                URL.revokeObjectURL(url); ok(out);
            };
            img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('That file isn’t a picture')); };
            img.src = url;
        });
    }

    // ---------- switching ----------
    function switchTo(id) {
        if (id === active || !list.some((p) => p.id === id)) return;
        if (typeof Jam !== 'undefined' && Jam.active) Jam.leave(true);
        try { Player.pause(); } catch (e) {}
        // put this profile's things away...
        const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (mine(k)) keys.push(k); }
        const box = {}; keys.forEach((k) => { box[k] = localStorage.getItem(k); });
        keys.forEach((k) => localStorage.removeItem(k));
        try { localStorage.setItem(BUCKET + active, JSON.stringify(box)); }
        catch (e) { Object.entries(box).forEach(([k, v]) => localStorage.setItem(k, v)); UI.toast('Not enough space on this device to switch profiles', 'error'); return; }
        // ...and take out the other one's
        let next = {}; try { next = JSON.parse(localStorage.getItem(BUCKET + id) || '{}'); } catch (e) {}
        Object.entries(next).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} });
        localStorage.removeItem(BUCKET + id);
        active = id; LS.set(ACTIVE, id);
        localStorage.setItem('dc_name', current().name);
        // nothing may write the old profile's data after this point
        window.__dcSwitching = true;
        const raw = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (window.__dcSwitching && mine(String(k))) return; return raw.call(this, k, v); };
        location.hash = '#/home';
        location.reload();
    }

    // ---------- screens ----------
    function editor(p, isNew) {
        const draft = p ? { ...p } : { id: uid(), name: '', pic: '', pic64: '' };
        UI.modal(`<h3>${isNew ? 'Add a profile' : 'Edit profile'}</h3>
            ${isNew ? '<p class="muted small">Each profile has its own Liked Songs, playlists, history and settings, on this device.</p>' : ''}
            <div class="pf-edit">
                <button class="pf-pick" data-pf="pick" aria-label="Choose a picture">${avatarHTML(draft, 'xl')}<span class="pf-cam">${ic('image')}</span></button>
                <div class="pf-edit-r">
                    <input class="field" data-pf="name" maxlength="24" placeholder="Name" value="${esc(draft.name)}">
                    <div class="pf-btns"><button class="btn ghost sm" data-pf="pick">${ic('image')}<span>Choose picture</span></button>
                    <button class="btn ghost sm" data-pf="nopic" ${draft.pic ? '' : 'hidden'}>Remove picture</button></div>
                </div>
            </div>
            <input type="file" accept="image/*" data-pf="file" hidden>
            ${!isNew && list.length > 1 ? `<button class="btn ghost sm danger-t pf-del" data-pf="delete">${ic('x')}<span>Delete this profile</span></button>` : ''}
            <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-pf="save">${isNew ? 'Add profile' : 'Save'}</button></div>`, (m, close) => {
            const file = m.querySelector('[data-pf="file"]'), nameIn = m.querySelector('[data-pf="name"]');
            const repaint = () => { m.querySelector('.pf-pick').innerHTML = avatarHTML({ ...draft, name: nameIn.value || draft.name || '?' }, 'xl') + `<span class="pf-cam">${ic('image')}</span>`; m.querySelector('[data-pf="nopic"]').hidden = !draft.pic; hydrateIcons(m); };
            m.querySelectorAll('[data-pf="pick"]').forEach((b) => (b.onclick = () => file.click()));
            file.onchange = async () => { const f = file.files[0]; if (!f) return; try { Object.assign(draft, await readPicture(f)); repaint(); } catch (e) { UI.toast(e.message, 'error'); } file.value = ''; };
            m.querySelector('[data-pf="nopic"]').onclick = () => { draft.pic = draft.pic64 = ''; repaint(); };
            nameIn.addEventListener('input', () => { if (!draft.pic) repaint(); });
            const del = m.querySelector('[data-pf="delete"]');
            if (del) del.onclick = () => {
                close();
                setTimeout(() => UI.confirmModal('Delete “' + draft.name + '”?', 'Its Liked Songs, playlists, history and settings are deleted from this device. This can’t be undone.', 'Delete', () => remove(draft.id)), 320);
            };
            m.querySelector('[data-pf="save"]').onclick = () => {
                const name = nameIn.value.trim().slice(0, 24);
                if (!name) { UI.toast('Type a name'); nameIn.focus(); return; }
                draft.name = name;
                if (isNew) {
                    list.push(draft); save(); close(); paint();
                    setTimeout(() => UI.confirmModal('Switch to ' + name + ' now?', 'You can switch any time from the picture at the top.', 'Switch', () => switchTo(draft.id)), 320);
                } else {
                    Object.assign(list.find((x) => x.id === draft.id), draft); save();
                    if (draft.id === active) localStorage.setItem('dc_name', name);
                    close(); paint(); UI.toast('Profile saved', 'success');
                    Bus.emit('profile');
                }
            };
            if (isNew) setTimeout(() => nameIn.focus(), 50);
        });
    }
    function remove(id) {
        if (list.length < 2) return;
        if (id === active) {
            const other = list.find((p) => p.id !== id);
            list = list.filter((p) => p.id !== id); save();
            // drop this profile's things, then open the other one
            const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (mine(k)) keys.push(k); }
            keys.forEach((k) => localStorage.removeItem(k));
            let next = {}; try { next = JSON.parse(localStorage.getItem(BUCKET + other.id) || '{}'); } catch (e) {}
            Object.entries(next).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} });
            localStorage.removeItem(BUCKET + other.id);
            active = other.id; LS.set(ACTIVE, active); localStorage.setItem('dc_name', other.name);
            window.__dcSwitching = true;
            const raw = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) { if (window.__dcSwitching && mine(String(k))) return; return raw.call(this, k, v); };
            location.hash = '#/home'; location.reload();
        } else {
            list = list.filter((p) => p.id !== id); save();
            localStorage.removeItem(BUCKET + id);
            paint(); UI.toast('Profile deleted');
        }
    }
    function menu(anchor) {
        const cur = current();
        const others = list.filter((p) => p.id !== active);
        UI.openMenu(anchor, [
            { html: `<div class="pf-menu-head">${avatarHTML(cur, 'md')}<span><b>${esc(cur.name)}</b><small>${list.length > 1 ? list.length + ' profiles on this device' : 'Your profile'}</small></span></div>` },
            { icon: 'edit', label: 'Edit profile', run: () => editor(cur) },
            ...others.map((p) => ({ iconHTML: avatarHTML(p, 'xs'), label: 'Switch to ' + p.name, run: () => switchTo(p.id) })),
            { icon: 'users', label: 'Friends', run: () => { location.hash = '#/friends'; } },
            { icon: 'settings', label: 'Settings', run: () => { location.hash = '#/settings'; } },
        ]);
    }
    function paint() {
        const cur = current();
        document.querySelectorAll('[data-profile-btn]').forEach((b) => {
            const full = b.dataset.profileBtn === 'full';
            b.innerHTML = avatarHTML(cur, full ? 'sm' : 'sm') + (full ? `<span class="pf-name">${esc(cur.name)}</span>${ic('chevronDown') || ''}` : '');
            b.title = cur.name;
            hydrateIcons(b);
        });
    }
    function start() {
        document.addEventListener('click', (e) => { const b = e.target.closest('[data-profile-btn]'); if (b) { e.preventDefault(); menu(b); } });
        paint();
    }
    return { start, current, list: () => list, menu, editor, switchTo, avatarHTML, paint, setName(n) { const c = current(); c.name = n; save(); localStorage.setItem('dc_name', n); paint(); } };
})();
