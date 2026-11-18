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
const THEMES = { bordeaux: 'Bordeaux et or', bleu: 'Bleu marine', foret: 'Vert forêt', sombre: 'Sombre', auto: 'Automatique (clair / sombre)' };
const dlg = $('#dlg');
const DEF = { normal: 7, pause: 60, from: 12, to: 14 };
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
const times = e => e.start ? `${e.start} → ${e.end}` : 'Pas d’horaires';
const stats = (n, S) => `<div class="stats">${[[n, 'Événements'], [F(S.total, 1), 'Travaillé']].map(([v, l]) => `<div class="st"><b>${v}</b><span>${l}</span></div>`).join('')}<div class="st ot"><b>${F(S.ot, 1)}</b><span>Heures sup.</span></div></div>`;

function cal(days, first) {
  const m = first.getMonth(), t = iso(new Date()), last = new Date(first.getFullYear(), m + 1, 0);
  let h = '<div class="cal">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<i>${x}</i>`).join('');
  for (let d = monday(first); d <= last || (d.getDay() + 6) % 7 !== 0; d = addDays(d, 1)) {
    const k = iso(d), x = days[k];
    h += `<button data-sel="${k}" class="${d.getMonth() !== m ? 'out ' : ''}${k === t ? 'today ' : ''}${k === sel ? 'sel' : ''}"><span>${d.getDate()}</span>${x ? `<small>${F(x.total, 1)}</small>${x.ot ? `<em>+${F(x.ot, 1)}</em>` : ''}` : ''}</button>`;
  }
  return h + '</div>';
}
function dayBlock(days, k) {
  const x = days[k];
  return `<section class="day"><h3>${fr(pd(k), { weekday: 'long', day: 'numeric', month: 'long' })}${x ? `<b>${F(x.total)}</b>` : ''}</h3>` +
    (x ? x.events.map(e => `<div class="ev" data-id="${e.id}"><strong>${esc(e.name)}</strong><span>${times(e)}</span></div>`).join('') +
      `<div class="chips"><span>Présence ${F(x.presence)}</span><button data-pause="${k}">Pause ${x.pause ? '−' + F(x.pause) : '0'}${x.manual ? ' ✎' : ''}</button><span class="${x.ot ? 'ot' : ''}">Sup. ${F(x.ot)}</span></div>` : '<p class="mut">Aucun événement ce jour.</p>') +
    `<button class="ghost" data-add="${k}">+ Ajouter un événement</button></section>`;
}
const items = () => {
  const t = q.toLowerCase();
  const l = events.filter(e => !t || (e.name + ' ' + e.comment + ' ' + e.date + ' ' + fr(pd(e.date), { month: 'long' })).toLowerCase().includes(t))
    .sort((a, b) => b.date.localeCompare(a.date) || (a.prepStart || a.start).localeCompare(b.prepStart || b.start));
  return l.length ? l.map(e => `<div class="ev" data-id="${e.id}"><strong>${esc(e.name)}</strong><span>${fr(pd(e.date), { day: 'numeric', month: 'short', year: 'numeric' })} · ${times(e)}</span></div>`).join('')
    : `<p class="mut">${events.length ? 'Aucun résultat.' : 'Aucun événement. Touchez + pour créer le premier.'}</p>`;
};
function dataView() {
  const le = localStorage.getItem('lastExport'), old = !le || (Date.now() - new Date(le)) > 30 * 864e5, th = localStorage.getItem('theme') || 'bordeaux';
  const inp = (id, l, v, st) => `<label>${l}<input type="number" id="${id}" value="${v}" step="${st}"></label>`;
  return `<div class="panel"><h3>Sauvegarde et export</h3>
    <p>${events.length} événement(s) enregistré(s) sur ce téléphone.</p>
    <p class="${old ? 'warn' : 'mut'}">${le ? 'Dernier export : ' + fr(new Date(le), { day: 'numeric', month: 'long', year: 'numeric' }) : 'Aucun export réalisé.'}${old ? ' — pensez à exporter ce mois-ci.' : ''}</p>
    <div class="btns"><button data-act="export">Exporter (JSON)</button><button data-act="import">Importer / Restaurer</button><button class="ghost" data-act="ics">Vers l’agenda (.ics)</button></div>
    <p class="mut">Le fichier JSON contient événements, pauses modifiées et règles : sauvegarde, restauration et transfert vers l’ordinateur. Le fichier .ics ajoute vos événements à l’agenda du téléphone (il ne remplace pas la sauvegarde JSON).</p></div>
    <div class="panel"><h3>Règles de calcul</h3><div class="row">${inp('s-n', 'Travail normal (h/jour)', settings.normal, '0.25')}${inp('s-p', 'Pause (min)', settings.pause, '5')}</div>
    <div class="row">${inp('s-f', 'Pause entre (h)', settings.from, '0.5')}${inp('s-t', 'et (h)', settings.to, '0.5')}</div>
    <div class="btns"><button data-act="savesettings">Enregistrer les règles</button></div>
    <p class="mut">S’applique à tout l’historique. Une pause se corrige aussi jour par jour avec le bouton « Pause » de chaque journée.</p></div>
    <div class="panel"><h3>Apparence</h3><label>Thème<select id="theme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}"${k === th ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="panel"><h3>État du stockage</h3><p class="mut" id="persist">Vérification…</p></div>`;
}
function render() {
  const days = Calc.byDay(events, opts()), nav = view === 'mois' || view === 'semaine' || view === 'bilan';
  const T = { liste: 'Événements', data: 'Données', bilan: 'Bilan' };
  let from, to, label;
  if (view === 'semaine') { from = monday(cur); to = addDays(from, 6); label = `${fr(from)} – ${fr(to, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
  else { from = new Date(cur.getFullYear(), cur.getMonth(), 1); to = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); label = cur.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }
  $('#top').innerHTML = nav ? `<button data-nav="-1" aria-label="Précédent">‹</button><h1>${label}</h1><button data-nav="1" aria-label="Suivant">›</button><button data-nav="0" class="today">Auj.</button>` : `<h1>${T[view]}</h1>`;
  let b = '';
  if (nav) {
    const a = iso(from), z = iso(to), ks = Object.keys(days).filter(k => k >= a && k <= z);
    b = stats(events.filter(e => e.date >= a && e.date <= z).length, Calc.sum(ks.map(k => days[k]))) +
      (view === 'mois' ? cal(days, from) + dayBlock(days, sel) : view === 'bilan' ? bilan(days, ks, from) : Array.from({ length: 7 }, (_, i) => dayBlock(days, iso(addDays(from, i)))).join(''));
  } else if (view === 'liste') b = `<input id="q" type="search" placeholder="Rechercher (nom, mois, commentaire)" value="${esc(q)}"><div id="res">${items()}</div>`;
  else b = dataView();
  $('#main').innerHTML = banner() + b;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === view));
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
    <p id="f-calc" class="mut"></p><label>Commentaires<textarea id="f-c" rows="2">${esc(ev.comment)}</textarea></label>
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button data-act="save">Enregistrer</button></div>`;
  calcForm(); dlg.showModal();
}
function calcForm() {
  const v = i => $('#' + i).value, s = Calc.tm(v('f-s')), e = Calc.tm(v('f-e'));
  $('#f-calc').textContent = `Durée : ${F(Calc.durations({ start: v('f-s'), end: v('f-e') }).real)}${s !== null && e !== null && e < s ? ' (finit après minuit)' : ''}`;
}
const blank = d => { let t = {}; try { t = JSON.parse(localStorage.getItem('lastTimes') || '{}'); } catch (e) {} return { id: Calc.uid(), name: '', date: d || sel, prepStart: '', prepEnd: '', start: t.start || '', end: t.end || '', comment: '' }; };
async function saveForm() {
  const g = i => $('#' + i).value.trim();
  const ev = { ...editing, name: g('f-name'), date: g('f-date'), prepStart: '', prepEnd: '', start: g('f-s'), end: g('f-e'), comment: g('f-c') };
  if (!ev.name || !ev.date) return toast('Le nom et la date sont obligatoires');
  if (!ev.start !== !ev.end) return toast('Renseignez le début ET la fin');
  try { await save(ev); await load(); localStorage.setItem('lastTimes', JSON.stringify({ start: ev.start, end: ev.end })); } catch (e) { return toast('Échec de l’enregistrement'); }
  sel = ev.date; cur = pd(ev.date); dlg.close(); render(); toast('Enregistré');
}
function detail(id) {
  const e = events.find(x => x.id === id); if (!e) return;
  const d = Calc.durations(e), x = Calc.byDay(events, opts())[e.date];
  dlg.innerHTML = `<h2>${esc(e.name)}</h2><p class="mut">${fr(pd(e.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <p><b>Horaires</b> : ${e.start ? `${e.start} → ${e.end} (${F(d.real)})` : '—'}</p>
    ${e.comment ? `<p>${esc(e.comment).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="chips"><span>Présence ${F(x.presence)}</span>${x.pause ? `<span>Pause −${F(x.pause)}</span>` : ''}<span>Travaillé ${F(x.total)}</span><span class="${x.ot ? 'ot' : ''}">Sup. ${F(x.ot)}</span></div>
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
async function exportICS() {
  const name = `agenda-${iso(new Date())}.ics`, blob = new Blob([Calc.toICS(events)], { type: 'text/calendar' }), file = new File([blob], name, { type: 'text/calendar' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4); toast('Fichier .ics prêt');
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
function bilan(days, ks, from) {
  const y = String(from.getFullYear()), S = Calc.sum(ks.map(k => days[k]));
  const mo = Calc.monthly(Object.fromEntries(Object.keys(days).filter(k => k.startsWith(y)).map(k => [k, days[k]])));
  const row = (a, b, c, o) => `<tr><td>${a}</td><td>${b}</td><td class="${o ? 'ot' : ''}">${c}</td></tr>`;
  return `<div class="panel"><h3>Résumé du mois</h3><p>${S.jours} jour(s) travaillé(s) · présence ${F(S.presence)} · pause −${F(S.pause)}<br><b>Total ${F(S.total)}</b> · <b class="warn">heures sup. ${F(S.ot)}</b></p></div>
    <div class="panel"><h3>Jour par jour</h3><table><tr><th>Date</th><th>Travaillé</th><th>Sup.</th></tr>${ks.map(k => row(fr(pd(k), { weekday: 'short', day: 'numeric' }), F(days[k].total), F(days[k].ot), days[k].ot)).join('') || '<tr><td colspan="3" class="mut">Aucun événement ce mois-ci.</td></tr>'}</table></div>
    <div class="panel"><h3>Année ${y}</h3><table><tr><th>Mois</th><th>Travaillé</th><th>Sup.</th></tr>${mo.map(m => row(fr(new Date(+y, +m.month.slice(5) - 1, 1), { month: 'long' }), F(m.total), F(m.ot), m.ot)).join('') || '<tr><td colspan="3" class="mut">—</td></tr>'}</table></div>`;
}
function banner() {
  if (!events.length) return '';
  const ref = localStorage.getItem('lastExport') || localStorage.getItem('firstUse'), n = ref ? Math.floor((Date.now() - new Date(ref)) / 864e5) : 0;
  return n < 30 ? '' : `<div class="banner"><span>${localStorage.getItem('lastExport') ? `Dernier export il y a ${n} jours.` : 'Vos données n’ont jamais été exportées.'}</span><button data-act="export">Exporter</button></div>`;
}
function pauseDlg(k) {
  const x = Calc.byDay(events, opts())[k]; if (!x) return;
  dlg.innerHTML = `<h2>Pause déjeuner</h2><p class="mut">${fr(pd(k), { weekday: 'long', day: 'numeric', month: 'long' })}<br>${x.manual ? 'Valeur saisie à la main.' : 'Calcul automatique : ' + F(x.pause)}</p>
    <label>Pause à déduire (minutes, 0 = aucune)<input type="number" id="p-min" min="0" max="480" step="5" value="${x.pause}"></label>
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button class="ghost" data-act="autopause" data-k="${k}">Automatique</button><button data-act="savepause" data-k="${k}">Enregistrer</button></div>`;
  dlg.showModal();
}
async function saveSettings() {
  const n = id => +$('#' + id).value, s = { normal: n('s-n'), pause: n('s-p'), from: n('s-f'), to: n('s-t') };
  if (!(s.normal > 0 && s.normal <= 16) || !(s.pause >= 0 && s.pause <= 240) || !(s.from >= 0 && s.to > s.from && s.to <= 24)) return toast('Valeurs invalides');
  settings = s; await putMeta('settings', s); render(); toast('Règles enregistrées');
}
function applyTheme() {
  let t = localStorage.getItem('theme') || 'bordeaux';
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'sombre' : 'bordeaux';
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
}
document.addEventListener('change', e => { if (e.target.id === 'theme') { localStorage.setItem('theme', e.target.value); applyTheme(); render(); } });

/* ---------- Événements ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-nav],[data-sel],[data-add],[data-id],[data-tab],[data-act],[data-pause]'); if (!t) return;
  const d = t.dataset;
  if (d.nav !== undefined) { const n = +d.nav; if (!n) { cur = new Date(); sel = iso(cur); } else if (view === 'semaine') cur = addDays(cur, 7 * n); else cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1); return render(); }
  if (d.tab) { view = d.tab; return render(); }
  if (d.sel) { sel = d.sel; return render(); }
  if (d.add) return formDlg(blank(d.add));
  if (d.pause) return pauseDlg(d.pause);
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
  if (e.target.id === 'q') { q = e.target.value; $('#res').innerHTML = items(); }
  else if (dlg.open && e.target.id && e.target.id.startsWith('f-')) calcForm();
});
$('#file').addEventListener('change', e => onFile(e.target.files[0]));

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
