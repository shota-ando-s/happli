/* 住所の分割: 1つの住所欄を 都道府県 / 市区町村 / 町域・番地 / 建物名 に分ける（DOM 非依存の純粋関数）。
   住所のデータベースは使わず、文字の並び方だけで判断する。確かでない行は「推測あり」「要確認」として理由を返す。
   漢数字の読み取りは名簿の重複チェック（meiyose.js）の kanjiToNumber を借りる。
   ブラウザでは window.MacroApps.jusho、Node では module.exports */
(function (root, factory) {
  const meiyose = typeof require !== 'undefined' ? require('./meiyose.js') : root.MacroApps.meiyose;
  const api = factory(meiyose);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.jusho = api; }
})(typeof self !== 'undefined' ? self : this, function (meiyose) {
  const kanjiToNumber = meiyose.kanjiToNumber;

  const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
    '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
    '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県',
    '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  /* 「都」「府」を書かずに使われやすい3つだけ（後ろに市区町村が続くときに限る）。北海道はもともと「道」まで書く */
  const PREF_ABBR = [['東京', '東京都'], ['大阪', '大阪府'], ['京都', '京都府']];

  /* 都道府県を推測するための表: 政令指定都市と県庁所在地 */
  const SEIREI = { '札幌市': '北海道', '仙台市': '宮城県', 'さいたま市': '埼玉県', '千葉市': '千葉県', '横浜市': '神奈川県', '川崎市': '神奈川県',
    '相模原市': '神奈川県', '新潟市': '新潟県', '静岡市': '静岡県', '浜松市': '静岡県', '名古屋市': '愛知県', '京都市': '京都府', '大阪市': '大阪府',
    '堺市': '大阪府', '神戸市': '兵庫県', '岡山市': '岡山県', '広島市': '広島県', '北九州市': '福岡県', '福岡市': '福岡県', '熊本市': '熊本県' };
  const KENCHO = { '青森市': '青森県', '盛岡市': '岩手県', '秋田市': '秋田県', '山形市': '山形県', '福島市': '福島県', '水戸市': '茨城県',
    '宇都宮市': '栃木県', '前橋市': '群馬県', '富山市': '富山県', '金沢市': '石川県', '福井市': '福井県', '甲府市': '山梨県', '長野市': '長野県',
    '岐阜市': '岐阜県', '津市': '三重県', '大津市': '滋賀県', '奈良市': '奈良県', '和歌山市': '和歌山県', '鳥取市': '鳥取県', '松江市': '島根県',
    '山口市': '山口県', '徳島市': '徳島県', '高松市': '香川県', '松山市': '愛媛県', '高知市': '高知県', '佐賀市': '佐賀県', '長崎市': '長崎県',
    '大分市': '大分県', '宮崎市': '宮崎県', '鹿児島市': '鹿児島県', '那覇市': '沖縄県' };
  const WARDS = ['千代田区', '中央区', '港区', '新宿区', '文京区', '台東区', '墨田区', '江東区', '品川区', '目黒区', '大田区', '世田谷区',
    '渋谷区', '中野区', '杉並区', '豊島区', '北区', '荒川区', '板橋区', '練馬区', '足立区', '葛飾区', '江戸川区'];
  /* ほかの政令市にも同じ名前の区があるもの */
  const WARD_AMBIGUOUS = ['中央区', '北区', '港区'];

  /* まぎらわしい名前の例外表（名前の途中に 市・町・村・郡 の字がある） */
  const TRICKY_CITIES = ['四日市市', '廿日市市', '野々市市', '市川市', '市原市', '町田市', '十日町市', '大町市', '村山市', '東村山市',
    '武蔵村山市', '羽村市', '村上市', '田村市', '大村市', '郡山市', '大和郡山市', '郡上市'];
  const TRICKY_TOWNS = ['余市町', '上市町', '市貝町', '下市町', '市川三郷町', '大町町', '玉村町', '村田町'];
  /* 名前に 市・村 の字がある郡 */
  const GUN_OK = ['余市', '高市', '北村山', '西村山', '東村山', '田村'];
  const byLen = (a) => a.slice().sort((x, y) => y.length - x.length);
  const TRICKY_CITIES_S = byLen(TRICKY_CITIES), TRICKY_TOWNS_S = byLen(TRICKY_TOWNS), WARDS_S = byLen(WARDS);

  const STATUS_LABEL = { ok: 'OK', guess: '推測あり', check: '要確認' };
  const FIELDS = ['pref', 'city', 'town', 'building'];
  const FIELD_LABEL = { pref: '都道府県', city: '市区町村', town: '町域・番地', building: '建物名', noPref: '住所（都道府県なし）' };

  const HY = '-－ー‐‑–—―−ｰ﹣';
  const KNUM = '〇一二三四五六七八九十百千';
  const isDigit = (c) => c != null && /[0-9０-９]/.test(c);
  const isKnum = (c) => c != null && KNUM.indexOf(c) !== -1;
  const isSpace = (c) => c != null && /\s/.test(c);
  const half = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const ltrim = (s) => s.replace(/^\s+/, '');
  function startsWithAny(s, list) { for (const n of list) if (s.startsWith(n)) return n; return null; }

  /* ---------- 都道府県 ---------- */
  function matchPref(s) {
    for (const p of PREFS) if (s.startsWith(p)) return { pref: p, len: p.length };
    for (const [abbr, full] of PREF_ABBR) {
      if (!s.startsWith(abbr) || s.startsWith(full)) continue;
      if (s.startsWith(abbr + '市') || s.startsWith(abbr + '郡')) continue; // 大阪市・京都市は市の名前、京都郡は福岡県
      const rest = ltrim(s.slice(abbr.length));
      if (rest && matchCity(rest, full)) return { pref: full, len: s.length - rest.length, abbr };
    }
    return null;
  }

  /* ---------- 市区町村 ---------- */
  /* 郡のあとの町村名。例外表にない名前は一番短い「〇〇町」「〇〇村」 */
  function matchTown(r) {
    const t = startsWithAny(r, TRICKY_TOWNS_S);
    if (t) return { name: t, tricky: true };
    const m = r.match(/^([^\s0-9０-９市区郡町村][^\s0-9０-９市区郡]{0,4}?)[町村]/);
    return m ? { name: m[0] } : null;
  }
  /* r の先頭から市区町村を読む。戻り値: { city, base, consumed, reasons } または null */
  function matchCity(r, pref) {
    const reasons = [];
    const done = (city, consumed, base) => ({ city, consumed, base: base || city, reasons });
    // 1. 例外表の市
    const tc = startsWithAny(r, TRICKY_CITIES_S);
    if (tc) return done(tc, tc.length);
    // 2. 郡＋町村
    const g = r.match(/^(.{1,5}?)郡/);
    if (g && (GUN_OK.indexOf(g[1]) !== -1 || !/[\s0-9０-９市区町村]/.test(g[1]))) {
      const rest = ltrim(r.slice(g[0].length));
      const t = matchTown(rest);
      if (t) {
        if (!t.tricky) checkTownEnd(rest.slice(t.name.length), g[0] + t.name, reasons);
        return done(g[0] + t.name, r.length - rest.length + t.name.length);
      }
    }
    // 3. 例外表の町（郡なし）
    const tt = startsWithAny(r, TRICKY_TOWNS_S);
    if (tt) {
      reasons.push({ level: 'guess', text: '郡が書かれていないため、「' + tt + '」を町村の名前とみなしました' });
      return done(tt, tt.length);
    }
    // 4. 東京23区
    if (!pref || pref === '東京都') {
      const w = startsWithAny(r, WARDS_S);
      if (w) return done(w, w.length);
    }
    // 5. 〇〇市（政令市なら区まで）
    const c = r.match(/^([^\s0-9０-９]{1,6}?)市/);
    if (c && !/[町村郡区]/.test(c[1])) {
      const city = c[0];
      if (SEIREI[city]) {
        const rest = ltrim(r.slice(city.length));
        const w = rest.match(/^([^\s0-9０-９市]{1,4}?)区/);
        if (w) return done(city + w[0], r.length - rest.length + w[0].length, city);
      }
      return done(city, city.length);
    }
    // 6. 〇〇町・〇〇村（郡なし）
    const t = matchTown(r);
    if (t) {
      reasons.push({ level: 'guess', text: '郡が書かれていないため、「' + t.name + '」を町村の名前とみなしました' });
      checkTownEnd(r.slice(t.name.length), t.name, reasons);
      return done(t.name, t.name.length);
    }
    return null;
  }
  /* 「東村｜山市…」「玉村｜町…」のように区切りがはっきりしないとき */
  function checkTownEnd(rest, name, reasons) {
    if (/^[^\s0-9０-９]{0,2}市/.test(rest) && !/^市/.test(rest) || /^[町村]/.test(rest)) {
      reasons.push({ level: 'check', text: '「' + name + '」で区切りましたが、続く「' + rest.slice(0, 4) + '」まで含めた名前かもしれません' });
    }
  }
  function inferPref(base) {
    if (SEIREI[base]) return { pref: SEIREI[base] };
    if (KENCHO[base]) return { pref: KENCHO[base] };
    if (WARDS.indexOf(base) !== -1) return { pref: '東京都', ambiguous: WARD_AMBIGUOUS.indexOf(base) !== -1 };
    return null;
  }

  /* ---------- 番地 ---------- */
  function readNum(s, i) {
    let j = i;
    if (isDigit(s[j])) { while (isDigit(s[j])) j++; return { kind: 'a', end: j }; }
    if (isKnum(s[j])) { while (isKnum(s[j])) j++; return { kind: 'k', end: j }; }
    return null;
  }
  function readUnit(s, i) {
    if (s.startsWith('丁目', i)) return { u: '丁目', end: i + 2 };
    if (s.startsWith('番地', i)) return { u: '番地', end: i + 2 };
    if (s[i] === '番' && !/[町丁]/.test(s[i + 1] || '')) return { u: '番', end: i + 1 };
    if (s[i] === '号' && !/[室館棟線]/.test(s[i + 1] || '')) return { u: '号', end: i + 1 };
    return null;
  }
  function sepAt(s, i) { return s[i] != null && (HY.indexOf(s[i]) !== -1 || s[i] === 'の'); }
  /* 漢数字は、後ろに 丁目・番・号 や区切りが続くときだけ番地の数字とみなす（「三井ビル」「六本木」を番地にしない） */
  function kanjiOk(s, n) {
    if (n.kind === 'a') return true;
    const nx = s[n.end];
    if (readUnit(s, n.end) || nx == null || isSpace(nx)) return true;
    return sepAt(s, n.end) && !!readNum(s, n.end + 1);
  }
  function parseChain(s, start, first) {
    const groups = [];
    let n = first, pos = start, sep = '';
    for (;;) {
      const g = { start: pos, kind: n.kind, text: s.slice(pos, n.end), sep, unit: '' };
      pos = n.end;
      const u = readUnit(s, pos);
      if (u) { g.unit = u.u; pos = u.end; }
      g.end = pos;
      groups.push(g);
      let p2 = pos;
      sep = '';
      if (sepAt(s, p2)) { sep = s[p2] === 'の' ? 'の' : '-'; p2++; } else if (!g.unit) break;
      const n2 = readNum(s, p2);
      if (!n2 || !kanjiOk(s, n2)) break;
      if (!sep) sep = g.unit;
      pos = p2; n = n2;
    }
    return { start, end: groups[groups.length - 1].end, groups };
  }
  /* 番地のかたまりを探す。「北1条」「第2地割」のような町名の中の数字は飛ばす */
  function findChain(s) {
    for (let i = 0; i < s.length; i++) {
      const prev = s[i - 1];
      if ((isDigit(s[i]) && isDigit(prev)) || (isKnum(s[i]) && isKnum(prev))) continue;
      const n = readNum(s, i);
      if (!n) continue;
      if (n.kind === 'a') {
        if (/^(条|線|地割)/.test(s.slice(n.end))) continue;
      } else if (!readUnit(s, n.end)) continue;
      return parseChain(s, i, n);
    }
    return null;
  }
  function groupNum(g) { return g.kind === 'a' ? half(g.text) : String(kanjiToNumber(g.text)); }
  function normalizeChain(groups) {
    if (groups.length === 1 && groups[0].unit === '丁目') return groupNum(groups[0]) + '丁目';
    return groups.map(groupNum).join('-');
  }
  function tidyText(s) {
    return half(s).replace(new RegExp('(\\d)[' + HY + '](?=\\d)', 'g'), '$1-');
  }

  function splitTown(s, opts, add) {
    const ch = findChain(s);
    let town, banchi, building;
    if (!ch) {
      const sp = s.search(/\s/);
      if (sp > 0) { town = s.slice(0, sp); building = s.slice(sp); } else { town = s; building = ''; }
      banchi = '';
      if (s.trim()) add('check', '番地が見つかりませんでした。町名・番地・建物名の区切りを確かめてください');
      return { town: opts.normalize ? tidyText(town).replace(/\s+/g, '') : town.trim(), building: cleanBuilding(building, opts) };
    }
    const groups = ch.groups.slice();
    let end = ch.end, bPrefix = '';
    if (groups.length >= 4) {
      const last = groups[groups.length - 1];
      if (last.kind === 'a' && half(last.text).length >= 3 && last.sep === '-') {
        groups.pop();
        end = groups[groups.length - 1].end;
        bPrefix = s.slice(last.start, last.end);
        add('check', '4つめの数字「' + half(last.text) + '」を部屋番号とみなして建物名に移しました');
      } else {
        add('guess', '番地の数字が4つ以上あります（' + groups.map(groupNum).join('-') + '）。部屋番号が混ざっていないか確かめてください');
      }
    }
    town = s.slice(0, ch.start);
    building = bPrefix + s.slice(ch.end);
    if (!town.trim()) add('guess', '町名がなく、番地だけが書かれています');
    if (opts.normalize) {
      banchi = normalizeChain(groups);
      return { town: tidyText(town).replace(/\s+/g, '') + banchi, building: cleanBuilding(building, opts) };
    }
    return { town: s.slice(0, end).trim(), building: cleanBuilding(building, opts) };
  }
  function cleanBuilding(b, opts) {
    if (opts.normalize) b = tidyText(b);
    if (opts.trimBuilding) b = b.trim();
    return b.trim() ? b : '';
  }

  /* ---------- 1件の住所を分ける ---------- */
  /* opts: { normalize: 番地の書き方をそろえる（既定 true）, trimBuilding: 建物名の前後の空白を取る（既定 true） } */
  function splitAddress(text, opts) {
    opts = Object.assign({ normalize: true, trimBuilding: true }, opts || {});
    const original = text == null ? '' : String(text);
    const reasons = [];
    const add = (level, t) => reasons.push({ level, text: t });
    const out = { original, pref: '', city: '', town: '', building: '', noPref: '', prefGuessed: false, note: '' };
    let s = ltrim(original);
    if (!s.trim()) {
      add('check', '住所が空です');
      return finish(out, reasons);
    }
    const z = s.match(/^〒?\s*[0-9０-９]{3}[-－ー−‐]?[0-9０-９]{4}(?![0-9０-９])\s*/);
    if (z && z[0].length < s.trim().length && !isDigit(s[z[0].length])) {
      out.note = '先頭の郵便番号「' + z[0].trim() + '」は住所から外しました';
      s = s.slice(z[0].length);
    }
    const pm = matchPref(s);
    if (pm) {
      out.pref = pm.pref;
      s = ltrim(s.slice(pm.len));
      if (pm.abbr) add('guess', '「' + pm.abbr + '」を「' + pm.pref + '」として読みました');
    }
    const cm = matchCity(s, out.pref);
    if (cm) {
      out.city = cm.city;
      s = ltrim(s.slice(cm.consumed));
      cm.reasons.forEach((x) => reasons.push(x));
      const inf = inferPref(cm.base);
      if (!out.pref && inf) {
        out.pref = inf.pref; out.prefGuessed = true;
        if (inf.ambiguous) add('check', '都道府県が書かれていないため「' + inf.pref + '」と推測しましたが、ほかの市にも同じ名前の区（' + cm.base + '）があります');
        else add('guess', '都道府県が書かれていないため、「' + cm.base + '」から「' + inf.pref + '」と推測しました');
      } else if (out.pref && inf && !inf.ambiguous && inf.pref !== out.pref) {
        add('check', '都道府県「' + out.pref + '」と「' + cm.base + '」（ふつうは' + inf.pref + '）の組み合わせが合わないようです');
      }
    }
    if (!out.pref) add('check', '都道府県が書かれておらず、市区町村の名前からも分かりませんでした');
    if (!out.city) add('check', '市区町村が見つかりませんでした');
    const tb = splitTown(s, opts, add);
    out.town = tb.town; out.building = tb.building;
    return finish(out, reasons);
  }
  function joinNoPref(r) { return r.city + r.town + (r.building ? ' ' + r.building : ''); }
  function finish(out, reasons) {
    out.reasons = reasons;
    out.status = reasons.some((x) => x.level === 'check') ? 'check' : reasons.some((x) => x.level === 'guess') ? 'guess' : 'ok';
    out.noPref = joinNoPref(out);
    out.edited = false;
    return out;
  }

  /* 手で直した内容を反映する（元の結果は書き換えない）。直した行は人が確かめたものとして OK にする */
  function applyEdit(r, changes) {
    const e = Object.assign({}, r);
    FIELDS.forEach((f) => { if (changes && changes[f] != null) e[f] = String(changes[f]); });
    e.noPref = joinNoPref(e);
    e.edited = true;
    e.status = 'ok';
    e.before = r.edited ? r.before : STATUS_LABEL[r.status];
    e.reasons = [{ level: 'ok', text: '手で直しました（元の判定: ' + e.before + '）' }];
    return e;
  }

  /* ---------- 列の推測と確認 ---------- */
  function guessMap(header) {
    const h = header.map((x) => String(x == null ? '' : x).trim());
    const isBuilding = (x) => /建物|ビル|マンション|方書|住所[2２]|address\s*2/i.test(x);
    const isKana = (x) => /カナ|かな|フリガナ|ふりがな|ﾌﾘｶﾞﾅ|ｶﾅ/.test(x);
    const address = h.find((x) => /住所[1１]/.test(x) && !isKana(x)) ||
      h.find((x) => /住所|所在地/.test(x) && !isBuilding(x) && !isKana(x)) ||
      h.find((x) => /^address(1)?$/i.test(x)) || '';
    const zip = h.find((x) => /郵便|〒|zip|postal/i.test(x) && x !== address) || '';
    const building = h.find((x) => isBuilding(x) && x !== address && !isKana(x)) || '';
    return { address, zip, building };
  }
  function checkMap(header, map) {
    const errs = [];
    if (!map || !map.address) { errs.push('住所が入っている列を選んでください（手順2の「住所の列」）。'); return errs; }
    ['address', 'zip', 'building'].forEach((k) => {
      if (map[k] && header.indexOf(map[k]) === -1) errs.push('列「' + map[k] + '」がファイルの中に見つかりません。手順2で選び直してください。');
    });
    if (map.building && map.building === map.address) errs.push('「住所の列」と「建物名の列」に同じ列が選ばれています。建物名の列がなければ「なし」にしてください（手順2）。');
    if (map.zip && map.zip === map.address) errs.push('「住所の列」と「郵便番号の列」に同じ列が選ばれています。手順2で選び直してください。');
    return errs;
  }

  /* ---------- 表全体 ---------- */
  function summarize(results) {
    const s = { rows: results.length, ok: 0, guess: 0, check: 0, edited: 0 };
    results.forEach((r) => { s[r.status]++; if (r.edited) s.edited++; });
    return s;
  }
  /* map: { address, zip, building }（列の見出し）。建物の列があれば、住所から分けた建物名と合わせる */
  function splitTable(header, rows, map, opts) {
    const ai = header.indexOf(map.address), bi = map.building ? header.indexOf(map.building) : -1;
    const results = rows.map(function (row) {
      const r = splitAddress(row[ai], opts);
      if (bi === -1) return r;
      const ex = String(row[bi] == null ? '' : row[bi]).trim();
      if (!ex) return r;
      if (!r.building || r.building === ex) r.building = ex;
      else {
        r.reasons.push({ level: 'check', text: '住所の列にも建物名らしい「' + r.building + '」があったため、建物名の列「' + ex + '」の前につなげました' });
        r.building = r.building + ' ' + ex;
      }
      return finish(r, r.reasons);
    });
    return { results, stats: summarize(results) };
  }
  function reasonText(r) {
    return r.reasons.filter((x) => x.level !== 'ok' || r.edited).map((x) => x.text).concat(r.note ? [r.note] : []).join('／');
  }
  /* opts: { mode: 'append'（列を足す）| 'replace'（住所の列を置き換える）, noPref: 都道府県なしの住所欄も作る } */
  function buildOutput(header, rows, map, results, opts) {
    opts = opts || {};
    const ai = header.indexOf(map.address), bi = map.building ? header.indexOf(map.building) : -1;
    const replace = opts.mode === 'replace';
    const keys = FIELDS.concat(opts.noPref ? ['noPref'] : []);
    const keep = header.map((_, i) => !(replace && (i === ai || i === bi)));
    const kept = header.filter((_, i) => keep[i]);
    const name = (n) => (kept.indexOf(n) !== -1 ? n + '（分割）' : n);
    const newCols = keys.map((k) => name(FIELD_LABEL[k]));
    const tail = [name('確度'), name('理由')];
    function line(cells, add, tl) {
      const out = [];
      header.forEach((_, i) => {
        if (replace && i === ai) add.forEach((v) => out.push(v));
        if (keep[i]) out.push(cells[i] == null ? '' : cells[i]);
      });
      return replace ? out.concat(tl) : out.concat(add, tl);
    }
    const out = [line(header, newCols, tail)];
    rows.forEach((row, ri) => {
      const r = results[ri];
      out.push(line(row, keys.map((k) => r[k]), [STATUS_LABEL[r.status], reasonText(r)]));
    });
    return out;
  }
  function prefCounts(results) {
    const m = new Map();
    results.forEach((r) => { const k = r.pref || '（不明）'; m.set(k, (m.get(k) || 0) + 1); });
    const order = (p) => (p === '（不明）' ? 99 : PREFS.indexOf(p) === -1 ? 98 : PREFS.indexOf(p));
    return Array.from(m, ([pref, count]) => ({ pref, count })).sort((a, b) => b.count - a.count || order(a.pref) - order(b.pref));
  }
  function outputName(name) {
    return String(name || '住所').replace(/\.(csv|txt|tsv)$/i, '') + '_住所分割.csv';
  }

  return {
    PREFS, SEIREI, KENCHO, WARDS, TRICKY_CITIES, TRICKY_TOWNS, STATUS_LABEL, FIELDS, FIELD_LABEL,
    splitAddress, applyEdit, guessMap, checkMap, splitTable, summarize, buildOutput, prefCounts, reasonText, outputName,
  };
});
