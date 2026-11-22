/* アンケート集計（DOM 非依存）。ブラウザでは window.MacroApps.enquete、Node では module.exports
   回答CSV（1行=1人、1列=1問）の各列の種類（単一選択・複数選択・評価・数値・自由記述・除外）を推測し、
   質問ごとの件数と割合、評価の平均・中央値・上位2つの割合、クロス集計、自由記述の単語の数を出す。
   回答の行は { line: CSVの行番号, cells: [列の値…] } の形で扱う。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.enquete = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = {
    single: { label: '単一選択', desc: '1つだけ選ぶ質問' },
    multi: { label: '複数選択', desc: 'いくつでも選べる質問' },
    rating: { label: '評価', desc: '満足度や1〜5点など、段階のある質問' },
    number: { label: '数値', desc: '年齢・回数などの数' },
    text: { label: '自由記述', desc: '文章で答える質問' },
    skip: { label: '日時・その他（除外）', desc: '集計しない列' },
  };
  const DELIMS = {
    cs: { label: '「, 」（カンマと空白）', re: /\s*,\s+/ },
    semi: { label: '「;」（セミコロン）', re: /\s*[;；]\s*/ },
    ten: { label: '「、」（読点）', re: /\s*、\s*/ },
    nl: { label: '改行', re: /\s*\r?\n\s*/ },
    comma: { label: '「,」（カンマ）', re: /\s*[,，]\s*/ },
  };
  const DELIM_ORDER = ['nl', 'semi', 'cs', 'ten', 'comma'];
  const ORDERS = { freq: '多い順', name: '名前・番号の順', appear: 'ファイルに出てきた順' };
  const BLANK_WORDS = ['', '無回答', '未回答', '-', '－', '―', '—', 'ー', 'N/A', 'n/a', 'NA'];
  const OTHER_RE = /^(その他|そのほか|ほか|other)/i;

  /* ---------- 文字の整え ---------- */
  function str(v) { return v == null ? '' : String(v); }
  function clean(v) { return str(v).replace(/[　\s]+/g, ' ').trim(); }
  function nfkc(v) { return str(v).normalize ? str(v).normalize('NFKC') : str(v); }
  function isBlank(v) { return BLANK_WORDS.indexOf(clean(v)) !== -1; }
  /* 段階のラベルを比べるための形: 全角半角をそろえ、空白・先頭の番号・末尾の括弧書きを除く */
  function canon(v) {
    return nfkc(v).replace(/\s+/g, '').replace(/^\d+[.:、)\-]?(?=\D)/, '').replace(/[(（][^)）]*[)）]$/, '').replace(/言え/g, 'いえ');
  }
  function parseNumber(v) {
    const t = nfkc(v).trim().replace(/[,\s]/g, '').replace(/(円|歳|才|人|名|回|件|時間|分|点|個|日|年|ヶ月|か月|カ月|%)$/, '');
    return /^[-+]?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  const DATE_RE = /^(\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})([ T]\d{1,2}:\d{2}(:\d{2})?.*)?$|^\d{1,2}:\d{2}(:\d{2})?$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------- 評価の段階（よい方が先）。各段階は言い方の候補 ---------- */
  const SCALES = [
    { name: '満足度（5段階）', levels: [['とても満足', '非常に満足', '大変満足', 'たいへん満足', 'とても満足した'], ['やや満足', 'まあ満足', 'まあまあ満足', 'どちらかといえば満足', 'おおむね満足', '概ね満足', '少し満足'], ['どちらともいえない', '普通', 'ふつう'], ['やや不満', 'どちらかといえば不満', '少し不満', 'やや不満足'], ['不満', 'とても不満', '非常に不満', '大変不満', '不満足']] },
    { name: '満足度（5段階）', levels: [['とても満足', '非常に満足', '大変満足', 'たいへん満足'], ['満足'], ['どちらともいえない', '普通', 'ふつう'], ['不満'], ['とても不満', '非常に不満', '大変不満', 'たいへん不満']] },
    { name: '満足度（5段階）', levels: [['満足'], ['やや満足', 'まあ満足', 'どちらかといえば満足', 'おおむね満足'], ['どちらともいえない', '普通', 'ふつう'], ['やや不満', 'どちらかといえば不満', '少し不満'], ['不満']] },
    { name: '満足度（4段階）', levels: [['満足', 'とても満足'], ['やや満足', 'まあ満足', 'どちらかといえば満足', 'おおむね満足'], ['やや不満', 'どちらかといえば不満', '少し不満'], ['不満', 'とても不満']] },
    { name: '満足度（7段階）', levels: [['とても満足', '非常に満足', '大変満足'], ['満足'], ['やや満足', 'どちらかといえば満足'], ['どちらともいえない', '普通', 'ふつう'], ['やや不満', 'どちらかといえば不満'], ['不満'], ['とても不満', '非常に不満', '大変不満']] },
    { name: '満足度（3段階）', levels: [['満足'], ['どちらともいえない', '普通', 'ふつう'], ['不満']] },
    { name: 'そう思う（5段階）', levels: [['そう思う', 'とてもそう思う', '強くそう思う', '非常にそう思う'], ['ややそう思う', 'まあそう思う', 'どちらかといえばそう思う', '少しそう思う'], ['どちらともいえない', '普通', 'ふつう'], ['あまりそう思わない', 'ややそう思わない', 'どちらかといえばそう思わない'], ['そう思わない', '全くそう思わない', 'まったくそう思わない', '全然そう思わない']] },
    { name: 'そう思う（4段階）', levels: [['そう思う', 'とてもそう思う', '強くそう思う'], ['ややそう思う', 'まあそう思う', 'どちらかといえばそう思う'], ['あまりそう思わない', 'どちらかといえばそう思わない'], ['そう思わない', '全くそう思わない', 'まったくそう思わない']] },
    { name: '役に立った（5段階）', levels: [['とても役に立った', '大変役に立った', '非常に役に立った', 'とても役立った'], ['役に立った', 'やや役に立った', 'まあ役に立った', '役立った'], ['どちらともいえない', '普通', 'ふつう'], ['あまり役に立たなかった', 'あまり役立たなかった'], ['役に立たなかった', '全く役に立たなかった', 'まったく役に立たなかった']] },
    { name: '役に立った（4段階）', levels: [['とても役に立った', '大変役に立った', '非常に役に立った'], ['役に立った', 'やや役に立った', 'まあ役に立った'], ['あまり役に立たなかった'], ['役に立たなかった', '全く役に立たなかった', 'まったく役に立たなかった']] },
    { name: '理解度（5段階）', levels: [['よく理解できた', 'とても理解できた', '十分理解できた', 'よくわかった', 'よく分かった', 'とてもよくわかった'], ['理解できた', 'だいたい理解できた', 'まあ理解できた', 'わかった', '分かった', 'だいたいわかった'], ['どちらともいえない', '普通', 'ふつう'], ['あまり理解できなかった', 'あまりわからなかった', 'あまり分からなかった'], ['理解できなかった', '全く理解できなかった', 'わからなかった', '分からなかった']] },
    { name: '良い・悪い（5段階）', levels: [['とても良い', '非常に良い', '大変良い', 'とてもよい', '非常によい', 'たいへん良い'], ['良い', 'よい', 'やや良い', 'まあ良い', 'まあまあ良い'], ['普通', 'ふつう', 'どちらともいえない'], ['やや悪い', 'あまり良くない', 'あまりよくない', 'やや不十分'], ['悪い', 'とても悪い', '非常に悪い', '良くない', 'よくない']] },
    { name: '多い・少ない（5段階）', levels: [['多い', 'とても多い', '多すぎる'], ['やや多い'], ['ちょうどよい', 'ちょうど良い', '適切', '適当'], ['やや少ない'], ['少ない', 'とても少ない', '少なすぎる']] },
    { name: '長い・短い（5段階）', levels: [['長い', 'とても長い', '長すぎる'], ['やや長い'], ['ちょうどよい', 'ちょうど良い', '適切', '適当'], ['やや短い'], ['短い', 'とても短い', '短すぎる']] },
  ];
  /* 段階外でも評価の質問によくある答え（平均には入れない） */
  const OFF_SCALE_WORDS = ['わからない', '分からない', '該当なし', '不明', '対象外', '利用していない', '使っていない', '参加していない', '覚えていない'];

  function matchScale(values) {
    const distinct = uniq(values.map(clean).filter((v) => !isBlank(v)));
    if (distinct.length < 2) return null;
    const off = [], inScale = [];
    distinct.forEach((v) => (OFF_SCALE_WORDS.indexOf(canon(v)) !== -1 ? off : inScale).push(v));
    if (inScale.length < 2 || off.length > 2) return null;
    let best = null;
    SCALES.forEach(function (sc, order) {
      const canonLevels = sc.levels.map((ws) => ws.map(canon));
      const pos = {}, used = {};
      for (const v of inScale) {
        const c = canon(v);
        const p = canonLevels.findIndex((ws) => ws.indexOf(c) !== -1);
        if (p === -1 || used[p] != null) return;
        pos[v] = p; used[p] = v;
      }
      const usedN = Object.keys(used).length;
      const full = usedN === sc.levels.length ? 1 : 0;
      // 全段階が使われている段階を優先し、次に使われた段階の多いもの、同じなら一覧の順（5段階が先）
      if (!best || full > best.full || (full === best.full && usedN > best.usedN)) best = { sc, pos, used, usedN, full, order };
    });
    if (!best) return null;
    const levels = best.sc.levels.map((ws, i) => (best.used[i] != null ? best.used[i] : ws[0]));
    const map = {};
    levels.forEach((l, i) => { map[canon(l)] = i; });
    return { kind: 'label', name: best.sc.name, levels, map, off };
  }
  /* 数字の段階（1〜5 など）。よい方（大きい数）を先に並べる */
  function numericScale(min, max) {
    const levels = [];
    for (let v = max; v >= min; v--) levels.push(String(v));
    return { kind: 'number', name: min + '〜' + max + 'の' + (max - min + 1) + '段階', min, max, levels };
  }
  function scaleFromHeader(h) {
    const t = nfkc(h);
    let m = t.match(/(\d+)\s*[〜~～\-ー－から]+\s*(\d+)/);
    if (m && Number(m[2]) > Number(m[1]) && Number(m[2]) <= 10) return { min: Number(m[1]), max: Number(m[2]) };
    m = t.match(/(\d+)\s*段階/) || t.match(/(\d+)\s*点満点/);
    if (m && Number(m[1]) >= 2 && Number(m[1]) <= 10) return { min: 1, max: Number(m[1]) };
    return null;
  }

  /* ---------- 複数選択の区切り ---------- */
  function splitMulti(cell, delim) {
    const d = DELIMS[delim] || DELIMS.cs;
    if (isBlank(cell)) return [];
    return uniq(str(cell).split(d.re).map(clean).filter((t) => t !== '' && !isBlank(t)));
  }
  function detectDelimiter(values) {
    const vals = values.map(str).filter((v) => !isBlank(v));
    if (vals.length < 2) return null;
    let best = null;
    DELIM_ORDER.forEach(function (key) {
      const re = DELIMS[key].re;
      const containing = vals.filter((v) => re.test(v.trim())).length;
      if (containing < 2 || containing < vals.length * 0.1) return;
      const occ = {}, single = {};
      let total = 0, len = 0;
      vals.forEach(function (v) {
        const toks = splitMulti(v, key);
        if (toks.length === 1) single[toks[0]] = 1;
        toks.forEach((t) => { occ[t] = (occ[t] || 0) + 1; total++; len += t.length; });
      });
      const toks = Object.keys(occ);
      if (!total) return;
      const repeated = toks.reduce((a, t) => a + (occ[t] >= 2 ? occ[t] : 0), 0);
      const distinctCells = uniq(vals.map(clean)).length;
      const alone = toks.some((t) => single[t]);
      if (repeated / total < 0.7) return;
      if (toks.length > Math.max(40, vals.length * 0.5)) return;
      if (len / total > 30) return;
      if (distinctCells < toks.length && !alone) return;
      if (!best || containing > best.containing) best = { key, containing };
    });
    return best ? best.key : null;
  }

  /* ---------- 種類の推測 ---------- */
  const SKIP_HEADER = /タイムスタンプ|timestamp|日時|時刻|メール|e-?mail|電話|氏名|お名前|^名前$|^(id|no\.?|番号|回答番号|回答者id|社員番号)$|回答日|記入日/i;
  const NUMBER_HEADER = /年齢|歳|金額|円|人数|回数|件数|時間|日数|年数|勤続|身長|体重|距離|個数|数量|^数$/;
  const RATING_HEADER = /評価|満足|点数|段階|スコア|おすすめ|お勧め|推奨|理解|わかりやすさ|分かりやすさ|重要|期待|度$|度（|度\(/;

  function detectType(header, values) {
    const h = clean(header);
    const vals = values.map(clean).filter((v) => !isBlank(v));
    if (!vals.length) return { type: 'skip', reason: '回答がひとつもない列です' };
    if (SKIP_HEADER.test(h)) return { type: 'skip', reason: '見出しから、日時・連絡先などの集計しない列と判断しました' };
    const ratio = (f) => vals.filter(f).length / vals.length;
    if (ratio((v) => DATE_RE.test(nfkc(v))) >= 0.8) return { type: 'skip', reason: '日付・時刻の列です' };
    if (ratio((v) => EMAIL_RE.test(v)) >= 0.8) return { type: 'skip', reason: 'メールアドレスの列です' };
    const sc = matchScale(vals);
    if (sc) return { type: 'rating', scale: sc };
    const nums = vals.map(parseNumber).filter((n) => isFinite(n));
    if (nums.length / vals.length >= 0.8) {
      const ints = nums.every((n) => Number.isInteger(n));
      const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
      const hint = scaleFromHeader(h);
      if (ints && hint && min >= hint.min && max <= hint.max && !NUMBER_HEADER.test(h.replace(/\d+\s*段階|\d+\s*点満点/g, ''))) return { type: 'rating', scale: numericScale(hint.min, hint.max) };
      if (ints && !NUMBER_HEADER.test(h) && min >= 0 && max <= 10 && (RATING_HEADER.test(h) || (min >= 1 && max <= 5))) {
        const top = max <= 5 ? 5 : max <= 7 ? 7 : 10;
        return { type: 'rating', scale: numericScale(min === 0 ? 0 : 1, top) };
      }
      return { type: 'number' };
    }
    const delim = detectDelimiter(values.filter((v) => !isBlank(v)));
    if (delim) return { type: 'multi', delim };
    const count = {};
    vals.forEach((v) => { count[v] = (count[v] || 0) + 1; });
    const distinct = Object.keys(count).length;
    const avgLen = vals.reduce((a, v) => a + v.length, 0) / vals.length;
    const repeatedShare = vals.filter((v) => count[v] >= 2).length / vals.length;
    if (distinct <= 30 && avgLen <= 40 && repeatedShare >= 0.5) return { type: 'single' };
    return { type: 'text' };
  }

  /* ---------- 質問の組み立て（種類・区切り・並び順・選択肢の一覧） ---------- */
  function startsWithDigit(labels) { return labels.length > 1 && labels.every((l) => /^[0-9０-９]/.test(l) || OTHER_RE.test(l)); }
  function buildQuestions(header, rows, overrides) {
    overrides = overrides || {};
    return header.map(function (hd, i) {
      const values = rows.map((r) => str(r[i]));
      const auto = detectType(hd, values);
      const ov = overrides[i] || {};
      const q = { index: i, header: clean(hd) || ('（見出しなし・' + (i + 1) + '列目）'), auto, type: TYPES[ov.type] ? ov.type : auto.type };
      q.delim = DELIMS[ov.delim] ? ov.delim : auto.delim || detectDelimiter(values) || 'cs';
      if (q.type === 'rating') q.scale = auto.scale || ratingScaleFor(hd, values);
      prepareChoices(q, values);
      q.order = ORDERS[ov.order] ? ov.order : startsWithDigit(q.choices) ? 'name' : 'freq';
      q.choices = sortChoices(q, q.choices, q.baseCount);
      return q;
    });
  }
  function ratingScaleFor(header, values) {
    const sc = matchScale(values);
    if (sc) return sc;
    const hint = scaleFromHeader(header);
    if (hint) return numericScale(hint.min, hint.max);
    const nums = values.map(parseNumber).filter((n) => isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 10);
    if (nums.length >= 2) {
      const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
      return numericScale(min === 0 ? 0 : 1, max <= 5 ? 5 : max <= 7 ? 7 : 10);
    }
    return null; // 段階として読めない（平均は出さない）
  }
  function prepareChoices(q, values) {
    const count = {}, order = [];
    values.forEach(function (v) {
      answersOf(q, v).forEach(function (a) {
        if (count[a] == null) { count[a] = 0; order.push(a); }
        count[a]++;
      });
    });
    q.baseCount = count;
    if (q.type === 'rating' && q.scale) {
      q.choices = q.scale.levels.concat(order.filter((a) => q.scale.levels.indexOf(a) === -1));
    } else q.choices = order;
  }
  function sortChoices(q, labels, count) {
    if (q.type === 'rating' && q.scale) return labels.slice();
    const pos = {};
    (q.choices || labels).forEach((l, i) => { pos[l] = i; });
    const arr = labels.slice();
    const other = (l) => (OTHER_RE.test(l) ? 1 : 0);
    if (q.order === 'freq') arr.sort((a, b) => other(a) - other(b) || (count[b] || 0) - (count[a] || 0) || pos[a] - pos[b]);
    else if (q.order === 'name') arr.sort((a, b) => other(a) - other(b) || nfkc(a).localeCompare(nfkc(b), 'ja', { numeric: true }));
    else arr.sort((a, b) => other(a) - other(b) || pos[a] - pos[b]);
    return arr;
  }
  /* 1人分の答え（選択肢の配列）。無回答は空配列 */
  function answersOf(q, cell) {
    if (isBlank(cell)) return [];
    if (q.type === 'multi') return splitMulti(cell, q.delim);
    if (q.type === 'rating' && q.scale) {
      const lv = levelOf(q.scale, cell);
      return [lv >= 0 ? q.scale.levels[lv] : clean(cell)];
    }
    return [clean(cell)];
  }
  /* 段階の位置（0 がいちばんよい）。段階外は -1 */
  function levelOf(scale, cell) {
    if (scale.kind === 'number') {
      const n = parseNumber(cell);
      if (!isFinite(n) || !Number.isInteger(n) || n < scale.min || n > scale.max) return -1;
      return scale.max - n;
    }
    const p = scale.map[canon(cell)];
    return p == null ? -1 : p;
  }
  function scoreOf(scale, lv) { return scale.kind === 'number' ? scale.max - lv : scale.levels.length - lv; }

  /* ---------- 1問の集計 ---------- */
  function summarize(q, records) {
    const n = records.length;
    const cells = records.map((r) => str(r.cells[q.index]));
    const answeredCells = cells.filter((c) => !isBlank(c));
    const answered = answeredCells.length;
    const out = { n, answered, blank: n - answered, base: answered, items: [], stats: null };
    if (q.type === 'skip') return out;
    if (q.type === 'text') { out.items = []; return out; }
    if (q.type === 'number') return Object.assign(out, numberSummary(answeredCells));
    const count = {};
    answeredCells.forEach((c) => answersOf(q, c).forEach((a) => { count[a] = (count[a] || 0) + 1; }));
    const labels = q.choices.slice();
    Object.keys(count).forEach((l) => { if (labels.indexOf(l) === -1) labels.push(l); });
    const ordered = q.type === 'rating' && q.scale ? labels : sortChoices(q, labels, count);
    out.items = ordered.map(function (l) {
      const c = count[l] || 0;
      const offScale = q.type === 'rating' && q.scale ? q.scale.levels.indexOf(l) === -1 : false;
      return { label: l, count: c, pct: answered ? (c / answered) * 100 : 0, other: OTHER_RE.test(l), offScale };
    }).filter((it) => it.count > 0 || (q.type === 'rating' && q.scale && !it.offScale) || q.type !== 'rating');
    if (q.type === 'rating' && q.scale) out.stats = ratingStats(q.scale, answeredCells);
    return out;
  }
  function median(sorted) {
    if (!sorted.length) return null;
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }
  function ratingStats(scale, cells) {
    const scores = [];
    let off = 0, top2 = 0, bottom2 = 0;
    const L = scale.levels.length;
    cells.forEach(function (c) {
      const lv = levelOf(scale, c);
      if (lv < 0) { off++; return; }
      scores.push(scoreOf(scale, lv));
      if (lv < 2) top2++;
      if (lv >= L - 2) bottom2++;
    });
    const scored = scores.length;
    scores.sort((a, b) => a - b);
    const mean = scored ? scores.reduce((a, b) => a + b, 0) / scored : null;
    const med = median(scores);
    const labelOfScore = (s) => scale.levels[scale.kind === 'number' ? scale.max - s : L - s];
    let medianLabel = null;
    if (med != null) medianLabel = Number.isInteger(med) ? labelOfScore(med) : labelOfScore(Math.ceil(med)) + 'と' + labelOfScore(Math.floor(med)) + 'の間';
    const useTop = L >= 4;
    return {
      scored, offScale: off, mean, median: med, medianLabel,
      top2: useTop && scored ? (top2 / scored) * 100 : null, top2Count: useTop ? top2 : null, top2Labels: useTop ? scale.levels.slice(0, 2) : null,
      bottom2: useTop && scored ? (bottom2 / scored) * 100 : null, bottom2Count: useTop ? bottom2 : null, bottom2Labels: useTop ? scale.levels.slice(L - 2) : null,
      maxScore: scale.kind === 'number' ? scale.max : L, minScore: scale.kind === 'number' ? scale.min : 1,
    };
  }
  function niceStep(range, maxBins) {
    if (range <= 0) return 1;
    const bases = [1, 2, 5];
    for (let p = -3; p < 12; p++) {
      for (const b of bases) {
        const s = b * Math.pow(10, p);
        if (Math.ceil((range + 1e-9) / s) + 1 <= maxBins) return s;
      }
    }
    return Math.pow(10, 12);
  }
  function numberSummary(cells) {
    const nums = [];
    let invalid = 0;
    cells.forEach((c) => { const v = parseNumber(c); if (isFinite(v)) nums.push(v); else invalid++; });
    nums.sort((a, b) => a - b);
    const count = nums.length;
    const stats = { count, invalid, mean: null, median: null, min: null, max: null, sum: 0 };
    const items = [];
    if (count) {
      stats.sum = nums.reduce((a, b) => a + b, 0);
      stats.mean = stats.sum / count;
      stats.median = median(nums);
      stats.min = nums[0]; stats.max = nums[count - 1];
      const ints = nums.every((v) => Number.isInteger(v));
      const maxBins = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(count)) + 1));
      const distinct = uniq(nums.map(String));
      if (ints && distinct.length <= maxBins) {
        distinct.map(Number).sort((a, b) => a - b).forEach((v) => {
          const c = nums.filter((x) => x === v).length;
          items.push({ label: String(v), count: c, pct: (c / count) * 100 });
        });
      } else {
        let step = niceStep(stats.max - stats.min, maxBins);
        if (ints && step < 1) step = 1;
        const lo = Math.floor(stats.min / step) * step;
        const nb = Math.floor((stats.max - lo) / step) + 1;
        for (let b = 0; b < nb; b++) {
          const a = lo + b * step, z = a + step;
          const c = nums.filter((x) => x >= a - 1e-9 && x < z - 1e-9).length;
          const label = ints && Number.isInteger(step) ? (step === 1 ? String(a) : a + '〜' + (z - 1)) : fmtNum(a) + '以上' + fmtNum(z) + '未満';
          items.push({ label, count: c, pct: (c / count) * 100 });
        }
      }
    }
    return { base: count, items, stats };
  }

  /* ---------- 絞り込み ---------- */
  function applyFilter(records, q, value) {
    if (!q || value == null || value === '') return records.slice();
    return records.filter((r) => answersOf(q, r.cells[q.index]).indexOf(value) !== -1);
  }

  /* ---------- クロス集計 ---------- */
  function crosstab(qr, qc, records) {
    const rows = qr.choices.slice(), cols = qc.choices.slice();
    const counts = rows.map(() => cols.map(() => 0));
    const rowBase = rows.map(() => 0), colBase = cols.map(() => 0);
    const rowScore = rows.map(() => ({ sum: 0, n: 0 }));
    const total = { sum: 0, n: 0 };
    const meanable = qc.type === 'rating' && qc.scale;
    let grand = 0, excluded = 0;
    records.forEach(function (r) {
      const ra = answersOf(qr, r.cells[qr.index]), ca = answersOf(qc, r.cells[qc.index]);
      if (!ra.length || !ca.length) { excluded++; return; }
      grand++;
      const ri = ra.map((a) => { let i = rows.indexOf(a); if (i === -1) { rows.push(a); counts.push(cols.map(() => 0)); rowBase.push(0); rowScore.push({ sum: 0, n: 0 }); i = rows.length - 1; } return i; });
      const ci = ca.map((a) => { let i = cols.indexOf(a); if (i === -1) { cols.push(a); counts.forEach((row) => row.push(0)); colBase.push(0); i = cols.length - 1; } return i; });
      ri.forEach((i) => { rowBase[i]++; ci.forEach((j) => { counts[i][j]++; }); });
      ci.forEach((j) => { colBase[j]++; });
      if (meanable) {
        const lv = levelOf(qc.scale, r.cells[qc.index]);
        if (lv >= 0) {
          const s = scoreOf(qc.scale, lv);
          ri.forEach((i) => { rowScore[i].sum += s; rowScore[i].n++; });
          total.sum += s; total.n++;
        }
      }
    });
    return {
      rowQ: qr.header, colQ: qc.header, rows, cols, counts, rowBase, colBase, grand, excluded,
      multi: qr.type === 'multi' || qc.type === 'multi', rowMulti: qr.type === 'multi', colMulti: qc.type === 'multi',
      rowMean: meanable ? rowScore.map((x) => (x.n ? x.sum / x.n : null)) : null,
      totalMean: meanable && total.n ? total.sum / total.n : null,
    };
  }
  /* 表示する値。mode: count | row | col */
  function cellValue(ct, i, j, mode) {
    const c = ct.counts[i][j];
    if (mode === 'row') return ct.rowBase[i] ? (c / ct.rowBase[i]) * 100 : null;
    if (mode === 'col') return ct.colBase[j] ? (c / ct.colBase[j]) * 100 : null;
    return c;
  }
  /* 合計の行（列ごと）・合計の列（行ごと）の値 */
  function totalRowValue(ct, j, mode) {
    if (mode === 'row') return ct.grand ? (ct.colBase[j] / ct.grand) * 100 : null;
    if (mode === 'col') return ct.colBase[j] ? 100 : null;
    return ct.colBase[j];
  }
  function totalColValue(ct, i, mode) {
    if (mode === 'col') return ct.grand ? (ct.rowBase[i] / ct.grand) * 100 : null;
    if (mode === 'row') return ct.rowBase[i] ? (ct.colMulti ? null : 100) : null;
    return ct.rowBase[i];
  }
  const MODE_LABEL = { count: '件数', row: '行%', col: '列%' };

  /* ---------- 自由記述 ---------- */
  const STOPWORDS = ['思い', '思う', '思っ', '思える', '感じ', '感じる', '今回', '自分', '私', '僕', '皆', '皆さん', '皆様', '方々', '大変', '非常', '本当', '特に', '少し', '色々', '様々', '全体', '部分', '場合', '以上', '以下', '以外', '程度', '一部', '一番', '今後', '次回', '前回', '当日', 'お願い', 'ござい', '致し', '頂き', '頂け', '下さい', '出来', '出来る', '良い', '良かっ', 'もう少し', '特', 'なし', 'ない',
    'the', 'and', 'for', 'to', 'of', 'is', 'it', 'in', 'on', 'a'];
  const KANJI_KATA = /[㐀-鿿゠-ヿA-Za-z]/;
  const KATA_ONLY = /^[゠-ヿ]+$/;
  function segmentWords(text, segmenter) {
    const segs = [];
    for (const s of segmenter.segment(nfkc(text))) segs.push({ t: s.segment, i: s.index, word: s.isWordLike !== false });
    const out = [];
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (!s.word) { out.push(null); continue; }
      const prev = out.length ? out[out.length - 1] : null;
      if (prev && KATA_ONLY.test(prev.t) && KATA_ONLY.test(s.t) && prev.end === s.i) { prev.t += s.t; prev.end = s.i + s.t.length; continue; }
      out.push({ t: s.t, end: s.i + s.t.length });
    }
    return out.filter(Boolean).map((x) => x.t.toLowerCase());
  }
  function keepWord(w) {
    if (w.length < 2) return false;
    if (!KANJI_KATA.test(w)) return false; // ひらがなだけ・記号・数字だけは除く
    if (/^[\d.,%\-]+$/.test(w)) return false;
    if (/^[぀-ゟ]/.test(w) && w.length <= 2) return false;
    return STOPWORDS.indexOf(w) === -1;
  }
  /* 回答ごとに数える（同じ回答に何度出ても1回）。segmenter がなければ空 */
  function wordFreq(texts, segmenter, limit) {
    if (!segmenter) return [];
    const count = {}, first = {};
    let k = 0;
    texts.forEach(function (t) {
      if (isBlank(t)) return;
      uniq(segmentWords(t, segmenter).filter(keepWord)).forEach(function (w) {
        if (count[w] == null) { count[w] = 0; first[w] = k++; }
        count[w]++;
      });
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a] || first[a] - first[b]).slice(0, limit || 30).map((w) => ({ word: w, count: count[w] }));
  }
  function textMatch(text, needle) {
    if (!needle) return true;
    return nfkc(text).toLowerCase().indexOf(nfkc(needle).toLowerCase().trim()) !== -1;
  }
  /* opts: { query, word, attr: 添える質問 } */
  function textAnswers(q, records, opts) {
    opts = opts || {};
    const out = [];
    records.forEach(function (r) {
      const t = str(r.cells[q.index]).trim();
      if (isBlank(t)) return;
      if (!textMatch(t, opts.query) || !textMatch(t, opts.word)) return;
      out.push({ line: r.line, text: t, attr: opts.attr ? clean(r.cells[opts.attr.index]) : '' });
    });
    return out;
  }

  /* ---------- CSV ---------- */
  function fmtPct(v) { return v == null || !isFinite(v) ? '' : (Math.round(v * 10) / 10).toFixed(1); }
  function fmtNum(v, d) {
    if (v == null || !isFinite(v)) return '';
    if (d != null) return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    return String(Math.round(v * 100) / 100);
  }
  function baseNote(q, s) {
    if (q.type === 'multi') return '割合は回答した' + s.answered + '人に対する割合（1人が複数選べるため合計は100%を超えます）';
    if (q.type === 'rating' && s.stats) return '割合は回答した' + s.answered + '人に対する割合。平均・上位2つは段階で答えた' + s.stats.scored + '人で計算';
    if (q.type === 'number') return '分布の割合は数値で答えた' + s.stats.count + '人に対する割合';
    return '割合は回答した' + s.answered + '人に対する割合';
  }
  function summaryCsv(questions, sums, filterNote) {
    const out = [['質問', '種類', '項目', '件数', '割合（%）', '値', '備考']];
    questions.forEach(function (q, k) {
      if (q.type === 'skip') return;
      const s = sums[k], tl = TYPES[q.type].label;
      const note = [q.type === 'text' ? '' : baseNote(q, s), filterNote ? '絞り込み: ' + filterNote : ''].filter(Boolean).join('／');
      out.push([q.header, tl, q.type === 'text' ? '回答数' : '回答者数（割合の母数）', s.answered, '', '', note]);
      out.push([q.header, tl, '無回答', s.blank, '', '', '']);
      if (q.type === 'text') return;
      s.items.forEach((it) => out.push([q.header, tl, it.label, it.count, fmtPct(it.pct), '', it.offScale ? '段階外（平均に含めない）' : '']));
      if (q.type === 'rating' && s.stats) {
        const st = s.stats;
        out.push([q.header, tl, '平均点', '', '', fmtNum(st.mean, 2), st.minScore + '〜' + st.maxScore + '点で計算（' + q.scale.levels[0] + '＝' + st.maxScore + '点）']);
        out.push([q.header, tl, '中央値', '', '', st.median == null ? '' : fmtNum(st.median), st.medianLabel || '']);
        if (st.top2 != null) {
          out.push([q.header, tl, '上位2つの割合（' + st.top2Labels.join('＋') + '）', st.top2Count, '', fmtPct(st.top2), '']);
          out.push([q.header, tl, '下位2つの割合（' + st.bottom2Labels.join('＋') + '）', st.bottom2Count, '', fmtPct(st.bottom2), '']);
        }
      }
      if (q.type === 'number') {
        const st = s.stats;
        [['平均', st.mean], ['中央値', st.median], ['最小', st.min], ['最大', st.max], ['合計', st.sum]].forEach((p) => out.push([q.header, tl, p[0], '', '', fmtNum(p[1]), '']));
        if (st.invalid) out.push([q.header, tl, '数値でない回答', st.invalid, '', '', '集計から除いています']);
      }
    });
    return out;
  }
  function crossCsv(ct, mode) {
    const fmt = (v) => (mode === 'count' ? (v == null ? '' : v) : fmtPct(v));
    const head = [ct.rowQ + ' ＼ ' + ct.colQ + '（' + MODE_LABEL[mode] + '）'].concat(ct.cols, ['合計（人）']);
    if (ct.rowMean) head.push('平均点');
    const out = [head];
    ct.rows.forEach(function (r, i) {
      const line = [r].concat(ct.cols.map((_, j) => fmt(cellValue(ct, i, j, mode))), [ct.rowBase[i]]);
      if (ct.rowMean) line.push(fmtNum(ct.rowMean[i], 2));
      out.push(line);
    });
    const tot = ['合計'].concat(ct.cols.map((_, j) => fmt(totalRowValue(ct, j, mode))), [ct.grand]);
    if (ct.rowMean) tot.push(fmtNum(ct.totalMean, 2));
    out.push(tot);
    return out;
  }
  function textCsv(list, attrHeader) {
    const out = [attrHeader ? ['行番号', attrHeader, '回答'] : ['行番号', '回答']];
    list.forEach((x) => out.push(attrHeader ? [x.line, x.attr, x.text] : [x.line, x.text]));
    return out;
  }

  /* 見出しの並びから、種類の上書きを保存するキーを作る（回答の中身は使わない） */
  function signature(header) {
    const s = JSON.stringify(header.map(clean));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + '-' + header.length;
  }
  function uniq(arr) { const seen = {}; return arr.filter((v) => (seen[v] ? false : (seen[v] = true))); }

  return {
    TYPES, DELIMS, DELIM_ORDER, ORDERS, SCALES, STOPWORDS, MODE_LABEL,
    clean, canon, isBlank, parseNumber, matchScale, numericScale, splitMulti, detectDelimiter, detectType,
    buildQuestions, answersOf, levelOf, summarize, applyFilter, crosstab, cellValue, totalRowValue, totalColValue,
    wordFreq, segmentWords, textAnswers, summaryCsv, crossCsv, textCsv, signature, fmtPct, fmtNum, baseNote,
  };
});
