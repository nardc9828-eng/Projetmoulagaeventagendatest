'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const fr = (d, o) => d.toLocaleDateString('fr-FR', o || { day: 'numeric', month: 'short' });
const F = Calc.fmt;
const opts = () => ({ normal: settings.normal * 60, pause: settings.pause, from: settings.from * 60, to: settings.to * 60, dayPause });
const THEMES = { bordeaux: 'Bordeaux & or', bleu: 'Bleu marine', foret: 'Vert forêt', ocean: 'Océan', emeraude: 'Émeraude', violet: 'Violet', framboise: 'Framboise', corail: 'Corail', sombre: 'Sombre', nuit: 'Nuit bleue', noiror: 'Noir & or', auto: 'Auto (clair/sombre)' };
const TCOL = { bordeaux: ['#5b1527', '#c9a24a'], bleu: ['#17324d', '#5b8fc9'], foret: ['#1f4d3a', '#b8963e'], ocean: ['#0b5563', '#2bb8a6'], emeraude: ['#0f6b4f', '#34d399'], violet: ['#4c2a85', '#b98cf5'], framboise: ['#a3174f', '#ff7aa8'], corail: ['#c2410c', '#f59e0b'], sombre: ['#14100f', '#c9a24a'], nuit: ['#0b1220', '#60a5fa'], noiror: ['#1a1814', '#d4a73a'], auto: ['#f7f2ee', '#14100f'] };
const SW = k => `linear-gradient(135deg, ${TCOL[k][0]} 50%, ${TCOL[k][1]} 50%)`;
const VIEWS = { jour: 'Jour', semaine: 'Semaine', mois: 'Mois', annee: 'Année', bilan: 'Bilan', data: 'Données' };
let bscope = localStorage.getItem('bscope') || 'mois';
const unit = () => (view === 'bilan' ? bscope : view);
const vsel = () => `<select id="vs" aria-label="Changer de vue">${Object.entries(VIEWS).map(([k, v]) => `<option value="${k}"${k === view ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
const dlg = $('#dlg');
const DEF = { normal: 7, pause: 60, from: 12, to: 14, week: 35, prep: 0 };
let settings = { ...DEF }, dayPause = {}, lastDel = null;
let db, events = [], view = 'mois', cur = new Date(), sel = iso(new Date()), q = '', editing = null, pending = null;

/* ---------- Stockage local (IndexedDB) ---------- */
const open = () => new Promise((ok, ko) => {
  const r = indexedDB.open('agenda-evenements', 2);
  r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' }); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
  r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
});
const tx = (mode, fn, st = 'events') => new Promise((ok, ko) => {
  const t = db.transaction(st, mode), r = fn(t.objectStore(st));
  t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
});
const load = async () => {
  events = await tx('readonly', s => s.getAll());
  for (const m of await tx('readonly', s => s.getAll(), 'meta')) { if (m.key === 'settings') settings = { ...DEF, ...m.value }; if (m.key === 'dayPause') dayPause = m.value || {}; }
};
const putMeta = (key, value) => tx('readwrite', s => s.put({ key, value }), 'meta');
const save = ev => tx('readwrite', s => s.put(ev));
const del = id => tx('readwrite', s => s.delete(id));
const bulk = (list, replace) => tx('readwrite', s => { if (replace) s.clear(); list.forEach(e => s.put(e)); });

function toast(t, undo) {
  const e = $('#toast'); e.innerHTML = esc(t) + (undo ? ` <button data-act="undo">${undo}</button>` : ''); e.classList.toggle('act', !!undo); e.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), undo ? 7000 : 2600);
}

/* ---------- Rendu ---------- */
const times = e => (e.start ? `${e.start} → ${e.end}` : (e.date <= iso(new Date()) ? 'À compléter' : 'Pas encore d’horaires')) + (Calc.durations(e).prep ? ` · prépa ${F(Calc.durations(e).prep)}` : '');
const stats = (n, S) => `<div class="stats">${[[n, 'Événements'], [F(S.span, 1), 'Temps event'], [F(S.total, 1), 'Travaillé']].map(([v, l]) => `<div class="st"><b>${v}</b><span>${l}</span></div>`).join('')}<div class="st ot"><b>${F(S.ot, 1)}</b><span>Heures sup.</span></div></div>`;

