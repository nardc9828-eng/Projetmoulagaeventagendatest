/* Calculs partagés (téléphone + ordinateur). Les durées sont en minutes. */
(function (g) {
  const NORMAL = 420; // 7 h de travail effectif par jour (8 h de présence - 1 h de pause)
  const PAUSE = 60, LUNCH_FROM = 720, LUNCH_TO = 840; // pause déjeuner 1 h, plage 12h-14h
  const RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const tm = s => (s && RE.test(s) ? +s.split(':')[0] * 60 + +s.split(':')[1] : null);
  // Intervalle [début, fin] en minutes ; si la fin est avant le début, elle tombe après minuit (+24 h)
  function iv(a, b) {
    const s = tm(a), e = tm(b);
    if (s === null || e === null) return null;
    return [s, e < s ? e + 1440 : e];
  }
  const len = i => (i ? i[1] - i[0] : 0);
  // Durée de l'union des intervalles : un même horaire n'est jamais compté deux fois
  function union(list) {
    const a = list.filter(Boolean).sort((x, y) => x[0] - y[0]);
    let tot = 0, cs = null, ce = null;
    for (const [s, e] of a) {
      if (cs === null) { cs = s; ce = e; }
      else if (s <= ce) ce = Math.max(ce, e);
      else { tot += ce - cs; cs = s; ce = e; }
    }
    return cs === null ? tot : tot + ce - cs;
  }
  const durations = ev => ({ prep: len(iv(ev.prepStart, ev.prepEnd)), real: len(iv(ev.start, ev.end)) });
  // Regroupe par date (un événement qui passe minuit reste rattaché à sa date de début)
  function byDay(events, o = {}) {
    const NORM = o.normal ?? NORMAL, PA = o.pause ?? PAUSE, LF = o.from ?? LUNCH_FROM, LT = o.to ?? LUNCH_TO, dp = o.dayPause || {};
    const days = {};
    for (const ev of events) {
      const d = days[ev.date] || (days[ev.date] = { events: [], p: [], r: [] });
      d.events.push(ev);
      d.p.push(iv(ev.prepStart, ev.prepEnd));
      d.r.push(iv(ev.start, ev.end));
    }
    for (const k in days) {
      const d = days[k];
      d.events.sort((a, b) => (a.prepStart || a.start || '99').localeCompare(b.prepStart || b.start || '99'));
      d.prep = union(d.p);
      d.real = union(d.r);
      const all = [...d.p, ...d.r];
      d.presence = union(all); // temps de présence sur site (sans double comptage)
      // Pause déjeuner : 1 h déduite si vous êtes présent sur la plage 12h-14h,
      // moins l'éventuelle coupure déjà présente dans cette plage.
      const win = union(all.map(i => i && [Math.max(i[0], LF), Math.min(i[1], LT)]).filter(i => i && i[1] > i[0]));
      const gap = (LT - LF) - win;
      d.pause = Math.min(Math.max(0, PA - gap), win);
      d.manual = dp[k] !== undefined; // pause saisie à la main pour ce jour
      if (d.manual) d.pause = Math.min(dp[k], d.presence);
      d.total = d.presence - d.pause; // travail effectif
      d.normal = Math.min(d.total, NORM);
      d.ot = Math.max(0, d.total - NORM);
    }
    return days;
  }
  function sum(list) {
    const s = { jours: list.length, prep: 0, real: 0, presence: 0, pause: 0, total: 0, normal: 0, ot: 0 };
    for (const d of list) for (const k of ['prep', 'real', 'presence', 'pause', 'total', 'normal', 'ot']) s[k] += d[k];
    return s;
  }
  function monthly(days) {
    const m = {};
    for (const k of Object.keys(days).sort()) {
      const key = k.slice(0, 7), d = days[k];
      const x = m[key] || (m[key] = { month: key, evenements: 0, days: [] });
      x.evenements += d.events.length;
      x.days.push(d);
    }
    return Object.values(m).map(x => ({ month: x.month, evenements: x.evenements, ...sum(x.days) }));
  }
  const fmt = (m, short) => {
    const h = Math.floor(m / 60), mm = m % 60;
    return short && mm === 0 ? h + 'h' : h + 'h' + String(mm).padStart(2, '0');
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Vérifie un fichier JSON importé
  function validate(data) {
    const errors = [], warnings = [], events = [], seen = new Set();
    const arr = Array.isArray(data) ? data : data && data.events;
    if (!Array.isArray(arr)) return { ok: false, errors: ['Fichier invalide : la liste "events" est introuvable.'], warnings, events };
    arr.forEach((e, i) => {
      const p = 'Événement ' + (i + 1) + (e && e.name ? ' (« ' + e.name + ' »)' : '');
      if (!e || typeof e !== 'object') return errors.push(p + ' : format invalide');
      if (!e.name || typeof e.name !== 'string') return errors.push(p + ' : nom manquant');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || isNaN(new Date(e.date))) return errors.push(p + ' : date invalide');
      const ev = { id: String(e.id || uid()), name: e.name.trim(), date: e.date, comment: String(e.comment || '') };
      let bad = false;
      for (const k of ['prepStart', 'prepEnd', 'start', 'end']) {
        ev[k] = e[k] || '';
        if (ev[k] && tm(ev[k]) === null) { errors.push(p + ' : heure « ' + k + ' » invalide'); bad = true; }
      }
      if (bad) return;
      if (!ev.prepStart !== !ev.prepEnd) warnings.push(p + ' : préparation incomplète (ignorée dans les calculs)');
      if (!ev.start !== !ev.end) warnings.push(p + ' : horaires réels incomplets (ignorés dans les calculs)');
      if (seen.has(ev.id)) return warnings.push(p + ' : identifiant en double (ignoré)');
      seen.add(ev.id);
      events.push(ev);
    });
    const src = data && !Array.isArray(data) ? data : {}, dayPause = {}, st = src.settings;
    for (const [k, v] of Object.entries(src.dayPause || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(+v) && v >= 0 && v <= 480) dayPause[k] = +v;
    const settings = st && st.normal > 0 && st.normal <= 16 && st.pause >= 0 && st.to > st.from ? { normal: +st.normal, pause: +st.pause, from: +st.from, to: +st.to } : null;
    return { ok: errors.length === 0, errors, warnings, events, dayPause, settings };
  }
  // Export .ics (agenda du téléphone / ordinateur). Heures "flottantes" = heure locale.
  function toICS(events) {
    const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const ymd = d => d.replace(/-/g, ''), p2 = n => String(n).padStart(2, '0');
    const hm = t => { const [h, m] = t.split(':'); return p2(h) + m + '00'; };
    const nextDay = d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.getFullYear() + p2(x.getMonth() + 1) + p2(x.getDate()); };
    const fold = l => l.length <= 73 ? l : l.match(/.{1,73}/g).join('\r\n ');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda Evenements//FR', 'CALSCALE:GREGORIAN'];
    for (const e of events) {
      L.push('BEGIN:VEVENT', 'UID:' + e.id + '@agenda-evenements', 'DTSTAMP:' + stamp, 'SUMMARY:' + esc(e.name));
      const r = iv(e.start, e.end);
      if (r) L.push('DTSTART:' + ymd(e.date) + 'T' + hm(e.start), 'DTEND:' + (r[1] > 1440 ? nextDay(e.date) : ymd(e.date)) + 'T' + hm(e.end));
      else L.push('DTSTART;VALUE=DATE:' + ymd(e.date), 'DTEND;VALUE=DATE:' + nextDay(e.date));
      if (e.comment) L.push('DESCRIPTION:' + esc(e.comment));
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  const api = { toICS, NORMAL, tm, iv, union, durations, byDay, sum, monthly, fmt, uid, validate };
  if (typeof module !== 'undefined') module.exports = api; else g.Calc = api;
})(this);
