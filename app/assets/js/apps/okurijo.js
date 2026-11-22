/* 送り状CSV変換: 注文CSV → ヤマト運輸 B2クラウド 基本レイアウト（97項目）。DOM 非依存 */
(function (root, factory) {
  const kana = typeof require !== 'undefined' ? require('../core/kana.js') : root.MacroApps.kana;
  const api = factory(kana);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.okurijo = api; }
})(typeof self !== 'undefined' ? self : this, function (kana) {
  /* 1〜42 は公式レイアウトの項目名。43〜97 は本実装では常に空欄（項目名は内容から付けた仮のもの） */
  const DEFS = [
    ['お客様管理番号', '半角英数字', 50, false],
    ['送り状種類', '半角英数字', 1, true],
    ['クール区分', '半角数字＆空白', 1, false],
    ['伝票番号', '半角数字', 12, false],
    ['出荷予定日', '半角数字', 10, true],
    ['お届け予定日', '半角数字', 10, false],
    ['配達時間帯', '半角数字＆空白', 4, false],
    ['お届け先コード', '半角英数字', 20, false],
    ['お届け先電話番号', '半角数字＆ハイフン', 15, true],
    ['お届け先電話番号枝番', '半角数字', 2, false],
    ['お届け先郵便番号', '半角数字＆ハイフン', 8, true],
    ['お届け先住所', '全角/半角', 64, true],
    ['お届け先アパートマンション名', '全角/半角', 32, false],
    ['お届け先会社・部門１', '全角/半角', 50, false],
    ['お届け先会社・部門２', '全角/半角', 50, false],
    ['お届け先名', '全角/半角', 32, true],
    ['お届け先名(ｶﾅ)', '半角カタカナ', 50, false],
    ['敬称', '全角/半角', 4, false],
    ['ご依頼主コード', '半角英数字', 20, false],
    ['ご依頼主電話番号', '半角数字＆ハイフン', 15, true],
    ['ご依頼主電話番号枝番', '半角数字', 2, false],
    ['ご依頼主郵便番号', '半角数字＆ハイフン', 8, true],
    ['ご依頼主住所', '全角/半角', 64, true],
    ['ご依頼主アパートマンション', '全角/半角', 32, false],
    ['ご依頼主名', '全角/半角', 32, true],
    ['ご依頼主名(ｶﾅ)', '半角カタカナ', 50, false],
    ['品名コード１', '半角英数字', 30, false],
    ['品名１', '全角/半角', 50, true],
    ['品名コード２', '半角英数字', 30, false],
    ['品名２', '全角/半角', 50, false],
    ['荷扱い１', '全角/半角', 20, false],
    ['荷扱い２', '全角/半角', 20, false],
    ['記事', '全角/半角', 44, false],
    ['ｺﾚｸﾄ代金引換額（税込)', '半角数字', 7, false],
    ['内消費税額等', '半角数字', 7, false],
    ['止置き', '半角数字', 1, false],
    ['営業所コード', '半角数字', 6, false],
    ['発行枚数', '半角数字', 2, false],
    ['個数口表示フラグ', '半角数字', 1, false],
    ['請求先顧客コード', '半角数字', 12, true],
    ['請求先分類コード', '半角数字', 3, false],
    ['運賃管理番号', '半角数字', 2, true],
  ];
  const UNUSED = [
    'クロネコwebコレクトデータ登録', 'クロネコwebコレクト加盟店番号',
    'クロネコwebコレクト申込受付番号１', 'クロネコwebコレクト申込受付番号２', 'クロネコwebコレクト申込受付番号３',
    'お届け予定ｅメール利用区分', 'お届け予定ｅメールe-mailアドレス', '入力機種', 'お届け予定ｅメールメッセージ',
    'お届け完了ｅメール利用区分', 'お届け完了ｅメールe-mailアドレス', 'お届け完了ｅメールメッセージ',
    'クロネコ収納代行利用区分', 'クロネコ収納代行予備', '収納代行請求金額(税込)', '収納代行内消費税額等',
    '収納代行請求先郵便番号', '収納代行請求先住所', '収納代行請求先住所（アパートマンション名）',
    '収納代行請求先会社・部門名１', '収納代行請求先会社・部門名２', '収納代行請求先名(漢字)', '収納代行請求先名(カナ)',
    '収納代行問合せ先名(漢字)', '収納代行問合せ先郵便番号', '収納代行問合せ先住所',
    '収納代行問合せ先住所（アパートマンション名）', '収納代行問合せ先電話番号', '収納代行管理番号',
    '収納代行品名', '収納代行備考',
    '複数口くくりキー',
    '検索キータイトル1', '検索キー1', '検索キータイトル2', '検索キー2', '検索キータイトル3', '検索キー3',
    '検索キータイトル4', '検索キー4', '検索キータイトル5', '検索キー5',
    '予備１', '予備２',
    '投函予定メール利用区分', '投函予定メールe-mailアドレス', '投函予定メールメッセージ',
    '投函完了メール（お届け先宛）利用区分', '投函完了メール（お届け先宛）e-mailアドレス', '投函完了メール（お届け先宛）メッセージ',
    '投函完了メール（ご依頼主宛）利用区分', '投函完了メール（ご依頼主宛）e-mailアドレス', '投函完了メール（ご依頼主宛）メッセージ',
    '連携管理番号', '通知メールアドレス',
  ];
  const COLUMNS = DEFS.map((d, i) => ({ no: i + 1, name: d[0], kind: d[1], maxBytes: d[2], required: d[3] }))
    .concat(UNUSED.map((n, i) => ({ no: 43 + i, name: n, kind: '', maxBytes: null, required: false })));

  const INVOICE_TYPES = [
    { code: '0', label: '発払い' },
    { code: '2', label: 'コレクト（代金引換）', collect: true, codLimit: 300000 },
    { code: '3', label: 'クロネコゆうメール', noBilling: true },
    { code: '4', label: 'タイム' },
    { code: '5', label: '着払い', noBilling: true },
    { code: '6', label: '発払い（複数口）' },
    { code: '7', label: 'クロネコゆうパケット' },
    { code: '8', label: '宅急便コンパクト' },
    { code: '9', label: '宅急便コンパクトコレクト', collect: true, codLimit: 30000 },
    { code: 'A', label: 'ネコポス' },
  ];
  const COOL_TYPES = [
    { code: '', label: '通常' },
    { code: '1', label: 'クール冷凍' },
    { code: '2', label: 'クール冷蔵' },
  ];
  const TIME_BANDS = ['0812', '1416', '1618', '1820', '1921'];

  const sjisLen = kana.sjisLength;
  function str(v) { return v == null ? '' : String(v).trim(); }
  /* 全角英数記号・全角空白を半角に（カナはそのまま） */
  function toHalfAscii(v) {
    return str(v).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ').replace(/[－―‐−ー〜]/g, (c) => (c === '〜' ? '~' : '-'));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function yen(n) { return Number(n).toLocaleString('ja-JP'); }

  function normalizeZip(v) {
    const s = toHalfAscii(v).replace(/[〒\s-]/g, '');
    return /^\d{7}$/.test(s) ? s : null;
  }
  /* 数字とハイフンだけにする。括弧はハイフンに。数字10〜11桁・先頭0でなければ null */
  function normalizeTel(v) {
    let s = toHalfAscii(v).replace(/^\(/, '').replace(/[()]/g, '-').replace(/[^0-9-]/g, '');
    s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
    const digits = s.replace(/-/g, '');
    if (digits.length < 10 || digits.length > 11 || digits[0] !== '0' || s.length > 15) return null;
    return s;
  }
  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  /* 日付の表記ゆれを YYYY/MM/DD に。空は ''、解釈できなければ null。
     年のない「11/20」は基準日（出荷予定日）の年とし、基準日より前なら翌年とみなす */
  function normalizeDate(v, baseDate) {
    let s = toHalfAscii(v).replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '').replace(/\s/g, '');
    if (s === '') return '';
    let y, m, d, m1;
    if ((m1 = s.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$/))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
    else if ((m1 = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
    else if ((m1 = s.match(/^(\d{1,2})[/.\-月](\d{1,2})日?$/))) {
      m = +m1[1]; d = +m1[2];
      const base = baseDate && /^\d{4}\/\d{2}\/\d{2}$/.test(baseDate) ? baseDate : null;
      y = base ? +base.slice(0, 4) : new Date().getFullYear();
      if (base && (!validDate(y, m, d) || y + '/' + pad2(m) + '/' + pad2(d) < base)) y += 1; // 2/29 は翌年がうるう年なら翌年
    } else return null;
    if (!validDate(y, m, d)) return null;
    return y + '/' + pad2(m) + '/' + pad2(d);
  }
  /* 配達時間帯の表記ゆれをB2の区分に。空・指定なしは ''、解釈できなければ null */
  function normalizeTimeBand(v) {
    const s = toHalfAscii(v).replace(/\s/g, '');
    if (s === '' || /^(指定なし|指定無し|なし|無し|-)$/.test(s)) return '';
    if (/午前/.test(s)) return '0812';
    if (/^\d{4}$/.test(s)) return TIME_BANDS.includes(s) ? s : null;
    let nums = s.match(/\d+/g) || [];
    if (nums.length === 4 && /^0+$/.test(nums[1]) && /^0+$/.test(nums[3])) nums = [nums[0], nums[2]]; // 8:00-12:00
    if (nums.length !== 2) return null;
    const code = pad2(+nums[0]) + pad2(+nums[1]);
    return TIME_BANDS.includes(code) ? code : null;
  }

  /* 住所の桁あふれ: 住所64バイト → 建物名32バイト → 会社・部門１ 50バイトへ順に回す */
  function fitAddress(address, building) {
    const notes = [];
    let addr = address, bld = building, extra = '';
    if (sjisLen(addr) > 64) {
      const head = kana.truncateSjis(addr, 64);
      const rest = addr.slice(head.length);
      addr = head;
      bld = bld ? rest + ' ' + bld : rest;
      notes.push('建物名');
    }
    if (sjisLen(bld) > 32) {
      const head = kana.truncateSjis(bld, 32);
      extra = bld.slice(head.length);
      bld = head;
      notes.push('会社・部門１');
    }
    return { addr, bld, extra, notes, ok: sjisLen(extra) <= 50 };
  }

  function lineLabel(lines) { return lines.join('・') + '行目'; }

  function toB2(orders, mapping, sender, options) {
    const opt = Object.assign({ invoiceType: '0', cool: '', shipDate: '', honorific: '様', mergeSameOrder: true, taxRate: 10, defaultItem: '' }, options || {});
    const map = mapping || {};
    const snd = sender || {};
    const header = COLUMNS.map((c) => c.name);
    const errors = [], warnings = [], rows = [];
    const type = INVOICE_TYPES.find((t) => t.code === str(opt.invoiceType));

    /* 全体の設定チェック（ここで誤りがあれば1件も出力しない） */
    if (!type) errors.push('送り状種類「' + str(opt.invoiceType) + '」はB2クラウドの区分にありません。一覧から選び直してください。');
    const cool = str(opt.cool) === '0' ? '' : str(opt.cool);
    if (!['', '1', '2'].includes(cool)) errors.push('クール区分「' + cool + '」が不正です。通常・冷凍・冷蔵から選んでください。');
    if (type && cool && ['3', '7', 'A'].includes(type.code)) errors.push(type.label + 'ではクール便を使えません。クール区分を「通常」にしてください。');
    else if (type && cool && ['8', '9'].includes(type.code)) warnings.push(type.label + 'でクール区分を指定しています。B2クラウドで受け付けられるか確認してください。');
    const shipDate = /^\d{4}\/\d{2}\/\d{2}$/.test(str(opt.shipDate)) ? normalizeDate(opt.shipDate) : null;
    if (!shipDate) errors.push('出荷予定日「' + str(opt.shipDate) + '」が日付として読めません。YYYY/MM/DD の形で入力してください。');
    const honorific = str(opt.honorific);
    if (sjisLen(honorific) > 4) errors.push('敬称「' + honorific + '」が長すぎます。全角2文字までにしてください。');
    const taxRate = Number(opt.taxRate);
    if (type && type.collect && !(taxRate >= 0)) errors.push('税率が数値ではありません。');

    const sName = str(snd.name), sAddr = str(snd.address), sBld = str(snd.building);
    if (!sName) errors.push('ご依頼主名が入っていません。発送元の名前を入力してください。');
    else if (sjisLen(sName) > 32) errors.push('ご依頼主名が長すぎます（全角16文字まで）。');
    const sTel = normalizeTel(snd.tel);
    if (!str(snd.tel)) errors.push('ご依頼主電話番号が入っていません。');
    else if (!sTel) errors.push('ご依頼主電話番号「' + str(snd.tel) + '」は電話番号として読めません。0から始まる10〜11桁で入力してください。');
    const sZip = normalizeZip(snd.zip);
    if (!str(snd.zip)) errors.push('ご依頼主郵便番号が入っていません。');
    else if (!sZip) errors.push('ご依頼主郵便番号「' + str(snd.zip) + '」が7桁の数字ではありません。');
    if (!sAddr) errors.push('ご依頼主住所が入っていません。');
    else if (sjisLen(sAddr) > 64) errors.push('ご依頼主住所が長すぎます（全角32文字まで）。超える部分は「建物名」欄に入れてください。');
    if (sjisLen(sBld) > 32) errors.push('ご依頼主の建物名が長すぎます（全角16文字まで）。');

    let billingCode = '', billingSub = '', fareNo = '';
    if (type && !type.noBilling) {
      billingCode = toHalfAscii(snd.billingCode).replace(/[\s-]/g, '');
      billingSub = toHalfAscii(snd.billingSubCode).replace(/\s/g, '');
      fareNo = toHalfAscii(snd.fareNo).replace(/\s/g, '') || '01';
      if (!billingCode) errors.push('請求先顧客コードが入っていません。B2クラウドに登録している請求先顧客コード（数字）を入力してください。');
      else if (!/^\d{1,12}$/.test(billingCode)) errors.push('請求先顧客コード「' + billingCode + '」は12桁までの数字で入力してください。');
      if (billingSub && !/^\d{1,3}$/.test(billingSub)) errors.push('請求先分類コード「' + billingSub + '」は3桁までの数字で入力してください。');
      if (!/^\d{1,2}$/.test(fareNo)) errors.push('運賃管理番号「' + fareNo + '」は2桁までの数字で入力してください。');
      else fareNo = pad2(fareNo);
    }
    if (errors.length) return { header, rows, errors, warnings };

    /* 注文を（必要なら注文番号で）まとめる */
    const get = (o, key) => (map[key] ? str(o[map[key]]) : '');
    const groups = [], byNo = {};
    (orders || []).forEach((o, i) => {
      const no = get(o, 'orderNo');
      const line = i + 2;
      if (opt.mergeSameOrder && no && byNo[no]) { byNo[no].items.push({ o, line }); return; }
      const g = { no, items: [{ o, line }] };
      groups.push(g);
      if (no) byNo[no] = g;
    });

    groups.forEach((g) => {
      const lines = g.items.map((it) => it.line);
      const prefix = (g.no ? '注文番号 ' + g.no : '注文番号なし') + '（' + lineLabel(lines) + '）: ';
      const errs = [], warns = [];
      /* まとめた行で値をそろえる: 最初の空でない値。違う値が混ざれば知らせる */
      const pick = (key) => {
        const vals = g.items.map((it) => get(it.o, key)).filter((v) => v !== '');
        return { value: vals[0] || '', mixed: new Set(vals).size > 1, vals: Array.from(new Set(vals)) };
      };
      const LABEL = { name: 'お届け先名', zip: '郵便番号', address1: '住所', address2: '建物名', tel: '電話番号', company: '会社名' };
      Object.keys(LABEL).forEach((k) => {
        if (pick(k).mixed) errs.push(prefix + '同じ注文番号の行で' + LABEL[k] + 'が違います（' + pick(k).vals.join('／') + '）。届け先が別なら注文番号を分けるか、「同じ注文番号をまとめる」を外してください。');
      });

      const row = new Array(97).fill('');
      row[1] = type.code;
      row[2] = cool;
      row[4] = shipDate;

      /* お客様管理番号 */
      const no = toHalfAscii(g.no);
      if (no && (!/^[\x20-\x7E]*$/.test(no) || no.length > 50)) warns.push(prefix + '注文番号が半角英数字50文字に収まらないため、お客様管理番号は空にしました。');
      else row[0] = no;

      /* お届け予定日・配達時間帯 */
      const dd = pick('deliveryDate');
      if (dd.value) {
        const d = normalizeDate(dd.value, shipDate);
        if (d === null) errs.push(prefix + 'お届け予定日「' + dd.value + '」が日付として読めません。2026/11/20 のように入力してください。');
        else if (d < shipDate) errs.push(prefix + 'お届け予定日 ' + d + ' が出荷予定日 ' + shipDate + ' より前です。日付を確認してください。');
        else row[5] = d;
      }
      const tb = pick('timeBand');
      if (tb.value) {
        const t = normalizeTimeBand(tb.value);
        if (t === null) warns.push(prefix + '配達時間帯「' + tb.value + '」を区分（午前中・14-16・16-18・18-20・19-21）に読み替えられないため、指定なしにしました。');
        else row[6] = t;
      }

      /* 電話番号・郵便番号 */
      const telRaw = pick('tel').value;
      const tel = normalizeTel(telRaw);
      if (!telRaw) errs.push(prefix + 'お届け先電話番号が入っていません。');
      else if (!tel) errs.push(prefix + 'お届け先電話番号「' + telRaw + '」は電話番号として読めません。0から始まる10〜11桁の数字で入力してください（Excelで先頭の0が消えていないかも確認してください）。');
      else row[8] = tel;
      const zipRaw = pick('zip').value;
      const zip = normalizeZip(zipRaw);
      if (!zipRaw) errs.push(prefix + 'お届け先郵便番号が入っていません。');
      else if (!zip) errs.push(prefix + 'お届け先郵便番号「' + zipRaw + '」が7桁の数字ではありません。123-4567 の形で入力してください（6桁ならExcelで先頭の0が消えています）。');
      else row[10] = zip;

      /* 住所・建物名・会社名 */
      const a1 = pick('address1').value, a2 = pick('address2').value, company = pick('company').value;
      if (!a1) errs.push(prefix + 'お届け先住所が入っていません。');
      else {
        const f = fitAddress(a1, a2);
        if (!f.ok) errs.push(prefix + 'お届け先住所と建物名が長すぎて送り状に収まりません（住所 全角32文字＋建物名 全角16文字＋会社・部門 全角25文字まで）。住所を短くしてください。');
        else {
          row[11] = f.addr; row[12] = f.bld;
          if (f.extra) { row[13] = f.extra; row[14] = company; }
          else row[13] = company;
          if (f.notes.length) warns.push(prefix + 'お届け先住所が全角32文字を超えたため、続きを' + f.notes.join('・') + 'の欄に回しました。送り状の表示を確認してください。');
        }
      }
      if (sjisLen(company) > 50) errs.push(prefix + '会社名「' + company + '」が長すぎます（全角25文字まで）。');

      /* お届け先名 */
      const name = pick('name').value;
      if (!name) errs.push(prefix + 'お届け先名が入っていません。');
      else if (sjisLen(name) > 32) errs.push(prefix + 'お届け先名「' + name + '」が長すぎます（全角16文字まで）。会社名は会社名の列に分けてください。');
      else row[15] = name;
      row[17] = honorific;

      /* ご依頼主 */
      row[19] = sTel; row[21] = sZip; row[22] = sAddr; row[23] = sBld; row[24] = sName;

      /* 品名 */
      const items = g.items.map((it) => get(it.o, 'item')).filter((v) => v !== '');
      if (!items.length && str(opt.defaultItem)) items.push(str(opt.defaultItem));
      if (!items.length) errs.push(prefix + '品名が入っていません。商品名の列を確認するか、「品名が空のときに使う品名」を入力してください。');
      [27, 29].forEach((idx, k) => {
        const it = items[k];
        if (!it) return;
        if (sjisLen(it) > 50) {
          row[idx] = kana.truncateSjis(it, 50);
          warns.push(prefix + '品名' + (k ? '２' : '１') + '「' + it + '」が全角25文字を超えたため、「' + row[idx] + '」に切り詰めました。');
        } else row[idx] = it;
      });
      if (items.length > 2) warns.push(prefix + '商品が3つ以上あります。送り状には2つまでしか載らないため、' + items.slice(2).map((s) => '「' + s + '」').join('') + 'は省きました。');

      /* コレクト（代金引換） */
      const cod = pick('codAmount');
      if (type.collect) {
        if (cod.mixed) errs.push(prefix + '同じ注文番号の行で代引金額が違います（' + cod.vals.join('／') + '）。注文全体の請求額を1つにそろえてください。');
        else if (!cod.value) errs.push(prefix + 'コレクト（代引き）なのに代引金額が入っていません。');
        else {
          const amt = kana.normalizeAmount(cod.value);
          if (!Number.isInteger(amt) || amt <= 0) errs.push(prefix + '代引金額「' + cod.value + '」が1円以上の整数ではありません。');
          else if (amt > type.codLimit) errs.push(prefix + '代引金額 ' + yen(amt) + '円が' + type.label + 'の上限 ' + yen(type.codLimit) + '円を超えています。');
          else { row[33] = String(amt); row[34] = String(Math.floor(amt * taxRate / (100 + taxRate))); }
        }
      } else if (cod.value) {
        warns.push(prefix + '代引金額「' + cod.value + '」が入っていますが、送り状種類が「' + type.label + '」のため出力しません。代引きの注文はコレクトで別に変換してください。');
      }

      /* 請求先 */
      row[39] = billingCode; row[40] = billingSub; row[41] = fareNo;

      if (errs.length) { errors.push.apply(errors, errs); return; }
      warnings.push.apply(warnings, warns);
      rows.push(row);
    });
    return { header, rows, errors, warnings };
  }

  return { toB2, COLUMNS, INVOICE_TYPES, COOL_TYPES, TIME_BANDS, normalizeDate, normalizeTimeBand, normalizeZip, normalizeTel };
});
