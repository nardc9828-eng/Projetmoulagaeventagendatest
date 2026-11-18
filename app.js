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
const dlg = $('#dlg');
let db, events = [], view = 'mois', cur = new Date(), sel = iso(new Date()), q = '', editing = null, pending = null;

/* ---------- Stockage local (IndexedDB) ---------- */
const open = () => new Promise((ok, ko) => {
  const r = indexedDB.open('agenda-evenements', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('events', { keyPath: 'id' });
  r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
});
const tx = (mode, fn) => new Promise((ok, ko) => {
  const t = db.transaction('events', mode), r = fn(t.objectStore('events'));
  t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
});
const load = async () => { events = await tx('readonly', s => s.getAll()); };
const save = ev => tx('readwrite', s => s.put(ev));
const del = id => tx('readwrite', s => s.delete(id));
const bulk = (list, replace) => tx('readwrite', s => { if (replace) s.clear(); list.forEach(e => s.put(e)); });

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2600); }

/* ---------- Rendu ---------- */
const times = e => [e.prepStart && `Prép. ${e.prepStart}–${e.prepEnd}`, e.start && `Évt ${e.start}–${e.end}`].filter(Boolean).join(' · ') || 'Pas d’horaires';
const stats = (n, S) => `<div class="stats">${[[n, 'Événements'], [F(S.prep, 1), 'Préparation'], [F(S.real, 1), 'Événement'], [F(S.total, 1), 'Travaillé']].map(([v, l]) => `<div class="st"><b>${v}</b><span>${l}</span></div>`).join('')}<div class="st ot"><b>${F(S.ot, 1)}</b><span>Heures sup.</span></div></div>`;

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
      `<div class="chips"><span>Prép. ${F(x.prep)}</span><span>Événement ${F(x.real)}</span>${x.pause ? `<span>Pause −${F(x.pause)}</span>` : ''}<span>Normal ${F(x.normal)}</span><span class="${x.ot ? 'ot' : ''}">Sup. ${F(x.ot)}</span></div>` : '<p class="mut">Aucun événement ce jour.</p>') +
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
  const le = localStorage.getItem('lastExport'), old = !le || (Date.now() - new Date(le)) > 30 * 864e5;
  return `<div class="panel"><h3>Sauvegarde et export</h3>
    <p>${events.length} événement(s) enregistré(s) sur ce téléphone.</p>
    <p class="${old ? 'warn' : 'mut'}">${le ? 'Dernier export : ' + fr(new Date(le), { day: 'numeric', month: 'long', year: 'numeric' }) : 'Aucun export réalisé.'}${old ? ' — pensez à exporter ce mois-ci.' : ''}</p>
    <div class="btns"><button data-act="export">Exporter (JSON)</button><button data-act="import">Importer / Restaurer</button></div>
    <p class="mut">Le fichier JSON contient toutes vos données : il sert à la fois de sauvegarde, de restauration et de transfert vers l’ordinateur.</p></div>
    <div class="panel"><h3>État du stockage</h3><p class="mut" id="persist">Vérification…</p></div>`;
}
function render() {
  const days = Calc.byDay(events), nav = view === 'mois' || view === 'semaine';
  const T = { liste: 'Événements', data: 'Données' };
  let from, to, label;
  if (view === 'semaine') { from = monday(cur); to = addDays(from, 6); label = `${fr(from)} – ${fr(to, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
  else { from = new Date(cur.getFullYear(), cur.getMonth(), 1); to = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); label = cur.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); }
  $('#top').innerHTML = nav ? `<button data-nav="-1" aria-label="Précédent">‹</button><h1>${label}</h1><button data-nav="1" aria-label="Suivant">›</button><button data-nav="0" class="today">Auj.</button>` : `<h1>${T[view]}</h1>`;
  let b = '';
  if (nav) {
    const a = iso(from), z = iso(to), ks = Object.keys(days).filter(k => k >= a && k <= z);
    b = stats(events.filter(e => e.date >= a && e.date <= z).length, Calc.sum(ks.map(k => days[k]))) +
      (view === 'mois' ? cal(days, from) + dayBlock(days, sel) : Array.from({ length: 7 }, (_, i) => dayBlock(days, iso(addDays(from, i)))).join(''));
  } else if (view === 'liste') b = `<input id="q" type="search" placeholder="Rechercher (nom, mois, commentaire)" value="${esc(q)}"><div id="res">${items()}</div>`;
  else b = dataView();
  $('#main').innerHTML = b;
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
    <fieldset><legend>Préparation</legend><div class="row">${f('f-ps', 'Début', ev.prepStart)}${f('f-pe', 'Fin', ev.prepEnd)}</div></fieldset>
    <fieldset><legend>Événement (horaires réels)</legend><div class="row">${f('f-s', 'Début', ev.start)}${f('f-e', 'Fin', ev.end)}</div></fieldset>
    <p id="f-calc" class="mut"></p><label>Commentaires<textarea id="f-c" rows="2">${esc(ev.comment)}</textarea></label>
    <div class="btns"><button class="ghost" data-act="close">Annuler</button><button data-act="save">Enregistrer</button></div>`;
  calcForm(); dlg.showModal();
}
function calcForm() {
  const v = i => $('#' + i).value, d = Calc.durations({ prepStart: v('f-ps'), prepEnd: v('f-pe'), start: v('f-s'), end: v('f-e') });
  $('#f-calc').textContent = `Préparation : ${F(d.prep)} · Événement : ${F(d.real)}${Calc.tm(v('f-e')) !== null && Calc.tm(v('f-s')) !== null && Calc.tm(v('f-e')) < Calc.tm(v('f-s')) ? ' (finit après minuit)' : ''}`;
}
const blank = d => ({ id: Calc.uid(), name: '', date: d || sel, prepStart: '', prepEnd: '', start: '', end: '', comment: '' });
async function saveForm() {
  const g = i => $('#' + i).value.trim();
  const ev = { ...editing, name: g('f-name'), date: g('f-date'), prepStart: g('f-ps'), prepEnd: g('f-pe'), start: g('f-s'), end: g('f-e'), comment: g('f-c') };
  if (!ev.name || !ev.date) return toast('Le nom et la date sont obligatoires');
  if (!ev.prepStart !== !ev.prepEnd || !ev.start !== !ev.end) return toast('Renseignez le début ET la fin');
  try { await save(ev); await load(); } catch (e) { return toast('Échec de l’enregistrement'); }
  sel = ev.date; cur = pd(ev.date); dlg.close(); render(); toast('Enregistré');
}
function detail(id) {
  const e = events.find(x => x.id === id); if (!e) return;
  const d = Calc.durations(e), x = Calc.byDay(events)[e.date];
  dlg.innerHTML = `<h2>${esc(e.name)}</h2><p class="mut">${fr(pd(e.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <p><b>Préparation</b> : ${e.prepStart ? `${e.prepStart} → ${e.prepEnd} (${F(d.prep)})` : '—'}<br><b>Événement</b> : ${e.start ? `${e.start} → ${e.end} (${F(d.real)})` : '—'}</p>
    ${e.comment ? `<p>${esc(e.comment).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="chips"><span>Présence ${F(x.presence)}</span>${x.pause ? `<span>Pause −${F(x.pause)}</span>` : ''}<span>Travaillé ${F(x.total)}</span><span>Normal ${F(x.normal)}</span><span class="${x.ot ? 'ot' : ''}">Sup. ${F(x.ot)}</span></div>
    <div class="btns"><button class="ghost" data-act="close">Fermer</button><button data-act="edit" data-id="${e.id}">Modifier</button><button class="danger" data-act="del" data-id="${e.id}">Supprimer</button></div>`;
  dlg.showModal();
}

/* ---------- Export / import ---------- */
async function exportJSON() {
  const data = { app: 'agenda-evenements', version: 1, exportedAt: new Date().toISOString(), events };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name = `agenda-${iso(new Date())}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); localStorage.setItem('lastExport', new Date().toISOString()); return render(); } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
  localStorage.setItem('lastExport', new Date().toISOString()); toast('Fichier exporté'); render();
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

/* ---------- Événements ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-nav],[data-sel],[data-add],[data-id],[data-tab],[data-act]'); if (!t) return;
  const d = t.dataset;
  if (d.nav !== undefined) { const n = +d.nav; if (!n) { cur = new Date(); sel = iso(cur); } else if (view === 'semaine') cur = addDays(cur, 7 * n); else cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1); return render(); }
  if (d.tab) { view = d.tab; return render(); }
  if (d.sel) { sel = d.sel; return render(); }
  if (d.add) return formDlg(blank(d.add));
  switch (d.act) {
    case 'new': return formDlg(blank());
    case 'close': return dlg.close();
    case 'save': return saveForm();
    case 'edit': dlg.close(); return formDlg({ ...events.find(x => x.id === d.id) });
    case 'del': if (confirm('Supprimer définitivement cet événement ?')) { await del(d.id); await load(); dlg.close(); render(); toast('Supprimé'); } return;
    case 'export': return exportJSON();
    case 'import': $('#file').value = ''; return $('#file').click();
    case 'merge': case 'replace':
      if (d.act === 'replace' && !confirm('Remplacer TOUTES les données actuelles par celles du fichier ?')) return;
      await bulk(pending.events, d.act === 'replace'); await load(); dlg.close(); render(); return toast(`${pending.events.length} événement(s) importé(s)`);
  }
  if (d.id) detail(d.id);
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { q = e.target.value; $('#res').innerHTML = items(); }
  else if (dlg.open && e.target.id && e.target.id.startsWith('f-')) calcForm();
});
$('#file').addEventListener('change', e => onFile(e.target.files[0]));

(async () => {
  try { db = await open(); await load(); } catch (e) { $('#main').innerHTML = '<p class="warn">Stockage local indisponible. Évitez la navigation privée.</p>'; return; }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
