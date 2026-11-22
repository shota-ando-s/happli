/* 差し込み文書の一括作成: 画面に依存しない処理。ブラウザでは window.MacroApps.sashikomi、Node では module.exports
   敬称の決まりと郵便番号の整え方は「宛名ラベル・封筒の印刷」（assets/js/apps/atena.js）のものをそのまま使う */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const atena = typeof require !== 'undefined' ? require('./atena.js') : root.MacroApps.atena;
  const api = factory(kana, atena);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.sashikomi = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, atena) {
  const FORMAT_ID = 'happli-sashikomi';
  const FORMATS = ['円', '和暦', '西暦'];
  const str = (v) => (v == null ? '' : String(v));
  const half = (s) => str(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  /* ---------- 日付 ---------- */
  const ERAS = [
    { name: '令和', short: 'R', start: [2019, 5, 1] },
    { name: '平成', short: 'H', start: [1989, 1, 8] },
    { name: '昭和', short: 'S', start: [1926, 12, 25] },
    { name: '大正', short: 'T', start: [1912, 7, 30] },
    { name: '明治', short: 'M', start: [1868, 1, 25] },
  ];
  const key = (y, m, d) => y * 10000 + m * 100 + d;
  function validDate(y, m, d) {
    if (!(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
  }
  /* 2026/11/16・2026-11-16・2026年11月16日・20261116・令和8年11月16日・R8.11.16 など。時刻が付いていても日付だけ読む */
  function toDate(v) {
    let s = half(v).trim().replace(/[／]/g, '/').replace(/[－ー−]/g, '-').replace(/．/g, '.');
    if (!s) return null;
    s = s.split(/[\sT　]/)[0];
    let m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(令和|平成|昭和|大正|明治|[RHSTMrhstm])(元|\d{1,2})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?$/);
    if (m) {
      const era = ERAS.find((e) => e.name === m[1] || e.short === m[1].toUpperCase());
      const n = m[2] === '元' ? 1 : +m[2];
      return validDate(era.start[0] + n - 1, +m[3], +m[4]);
    }
    return null;
  }
  function formatSeireki(d) { return d.y + '年' + d.m + '月' + d.d + '日'; }
  /* 1年目は「元年」と書く */
  function formatWareki(d) {
    const k = key(d.y, d.m, d.d);
    const era = ERAS.find((e) => k >= key(e.start[0], e.start[1], e.start[2]));
    if (!era) return formatSeireki(d);
    const n = d.y - era.start[0] + 1;
    return era.name + (n === 1 ? '元' : n) + '年' + d.m + '月' + d.d + '日';
  }
  function isoToDate(iso) { return toDate(iso); }

  /* ---------- 値の書式 ---------- */
  function yen(n) {
    const neg = n < 0, a = Math.abs(n);
    const parts = String(a).split('.');
    return (neg ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '') + '円';
  }
  /* 書式に合わない値はそのまま返し、ok=false にする（空の値は空のまま ok） */
  function formatValue(value, format) {
    const v = str(value).trim();
    if (!format || !v) return { text: v, ok: true };
    if (format === '円') {
      const n = kana.normalizeAmount(v);
      return isNaN(n) ? { text: v, ok: false } : { text: yen(n), ok: true };
    }
    const d = toDate(v);
    if (!d) return { text: v, ok: false };
    return { text: format === '和暦' ? formatWareki(d) : formatSeireki(d), ok: true };
  }

  /* ---------- 差し込み欄 {{列名}} / {{列名:書式}} ---------- */
  function parsePlaceholders(text) {
    const s = str(text), items = [], errors = [];
    let pos = 0;
    for (;;) {
      const i = s.indexOf('{{', pos);
      if (i === -1) break;
      const end = s.indexOf('}}', i + 2);
      const next = s.indexOf('{{', i + 2);
      const inner = end === -1 ? '' : s.slice(i + 2, end);
      if (end === -1 || (next !== -1 && next < end) || /[\r\n]/.test(inner)) {
        const snip = s.slice(i, i + 12).split(/[\r\n]/)[0];
        errors.push('「{{」が閉じていません（「' + snip + '…」）。差し込み欄は {{列名}} のように「}}」で閉じてください。');
        pos = i + 2;
        continue;
      }
      const raw = s.slice(i, end + 2);
      const sep = inner.search(/[:：]/);
      const name = (sep === -1 ? inner : inner.slice(0, sep)).trim();
      const format = sep === -1 ? '' : inner.slice(sep + 1).trim();
      pos = end + 2;
      if (!name) { errors.push('「' + raw + '」の中に列名がありません。{{会社名}} のように、ファイルの列名を入れてください。'); continue; }
      if (sep !== -1 && FORMATS.indexOf(format) === -1) {
        errors.push('「' + raw + '」の書式「' + format + '」は使えません。使えるのは ' + FORMATS.join('・') + ' です（例: {{' + name + ':円}}）。書式がいらないときは {{' + name + '}} にしてください。');
        continue;
      }
      items.push({ raw, name, format, index: i });
    }
    return { items, errors };
  }

  function resolveColumn(name, header, aliases) {
    const a = aliases && aliases[name];
    if (a) return header.indexOf(a) !== -1 ? a : '';
    return header.indexOf(name) !== -1 ? name : '';
  }
  /* 似た名前の列の候補（エラーの案内用。勝手には使わない） */
  function suggestColumn(name, header) {
    const n = str(name).trim();
    if (!n) return '';
    let hit = header.find((h) => h && (h.indexOf(n) !== -1 || n.indexOf(h) !== -1));
    if (hit) return hit;
    const f = atena.FIELDS.find((x) => x.label === n || x.words.indexOf(n) !== -1 || x.words.some((w) => n.indexOf(w) !== -1));
    if (!f) return '';
    for (const w of f.words) { hit = header.find((h) => h === w); if (hit) return hit; }
    for (const w of f.words) { hit = header.find((h) => h.indexOf(w) !== -1); if (hit) return hit; }
    return '';
  }

  /* 文中の差し込み欄に値を入れる。列が見つからない欄は {{…}} のまま残す */
  function fill(text, header, row, aliases, opts) {
    const s = str(text), p = parsePlaceholders(s);
    const out = { text: '', empties: [], bad: [], unknown: [], columns: [], count: p.items.length };
    let last = 0, buf = '';
    p.items.forEach((it) => {
      buf += s.slice(last, it.index);
      last = it.index + it.raw.length;
      const col = resolveColumn(it.name, header, aliases);
      if (!col) { out.unknown.push(it.name); buf += it.raw; return; }
      out.columns.push(col);
      const raw = str(row[header.indexOf(col)]).trim();
      if (!raw) { if (out.empties.indexOf(it.name) === -1) out.empties.push(it.name); return; }
      let v = formatValue(raw, it.format);
      if (!v.ok) out.bad.push({ name: it.name, value: raw, format: it.format });
      if (!it.format && opts && opts.zipColumn === col) { const z = atena.formatZip(raw); if (z.ok) v = { text: z.text, ok: true }; }
      buf += v.text;
    });
    out.text = buf + s.slice(last);
    return out;
  }

  /* ---------- 本文と記書き ---------- */
  const isBlank = (l) => !l.replace(/[\s　]/g, '');
  /* 空行で段落を分ける。「＞」（半角の > も可）で始まる行は右寄せ。それ以外の決まりはない */
  function parseBody(text) {
    const paras = [];
    let cur = [];
    str(text).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      if (isBlank(line)) { if (cur.length) paras.push(cur); cur = []; return; }
      const m = line.match(/^[＞>]\s*(.*)$/);
      cur.push(m ? { text: m[1].replace(/\s+$/, ''), right: true } : { text: line.replace(/\s+$/, ''), right: false });
    });
    if (cur.length) paras.push(cur);
    return paras;
  }
  function parseKi(text) {
    const out = [];
    str(text).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      if (isBlank(line)) return;
      const i = line.search(/[：:]/);
      // 差し込み欄の中の「:」（{{金額:円}}）で切らない
      const p = parsePlaceholders(line);
      const inside = i !== -1 && p.items.some((it) => i > it.index && i < it.index + it.raw.length);
      if (i === -1 || inside) out.push({ label: '', value: line.trim() });
      else out.push({ label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
    });
    return out;
  }

  /* ---------- ひな形 ---------- */
  const TO_LINES = '〒{{郵便番号}}\n{{住所}}\n\n{{会社名}}\n{{部署}}\n{{氏名}}';
  const OPENING = '拝啓　時下ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。';
  const PRESETS = [
    { id: 'annai', label: 'ご案内（イベント・説明会）', desc: '説明会やイベントの日時・会場をお知らせします',
      t: { subject: '説明会開催のご案内',
        body: OPENING + '\n　さて、このたび弊社では、下記のとおり説明会を開催する運びとなりました。ご多忙のところ誠に恐縮ではございますが、ぜひご参加くださいますようご案内申し上げます。\n　なお、準備の都合上、お手数ですが {{期日:和暦}}までに出欠をお知らせください。\n\n＞敬具',
        kiOn: true, ki: '日時：〇〇年〇月〇日（〇）〇時〜〇時\n会場：〇〇〇〇（所在地）\n参加費：無料\nお申込み期限：{{期日:和暦}}', closing: '以上' } },
    { id: 'sofu', label: '書類送付のご案内（送付状）', desc: '書類を郵送するときに同封する送付状です',
      t: { subject: '書類送付のご案内',
        body: OPENING + '\n　さて、下記の書類をお送りいたしますので、ご査収くださいますようお願い申し上げます。\n　ご不明な点がございましたら、お気軽に担当までお問い合わせください。\n\n＞敬具',
        kiOn: true, ki: '送付書類：〇〇〇〇\n部数：1部', closing: '以上' } },
    { id: 'shiharai', label: 'お支払いのお願い（やわらかい督促）', desc: 'まだ入金のない相手に、ていねいにお支払いをお願いします',
      t: { subject: 'お支払いについてのお願い',
        body: OPENING + '\n　さて、下記のご請求につきまして、本日現在、ご入金の確認がとれておりません。ご多忙のところ誠に恐縮ではございますが、ご確認のうえ、{{期日:和暦}}までにお手続きくださいますようお願い申し上げます。\n　なお、本状と行き違いにすでにお支払いいただいております場合は、何卒ご容赦くださいますようお願い申し上げます。\n\n＞敬具',
        kiOn: true, ki: 'ご請求金額：{{金額:円}}\nお支払期限：{{期日:和暦}}\nお振込先：〇〇銀行 〇〇支店 普通 0000000', closing: '以上' } },
    { id: 'tsuchi', label: '通知書（汎用）', desc: '変更や決定事項などを、いろいろな相手にお知らせします',
      t: { subject: '〇〇についてのお知らせ',
        body: OPENING + '\n　さて、このたび下記のとおりとなりましたので、ご通知申し上げます。\n　ご不明な点がございましたら、担当までお問い合わせくださいますようお願い申し上げます。\n\n＞敬具',
        kiOn: true, ki: '内容：〇〇〇〇\n実施日：{{期日:和暦}}', closing: '以上' } },
    { id: 'blank', label: '白紙から', desc: '件名と本文を自分で書きます（宛名の形だけ入っています）',
      t: { subject: '', body: '', kiOn: false, ki: '', closing: '' } },
  ];
  const HONOR_MODES = ['auto', 'sama', 'none'];
  function base() {
    return {
      format: FORMAT_ID, version: 1, name: '', preset: 'blank', font: 'mincho',
      date: { mode: 'today', value: '', era: 'wareki' },
      to: { lines: TO_LINES, honor: 'auto' },
      from: { company: '', zip: '', address: '', tel: '', person: '' },
      subject: '', body: '', kiOn: false, ki: '', closing: '', aliases: {},
    };
  }
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  /* 保存・読み込みしたひな形の形をそろえる。足りない項目は既定値、知らない値は既定値に戻す */
  function normalizeTemplate(o) {
    if (!isObj(o)) return { ok: false, template: null, errors: ['ひな形の中身が読み取れません。'] };
    const t = base();
    ['name', 'preset', 'subject', 'body', 'ki', 'closing'].forEach((k) => { if (k in o) t[k] = str(o[k]); });
    if (o.font === 'gothic') t.font = 'gothic';
    t.kiOn = !!o.kiOn;
    if (isObj(o.date)) {
      if (['today', 'fixed', 'none'].indexOf(o.date.mode) !== -1) t.date.mode = o.date.mode;
      t.date.value = str(o.date.value);
      if (o.date.era === 'seireki') t.date.era = 'seireki';
    }
    if (isObj(o.to)) {
      if ('lines' in o.to) t.to.lines = str(o.to.lines);
      if (HONOR_MODES.indexOf(o.to.honor) !== -1) t.to.honor = o.to.honor;
    }
    if (isObj(o.from)) Object.keys(t.from).forEach((k) => { t.from[k] = str(o.from[k]); });
    if (isObj(o.aliases)) Object.keys(o.aliases).forEach((k) => { if (typeof o.aliases[k] === 'string' && o.aliases[k]) t.aliases[k] = o.aliases[k]; });
    return { ok: true, template: t, errors: [] };
  }
  function presetTemplate(id, from) {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[PRESETS.length - 1];
    return normalizeTemplate(Object.assign(base(), p.t, { preset: p.id, from: from || undefined })).template;
  }
  function exportJson(t) { return JSON.stringify(normalizeTemplate(t).template, null, 2); }
  function importJson(text) {
    let o;
    try { o = JSON.parse(str(text).replace(/^﻿/, '')); } catch (e) {
      return { ok: false, template: null, errors: ['ファイルの中身が JSON の形になっていません。このツールの「ファイルに書き出す」で作ったファイルを選んでください。'] };
    }
    if (!isObj(o) || o.format !== FORMAT_ID) return { ok: false, template: null, errors: ['このファイルは「差し込み文書の一括作成」のひな形ではありません。このツールの「ファイルに書き出す」で作った .json ファイルを選んでください。'] };
    return normalizeTemplate(o);
  }

  /* ---------- 確認 ---------- */
  function textFields(t) {
    const f = [['宛名', t.to.lines], ['件名', t.subject], ['本文', t.body]];
    if (t.kiOn) f.push(['記書き', t.ki]);
    f.push(['結び', t.closing]);
    return f;
  }
  /* 使っている差し込み欄と、列が見つからない欄（エラー） */
  function checkTemplate(t, header) {
    const syntax = [], where = {}, order = [];
    textFields(t).forEach(([label, text]) => {
      const p = parsePlaceholders(text);
      p.errors.forEach((e) => syntax.push(label + ': ' + e.replace(/。$/, '') + '（手順4）。'));
      p.items.forEach((it) => {
        if (!where[it.name]) { where[it.name] = []; order.push(it.name); }
        if (where[it.name].indexOf(label) === -1) where[it.name].push(label);
      });
    });
    const unknown = order.filter((n) => !resolveColumn(n, header, t.aliases));
    const errors = unknown.map((n) => {
      const sug = suggestColumn(n, header);
      const alias = t.aliases[n];
      return '「{{' + n + '}}」（' + where[n].join('・') + '）: ' +
        (alias ? '対応させた列「' + alias + '」がファイルにありません' : 'ファイルに「' + n + '」という列がありません') + '（手順4）。' +
        (sug ? 'もしかして「' + sug + '」の列ですか？ ' : '') +
        '手順4の「差し込み欄と列の対応」で使う列を選ぶか、文面の {{' + n + '}} を列名に合わせて直してください。';
    });
    return { errors: errors.concat(syntax), used: order, unknown, where };
  }

  /* ---------- 宛名 ---------- */
  const OWN_HONOR = /(様|御中|殿|各位|先生)\s*$/;
  function addressLines(t, header, row) {
    const map = atena.guessMap(header);
    const nameCol = resolveCol(header, t.aliases, map.name);
    const zipCol = map.zip;
    const out = [];
    str(t.to.lines).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      if (isBlank(line)) { if (out.length && out[out.length - 1].text !== '') out.push({ text: '', honor: '', cols: [] }); return; }
      const f = fill(line, header, row, t.aliases, { zipColumn: zipCol });
      if (f.count && f.empties.length === f.count) return;
      out.push({ text: f.text.replace(/[\s　]+$/, ''), honor: '', cols: f.columns });
    });
    while (out.length && out[out.length - 1].text === '') out.pop();
    const last = out[out.length - 1];
    if (last && last.cols.length && !OWN_HONOR.test(last.text)) {
      const isName = !!nameCol && last.cols.indexOf(nameCol) !== -1;
      const honorVal = map.honor ? str(row[header.indexOf(map.honor)]).trim() : '';
      last.honor = atena.decideHonor({ honor: honorVal, name: isName ? '1' : '', company: isName ? '' : '1', dept: '' }, t.to.honor);
    }
    return out.map((l) => ({ text: l.text, honor: l.honor }));
  }
  function resolveCol(header, aliases, col) { return col && header.indexOf(col) !== -1 ? col : ''; }

  /* ---------- 1通分 ---------- */
  function letterDate(t, today) {
    if (t.date.mode === 'none') return '';
    const d = toDate(t.date.mode === 'fixed' ? t.date.value : today);
    if (!d) return '';
    return t.date.era === 'seireki' ? formatSeireki(d) : formatWareki(d);
  }
  function fromLines(f) {
    const out = [];
    if (f.zip.trim()) out.push('〒' + f.zip.trim().replace(/^〒/, ''));
    if (f.address.trim()) out.push(f.address.trim());
    if (f.company.trim()) out.push(f.company.trim());
    if (f.tel.trim()) out.push('TEL ' + f.tel.trim());
    if (f.person.trim()) out.push('担当：' + f.person.trim());
    return out;
  }
  function renderLetter(t, header, row, opts) {
    const F = (s) => fill(s, header, row, t.aliases).text;
    return {
      date: letterDate(t, (opts && opts.today) || ''),
      to: addressLines(t, header, row),
      from: fromLines(t.from), fromCompany: t.from.company.trim(),
      subject: F(t.subject).trim(),
      body: parseBody(t.body).map((p) => p.map((l) => ({ text: F(l.text), right: l.right }))),
      ki: t.kiOn ? parseKi(t.ki).map((k) => ({ label: F(k.label), value: F(k.value) })) : [],
      closing: F(t.closing).trim(),
      font: t.font,
    };
  }

  /* 行ごとの注意: 使う差し込み欄が空・書式に合わない値。行番号はファイルの行（見出しが1行目） */
  function rowWarnings(t, header, rows, indices) {
    const out = [];
    const fields = textFields(t);
    indices.forEach((i) => {
      const row = rows[i] || [];
      const empties = [], bad = [];
      fields.forEach(([, text]) => {
        const f = fill(text, header, row, t.aliases);
        f.empties.forEach((n) => { if (empties.indexOf(n) === -1) empties.push(n); });
        f.bad.forEach((b) => { if (!bad.some((x) => x.name === b.name && x.format === b.format)) bad.push(b); });
      });
      const who = (i + 2) + '行目（' + rowLabel(row) + '）';
      if (empties.length) out.push(who + ': ' + empties.map((n) => '「' + n + '」').join('・') + 'が空です。空のまま印刷します（宛名では、その行を省きます）。');
      bad.forEach((b) => out.push(who + ': 「' + b.name + '」の値「' + b.value + '」は' + (b.format === '円' ? '金額' : '日付') + 'として読めないので、書式「' + b.format + '」を付けずにそのまま印刷します。'));
    });
    return out;
  }

  /* ---------- 行の一覧 ---------- */
  function rowLabel(row) {
    const v = (row || []).map((c) => str(c).trim()).filter(Boolean).slice(0, 3);
    return v.length ? v.join('　') : '（空の行）';
  }
  function filterRows(rows, query) {
    const terms = str(query).toLowerCase().split(/[\s　]+/).filter(Boolean);
    const out = [];
    rows.forEach((r, i) => {
      const hay = (r || []).join(' ').toLowerCase();
      if (terms.every((q) => hay.indexOf(q) !== -1)) out.push(i);
    });
    return out;
  }

  return {
    FORMAT_ID, FORMATS, PRESETS, HONOR_MODES,
    toDate, isoToDate, formatWareki, formatSeireki, formatValue, yen,
    parsePlaceholders, resolveColumn, suggestColumn, fill, parseBody, parseKi,
    normalizeTemplate, presetTemplate, exportJson, importJson,
    checkTemplate, addressLines, renderLetter, rowWarnings, rowLabel, filterRows,
  };
});