function cal(days, first) {
  const m = first.getMonth(), t = iso(new Date()), last = new Date(first.getFullYear(), m + 1, 0);
  let h = '<div class="cal">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<i>${x}</i>`).join('');
  for (let d = monday(first); d <= last || (d.getDay() + 6) % 7 !== 0; d = addDays(d, 1)) {
    const k = iso(d), x = days[k];
    h += `<button data-sel="${k}" class="${d.getMonth() !== m ? 'out ' : ''}${k === t ? 'today ' : ''}${k === sel ? 'sel' : ''}"><span>${d.getDate()}</span>${x ? `<small>${x.total ? F(x.total, 1) : '…'}</small>${x.ot ? `<em>+${F(x.ot, 1)}</em>` : ''}` : ''}</button>`;
  }
  return h + '</div>';
}
function dayBlock(days, k) {
  const x = days[k];
  return `<section class="day"><h3>${fr(pd(k), { weekday: 'long', day: 'numeric', month: 'long' })}${x ? `<b>${F(x.total)}</b>` : ''}</h3>` +
    (x ? x.events.map(e => `<div class="ev" data-id="${e.id}"><strong>${esc(e.name)}</strong><span>${times(e)}</span></div>`).join('') +
      `<div class="chips"><span>Temps event ${F(x.span)}</span>${x.prep ? `<span>Prépa ${F(x.prep)}</span>` : ''}<span class="${x.ot ? 'ot' : ''}">Heures sup. ${F(x.ot)}</span></div>` : '<p class="mut">Aucun événement ce jour.</p>') +
    (x ? `<button class="ghost" data-pause="${k}">Ajuster la pause${x.manual ? ' ✎' : ''}</button> ` : '') + `<button class="ghost" data-add="${k}">+ Ajouter un événement</button></section>`;
}
function dataView() {
  const le = localStorage.getItem('lastExport'), old = !le || (Date.now() - new Date(le)) > 30 * 864e5, th = localStorage.getItem('theme') || 'bordeaux';
  const inp = (id, l, v, st) => `<label>${l}<input type="number" id="${id}" value="${v}" step="${st}"></label>`;
  return `<div class="panel"><h3>Sauvegarde et export</h3>
    <p>${events.length} événement(s) enregistré(s) sur ce téléphone.</p>
    <p class="${old ? 'warn' : 'mut'}">${le ? 'Dernier export : ' + fr(new Date(le), { day: 'numeric', month: 'long', year: 'numeric' }) : 'Aucun export réalisé.'}${old ? ' — pensez à exporter ce mois-ci.' : ''}</p>
    <div class="btns"><button data-act="export">Exporter (JSON)</button><button data-act="import">Importer / Restaurer</button></div>
    <p class="mut">Le fichier JSON contient événements, pauses et règles : c’est votre sauvegarde, la restauration et le transfert vers l’ordinateur.</p></div>
    <div class="panel"><h3>Autres formats</h3><div class="btns"><button class="ghost" data-act="xlsx">Exporter en Excel (.xlsx)</button><button class="ghost" data-act="ics">Vers l’agenda (.ics)</button><button class="ghost" data-act="icsimport">Depuis l’agenda (.ics)</button></div>
    <p class="mut">Excel : tous vos événements, avec un récapitulatif par jour et par mois. Le .ics échange avec l’agenda du téléphone. Ni l’un ni l’autre ne remplace la sauvegarde JSON.</p></div>
    <div class="panel"><h3>Règles de calcul</h3><div class="row">${inp('s-n', 'Travail normal (h/jour)', settings.normal, '0.25')}${inp('s-p', 'Pause (min)', settings.pause, '5')}</div>
    <div class="row">${inp('s-f', 'Pause entre (h)', settings.from, '0.5')}${inp('s-t', 'et (h)', settings.to, '0.5')}</div>
    <div class="row">${inp('s-w', 'Objectif par semaine (h)', settings.week, '0.5')}${inp('s-pd', 'Préparation par défaut (min)', settings.prep, '5')}</div>
    <div class="btns"><button data-act="savesettings">Enregistrer les règles</button></div>
    <p class="mut">S’applique à tout l’historique. Une pause se corrige aussi jour par jour avec le bouton « Ajuster la pause » de chaque journée.</p></div>
    <div class="panel"><h3>Apparence</h3><div class="thm">${Object.entries(THEMES).map(([k, v]) => `<button data-th="${k}" class="${k === th ? 'on' : ''}"><span class="sw" style="background:${SW(k)}"></span>${v}</button>`).join('')}</div></div>
    <div class="panel"><h3>État du stockage</h3><p class="mut" id="persist">Vérification…</p></div>`;
}
function range(u) {
  if (u === 'jour') { const d = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()); return [d, d, fr(d, { weekday: 'short', day: 'numeric', month: 'long' })]; }
  if (u === 'annee') return [new Date(cur.getFullYear(), 0, 1), new Date(cur.getFullYear(), 11, 31), String(cur.getFullYear())];
  if (u === 'semaine') { const f = monday(cur), t = addDays(f, 6); return [f, t, `${fr(f)} – ${fr(t, { day: 'numeric', month: 'short', year: 'numeric' })}`]; }
  return [new Date(cur.getFullYear(), cur.getMonth(), 1), new Date(cur.getFullYear(), cur.getMonth() + 1, 0), cur.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })];
}
function render() {
  const days = Calc.byDay(events, opts()), u = unit();
  let b = '';
  if (view !== 'data') {
    const [from, to, label] = range(u), a = iso(from), z = iso(to), td = iso(new Date());
    $('#top').innerHTML = `${vsel()}<button data-nav="-1" aria-label="Précédent">‹</button><h1>${label}</h1><button data-nav="1" aria-label="Suivant">›</button>${td >= a && td <= z ? '' : '<button data-nav="0" class="today">Aujourd’hui</button>'}`;
    const ks = Object.keys(days).filter(k => k >= a && k <= z).sort(), PS = Calc.sum(ks.map(k => days[k]));
    if (view === 'bilan') b = bilan(days, ks, PS, u, from);
    else {
      if (view === 'jour') sel = a;
      b = stats(events.filter(e => e.date >= a && e.date <= z).length, PS) + (view === 'semaine' ? gauge(PS.total) : '') +
        (view === 'jour' ? dayBlock(days, a) : view === 'mois' ? cal(days, from) + dayBlock(days, sel) : view === 'annee' ? year(days, from) : Array.from({ length: 7 }, (_, i) => dayBlock(days, iso(addDays(from, i)))).join(''));
    }
  } else { $('#top').innerHTML = `${vsel()}<h1>Données</h1>`; b = dataView(); }
  $('#main').innerHTML = banner() + b;
  if (view === 'data') persistInfo();
}
async function persistInfo() {
  let t = 'Stockage interne du navigateur (IndexedDB), conservé après fermeture et redémarrage.';
  try { if (navigator.storage && navigator.storage.persisted) t += (await navigator.storage.persisted()) ? ' Protection contre l’effacement automatique : active.' : ' Protection contre l’effacement : non accordée — installez l’application sur l’écran d’accueil et exportez chaque mois.'; } catch (e) {}
  const el = $('#persist'); if (el) el.textContent = t;
}

