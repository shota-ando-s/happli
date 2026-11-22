/* インボイス登録番号のチェック: 取引先マスタの登録番号の書き方・検査用数字・重複を確かめ、
   国税庁の公表データ（任意）と照合し、仕入や経費の明細から仕入税額控除の経過措置の目安を集計する。
   ネットへの照会はしない。ブラウザでは window.MacroApps.invoice、Node では module.exports */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const gensen = typeof require !== 'undefined' ? require('./gensen.js') : root.MacroApps.gensen;
  const api = factory(kana, gensen);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.invoice = api; }
})(typeof self !== 'undefined' ? self : this, function (kana, gensen) {
  /* ---------- 経過措置の期間（消費税法 平成28年改正法附則 第52条・第53条） ----------
     適格請求書発行事業者でない相手からの仕入れでも、次の割合は仕入税額控除できる。
     - 2023/10/01〜2026/09/30: 80%
     - 2026/10/01〜2029/09/30: 50%
     - 2029/10/01〜: 0%
     少額特例（附則第53条の2）: 基準期間の課税売上高が1億円以下などの事業者は、2023/10/01〜2029/09/30 の
     税込み1万円未満の仕入れは、インボイスがなくても帳簿の記載だけで控除できる */
  const START = '2023/10/01';
  const PERIODS = [
    { id: 'p80', from: '2023/10/01', to: '2026/09/30', ratio: 80, label: '経過措置 80%（2023/10〜2026/9）' },
    { id: 'p50', from: '2026/10/01', to: '2029/09/30', ratio: 50, label: '経過措置 50%（2026/10〜2029/9）' },
    { id: 'p0', from: '2029/10/01', to: '9999/12/31', ratio: 0, label: '控除なし（2029/10〜）' },
  ];
  const SMALL = { limit: 10000, from: '2023/10/01', to: '2029/09/30' };
  const CATEGORY = {
    qualified: '登録番号あり（全額）',
    small: '少額特例（全額）',
    p80: PERIODS[0].label, p50: PERIODS[1].label, p0: PERIODS[2].label,
    pre: '制度の始まる前（2023/9以前）',
  };
  const CATEGORY_ORDER = ['qualified', 'small', 'p80', 'p50', 'p0', 'pre'];

  /* ---------- 登録番号 ---------- */
  /* 法人番号の検査用数字（法人番号の指定等に関する省令 第2条）:
     12けたの基礎番号の、いちばん下のけたを1番目として n 番目の数字を Pn、n が奇数なら Qn=1・偶数なら Qn=2 とし、
     9 − (Σ Pn×Qn を 9 で割った余り) を先頭に付ける */
  function checkDigit(base12) {
    const s = String(base12 || '');
    if (!/^\d{12}$/.test(s)) return null;
    let sum = 0;
    for (let n = 1; n <= 12; n++) sum += Number(s.charAt(12 - n)) * (n % 2 === 1 ? 1 : 2);
    return 9 - (sum % 9);
  }
  /* 書き方のゆれをならす: 全角→半角、空白・ハイフン類を除く、小文字の t、T が無い13けた */
  const DASHES = /[\s\-‐‑‒–—―−ー－ｰ_.・･]/g;
  function normalizeNumber(v) {
    const raw = String(v == null ? '' : v);
    const t0 = raw.normalize('NFKC').trim();
    if (!t0) return { raw, value: '', empty: true, fixed: false, notes: [] };
    let t = t0.replace(DASHES, '').toUpperCase();
    const notes = [];
    if (t !== t0 || t0 !== raw.trim()) notes.push(/[^\x20-\x7e]/.test(raw.trim()) ? '全角の文字・空白・ハイフンを整えました' : '空白・ハイフン・小文字を整えました');
    if (/^\d{13}$/.test(t)) { t = 'T' + t; notes.push('先頭の「T」を補いました'); }
    const ok = /^T\d{13}$/.test(t);
    const fixed = ok && t !== raw.trim();
    return { raw, value: ok ? t : '', shown: t, empty: false, fixed, ok, notes: ok && fixed ? notes : [] };
  }
  function digitsOk(value) {
    const d = String(value || '').replace(/^T/, '');
    if (!/^\d{13}$/.test(d)) return false;
    return checkDigit(d.slice(1)) === Number(d.charAt(0));
  }
  /* 12けたの基礎番号から、検査用数字つきの登録番号を作る（テストや見本づくり用） */
  function makeNumber(base12) { const c = checkDigit(base12); return c == null ? '' : 'T' + c + base12; }

  /* ---------- 名前 ---------- */
  const CORP_WORDS = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
    '特定非営利活動法人', 'NPO法人', '社会福祉法人', '医療法人', '学校法人', '税理士法人', '弁護士法人', '司法書士法人', '監査法人',
    '(株)', '(有)', '(同)', '(合)', '(資)', '(名)', '(一社)', '(一財)', '(公社)', '(公財)', '(特非)', '(医)', '(社福)', '(学)'];
  /* 同じ相手とみなすためのキー: 会社の種類・空白・記号を除き、半角カナ・大文字にそろえる */
  function nameKey(name) {
    let t = String(name == null ? '' : name).normalize('NFKC').replace(/[\s　]+/g, '');
    CORP_WORDS.forEach(function (w) { t = t.split(w).join(''); });
    t = t.replace(/[()（）「」『』・,.、。]/g, '');
    return kana.toHankaku(t).toUpperCase();
  }
  function guessEntity(name) { return gensen.guessEntity(name); }
  function parseEntity(v) {
    const t = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!t) return '';
    if (/^2$|法人|会社/.test(t)) return '法人';
    if (/^1$|個人/.test(t)) return '個人';
    return '';
  }
  const parseDate = gensen.parseDate;

  /* ---------- 列の推測 ---------- */
  function guessBy(header, order, words, avoid) {
    const hs = (header || []).map((h) => String(h).trim());
    const taken = [], m = {};
    order.forEach(function (key) {
      m[key] = '';
      for (const w of words[key]) {
        const hit = hs.find((h) => taken.indexOf(h) === -1 && h.indexOf(w) !== -1 && !(avoid[key] && avoid[key].test(h)));
        if (hit) { taken.push(hit); m[key] = hit; break; }
      }
    });
    return m;
  }
  const MASTER_WORDS = {
    number: ['登録番号', 'インボイス', '適格請求書', 'T番号', '事業者番号'],
    entity: ['個人法人', '法人個人', '個人・法人', '個人/法人', '人格区分', '区分'],
    code: ['取引先コード', '仕入先コード', '支払先コード', 'コード'],
    name: ['取引先名', '仕入先名', '支払先名', '取引先', '仕入先', '支払先', '名称', '会社名', '相手先', '氏名'],
  };
  const MASTER_AVOID = { name: /コード|番号|区分|カナ|ｶﾅ|フリガナ/, entity: /税|支払/, code: /郵便|銀行|支店/ };
  function guessMasterMapping(header) {
    return guessBy(header, ['number', 'entity', 'code', 'name'], MASTER_WORDS, MASTER_AVOID);
  }
  const DETAIL_WORDS = {
    number: ['登録番号', 'インボイス', 'T番号'],
    tax: ['消費税額', '消費税', '税額'],
    rate: ['税率', '借方税区分', '税区分'],
    date: ['取引日', '請求日', '利用日', 'ご利用日', '支払日', '計上日', '伝票日付', '納品日', '日付', '年月日'],
    amount: ['税込金額', '支払金額', 'ご利用金額', '借方金額', '金額'],
    partner: ['仕入先', '支払先', '取引先', '相手先', 'ご利用店名', '店名', '摘要'],
  };
  const DETAIL_AVOID = { amount: /消費税|税額|合計|単価|源泉/, partner: /コード|番号|区分/, date: /申請|期限/, tax: /源泉|区分|率/ };
  function guessDetailMapping(header) {
    return guessBy(header, ['number', 'tax', 'rate', 'date', 'amount', 'partner'], DETAIL_WORDS, DETAIL_AVOID);
  }

  /* ---------- 公表データ（国税庁 適格請求書発行事業者公表サイトのダウンロードデータ） ----------
     見出しのあるCSV（自分で作った一覧など）は見出しで列を探す。見出しのないCSV（公表サイトの全件・差分データ）は
     列1..列N の見出しを付け、登録番号は中身（T＋13けた）で、日付と名称は公表データの仕様の位置で初期選択する */
  const PUBLIC_WORDS = {
    number: ['登録番号'],
    registered: ['登録年月日', '登録日'],
    disposal: ['取消年月日', '取消日', '取消'],
    expire: ['失効年月日', '失効日', '失効'],
    name: ['氏名又は名称', '名称', '氏名', '事業者名'],
  };
  const PUBLIC_AVOID = { name: /カナ|フリガナ|英語|ローマ字|所在地|住所/ };
  /* 公表データ（見出しなし）の列の位置（1から数える）。仕様書の版で変わることがあるので確認事項 */
  const PUBLIC_POS = { number: 2, registered: 8, disposal: 10, expire: 11, name: 19 };
  function preparePublic(rows) {
    const list = (rows || []).filter((r) => r && r.some((c) => String(c == null ? '' : c).trim() !== ''));
    if (!list.length) return { header: [], rows: [], headerless: false, map: {} };
    const first = list[0].map((c) => String(c == null ? '' : c).trim());
    const headerless = first.some((c) => /^T\d{13}$/.test(c.normalize('NFKC')));
    if (!headerless) {
      return { header: first, rows: list.slice(1), headerless: false, map: guessBy(first, ['number', 'registered', 'disposal', 'expire', 'name'], PUBLIC_WORDS, PUBLIC_AVOID) };
    }
    const width = list.reduce((w, r) => Math.max(w, r.length), 0);
    const header = [];
    for (let i = 1; i <= width; i++) header.push('列' + i);
    const map = { number: '', registered: '', disposal: '', expire: '', name: '' };
    const numIdx = first.findIndex((c) => /^T\d{13}$/.test(c.normalize('NFKC')));
    map.number = header[numIdx];
    const shift = numIdx + 1 - PUBLIC_POS.number;
    ['registered', 'disposal', 'expire', 'name'].forEach(function (k) {
      const p = PUBLIC_POS[k] + shift;
      if (p >= 1 && p <= width) map[k] = header[p - 1];
    });
    return { header, rows: list, headerless: true, map };
  }
  /* map: { number, name, registered, disposal, expire } → Map(登録番号 → {name, registered, ended, endKind}) */
  function buildPublicIndex(header, rows, map) {
    const hs = (header || []).map((h) => String(h).trim());
    const ci = {};
    ['number', 'name', 'registered', 'disposal', 'expire'].forEach((k) => { ci[k] = map && map[k] ? hs.indexOf(map[k]) : -1; });
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const index = new Map();
    let skipped = 0;
    (rows || []).forEach(function (r) {
      const n = normalizeNumber(cell(r, ci.number));
      if (!n.ok) { skipped++; return; }
      const dis = parseDate(cell(r, ci.disposal)), exp = parseDate(cell(r, ci.expire));
      let ended = '', endKind = '';
      if (dis && (!exp || dis <= exp)) { ended = dis; endKind = '取消'; } else if (exp) { ended = exp; endKind = '失効'; }
      /* 同じ番号が何度も出る（履歴）ときは後の行で上書きする */
      index.set(n.value, { name: cell(r, ci.name), registered: parseDate(cell(r, ci.registered)), ended, endKind });
    });
    return { index, count: index.size, skipped };
  }

  /* ---------- 取引先マスタのチェック ---------- */
  const SEVERITY = { ok: 0, info: 1, warning: 2, error: 3 };
  const JUDGE = ['問題なし', '問題なし', '要確認', '直してください'];
  /* map: { name, number, entity, code }  opts: { publicIndex: Map, baseDate: 'YYYY/MM/DD', individualCheckDigit: 'warn'|'error'|'skip', entityOverrides: {nameKey: '個人'|'法人'} } */
  function checkMaster(header, rows, map, opts) {
    const o = opts || {};
    const hs = (header || []).map((h) => String(h).trim());
    const ci = { name: map.name ? hs.indexOf(map.name) : -1, number: map.number ? hs.indexOf(map.number) : -1,
      entity: map.entity ? hs.indexOf(map.entity) : -1, code: map.code ? hs.indexOf(map.code) : -1 };
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const eov = o.entityOverrides || {};
    const indCheck = o.individualCheckDigit || 'warn';
    const pub = o.publicIndex || null;
    const lines = [];
    (rows || []).forEach(function (r, idx) {
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const name = cell(r, ci.name);
      const key = nameKey(name);
      let entity, entitySource;
      if (eov[key] === '個人' || eov[key] === '法人') { entity = eov[key]; entitySource = 'user'; }
      else if (parseEntity(cell(r, ci.entity))) { entity = parseEntity(cell(r, ci.entity)); entitySource = 'file'; }
      else { entity = guessEntity(name); entitySource = 'guess'; }
      const n = normalizeNumber(cell(r, ci.number));
      const issues = [];
      let status;
      if (n.empty) { status = 'none'; issues.push({ sev: 'warning', text: '登録番号がありません。相手が登録していないか、まだ聞いていないかを確かめてください。' }); }
      else if (!n.ok) { status = 'format'; issues.push({ sev: 'error', text: '「' + n.raw.trim() + '」は登録番号の形（T＋数字13けた）になっていません。けたの数や文字を確かめてください。' }); }
      else if (!digitsOk(n.value)) {
        const want = checkDigit(n.value.slice(2));
        if (entity === '個人' && indCheck !== 'error') {
          status = indCheck === 'skip' ? 'ok' : 'digitInd';
          if (indCheck !== 'skip') issues.push({ sev: 'warning', text: '最初の数字（検査用数字）が法人番号の決まりと合いません（計算では「' + want + '」）。個人事業者の番号は法人番号の決まりと同じとは限らないため、請求書の番号と見比べてください。' });
        } else {
          status = 'digit';
          issues.push({ sev: 'error', text: '最初の数字（検査用数字）が合いません。計算では「T' + want + n.value.slice(2) + '」になるはずです。写し間違いがないか、請求書の番号と見比べてください。' });
        }
      } else status = 'ok';
      if (n.ok && n.notes.length) issues.push({ sev: 'info', text: n.notes.join('。') + '。' });
      let pubStatus = '', pubName = '', registered = '', ended = '';
      if (pub && n.ok) {
        const hit = pub.get(n.value);
        if (!hit) { pubStatus = '公表データにない'; issues.push({ sev: 'warning', text: '読み込んだ公表データにこの番号がありません。番号の写し間違いか、公表データが一部（地域や期間）だけでないかを確かめてください。' }); }
        else {
          pubName = hit.name; registered = hit.registered; ended = hit.ended;
          const base = o.baseDate || '';
          if (hit.ended && (!base || hit.ended <= base)) {
            pubStatus = hit.endKind === '取消' ? '取消' : '失効';
            issues.push({ sev: 'error', text: '公表データでは ' + hit.ended + ' に登録が' + (hit.endKind === '取消' ? '取り消されて' : '失効して') + 'います。この日以後の取引では仕入税額控除を全額は受けられません。' });
          } else if (hit.registered && base && hit.registered > base) {
            pubStatus = '登録前';
            issues.push({ sev: 'warning', text: '公表データの登録日は ' + hit.registered + ' で、確認の基準日より後です。' });
          } else {
            pubStatus = '登録あり';
            if (hit.ended) issues.push({ sev: 'warning', text: hit.ended + ' に登録が' + (hit.endKind === '取消' ? '取り消される' : '失効する') + '予定です。' });
          }
          if (hit.name && name && nameKey(hit.name) !== key && nameKey(hit.name).indexOf(key) === -1 && key.indexOf(nameKey(hit.name)) === -1) {
            if (pubStatus === '登録あり') pubStatus = '名称が違う';
            issues.push({ sev: 'warning', text: '公表データの名称は「' + hit.name + '」です。別の事業者の番号を登録していないか確かめてください（屋号や旧社名のこともあります）。' });
          }
        }
      }
      lines.push({ row: idx + 2, code: cell(r, ci.code), name, nameKey: key, entity, entitySource, raw: n.raw.trim(), number: n.value, shown: n.ok ? n.value : (n.shown || ''),
        status, fixed: !!n.fixed, pubStatus, pubName, registered, ended, issues });
    });
    /* 重複: 同じ番号が別の名前の取引先に付いている / 同じ名前の取引先に別の番号 */
    const byNumber = new Map(), byName = new Map();
    lines.forEach(function (l) {
      if (l.number) { if (!byNumber.has(l.number)) byNumber.set(l.number, []); byNumber.get(l.number).push(l); }
      if (l.nameKey) { if (!byName.has(l.nameKey)) byName.set(l.nameKey, []); byName.get(l.nameKey).push(l); }
    });
    byNumber.forEach(function (list) {
      const names = new Set(list.map((l) => l.nameKey));
      if (names.size < 2) return;
      list.forEach(function (l) {
        const others = list.filter((x) => x !== l && x.nameKey !== l.nameKey).map((x) => x.name + '（' + x.row + '行目）');
        l.issues.push({ sev: 'warning', text: '同じ登録番号が別の取引先にも付いています: ' + others.slice(0, 5).join('、') + (others.length > 5 ? ' ほか' : '') + '。グループ会社の別名か、写し間違いかを確かめてください。' });
        l.dupNumber = true;
      });
    });
    byName.forEach(function (list) {
      const nums = new Set(list.filter((l) => l.number).map((l) => l.number));
      if (nums.size < 2) return;
      list.forEach(function (l) {
        if (!l.number) return;
        const others = list.filter((x) => x !== l && x.number && x.number !== l.number).map((x) => x.number + '（' + x.row + '行目）');
        l.issues.push({ sev: 'warning', text: '同じ取引先に別の登録番号もあります: ' + others.slice(0, 5).join('、') + '。どちらが正しいか確かめてください。' });
        l.dupName = true;
      });
    });
    const summary = { count: lines.length, ok: 0, warning: 0, error: 0, none: 0, fixed: 0, ...(pub ? { pubOk: 0, pubNg: 0 } : {}) };
    lines.forEach(function (l) {
      const worst = l.issues.reduce((w, x) => Math.max(w, SEVERITY[x.sev]), 0);
      l.severity = worst;
      l.judge = JUDGE[worst];
      if (l.status === 'none') summary.none++;
      if (worst >= 3) summary.error++; else if (worst === 2) summary.warning++; else summary.ok++;
      if (l.fixed) summary.fixed++;
      if (pub && l.number) { if (l.pubStatus === '登録あり') summary.pubOk++; else summary.pubNg++; }
    });
    return { lines, summary };
  }
  const STATUS_LABEL = { ok: '正しい形', none: '番号なし', format: '形が違う', digit: '検査用数字が合わない', digitInd: '検査用数字が合わない（個人）' };
  const ENTITY_SOURCE = { file: 'ファイルの区分', guess: '名前から推測', user: '画面で指定' };
  const MASTER_HEADER = ['行', '取引先コード', '取引先', '区分', '区分の決め方', '元の登録番号', '整えた登録番号', '番号の形', '公表データ', '公表データの名称', '登録日', '失効・取消日', '判定', 'メモ'];
  function masterRows(lines) {
    const rows = [MASTER_HEADER.slice()];
    (lines || []).forEach((l) => rows.push([String(l.row), l.code, l.name, l.entity, ENTITY_SOURCE[l.entitySource] || '', l.raw, l.number,
      STATUS_LABEL[l.status] || '', l.pubStatus, l.pubName, l.registered, l.ended, l.judge, l.issues.map((x) => x.text).join(' ')]));
    return rows;
  }
  /* 整えた取引先マスタ: 元の列の並びのまま、登録番号の列だけを整えた値にし、最後に「登録番号の確認」を足す。
     形が直せなかった番号は元のまま残す */
  function cleanedMaster(header, rows, map, lines) {
    const hs = (header || []).map((h) => String(h).trim());
    const ni = hs.indexOf(map.number);
    const byRow = new Map((lines || []).map((l) => [l.row, l]));
    const out = [hs.concat(['登録番号の確認'])];
    let changed = 0;
    (rows || []).forEach(function (r, idx) {
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const l = byRow.get(idx + 2);
      const row = hs.map((h, i) => (r[i] == null ? '' : String(r[i])));
      if (l && ni >= 0 && l.number && row[ni] !== l.number) { row[ni] = l.number; changed++; }
      row.push(l ? (l.severity >= 2 ? l.judge + '：' + l.issues.filter((x) => SEVERITY[x.sev] >= 2).map((x) => x.text).join(' ') : l.judge) : '');
      out.push(row);
    });
    return { rows: out, changed };
  }

  /* ---------- 明細と経過措置 ---------- */
  function parseRate(v, fallback) {
    const t = String(v == null ? '' : v).normalize('NFKC').replace(/\s/g, '');
    if (!t) return fallback;
    if (/非課税|不課税|対象外|免税|課税外|^0%?$/.test(t)) return 0;
    if (/軽減|8/.test(t) && !/10/.test(t)) return 8;
    if (/10/.test(t)) return 10;
    if (/^0\.1$/.test(t)) return 10;
    if (/^0\.08$/.test(t)) return 8;
    return fallback;
  }
  function readAmount(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (t === '') return { value: null };
    const neg = /^[-−▲△]|^\(.*\)$/.test(t.normalize('NFKC'));
    const n = kana.normalizeAmount(t.normalize('NFKC').replace(/^[-−▲△]/, '').replace(/^\((.*)\)$/, '$1'));
    if (!Number.isFinite(n)) return { problem: '「' + t + '」が数字として読めません' };
    if (!Number.isInteger(n)) return { problem: '「' + t + '」に小数があります。円単位にしてください' };
    return { value: neg ? -Math.abs(n) : n };
  }
  /* 0 に向けて切り捨て（返品のマイナスも同じ大きさで扱う） */
  const trunc = (x) => (x < 0 ? -Math.floor(-x + 1e-9) : Math.floor(x + 1e-9));
  /* map: { date, partner, amount, tax, rate, number }  opts: { amountMode: 'gross'|'net', defaultRate: 10|8 } */
  function extractDetails(header, rows, map, opts) {
    const o = opts || {};
    const hs = (header || []).map((h) => String(h).trim());
    const ci = {};
    ['date', 'partner', 'amount', 'tax', 'rate', 'number'].forEach((k) => { ci[k] = map[k] ? hs.indexOf(map[k]) : -1; });
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const items = [], errors = [];
    const defRate = o.defaultRate === 8 ? 8 : 10;
    (rows || []).forEach(function (r, idx) {
      const row = idx + 2;
      if (!r || r.every((c) => String(c == null ? '' : c).trim() === '')) return;
      const problems = [];
      const rawDate = cell(r, ci.date);
      const date = parseDate(rawDate);
      if (!rawDate) problems.push('日付が空です');
      else if (!date) problems.push('日付「' + rawDate + '」が読めません。年から書いた日付（例: 2026/10/31）にしてください');
      const partner = cell(r, ci.partner);
      if (!partner && !cell(r, ci.number)) problems.push('取引先が空です');
      const a = readAmount(cell(r, ci.amount));
      if (a.problem) problems.push('金額' + a.problem);
      else if (a.value == null) problems.push('金額が空です');
      let tax = null;
      if (ci.tax >= 0 && o.taxMode !== 'compute') {
        const t = readAmount(cell(r, ci.tax));
        if (t.problem) problems.push('消費税額' + t.problem);
        else tax = t.value;
      }
      if (problems.length) { errors.push({ row, message: row + '行目: ' + problems.join('。') + '。' }); return; }
      const rate = parseRate(cell(r, ci.rate), defRate);
      items.push({ row, date, partner, partnerKey: nameKey(partner), amount: a.value, tax, rate, number: cell(r, ci.number) });
    });
    return { items, errors };
  }
  /* 消費税額の列が請求書1枚の合計（同じ請求書の行に同じ値が並ぶ）に見えるかを調べる。
     仕入請求の照合の請求明細のように、行ごとの税額でない列を足すと二重に数えてしまうため */
  function taxLooksInvoiceLevel(header, rows, map) {
    if (!map.tax) return false;
    const hs = (header || []).map((h) => String(h).trim());
    const ti = hs.indexOf(map.tax), ai = hs.indexOf(map.amount), pi = hs.indexOf(map.partner), di = hs.indexOf(map.date);
    const inv = hs.findIndex((h) => /請求書番号|伝票番号|請求番号/.test(h));
    const groups = new Map();
    (rows || []).forEach(function (r) {
      if (!r) return;
      const k = inv >= 0 ? String(r[inv] || '') : String(r[pi] || '') + '\t' + String(r[di] || '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    let multi = 0, same = 0;
    groups.forEach(function (list) {
      if (list.length < 2) return;
      const amounts = new Set(list.map((r) => String(r[ai] || '')));
      if (amounts.size < 2) return;
      multi++;
      if (new Set(list.map((r) => String(r[ti] || ''))).size === 1) same++;
    });
    return multi > 0 && same / multi > 0.5;
  }
  function periodOf(date) {
    if (!date || date < START) return 'pre';
    for (const p of PERIODS) if (date >= p.from && date <= p.to) return p.id;
    return 'p0';
  }
  function ratioOf(cat) { const p = PERIODS.find((x) => x.id === cat); return p ? p.ratio : 100; }
  /* 明細ごとに、登録番号があるか（取引日に有効か）を決めて、控除できる消費税額の目安を出す。
     masterLines: checkMaster の lines。opts: { amountMode, smallBusiness(少額特例の対象の事業者か), publicIndex } */
  function evaluateDetails(items, masterLines, opts) {
    const o = opts || {};
    const pub = o.publicIndex || null;
    const byKey = new Map();
    (masterLines || []).forEach(function (l) {
      if (!l.nameKey) return;
      const prev = byKey.get(l.nameKey);
      /* 同じ名前が複数あるときは、問題のない番号のある行を優先 */
      if (!prev || (!prev.number && l.number) || (prev.severity >= 3 && l.severity < 3 && l.number)) byKey.set(l.nameKey, l);
    });
    const lines = (items || []).map(function (it) {
      const notes = [];
      let number = '', numberOk = false, source = '';
      if (it.number) {
        const n = normalizeNumber(it.number);
        number = n.value || it.number;
        numberOk = n.ok && digitsOk(n.value);
        source = '明細の番号';
        if (!n.ok) notes.push('明細の登録番号「' + it.number + '」が登録番号の形ではありません。');
        else if (!numberOk) notes.push('明細の登録番号の検査用数字が合いません。');
      } else {
        const m = byKey.get(it.partnerKey);
        if (!m) notes.push('取引先マスタに「' + it.partner + '」が見つかりません。');
        else if (!m.number) { source = 'マスタ'; notes.push(m.status === 'format' ? '取引先マスタの登録番号「' + m.raw + '」の形が違います。' : '取引先マスタに登録番号がありません。'); }
        else {
          number = m.number; source = 'マスタ';
          numberOk = m.status === 'ok' || m.status === 'digitInd';
          if (m.status === 'digitInd') notes.push('登録番号の検査用数字が法人番号の決まりと合いません（個人）。');
          else if (!numberOk) notes.push('取引先マスタの登録番号の検査用数字が合いません。');
          else if (m.dupNumber || m.dupName || m.pubStatus === '名称が違う') notes.push('取引先マスタの番号に確認が要る点があります（' + m.row + '行目）。');
        }
      }
      let qualified = numberOk;
      if (qualified && pub) {
        const hit = pub.get(number);
        if (hit) {
          if (hit.registered && it.date < hit.registered) { qualified = false; notes.push('取引日が登録日（' + hit.registered + '）より前です。'); }
          else if (hit.ended && it.date >= hit.ended) { qualified = false; notes.push('取引日が登録の' + hit.endKind + '日（' + hit.ended + '）以後です。'); }
        } else notes.push('公表データにない番号です（全額控除として数えています）。');
      }
      const rate = it.rate;
      const gross = o.amountMode === 'net' ? it.amount + (it.tax != null ? it.tax : trunc(it.amount * rate / 100)) : it.amount;
      let tax;
      if (rate === 0) tax = 0;
      else if (it.tax != null) tax = it.tax;
      else tax = o.amountMode === 'net' ? trunc(it.amount * rate / 100) : trunc(it.amount * rate / (100 + rate));
      const period = periodOf(it.date);
      let category;
      if (rate === 0) { category = 'exempt'; notes.length = 0; }
      else if (period === 'pre') category = 'pre';
      else if (qualified) category = 'qualified';
      else if (o.smallBusiness && Math.abs(gross) < SMALL.limit && it.date >= SMALL.from && it.date <= SMALL.to) { category = 'small'; notes.push('税込み1万円未満のため少額特例で数えています（帳簿への記載が必要です）。'); }
      else category = period;
      const ratio = category === 'exempt' ? 0 : (category === 'qualified' || category === 'small' || category === 'pre') ? 100 : ratioOf(category);
      const deductible = ratio === 100 ? tax : trunc(tax * ratio / 100);
      return { row: it.row, date: it.date, partner: it.partner, number, source, qualified, rate, amount: it.amount, gross, tax,
        category, ratio, deductible, lost: tax - deductible, notes };
    });
    const summary = { count: lines.length, qualified: 0, notQualified: 0, small: 0, exempt: 0, tax: 0, deductible: 0, lost: 0 };
    lines.forEach(function (l) {
      if (l.category === 'exempt') { summary.exempt++; return; }
      summary.tax += l.tax; summary.deductible += l.deductible; summary.lost += l.lost;
      if (l.category === 'qualified' || l.category === 'pre') summary.qualified++;
      else if (l.category === 'small') summary.small++;
      else summary.notQualified++;
    });
    return { lines, summary };
  }
  /* 区分 × 税率の集計 */
  function aggregate(lines) {
    const map = new Map();
    (lines || []).forEach(function (l) {
      if (l.category === 'exempt') return;
      const k = l.category + '\t' + l.rate;
      let g = map.get(k);
      if (!g) { g = { category: l.category, label: CATEGORY[l.category], rate: l.rate, ratio: l.ratio, count: 0, gross: 0, tax: 0, deductible: 0, lost: 0 }; map.set(k, g); }
      g.count++; g.gross += l.gross; g.tax += l.tax; g.deductible += l.deductible; g.lost += l.lost;
    });
    return Array.from(map.values()).sort((a, b) => (CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)) || (b.rate - a.rate));
  }
  /* 登録番号のない取引先ごと（控除できない額の多い順） */
  function byPartner(lines) {
    const map = new Map();
    (lines || []).forEach(function (l) {
      if (l.category === 'exempt' || l.category === 'qualified' || l.category === 'pre') return;
      const k = nameKey(l.partner) || l.number;
      let g = map.get(k);
      if (!g) { g = { partner: l.partner, count: 0, gross: 0, tax: 0, deductible: 0, lost: 0, reason: l.notes[0] || '' }; map.set(k, g); }
      g.count++; g.gross += l.gross; g.tax += l.tax; g.deductible += l.deductible; g.lost += l.lost;
    });
    return Array.from(map.values()).sort((a, b) => b.lost - a.lost || b.gross - a.gross);
  }
  const SUMMARY_HEADER = ['区分', '税率', '控除できる割合', '件数', '税込金額', '消費税額', '控除できる額の目安', '控除できない額の目安'];
  function summaryRows(groups) {
    const rows = [SUMMARY_HEADER.slice()];
    let c = 0, g = 0, t = 0, d = 0, lo = 0;
    (groups || []).forEach(function (x) {
      rows.push([x.label, x.rate + '%', x.ratio + '%', String(x.count), String(x.gross), String(x.tax), String(x.deductible), String(x.lost)]);
      c += x.count; g += x.gross; t += x.tax; d += x.deductible; lo += x.lost;
    });
    rows.push(['合計', '', '', String(c), String(g), String(t), String(d), String(lo)]);
    return rows;
  }
  const DETAIL_HEADER = ['行', '日付', '取引先', '登録番号', '番号の出どころ', '税率', '税込金額', '消費税額', '区分', '控除できる割合', '控除できる額の目安', '控除できない額の目安', 'メモ'];
  function detailRows(lines) {
    const rows = [DETAIL_HEADER.slice()];
    (lines || []).forEach((l) => rows.push([String(l.row), l.date, l.partner, l.number, l.source, l.category === 'exempt' ? '対象外' : l.rate + '%',
      String(l.gross), String(l.tax), l.category === 'exempt' ? '消費税の対象外' : CATEGORY[l.category], l.category === 'exempt' ? '' : l.ratio + '%',
      String(l.deductible), String(l.lost), l.notes.join(' ')]));
    return rows;
  }

  return {
    START, PERIODS, SMALL, CATEGORY, PUBLIC_POS, STATUS_LABEL, ENTITY_SOURCE, MASTER_HEADER, SUMMARY_HEADER, DETAIL_HEADER,
    checkDigit, normalizeNumber, digitsOk, makeNumber, nameKey, guessEntity, parseEntity, parseDate, parseRate,
    guessMasterMapping, guessDetailMapping, preparePublic, buildPublicIndex, checkMaster, masterRows, cleanedMaster,
    extractDetails, taxLooksInvoiceLevel, periodOf, evaluateDetails, aggregate, byPartner, summaryRows, detailRows,
  };
});
