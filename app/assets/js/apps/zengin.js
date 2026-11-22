/* 全銀データ作成（全銀協規定フォーマット・振込、120バイト固定長）。DOM非依存 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.zengin = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  const TYPES = { '21': '総合振込', '11': '給与振込', '12': '賞与振込' };
  /* 使用可能文字: 数字・英大文字・半角カナ（ｦ〜ﾟ）・スペース・( ) - . / , ｢ ｣ ¥(\) */
  const ALLOWED = /[0-9A-Zｦ-ﾟ ()\-./,｢｣\\]/;
  const ALLOWED_TEXT = '半角カナ・英大文字・数字・スペースと記号 ( ) - . / , ｢ ｣ ¥';

  function str(v) { return v == null ? '' : String(v); }
  /* 数字項目の前処理: 全角→半角、前後の空白を除く */
  function digits(v) { return kana.toHankaku(str(v)).trim(); }
  function padNum(s, n) { return String(s).padStart(n, '0'); }
  function padText(s, n) { return String(s).padEnd(n, ' ').slice(0, n); }
  /* 文字項目の前処理: 半角化し、¥ を \ に寄せ、前後の空白を除く */
  function toText(v) { return kana.toHankaku(str(v)).replace(/¥/g, '\\').trim(); }
  function badChars(s) {
    const bad = [];
    for (const ch of s) if (!ALLOWED.test(ch) && bad.indexOf(ch) === -1) bad.push(ch);
    return bad;
  }

  /* 預金種目の表記ゆれを 1普通・2当座・4貯蓄・9その他 に寄せる。不明は空文字（toHankaku でかなは半角カナになる） */
  function normalizeAccountType(v) {
    const s = kana.toHankaku(str(v)).replace(/\s/g, '');
    if (s === '') return '';
    if (/^(1|普通|普通預金|普|ﾌﾂｳ|ﾌﾂｳﾖｷﾝ|総合|総合口座)$/.test(s)) return '1';
    if (/^(2|当座|当座預金|当|ﾄｳｻﾞ|ﾄｳｻﾞﾖｷﾝ)$/.test(s)) return '2';
    if (/^(4|貯蓄|貯蓄預金|貯|ﾁﾖﾁｸ|ﾁﾖﾁｸﾖｷﾝ)$/.test(s)) return '4';
    if (/^(9|ｿﾉ他|他|ｿﾉﾀ)$/.test(s)) return '9';
    return '';
  }
  function normalizeType(v) {
    const s = kana.toHankaku(str(v)).replace(/\s/g, '');
    if (TYPES[s]) return s;
    if (/^総合/.test(s)) return '21';
    if (/^給与/.test(s)) return '11';
    if (/^賞与/.test(s)) return '12';
    return '';
  }
  function validMMDD(s) {
    if (!/^\d{4}$/.test(s)) return false;
    const m = Number(s.slice(0, 2)), d = Number(s.slice(2));
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1];
  }
  function isBlankRow(r) {
    return Object.keys(r || {}).every(function (k) { return str(r[k]).trim() === ''; });
  }
  function parseAmount(v) {
    const n = kana.normalizeAmount(v);
    return Number.isInteger(n) ? n : NaN;
  }

  /* 項目ごとの組み立てと検証を行う小さな部品 */
  function fieldTools(where, errors, warnings) {
    return {
      code: function (label, v, n, hint) {
        const s = digits(v);
        if (!new RegExp('^\\d{' + n + '}$').test(s)) {
          errors.push(where + 'の' + label + '「' + str(v) + '」が正しくありません。半角数字' + n + '桁で入力してください。' + (hint || ''));
          return '0'.repeat(n);
        }
        return s;
      },
      upTo: function (label, v, n, required) {
        const s = digits(v);
        if (s === '' && !required) return null;
        if (!new RegExp('^\\d{1,' + n + '}$').test(s)) {
          errors.push(where + 'の' + label + '「' + str(v) + '」が正しくありません。半角数字' + n + '桁以内で入力してください。');
          return '0'.repeat(n);
        }
        return padNum(s, n);
      },
      text: function (label, v, n, opt) {
        const s = toText(v);
        if (opt.required && s === '') {
          errors.push(where + 'の' + label + 'が空です。カナで入力してください。');
          return ' '.repeat(n);
        }
        const bad = badChars(s);
        if (bad.length) {
          errors.push(where + 'の' + label + '「' + str(v) + '」に使えない文字「' + bad.join('」「') + '」があります。' + ALLOWED_TEXT + ' で入力してください（全角カナ・ひらがなは自動で半角にしますが、漢字や「・」「＆」などの記号は使えません）。');
          return ' '.repeat(n);
        }
        if (s.length > n && opt.warn) warnings.push(where + 'の' + label + 'が' + s.length + '桁あるため、' + n + '桁に切り詰めました（' + s.slice(0, n) + '）。銀行で受け付けられる略し方か確認してください。');
        return padText(s, n);
      },
    };
  }

  function buildHeader(h, errors, warnings) {
    const where = '依頼人情報';
    const f = fieldTools(where, errors, warnings);
    const type = normalizeType(h.type);
    if (!type) errors.push(where + 'の種別「' + str(h.type) + '」が正しくありません。総合振込（21）・給与振込（11）・賞与振込（12）から選んでください。');
    const code = f.upTo('委託者コード', h.code, 10, true);
    const name = f.text('委託者名', h.name, 40, { required: true, warn: true });
    const date = digits(h.date);
    if (!validMMDD(date)) errors.push(where + 'の振込指定日（取組日）「' + str(h.date) + '」が正しくありません。月日を4桁（例: 0425）で、実在する日付にしてください。');
    const bank = f.code('仕向銀行番号', h.bankCode, 4);
    const bankName = f.text('仕向銀行名', h.bankName, 15, {});
    const branch = f.code('仕向支店番号', h.branchCode, 3);
    const branchName = f.text('仕向支店名', h.branchName, 15, {});
    const at = normalizeAccountType(h.accountType);
    if (at !== '1' && at !== '2') errors.push(where + 'の預金種目「' + str(h.accountType) + '」が正しくありません。依頼人の口座は「普通」か「当座」を選んでください。');
    const acct = f.upTo('口座番号', h.accountNumber, 7, true);
    return '1' + (type || '00') + '0' + code + name + (validMMDD(date) ? date : '0000') + bank + bankName + branch + branchName + (at || '0') + acct + ' '.repeat(17);
  }

  function buildData(r, line, errors, warnings) {
    const where = line + '行目';
    const f = fieldTools(where, errors, warnings);
    const bank = f.code('銀行番号', r.bankCode, 4, 'Excelで先頭の0が消えていないか確認してください。');
    const bankName = f.text('銀行名', r.bankName, 15, {});
    const branch = f.code('支店番号', r.branchCode, 3, 'Excelで先頭の0が消えていないか確認してください。');
    const branchName = f.text('支店名', r.branchName, 15, {});
    const at = normalizeAccountType(r.accountType);
    if (!at) errors.push(where + 'の預金種目「' + str(r.accountType) + '」が分かりません。「普通」「当座」「貯蓄」または 1・2・4・9 で入力してください。');
    const acct = f.upTo('口座番号', r.accountNumber, 7, true);
    const name = f.text('受取人名', r.name, 30, { required: true, warn: true });
    const amount = parseAmount(r.amount);
    let amt = '0'.repeat(10);
    if (!(amount >= 1 && amount <= 9999999999)) {
      errors.push(where + 'の金額「' + str(r.amount) + '」が正しくありません。1円以上・10桁以内の整数で入力してください。');
    } else amt = padNum(amount, 10);
    let newCode = digits(r.newCode) || '0';
    if (!/^[012]$/.test(newCode)) { errors.push(where + 'の新規コード「' + str(r.newCode) + '」が正しくありません。0・1・2のいずれかにしてください。'); newCode = '0'; }
    const c1 = f.upTo('顧客コード1', r.customerCode1, 10, false);
    const c2 = f.upTo('顧客コード2', r.customerCode2, 10, false);
    let tt = digits(r.transferType) || '7';
    if (!/^[78]$/.test(tt)) { errors.push(where + 'の振込指定区分「' + str(r.transferType) + '」が正しくありません。7（テレ振込）か8（文書振込）にしてください。'); tt = '7'; }
    return { record: '2' + bank + bankName + branch + branchName + '    ' + (at || '0') + acct + name + amt + newCode + (c1 || ' '.repeat(10)) + (c2 || ' '.repeat(10)) + tt + ' ' + ' '.repeat(7), amount: amount };
  }

  /* header: {type, code, name, date(MMDD), bankCode, bankName, branchCode, branchName, accountType, accountNumber}
     rows: [{bankCode, bankName, branchCode, branchName, accountType, accountNumber, name, amount, customerCode1?, customerCode2?, newCode?, transferType?}]
     options: {newline: 'CRLF'|'none', firstLine: 行番号の起点（既定1）} */
  function build(header, rows, options) {
    const opt = options || {};
    const firstLine = opt.firstLine == null ? 1 : opt.firstLine;
    const errors = [], warnings = [];
    const head = buildHeader(header || {}, errors, warnings);
    const data = [];
    let total = 0;
    (rows || []).forEach(function (r, i) {
      if (isBlankRow(r)) return;
      const d = buildData(r || {}, firstLine + i, errors, warnings);
      data.push(d.record);
      if (d.amount > 0) total += d.amount;
    });
    const count = data.length;
    if (!count) errors.push('振込データが1件もありません。振込一覧のファイルと列の対応を確認してください。');
    if (count > 999999) errors.push('件数が999,999件を超えています。ファイルを分けてください。');
    if (total > 999999999999) errors.push('合計金額が12桁を超えています。ファイルを分けてください。');
    if (errors.length) return { records: [], text: '', errors: errors, warnings: warnings, count: count, total: total };
    const records = [head].concat(data, ['8' + padNum(count, 6) + padNum(total, 12) + ' '.repeat(101), '9' + ' '.repeat(119)]);
    const nl = opt.newline === 'none' ? '' : '\r\n';
    return { records: records, text: records.map(function (x) { return x + nl; }).join(''), errors: errors, warnings: warnings, count: count, total: total };
  }

  function summarize(rows) {
    let count = 0, total = 0, invalid = 0;
    (rows || []).forEach(function (r) {
      if (isBlankRow(r)) return;
      count++;
      const n = parseAmount(r.amount);
      if (Number.isNaN(n)) invalid++; else total += n;
    });
    return { count: count, total: total, invalid: invalid };
  }

  return { build, summarize, normalizeAccountType, normalizeType, validMMDD, TYPES };
});