/* ---------- Formulaire et détail ---------- */
function formDlg(ev) {
  editing = ev;
  const f = (id, l, v, t) => `<label>${l}<input type="${t || 'time'}" id="${id}" value="${esc(v)}"></label>`;
  dlg.innerHTML = `<h2>${events.some(e => e.id === ev.id) ? 'Modifier l’événement' : 'Nouvel événement'}</h2>
    <label>Nom<input id="f-name" value="${esc(ev.name)}" placeholder="Ex. Congrès annuel"></label>${f('f-date', 'Date', ev.date, 'date')}
    <fieldset><legend>Horaires de l’événement</legend><div class="row">${f('f-s', 'Début', ev.start)}${f('f-e', 'Fin', ev.end)}</div></fieldset>
    <label>Préparation (minutes)<input type="number" id="f-prep" min="0" max="1440" step="5" inputmode="numeric" value="${Calc.durations(ev).prep}"></label>
    <div class="chips">${[0, 30, 60, 90, 120].map(m => `<button data-prep="${m}">${m ? (m < 60 ? m + ' min' : F(m, 1)) : 'Aucune'}</button>`).join('')}</div>
    <p id="f-calc" class="mut"></p><label>Commentaires<textarea id="f-c" rows="2">${esc(ev.comment)}</textarea></label>
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button data-act="save">Enregistrer</button></div>`;
  calcForm(); dlg.showModal();
}
function calcForm() {
  const v = i => $('#' + i).value, s = Calc.tm(v('f-s')), e = Calc.tm(v('f-e'));
  $('#f-calc').textContent = `Durée : ${F(Calc.durations({ start: v('f-s'), end: v('f-e') }).real)}${s !== null && e !== null && e < s ? ' (finit après minuit)' : ''}${+v('f-prep') ? ` · Préparation : ${F(+v('f-prep'))}` : ''}`;
}
const blank = d => { let t = {}; try { t = JSON.parse(localStorage.getItem('lastTimes') || '{}'); } catch (e) {} return { id: Calc.uid(), name: '', date: d || sel, prepStart: '', prepEnd: '', start: t.start || '', end: t.end || '', comment: '', prep: settings.prep }; };
async function saveForm() {
  const g = i => $('#' + i).value.trim();
  const ev = { ...editing, name: g('f-name'), date: g('f-date'), prepStart: '', prepEnd: '', prep: Math.max(0, Math.min(1440, Math.round(+g('f-prep') || 0))), start: g('f-s'), end: g('f-e'), comment: g('f-c') };
  if (!ev.name || !ev.date) return toast('Le nom et la date sont obligatoires');
  if (!ev.start !== !ev.end) return toast('Renseignez le début ET la fin');
  try { await save(ev); await load(); localStorage.setItem('lastTimes', JSON.stringify({ start: ev.start, end: ev.end })); } catch (e) { return toast('Échec de l’enregistrement'); }
  sel = ev.date; cur = pd(ev.date); dlg.close(); render(); toast('Enregistré');
}
function detail(id) {
  const e = events.find(x => x.id === id); if (!e) return;
  const d = Calc.durations(e), x = Calc.byDay(events, opts())[e.date];
  dlg.innerHTML = `<h2>${esc(e.name)}</h2><p class="mut">${fr(pd(e.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <p><b>Horaires</b> : ${e.start ? `${e.start} → ${e.end} (${F(d.real)})` : '—'}</p>${d.prep ? `<p><b>Préparation</b> : ${F(d.prep)}</p>` : ''}
    ${e.comment ? `<p>${esc(e.comment).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="chips"><span>Temps event ${F(x.span)}</span><span>Travaillé ${F(x.total)}</span><span class="${x.ot ? 'ot' : ''}">Sup. ${F(x.ot)}</span></div>
    <div class="btns"><button class="ghost" data-act="close">Fermer</button><button data-act="dup" data-id="${e.id}">Dupliquer</button><button data-act="edit" data-id="${e.id}">Modifier</button><button class="danger" data-act="del" data-id="${e.id}">Supprimer</button></div>`;
  dlg.showModal();
}

/* ---------- Export / import ---------- */
async function exportJSON() {
  const data = { app: 'agenda-evenements', version: 2, exportedAt: new Date().toISOString(), events, dayPause, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name = `agenda-${iso(new Date())}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); localStorage.setItem('lastExport', new Date().toISOString()); return render(); } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
  localStorage.setItem('lastExport', new Date().toISOString()); toast('Fichier exporté'); render();
}
async function exportXLSX() {
  const days = Calc.byDay(events, opts()), h = m => Math.round(m / 60 * 100) / 100, fd = k => k.split('-').reverse().join('/'), B = v => ({ v, b: 1 });
  const keys = Object.keys(days).sort(), mo = Calc.monthly(days), S = Calc.sum(keys.map(k => days[k]));
  const evs = events.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const MN = k => fr(new Date(+k.slice(0, 4), +k.slice(5) - 1, 1), { month: 'long', year: 'numeric' });
  const sheets = [
    { name: 'Événements', rows: [['Date', 'Événement', 'Début', 'Fin', 'Durée (h)', 'Préparation (h)', 'Commentaires'], ...evs.map(e => { const d = Calc.durations(e); return [fd(e.date), e.name, e.start, e.end, h(d.real), h(d.prep), e.comment]; })] },
    { name: 'Jours', rows: [['Date', 'Événement(s)', 'Temps event (h)', 'Temps travaillé (h)', 'Heures sup. (h)'], ...keys.map(k => [fd(k), days[k].events.map(e => e.name).join(' / '), h(days[k].span), h(days[k].total), h(days[k].ot)]), [B('TOTAL'), '', B(h(S.span)), B(h(S.total)), B(h(S.ot))]] },
    { name: 'Récap mensuel', rows: [['Mois', 'Événements', 'Jours travaillés', 'Temps event (h)', 'Temps travaillé (h)', 'Heures sup. (h)'], ...mo.map(m => [MN(m.month), m.evenements, m.jours, h(m.span), h(m.total), h(m.ot)]), [B('TOTAL'), B(events.length), B(S.jours), B(h(S.span)), B(h(S.total)), B(h(S.ot))]] },
  ];
  const name = `agenda-${iso(new Date())}.xlsx`, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([makeXlsx(sheets)], { type: mime }), file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4); toast('Fichier Excel prêt');
}
async function exportICS() {
  const name = `agenda-${iso(new Date())}.ics`, blob = new Blob([Calc.toICS(events)], { type: 'text/calendar' }), file = new File([blob], name, { type: 'text/calendar' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4); toast('Fichier .ics prêt');
}
async function onICS(file) {
  if (!file) return;
  let r; try { r = Calc.parseICS(await file.text()); } catch (e) { r = { events: [], recurring: 0 }; }
  const have = new Set(events.map(e => e.id)), td = new Date();
  pending = { ics: r.events.filter(e => !have.has(e.id)), sel: [] };
  dlg.innerHTML = `<h2>Import depuis l’agenda</h2><p class="mut">${r.events.length} événement(s) lu(s)${r.events.length - pending.ics.length ? `, ${r.events.length - pending.ics.length} déjà importé(s)` : ''}. Seuls le nom et la date sont repris ; vous saisirez ensuite les horaires réels (l’horaire prévu est noté en commentaire).</p>
    <div class="row"><label>Du<input type="date" id="i-from" value="${iso(new Date(td.getFullYear(), td.getMonth(), 1))}"></label><label>Au<input type="date" id="i-to" value="${iso(new Date(td.getFullYear() + 1, td.getMonth(), 0))}"></label></div>
    <div id="i-info"></div>${r.recurring ? `<p class="warn">${r.recurring} événement(s) récurrent(s) : seule la première occurrence est reprise.</p>` : ''}
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button data-act="doics" id="i-ok">Importer</button></div>`;
  icsPreview(); dlg.showModal();
}
function icsPreview() {
  const a = $('#i-from').value || '0000-00-00', b = $('#i-to').value || '9999-99-99';
  pending.sel = pending.ics.filter(e => e.date >= a && e.date <= b).sort((x, y) => x.date.localeCompare(y.date));
  const l = pending.sel;
  $('#i-info').innerHTML = `<p><b>${l.length}</b> événement(s) à ajouter sur cette période.</p>` + (l.length ? `<ul class="l">${l.slice(0, 6).map(e => `<li>${fr(pd(e.date), { day: 'numeric', month: 'short' })} — ${esc(e.name)}</li>`).join('')}${l.length > 6 ? `<li>… et ${l.length - 6} autre(s)</li>` : ''}</ul>` : '');
  $('#i-ok').disabled = !l.length;
}
async function onFile(file) {
  if (!file) return;
  let r; try { r = Calc.validate(JSON.parse(await file.text())); } catch (e) { r = { ok: false, errors: ['Ce fichier n’est pas un JSON valide.'], warnings: [], events: [] }; }
  pending = r;
  const list = (a, c) => a.length ? `<ul class="l ${c}">${a.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}${a.length > 6 ? `<li>… et ${a.length - 6} autre(s)</li>` : ''}</ul>` : '';
  dlg.innerHTML = `<h2>Vérification du fichier</h2><p>${r.events.length} événement(s) valide(s) sur ${r.events.length + r.errors.length}.</p>${list(r.errors, 'warn')}${list(r.warnings, '')}` +
    (r.ok ? `<div class="btns"><button data-act="close" class="ghost">Annuler</button><button data-act="merge">Fusionner</button><button class="danger" data-act="replace">Tout remplacer</button></div><p class="mut">Fusionner : ajoute et met à jour sans rien supprimer. Tout remplacer : efface les données actuelles.</p>` : `<p class="warn">Import impossible : corrigez le fichier.</p><div class="btns"><button data-act="close">Fermer</button></div>`);
  dlg.showModal();
}

/* ---------- Bilan, rappel, pause, réglages, thème ---------- */
function year(days, from) {
  const y = from.getFullYear(), t = iso(new Date());
  const mo = Object.fromEntries(Calc.monthly(Object.fromEntries(Object.keys(days).filter(k => k.startsWith(y + '-')).map(k => [k, days[k]]))).map(m => [m.month.slice(5), m]));
  let h = `<input id="q" type="search" placeholder="Rechercher un événement (nom, mois, commentaire)" value="${esc(q)}"><div id="res">${results()}</div><div class="yr">`;
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0).getDate(), off = (first.getDay() + 6) % 7, s = mo[pad(m + 1)];
    h += `<div class="mm"><button class="mt" data-ym="${y}-${pad(m + 1)}"><span>${fr(first, { month: 'long' })}</span>${s ? `<small>${s.evenements} évt · ${F(s.total, 1)}</small>` : ''}</button><div class="mg">${'<i></i>'.repeat(off)}`;
    for (let d = 1; d <= last; d++) { const k = `${y}-${pad(m + 1)}-${pad(d)}`, x = days[k]; h += `<button data-sel="${k}" aria-label="${k}" class="${x ? (x.ot ? 'o' : x.total ? 'e' : 'p') : ''}${k === t ? ' t' : ''}">${d}</button>`; }
    h += '</div></div>';
  }
  return h + '</div><p class="mut"><b class="lgd e"></b> jour avec événement · <b class="lgd o"></b> avec heures sup. · <b class="lgd p"></b> à compléter · touchez un jour ou un mois pour l’ouvrir</p>';
}
const BS = { jour: 'Jour', semaine: 'Semaine', mois: 'Mois', annee: 'Année' };
function bilan(days, ks, S, u, from) {
  const card = (v, l, o) => `<div class="st${o ? ' ot' : ''}"><b>${v}</b><span>${l}</span></div>`;
  const row = (a, e, w, ot) => `<tr><td>${a}</td><td>${e}</td><td>${w}</td><td class="${ot ? 'ot' : ''}">${F(ot)}</td></tr>`;
  let rows = '';
  if (u === 'annee') rows = Calc.monthly(Object.fromEntries(ks.map(k => [k, days[k]]))).map(m => row(fr(new Date(from.getFullYear(), +m.month.slice(5) - 1, 1), { month: 'long' }), F(m.span), F(m.total), m.ot)).join('');
  else if (u !== 'jour') rows = ks.map(k => row(fr(pd(k), { weekday: 'short', day: 'numeric' }), F(days[k].span), F(days[k].total), days[k].ot)).join('');
  return `<div class="panel"><label style="margin:0">Période du bilan<select id="bs">${Object.entries(BS).map(([k, v]) => `<option value="${k}"${k === u ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="stats s3">${card(F(S.span, 1), 'Temps event')}${card(F(S.total, 1), 'Temps travaillé')}${card(F(S.ot, 1), 'Heures sup.', 1)}</div>` +
    (rows ? `<div class="panel"><table><tr><th>${u === 'annee' ? 'Mois' : 'Jour'}</th><th>Event</th><th>Travaillé</th><th>Sup.</th></tr>${rows}</table></div>` : '<p class="mut">Aucun événement sur cette période.</p>');
}
function banner() {
  if (!events.length) return '';
  const today = iso(new Date()), todo = events.filter(e => !e.start && e.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const h = todo.length ? `<div class="banner"><span>${todo.length} événement(s) passé(s) sans horaires réels.</span><button data-id="${todo[0].id}">Compléter</button></div>` : '';
  const ref = localStorage.getItem('lastExport') || localStorage.getItem('firstUse'), n = ref ? Math.floor((Date.now() - new Date(ref)) / 864e5) : 0;
  return h + (n < 30 ? '' : `<div class="banner"><span>${localStorage.getItem('lastExport') ? `Dernier export il y a ${n} jours.` : 'Vos données n’ont jamais été exportées.'}</span><button data-act="export">Exporter</button></div>`);
}
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function results() {
  const t = norm(q.trim()); if (!t) return '';
  const l = events.filter(e => norm(`${e.name} ${e.comment} ${e.date} ${fr(pd(e.date), { month: 'long', year: 'numeric' })}`).includes(t)).sort((a, b) => b.date.localeCompare(a.date));
  return `<p class="mut">${l.length} résultat(s)${l.length > 40 ? ' (40 premiers)' : ''}</p>` + l.slice(0, 40).map(e => `<div class="ev" data-id="${e.id}"><strong>${esc(e.name)}</strong><span>${fr(pd(e.date), { day: 'numeric', month: 'short', year: 'numeric' })} · ${times(e)}</span></div>`).join('');
}
function gauge(total) {
  const goal = settings.week * 60, p = Math.min(100, Math.round(total / goal * 100)), diff = total - goal;
  return `<div class="gauge${diff > 0 ? ' over' : ''}"><div class="gl"><span><b>${F(total, 1)}</b> sur ${F(goal, 1)}</span><span class="mut">${p} %</span></div><div class="gb"><i style="width:${p}%"></i></div><small class="mut">${diff > 0 ? `+${F(diff)} au-dessus de l’objectif` : diff < 0 ? `Il reste ${F(-diff)}` : 'Objectif atteint'}</small></div>`;
}
function pauseDlg(k) {
  const x = Calc.byDay(events, opts())[k]; if (!x) return;
  dlg.innerHTML = `<h2>Pause déjeuner</h2><p class="mut">${fr(pd(k), { weekday: 'long', day: 'numeric', month: 'long' })}<br>${x.manual ? 'Valeur saisie à la main.' : 'Calcul automatique : ' + F(x.pause)}</p>
    <label>Pause à déduire (minutes, 0 = aucune)<input type="number" id="p-min" min="0" max="480" step="5" value="${x.pause}"></label>
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button class="ghost" data-act="autopause" data-k="${k}">Automatique</button><button data-act="savepause" data-k="${k}">Enregistrer</button></div>`;
  dlg.showModal();
}
async function saveSettings() {
  const n = id => +$('#' + id).value, s = { normal: n('s-n'), pause: n('s-p'), from: n('s-f'), to: n('s-t'), week: n('s-w'), prep: n('s-pd') };
  if (!(s.normal > 0 && s.normal <= 16) || !(s.prep >= 0 && s.prep <= 600) || !(s.week > 0 && s.week <= 80) || !(s.pause >= 0 && s.pause <= 240) || !(s.from >= 0 && s.to > s.from && s.to <= 24)) return toast('Valeurs invalides');
  settings = s; await putMeta('settings', s); render(); toast('Règles enregistrées');
}
function applyTheme() {
  let t = localStorage.getItem('theme') || 'bordeaux';
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'sombre' : 'bordeaux';
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
}
document.addEventListener('change', e => {
  if (e.target.id === 'vs') { view = e.target.value; if (view === 'jour') { const s = pd(sel); if (s.getFullYear() === cur.getFullYear() && s.getMonth() === cur.getMonth()) cur = s; } render(); }
  else if (e.target.id === 'bs') { bscope = e.target.value; localStorage.setItem('bscope', bscope); render(); }
});

/* ---------- Événements ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-nav],[data-sel],[data-add],[data-id],[data-act],[data-pause],[data-ym],[data-th],[data-prep]'); if (!t) return;
  const d = t.dataset;
  if (d.nav !== undefined) {
    const n = +d.nav, u = unit();
    if (!n) { cur = new Date(); sel = iso(cur); }
    else if (u === 'jour') cur = addDays(cur, n);
    else if (u === 'semaine') cur = addDays(cur, 7 * n);
    else if (u === 'annee') cur = new Date(cur.getFullYear() + n, cur.getMonth(), 1);
    else cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
    return render();
  }
  if (d.sel) { sel = d.sel; if (view === 'annee') { cur = pd(d.sel); view = 'mois'; } return render(); }
  if (d.ym) { const [yy, mm] = d.ym.split('-'); cur = new Date(+yy, +mm - 1, 1); view = 'mois'; return render(); }
  if (d.add) return formDlg(blank(d.add));
  if (d.pause) return pauseDlg(d.pause);
  if (d.th) { localStorage.setItem('theme', d.th); applyTheme(); return render(); }
  if (d.prep !== undefined) { $('#f-prep').value = d.prep; return calcForm(); }
  switch (d.act) {
    case 'new': return formDlg(blank());
    case 'close': return dlg.close();
    case 'save': return saveForm();
    case 'edit': dlg.close(); return formDlg({ ...events.find(x => x.id === d.id) });
    case 'del': { const ev = events.find(x => x.id === d.id); await del(d.id); await load(); dlg.close(); render(); lastDel = ev; return toast('Événement supprimé', 'Annuler'); }
    case 'undo': if (lastDel) { await save(lastDel); await load(); sel = lastDel.date; lastDel = null; render(); toast('Événement rétabli'); } return;
    case 'dup': dlg.close(); return formDlg({ ...events.find(x => x.id === d.id), id: Calc.uid() });
    case 'savepause': dayPause[d.k] = Math.max(0, Math.min(480, +$('#p-min').value || 0)); await putMeta('dayPause', dayPause); dlg.close(); render(); return toast('Pause enregistrée');
    case 'autopause': delete dayPause[d.k]; await putMeta('dayPause', dayPause); dlg.close(); render(); return toast('Pause automatique rétablie');
    case 'savesettings': return saveSettings();
    case 'export': return exportJSON();
    case 'ics': return exportICS();
    case 'xlsx': return exportXLSX();
    case 'icsimport': $('#icsfile').value = ''; return $('#icsfile').click();
    case 'doics': await bulk(pending.sel.map(e => ({ ...e, prep: settings.prep })), false); await load(); dlg.close(); render(); return toast(`${pending.sel.length} événement(s) ajouté(s) : complétez les horaires`);
    case 'import': $('#file').value = ''; return $('#file').click();
    case 'merge': case 'replace':
      if (d.act === 'replace' && !confirm('Remplacer TOUTES les données actuelles par celles du fichier ?')) return;
      await bulk(pending.events, d.act === 'replace');
      dayPause = d.act === 'replace' ? { ...pending.dayPause } : { ...dayPause, ...pending.dayPause }; await putMeta('dayPause', dayPause);
      if (d.act === 'replace' && pending.settings) { settings = { ...DEF, ...pending.settings }; await putMeta('settings', settings); } await load(); dlg.close(); render(); return toast(`${pending.events.length} événement(s) importé(s)`);
  }
  if (d.id) detail(d.id);
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { q = e.target.value; $('#res').innerHTML = results(); }
  else if (e.target.id && e.target.id.startsWith('i-')) icsPreview();
  else if (dlg.open && e.target.id && e.target.id.startsWith('f-')) calcForm();
});
$('#file').addEventListener('change', e => onFile(e.target.files[0]));
$('#icsfile').addEventListener('change', e => onICS(e.target.files[0]));

(async () => {
  applyTheme(); if (!localStorage.getItem('firstUse')) localStorage.setItem('firstUse', new Date().toISOString());
  try { db = await open(); await load(); } catch (e) { $('#main').innerHTML = '<p class="warn">Stockage local indisponible. Évitez la navigation privée.</p>'; return; }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) $('#upd').hidden = false; });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
})();
