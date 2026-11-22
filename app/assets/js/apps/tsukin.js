/* 通勤手当の確認: 通勤の届出一覧から、社員ごとの通勤手当の非課税額・課税額と、会社のルールで計算した額との違いを出す。
   ブラウザでは window.MacroApps.tsukin、Node では module.exports

   決まり（所得税法第9条第1項第5号、所得税法施行令第20条の2）
   - 電車・バスなどの交通機関: 「経済的かつ合理的な運賃等の額」（通勤定期券の額）まで非課税。1か月あたり15万円が上限
   - マイカー・自転車など: 片道の通勤距離ごとの限度額まで非課税（DISTANCE_TABLES）。片道2km未満は全額課税
   - 交通機関とマイカーなどの併用: 運賃等の額と距離ごとの限度額の合計まで非課税。合わせて1か月15万円が上限
   - 徒歩: 非課税の扱いはなく、支給すれば全額が課税
   - 3か月・6か月ごとにまとめて払うときは、限度額をその月数分にして比べる（1か月あたりで判定するのと同じ）
   計算は支給1回あたりで行い、1か月あたりの額は表示のため（1円未満切り捨て）。 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.tsukin = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 交通機関（と併用）の非課税の上限（1か月あたり） */
  const TRANSIT_CAP = 150000;

  /* マイカー・自転車などの距離ごとの非課税限度額（1か月あたり）。min: 片道の距離（km）がこの値以上なら limit。
     2km未満は 0（全額課税）。
     - 'r2025': 2025年の改正後（2025年4月1日以後に支払われるべき通勤手当。2025年11月の政令改正）
     - 'r2016': 改正前（2016年1月〜2025年3月） */
  const DISTANCE_TABLES = {
    r2025: {
      label: '2025年4月以後（改正後）',
      rows: [
        { min: 2, limit: 4700 }, { min: 10, limit: 7300 }, { min: 15, limit: 13500 }, { min: 25, limit: 19700 },
        { min: 35, limit: 25900 }, { min: 45, limit: 32300 }, { min: 55, limit: 38700 }, { min: 65, limit: 45000 },
        { min: 75, limit: 51300 },
      ],
    },
    r2016: {
      label: '2025年3月まで（改正前）',
      rows: [
        { min: 2, limit: 4200 }, { min: 10, limit: 7100 }, { min: 15, limit: 12900 }, { min: 25, limit: 18700 },
        { min: 35, limit: 24400 }, { min: 45, limit: 28000 }, { min: 55, limit: 31600 },
      ],
    },
  };
  const DEFAULT_TABLE = 'r2025';
  function tableRows(id) { return (DISTANCE_TABLES[id] || DISTANCE_TABLES[DEFAULT_TABLE]).rows.map((r) => ({ min: r.min, limit: r.limit })); }

  /* 片道の距離から1か月あたりの限度額。表は min の小さい順でなくてもよい */
  function distanceLimit(km, rows) {
    if (!(km >= 0)) return 0;
    const sorted = (rows || []).slice().sort((a, b) => a.min - b.min);
    let limit = 0;
    sorted.forEach(function (r) { if (km >= r.min - 1e-9) limit = r.limit; });
    return limit;
  }
  /* 表の確かめ。直すべき点を文の配列で返す */
  function validateTable(rows) {
    const out = [];
    if (!Array.isArray(rows) || !rows.length) { out.push('距離ごとの限度額の表が空です。「表を初期の値に戻す」を押してください。'); return out; }
    const seen = {};
    rows.forEach(function (r, i) {
      const n = (i + 1) + '行目';
      if (!(Number.isFinite(r.min) && r.min >= 0)) out.push(n + ': 距離（km以上）を0以上の数字にしてください。');
      else if (seen[r.min]) out.push(n + ': 距離「' + r.min + 'km以上」が' + seen[r.min] + 'と同じです。どちらかを直すか削除してください。');
      else seen[r.min] = n;
      if (!(Number.isInteger(r.limit) && r.limit >= 0)) out.push(n + ': 限度額を0以上の円単位の整数にしてください。');
    });
    return out;
  }
  function cleanTable(list) {
    if (!Array.isArray(list)) return null;
    const rows = list.filter((r) => r && typeof r === 'object').map((r) => ({ min: Number(r.min), limit: Number(r.limit) }));
    return rows.length ? rows : null;
  }

  /* ---------- 値の読み取り ---------- */
  function nfkc(v) { return String(v == null ? '' : v).normalize('NFKC').trim(); }
  /* 見出しの「1ヶ月」「1カ月」「一か月」などを「1か月」にそろえる */
  function normHeader(h) {
    return nfkc(h).replace(/[\s　]+/g, '').replace(/一/g, '1').replace(/三/g, '3').replace(/六/g, '6').replace(/(\d)[ヶヵカケかケ箇個]?月/g, '$1か月');
  }
  /* 通勤手段: { transit, car, walk, label } */
  const MEANS_WORDS = {
    transit: /電車|バス|鉄道|地下鉄|モノレール|新幹線|JR|私鉄|公共|交通機関|定期|列車|路面|フェリー|船/i,
    /* 「電車」「列車」「新幹線」の「車」は交通機関なので、車は前の字を見て判定する */
    car: /マイカー|自動車|自家用|社用車|バイク|オートバイ|原付|二輪|スクーター|自転車|(^|[^電列馬客汽])車/,
    walk: /徒歩|歩き|歩/,
    combo: /併用/,
  };
  function parseMeans(v) {
    const t = nfkc(v);
    if (!t) return null;
    let transit = MEANS_WORDS.transit.test(t), car = MEANS_WORDS.car.test(t);
    const walk = MEANS_WORDS.walk.test(t) && !transit && !car;
    if (MEANS_WORDS.combo.test(t) && !(transit && car)) { transit = true; car = true; }
    if (!transit && !car && !walk) return null;
    return { transit, car, walk };
  }
  function meansLabel(m) {
    if (!m) return '';
    if (m.transit && m.car) return '交通機関とマイカー等の併用';
    if (m.transit) return '交通機関';
    if (m.car) return 'マイカー・自転車等';
    return '徒歩';
  }
  /* 支給の単位（月数） */
  function parseUnit(v) {
    const t = nfkc(v).replace(/[\s　]+/g, '');
    if (!t) return null;
    if (/^(1|1か月|1ヶ月|1カ月|1ヵ月|1ケ月|月|毎月|月額|月払い|月ごと|1月)$/.test(t)) return 1;
    if (/^(3|3か月|3ヶ月|3カ月|3ヵ月|3ケ月|四半期|3月)$/.test(t)) return 3;
    if (/^(6|6か月|6ヶ月|6カ月|6ヵ月|6ケ月|半年|半期|6月)$/.test(t)) return 6;
    if (/^(12|12か月|12ヶ月|12カ月|1年|年|年額)$/.test(t)) return 12;
    return NaN;
  }
  /* 片道の距離（km）。「12.5km」「12.5キロ」「800m」 */
  function parseDistance(v) {
    const t = nfkc(v).replace(/[\s,]+/g, '');
    if (!t) return { value: null };
    let m = t.match(/^(\d+(?:\.\d+)?)(km|キロメートル|キロ|ｋｍ)?$/i);
    if (m) return { value: Number(m[1]) };
    m = t.match(/^(\d+(?:\.\d+)?)(m|メートル)$/i);
    if (m) return { value: Number(m[1]) / 1000 };
    return { problem: true };
  }
  function readAmount(raw, label) {
    const t = nfkc(raw);
    if (t === '' || t === '-' || t === '―') return { value: null };
    const n = kana.normalizeAmount(t);
    if (!Number.isFinite(n)) return { problem: label + '「' + t + '」が数字として読めません。数字だけ（例: 12,340）にしてください。' };
    if (n < 0) return { problem: label + '「' + t + '」がマイナスです。0以上にしてください。' };
    if (!Number.isInteger(n)) return { problem: label + '「' + t + '」に小数があります。円単位の整数にしてください。' };
    return { value: n };
  }

  /* ---------- 列の推測 ---------- */
  const FIELD_KEYS = ['id', 'name', 'means', 'distance', 'pass1', 'pass3', 'pass6', 'paid', 'unit', 'days', 'fare'];
  const WORDS = {
    id: ['社員番号', '従業員番号', '社員コード', '従業員コード', '社員ID', '社員No', '個人番号以外', '番号', 'コード'],
    name: ['氏名', '名前', '社員名', '従業員名'],
    means: ['通勤手段', '交通手段', '通勤方法', '手段', '経路の種類'],
    distance: ['片道距離', '片道の距離', '通勤距離', '距離'],
    pass1: ['1か月定期', '定期代1か月', '1か月の定期', '定期(1か月)', '1か月'],
    pass3: ['3か月定期', '定期代3か月', '3か月の定期', '定期(3か月)', '3か月'],
    pass6: ['6か月定期', '定期代6か月', '6か月の定期', '定期(6か月)', '6か月'],
    paid: ['支給額', '通勤手当', '手当額', '支給金額', '支払額'],
    unit: ['支給の単位', '支給単位', '支給周期', '支給月数', '単位'],
    days: ['出勤日数', '出社日数', '勤務日数', '通勤日数'],
    fare: ['片道運賃', '片道の運賃', '運賃'],
  };
  const AVOID = { id: /マイナンバー|個人番号/, paid: /単位|周期|課税|非課税/, distance: /運賃/, fare: /定期/, unit: /単価/ };
  const ORDER = ['pass1', 'pass3', 'pass6', 'unit', 'days', 'fare', 'distance', 'means', 'paid', 'id', 'name'];
  function guessMapping(header) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const ns = hs.map(normHeader);
    const taken = [];
    const m = {};
    ORDER.forEach(function (key) {
      m[key] = '';
      for (const w of WORDS[key]) {
        const nw = normHeader(w);
        const i = ns.findIndex((h, k) => taken.indexOf(k) === -1 && h.indexOf(nw) !== -1 && !(AVOID[key] && AVOID[key].test(h)));
        if (i >= 0) { taken.push(i); m[key] = hs[i]; break; }
      }
    });
    const out = {};
    FIELD_KEYS.forEach((k) => { out[k] = m[k]; });
    return out;
  }

  /* ---------- 行の取り出し ---------- */
  /* map: 各項目の見出し名。opts: { defaultUnit } 。1行が1つの通勤経路（同じ社員の行が複数あれば併用として合算） */
  function extract(header, rows, map) {
    const hs = (header || []).map((h) => String(h == null ? '' : h).trim());
    const ci = {};
    FIELD_KEYS.forEach((k) => { ci[k] = map && map[k] ? hs.indexOf(map[k]) : -1; });
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const items = [], errors = [];
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const problems = [];
      const id = cell(r, ci.id), name = cell(r, ci.name);
      if (!id && !name) problems.push('社員番号も氏名も空です。どちらかを入れてください。');
      const amounts = {};
      [['pass1', '1か月定期代'], ['pass3', '3か月定期代'], ['pass6', '6か月定期代'], ['paid', '支給額'], ['fare', '片道運賃']].forEach(function (p) {
        const a = readAmount(cell(r, ci[p[0]]), p[1]);
        if (a.problem) problems.push(a.problem); else amounts[p[0]] = a.value;
      });
      const rawDist = cell(r, ci.distance);
      const d = parseDistance(rawDist);
      if (d.problem) problems.push('片道距離「' + rawDist + '」が読めません。km単位の数字（例: 12.5）にしてください。');
      const rawUnit = cell(r, ci.unit);
      const unit = parseUnit(rawUnit);
      if (Number.isNaN(unit)) problems.push('支給の単位「' + rawUnit + '」が読めません。「1か月」「3か月」「6か月」のどれかにしてください。');
      let days = null;
      const rawDays = cell(r, ci.days);
      if (rawDays) {
        const n = Number(nfkc(rawDays).replace(/日$/, ''));
        if (!(Number.isFinite(n) && n >= 0 && n <= 31)) problems.push('出勤日数「' + rawDays + '」が読めません。0〜31の数字にしてください。');
        else days = n;
      }
      if (problems.length) { errors.push({ row, message: row + '行目: ' + problems.join(' ') }); return; }
      const rawMeans = cell(r, ci.means);
      items.push({
        row, id, name, meansText: rawMeans, means: parseMeans(rawMeans), distance: d.value, unit: unit || null, days,
        pass1: amounts.pass1, pass3: amounts.pass3, pass6: amounts.pass6, paid: amounts.paid, fare: amounts.fare,
      });
    });
    return { items, errors, hasPaid: ci.paid >= 0 };
  }

  /* ---------- 定期代 ---------- */
  /* m か月分の定期代（いちばん素直な組み合わせ）。{ amount, from } from: どの定期から出したか */
  function passFor(it, m) {
    const p = { 1: it.pass1, 3: it.pass3, 6: it.pass6 };
    if (p[m] != null) return { amount: p[m], from: m };
    const order = m >= 6 ? [6, 3, 1] : m >= 3 ? [3, 1, 6] : [1, 3, 6];
    for (const k of order) {
      if (p[k] == null) continue;
      if (m % k === 0) return { amount: p[k] * (m / k), from: k };
      return { amount: Math.floor((p[k] * m) / k), from: k };
    }
    return null;
  }
  /* 会社のルールで使う定期: basis 'p1'|'p3'|'p6'|'cheapest'。m か月分の額 */
  function companyPass(it, m, basis) {
    const p = { 1: it.pass1, 3: it.pass3, 6: it.pass6 };
    const scale = (k) => (m % k === 0 ? p[k] * (m / k) : Math.floor((p[k] * m) / k));
    if (basis === 'cheapest') {
      let best = null;
      [1, 3, 6].forEach(function (k) {
        if (p[k] == null) return;
        const v = scale(k);
        if (best == null || v < best.amount) best = { amount: v, from: k };
      });
      return best;
    }
    const want = basis === 'p1' ? 1 : basis === 'p3' ? 3 : 6;
    const order = want === 6 ? [6, 3, 1] : want === 3 ? [3, 6, 1] : [1, 3, 6];
    for (const k of order) if (p[k] != null) return { amount: scale(k), from: k, fallback: k !== want };
    return null;
  }

  /* ---------- 判定 ---------- */
  const DEFAULT_OPTIONS = {
    table: null, // null なら DEFAULT_TABLE
    basis: 'p6', // 会社のルール: 交通機関はどの定期をもとにするか
    capMonthly: null, // 会社の上限額（1か月あたり、円）。null なら上限なし
    carMethod: 'limit', // 'limit'（非課税限度額と同じ額）| 'perKm'（km単価 × 片道 × 2 × 出勤日数）| 'none'（会社のルールと比べない）
    perKmYen: 15,
    defaultDays: 20,
    defaultUnit: 1,
    tolerance: 0, // 会社のルールの額との差がこの円以内なら同じとみなす
  };
  const TAX_STATUS = ['非課税', '一部課税', '全額課税', '支給なし', '要確認'];
  const keyOf = (it) => (it.id ? 'id:' + nfkc(it.id) : 'name:' + nfkc(it.name).replace(/[\s　]+/g, ''));

  /* items を社員ごとにまとめて判定する。hasPaid: 支給額の列があるか */
  function evaluate(items, opts, hasPaid) {
    const o = Object.assign({}, DEFAULT_OPTIONS, opts || {});
    const rows = o.table && o.table.length ? o.table : tableRows(DEFAULT_TABLE);
    const groups = new Map();
    (items || []).forEach(function (it) {
      const k = keyOf(it);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    const summary = { people: 0, nontax: 0, partial: 0, full: 0, none: 0, check: 0, paid: 0, nontaxable: 0, taxable: 0, over: 0, under: 0, overAmount: 0, underAmount: 0, cheaperActual: 0 };
    const people = [];
    groups.forEach(function (list) {
      people.push(judge(list, o, rows, hasPaid));
    });
    people.forEach(function (p) {
      summary.people++;
      if (p.taxStatus === '非課税') summary.nontax++;
      else if (p.taxStatus === '一部課税') summary.partial++;
      else if (p.taxStatus === '全額課税') summary.full++;
      else if (p.taxStatus === '支給なし') summary.none++;
      else summary.check++;
      if (p.taxStatus !== '要確認') { summary.paid += p.paid; summary.nontaxable += p.nontaxable; summary.taxable += p.taxable; }
      if (p.compare === '多い') { summary.over++; summary.overAmount += p.diff; }
      if (p.compare === '少ない') { summary.under++; summary.underAmount += -p.diff; }
      if (p.cheaperActual) summary.cheaperActual++;
    });
    return { people, summary };
  }

  function yen(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function judge(list, o, rows, hasPaid) {
    const first = list[0];
    const checks = [], notes = [];
    const id = first.id, name = list.map((x) => x.name).find(Boolean) || '';
    const rowNos = list.map((x) => x.row);
    if (list.length > 1) notes.push(list.length + '行（' + rowNos.join('・') + '行目）を同じ人の経路として合算しました。');
    /* 支給の単位 */
    const units = Array.from(new Set(list.map((x) => x.unit).filter((u) => u != null)));
    let m = units.length ? units[0] : o.defaultUnit;
    if (units.length > 1) checks.push('行によって支給の単位が違います（' + units.map((u) => u + 'か月').join('・') + '）。同じ人の支給の単位をそろえてください。');
    /* 手段 */
    let transit = false, car = false, walk = false;
    list.forEach(function (x) {
      if (!x.means) {
        checks.push((x.meansText ? '通勤手段「' + x.meansText + '」が読めません' : '通勤手段が空です') + '（' + x.row + '行目）。「電車」「バス」「マイカー」「自転車」「徒歩」「併用」などで書いてください。');
        return;
      }
      transit = transit || x.means.transit; car = car || x.means.car; walk = walk || x.means.walk;
    });
    const means = { transit, car, walk: walk && !transit && !car };
    /* 交通機関の部分 */
    let fareTotal = 0, companyTransit = 0;
    const passNotes = [];
    list.forEach(function (x) {
      if (!x.means || !x.means.transit) return;
      const pf = passFor(x, m);
      if (!pf) { checks.push('交通機関の定期代が空です（' + x.row + '行目）。1か月・3か月・6か月のどれかの定期代を入れてください。'); return; }
      fareTotal += pf.amount;
      if (pf.from !== m) passNotes.push(pf.from + 'か月定期をもとに' + m + 'か月分を' + yen(pf.amount) + '円としました（' + x.row + '行目）。');
      const cp = companyPass(x, m, o.basis);
      companyTransit += cp ? cp.amount : 0;
      if (cp && cp.fallback) passNotes.push('会社のルールの定期代がないため、' + cp.from + 'か月定期で計算しました（' + x.row + '行目）。');
    });
    passNotes.forEach((n) => notes.push(n));
    /* マイカー・自転車などの部分 */
    let carLimit = 0, companyCar = 0, distance = null;
    list.forEach(function (x) {
      if (!x.means || !x.means.car) return;
      if (x.distance == null) { checks.push('マイカー・自転車などの片道距離が空です（' + x.row + '行目）。距離ごとに限度額が決まるので、km単位で入れてください。'); return; }
      distance = (distance || 0) + x.distance;
      if (x.distance > 100) notes.push('片道距離が' + x.distance + 'kmです。単位（kmかmか）や往復の距離になっていないか確かめてください。');
      const lim = distanceLimit(x.distance, rows);
      if (x.distance < 2) notes.push('片道2km未満のマイカー・自転車などの通勤手当は、全額が課税になります。');
      carLimit += lim * m;
      if (o.carMethod === 'perKm') {
        const d = x.days != null ? x.days : o.defaultDays;
        companyCar += Math.floor(x.distance * 2 * d * o.perKmYen) * m;
      } else companyCar += lim * m;
    });
    if (means.walk) notes.push('徒歩の通勤手当には非課税の扱いがないため、支給すれば全額が課税になります。');
    /* 非課税の上限 */
    const transitCapTotal = TRANSIT_CAP * m;
    let limitTotal = fareTotal + carLimit;
    if ((transit) && limitTotal > transitCapTotal) {
      notes.push('非課税の上限（1か月15万円' + (m > 1 ? '×' + m + 'か月' : '') + '）を超える部分は課税になります。');
      limitTotal = transitCapTotal;
    } else if (!transit && carLimit > transitCapTotal) limitTotal = transitCapTotal;
    /* 会社のルールの額 */
    let company = companyTransit + (o.carMethod === 'none' ? 0 : companyCar);
    if (o.capMonthly != null && company > o.capMonthly * m) {
      company = o.capMonthly * m;
      notes.push('会社の上限額（1か月' + yen(o.capMonthly) + '円）で計算しました。');
    }
    /* 支給額 */
    const paidList = list.map((x) => x.paid).filter((v) => v != null);
    let paid, paidSource;
    if (hasPaid && paidList.length) {
      paid = paidList.reduce((a, b) => a + b, 0);
      paidSource = 'file';
      if (paidList.length > 1 && paidList.every((v) => v === paidList[0]) && paidList[0] > 0) notes.push('同じ支給額が' + paidList.length + '行に入っています。社員の合計を各行に入れている場合は、1行だけにしてください（いまは合計' + yen(paid) + '円として計算）。');
    } else if (hasPaid) {
      paid = company; paidSource = 'rule';
      notes.push('支給額が空なので、会社のルールで計算した額を支給額としました。');
    } else { paid = company; paidSource = 'rule'; }
    /* 判定 */
    let nontaxable = Math.min(paid, limitTotal);
    let taxable = paid - nontaxable;
    let taxStatus;
    if (checks.length) { taxStatus = '要確認'; nontaxable = 0; taxable = 0; }
    else if (paid === 0) taxStatus = '支給なし';
    else if (taxable === 0) taxStatus = '非課税';
    else if (nontaxable === 0) taxStatus = '全額課税';
    else taxStatus = '一部課税';
    /* 会社のルールとの比べ */
    let compare = '', diff = 0;
    if (checks.length) compare = '';
    else if (paidSource === 'rule') compare = 'ルールで計算';
    else if (o.carMethod === 'none' && car) compare = '比べない';
    else {
      diff = paid - company;
      compare = Math.abs(diff) <= o.tolerance ? '一致' : diff > 0 ? '多い' : '少ない';
      if (compare === '多い') notes.push('会社のルールで計算した額（' + yen(company) + '円）より ' + yen(diff) + '円多く支給しています。');
      if (compare === '少ない') notes.push('会社のルールで計算した額（' + yen(company) + '円）より ' + yen(-diff) + '円少なく支給しています。');
    }
    /* 実費（片道運賃 × 2 × 出勤日数）のほうが安いか（在宅勤務が多い人など） */
    let actual = null, cheaperActual = false;
    list.forEach(function (x) {
      if (!x.means || !x.means.transit || x.fare == null || x.days == null) return;
      actual = (actual || 0) + x.fare * 2 * x.days * m;
    });
    if (actual != null && fareTotal > 0 && !checks.length && actual < fareTotal) {
      cheaperActual = true;
      notes.push('出勤日数から計算した運賃（片道運賃×2×出勤日数＝' + yen(actual) + '円）のほうが定期代（' + yen(fareTotal) + '円）より安くなっています。在宅勤務が多い人は支給の方法を見直す余地があります。');
    }
    return {
      key: keyOf(first), id, name, rows: rowNos, means: meansLabel(means), meansFlags: means, distance, unit: m,
      fare: fareTotal, carLimit, limit: limitTotal, company, paid, paidSource, nontaxable, taxable,
      monthlyPaid: Math.floor(paid / m), monthlyTaxable: Math.floor(taxable / m),
      taxStatus, compare, diff, checks, notes, cheaperActual, actual,
    };
  }

  /* ---------- 出力 ---------- */
  const RESULT_HEADER = ['社員番号', '氏名', '通勤手段', '片道距離（km）', '支給の単位（か月）', '支給額', '会社のルールの額', '差額', '会社のルールとの比べ',
    '定期代（合理的な運賃）', '距離ごとの限度額', '非課税の限度額', '非課税額', '課税額', '1か月あたりの支給額', '1か月あたりの課税額', '判定', '確認が要ること', 'メモ'];
  function resultRows(people) {
    const out = [RESULT_HEADER.slice()];
    (people || []).forEach(function (p) {
      const chk = p.taxStatus === '要確認';
      out.push([p.id, p.name, p.means, p.distance == null ? '' : String(p.distance), String(p.unit), chk ? '' : String(p.paid), chk ? '' : String(p.company),
        p.compare === '多い' || p.compare === '少ない' || p.compare === '一致' ? String(p.diff) : '', p.compare,
        p.meansFlags.transit ? String(p.fare) : '', p.meansFlags.car ? String(p.carLimit) : '', chk ? '' : String(p.limit),
        chk ? '' : String(p.nontaxable), chk ? '' : String(p.taxable), chk ? '' : String(p.monthlyPaid), chk ? '' : String(p.monthlyTaxable),
        p.taxStatus, p.checks.join(' '), p.notes.join(' ')]);
    });
    return out;
  }
  /* 給与ソフトに取り込む用: 要確認の人は入れない */
  const PAYROLL_HEADER = ['社員番号', '氏名', '通勤手当（支給額）', '非課税通勤手当', '課税通勤手当', '支給の単位（か月）'];
  function payrollRows(people) {
    const rows = [PAYROLL_HEADER.slice()], skipped = [];
    (people || []).forEach(function (p) {
      if (p.taxStatus === '要確認') { skipped.push(p.id || p.name); return; }
      rows.push([p.id, p.name, String(p.paid), String(p.nontaxable), String(p.taxable), String(p.unit)]);
    });
    return { rows, skipped };
  }

  return {
    TRANSIT_CAP, DISTANCE_TABLES, DEFAULT_TABLE, DEFAULT_OPTIONS, TAX_STATUS, RESULT_HEADER, PAYROLL_HEADER, FIELD_KEYS,
    tableRows, distanceLimit, validateTable, cleanTable, normHeader, parseMeans, meansLabel, parseUnit, parseDistance,
    guessMapping, extract, passFor, companyPass, evaluate, resultRows, payrollRows,
  };
});
