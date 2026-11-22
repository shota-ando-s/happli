/* 機能カタログと、選択した機能の保存 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.MacroApps = root.MacroApps || {}; root.MacroApps.registry = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const catalog = [
    { id: 'keshikomi', category: '経理・請求', title: '入金消込', pattern: '突合・照合・チェック', icon: 'payments', area: '経理',
      summary: '銀行の入金明細と請求一覧を照らし合わせて、どの請求が入金済みかを自動で仕分けます。',
      input: '請求一覧CSV・入金明細CSV', output: '消込結果・未回収一覧', href: 'apps/keshikomi.html' },
    { id: 'zengin', category: '経理・請求', title: '全銀データ作成', pattern: 'システム間ブリッジ', icon: 'bank', area: '経理・給与',
      summary: '振込先の一覧から、銀行に送る振込データ（総合振込・給与・賞与）を作ります。',
      input: '振込一覧CSV', output: '銀行に送る振込データ', href: 'apps/zengin.html' },
    { id: 'csvhenkan', category: 'データの整理・集計', title: '汎用CSV変換', pattern: 'システム間ブリッジ', icon: 'transform', area: 'どの部署でも',
      summary: 'CSVの列を並べ替えたり、値を読み替えたりして、別のソフトに取り込める形に変えます。設定は保存して次回も使えます。',
      input: '任意のCSV', output: '形を変えたCSV', href: 'apps/csvhenkan.html' },
    { id: 'okurijo', category: '出荷・在庫', title: '送り状CSV変換', pattern: 'システム間ブリッジ', icon: 'shipping', area: '出荷',
      summary: '注文データを、ヤマト運輸「B2クラウド」にそのまま取り込める送り状データに変えます。',
      input: '注文CSV', output: 'B2クラウド取込用CSV', href: 'apps/okurijo.html' },
    { id: 'seikyusho', category: '経理・請求', title: '請求書の一括作成', pattern: '帳票作成・印刷', icon: 'receipt', area: '経理',
      summary: '請求明細のCSVから、取引先ごとの請求書（インボイス対応）をまとめて作り、印刷やPDFで保存できます。',
      input: '請求明細CSV', output: '請求書（印刷・PDF）・請求一覧CSV', href: 'apps/seikyusho.html' },
    { id: 'shogo', category: 'データの整理・集計', title: '2つのリストの照合', pattern: '突合・照合・チェック', icon: 'compare', area: 'どの部署でも',
      summary: '2つの一覧を商品コードや社員番号などで結びつけて、両方にあるか・内容が同じかを調べます。',
      input: '照合したい2つのCSV', output: '照合結果・片方だけの一覧', href: 'apps/shogo.html' },
    { id: 'shukei', category: 'データの整理・集計', title: '集計表づくり', pattern: '集計・分析', icon: 'summarize', area: 'どの部署でも',
      summary: '売上や経費の一覧を、担当者ごと・月ごとなどに分けて、合計や件数の表にします。',
      input: '売上明細・経費一覧などのCSV', output: '集計表CSV', href: 'apps/shukei.html' },
    { id: 'matome', category: 'データの整理・集計', title: 'CSVまとめ・分け', pattern: 'データ整形・集約', icon: 'merge', area: 'どの部署でも',
      summary: '支店や月ごとに分かれた複数のCSVを1つにまとめたり、1つのCSVを部署や取引先ごとのファイルに分けたりします。',
      input: '複数のCSV、または1つのCSV', output: 'まとめたCSV・分けたCSV（ZIP）', href: 'apps/matome.html' },
    { id: 'atena', category: '文書・郵送', title: '宛名ラベル・封筒の印刷', pattern: '帳票作成・印刷', icon: 'mail', area: 'どの部署でも',
      summary: '住所録のCSVから、A4のラベル用紙や長形3号の封筒（縦書き）に宛名をまとめて印刷します。',
      input: '住所録CSV', output: '宛名ラベル・封筒（印刷・PDF）', href: 'apps/atena.html' },
    { id: 'kintai', category: '人事・総務', title: '勤怠の集計', pattern: '集計・分析', icon: 'schedule', area: '総務・給与',
      summary: 'タイムカードの打刻データから、社員ごと・締め日ごとに、実労働・残業・深夜・休日労働の時間を集計します。',
      input: '打刻データCSV', output: '社員ごとの集計表・日ごとの明細CSV', href: 'apps/kintai.html' },
    { id: 'meiyose', category: 'データの整理・集計', title: '名簿の重複チェック', pattern: '突合・照合・チェック', icon: 'group', area: 'どの部署でも',
      summary: '顧客名簿や取引先マスタの中から、同じ相手が2回以上登録されていそうな行を探して、グループごとに示します。',
      input: '顧客名簿・取引先マスタのCSV', output: 'チェック結果・重複を除いた名簿', href: 'apps/meiyose.html' },
    { id: 'seikei', category: 'データの整理・集計', title: '表記ゆれの一括整形', pattern: 'データ整形・集約', icon: 'auto_fix', area: 'どの部署でも',
      summary: '日付・電話番号・郵便番号・社名などのばらばらな書き方を、列ごとにまとめてそろえます。',
      input: '整えたいCSV', output: '整えたCSV（列の並びはそのまま）', href: 'apps/seikei.html' },
    { id: 'chohyo', category: '経理・請求', title: '見積書・発注書・納品書・領収書の作成', pattern: '帳票作成・印刷', icon: 'request_quote', area: '営業・経理・購買',
      summary: '請求書と同じ明細のCSVから、取引先ごとの見積書・納品書・領収書や、仕入先への発注書（注文請書つきも可）をまとめて作り、印刷やPDFで保存できます。',
      input: '明細CSV（請求書の一括作成と同じ形。発注書は宛先の列が仕入先）', output: '見積書・発注書（注文請書）・納品書・領収書（印刷・PDF）・一覧CSV', href: 'apps/chohyo.html' },
    { id: 'kyuyo', category: '人事・総務', title: '給与明細の一括印刷', pattern: '帳票作成・印刷', icon: 'badge', area: '総務・給与',
      summary: '給与ソフトやExcelから出した給与データから、社員全員の給与明細書をまとめて作り、A4の紙に1〜3人ずつ印刷します。',
      input: '給与データCSV（1行に1人）', output: '給与明細書（印刷・PDF）・振込一覧CSV', href: 'apps/kyuyo.html' },
    { id: 'zaiko', category: '出荷・在庫', title: '在庫の受払集計', pattern: '集計・分析', icon: 'inventory', area: '在庫・経理',
      summary: '入庫・出庫・返品・棚卸の記録から、商品ごとの月末の在庫数と在庫金額を計算し、商品有高帳を作ります。',
      input: '受払の記録CSV（前月末の在庫CSVは任意）', output: '在庫集計表・期末在庫・商品有高帳のCSV', href: 'apps/zaiko.html' },
    { id: 'shiwake', category: '経理・請求', title: '仕訳データの作成', pattern: 'システム間ブリッジ', icon: 'book', area: '経理',
      summary: '銀行やカードの明細を、摘要のキーワードで勘定科目に振り分けて、会計ソフトに取り込める仕訳データにします。',
      input: '入出金明細・カード明細のCSV', output: '汎用の仕訳CSV・弥生会計インポート形式', href: 'apps/shiwake.html' },
    { id: 'sashikomi', category: '文書・郵送', title: '差し込み文書の一括作成', pattern: '帳票作成・印刷', icon: 'drafts', area: 'どの部署でも',
      summary: '送付先の一覧と1枚の文面から、相手ごとの案内状・送付状・お支払いのお願いなどをまとめて作り、印刷やPDFで保存できます。',
      input: '送付先の一覧CSV', output: '差し込み文書（印刷・PDF）・ひな形ファイル（JSON）', href: 'apps/sashikomi.html' },
    { id: 'kigen', category: '人事・総務', title: '期限の管理', pattern: '突合・照合・チェック', icon: 'event', area: '総務・どの部署でも',
      summary: '契約・免許・車検・保険・在留カード・健康診断などの期限の一覧から、もうすぐ期限が来るものを急ぐ順に並べ、カレンダーにも取り込めるようにします。',
      input: '期限の一覧CSV', output: '対応リストCSV・カレンダー用ファイル（.ics）', href: 'apps/kigen.html' },
    { id: 'barcode', category: '出荷・在庫', title: '商品ラベル・バーコード印刷', pattern: '帳票作成・印刷', icon: 'qr_code', area: '出荷・在庫・店舗',
      summary: '商品一覧のCSVから、JANコード・Code128・QRコードの入った商品ラベルを作り、A4のラベル用紙に枚数分まとめて印刷します。',
      input: '商品一覧CSV（商品コード・商品名・価格・JANコード・枚数など）', output: '商品ラベル（印刷・PDF）', href: 'apps/barcode.html' },
    { id: 'nenrei', category: '経理・請求', title: '売掛金の年齢表', pattern: '集計・分析', icon: 'hourglass', area: '経理',
      summary: '請求一覧から、まだ回収できていない金額を取引先ごとに、期限を過ぎてからの日数（期限前・1〜30日・31〜60日…）で分けて一覧にします。',
      input: '請求一覧CSV（＋入金消込の消込結果・未回収一覧）', output: '年齢表・未回収明細・督促の差し込み用CSV', href: 'apps/nenrei.html' },
    { id: 'yojitsu', category: '経理・請求', title: '予算と実績の比較', pattern: '集計・分析', icon: 'trending_up', area: '経理・経営',
      summary: '予算の表と実績のデータを科目ごと・月ごとに並べて、差額・達成率と期首からの累計を出し、予算から外れた科目を見つけます。',
      input: '予算CSV・実績CSV（月別の表・明細・仕訳データ）', output: '予実対比表CSV・差異の大きい科目CSV', href: 'apps/yojitsu.html' },
    { id: 'shift', category: '人事・総務', title: 'シフト表のチェック', pattern: '突合・照合・チェック', icon: 'calendar_view_week', area: '店舗・医療・介護',
      summary: '公開前のシフト表を、必要な人数・勤務と勤務の間・連続勤務・夜勤明け・希望休などの決まりに照らして確かめ、スタッフごとの勤務日数や夜勤回数も一覧にします。',
      input: 'シフト表CSV（表の形・一覧の形）・希望休CSV（任意）', output: 'チェック結果・スタッフ別集計・予定の打刻データ（勤怠の集計用）のCSV', href: 'apps/shift.html' },
    { id: 'keihi', category: '経理・請求', title: '経費精算の集計', pattern: '集計・分析', icon: 'receipt_long', area: '経理',
      summary: '社員の経費申請一覧から、重複・上限超過・領収書なし・期間外・1人あたりの飲食額を確かめ、申請者別・科目別に集計します。仕訳CSVと振込一覧も作れます。',
      input: '経費の申請一覧CSV（任意で社員の口座CSV）', output: '精算一覧・経費明細（チェック結果つき）・仕訳CSV・振込一覧のCSV', href: 'apps/keihi.html' },
    { id: 'teiki', category: '経理・請求', title: '定期請求の明細づくり', pattern: 'システム間ブリッジ', icon: 'autorenew', area: '経理',
      summary: '保守料・月額利用料・年間ライセンスなどの契約一覧から、今月請求する明細を作ります。周期・値上げ・日割り・前払い/後払いに対応し、12か月の売上見込みも出します。',
      input: '契約一覧CSV', output: '請求明細CSV（請求書の一括作成で読める形）・売上見込みCSV', href: 'apps/teiki.html' },
    { id: 'meibo', category: '人事・総務', title: '社員名簿の節目一覧', pattern: '集計・分析', icon: 'person', area: '総務・人事',
      summary: '社員名簿から年齢・勤続年数と、40歳（介護保険）・60歳・勤続10年・契約の終了などこれから来る節目、次の有給休暇の付与日と日数を一覧にします。',
      input: '社員名簿CSV（氏名と、生年月日か入社日）', output: '節目一覧・年齢と勤続つき名簿・期限の管理用のCSV', href: 'apps/meibo.html' },
    { id: 'shikin', category: '経理・請求', title: '資金繰り表', pattern: '集計・分析', icon: 'savings', area: '経理・財務',
      summary: '入金予定と支払予定から、口座の残高が日・週・月ごとにどう動くかを見通し、足りなくなりそうな日を知らせます。',
      input: '入金予定・支払予定のCSV（請求一覧・未回収明細・売上見込み・振込一覧もそのまま使える）と家賃などの定例', output: '資金繰り表・入出金予定の明細のCSV', href: 'apps/shikin.html' },
    { id: 'gensen', category: '経理・請求', title: '源泉徴収の対象チェック', pattern: '突合・照合・チェック', icon: 'percent', area: '経理',
      summary: '個人に払った原稿料・デザイン料・講演料・士業の報酬などの一覧から、源泉徴収が必要かどうかと税額・差引支払額の目安を出します。',
      input: '支払一覧CSV（支払先・内容・支払金額）', output: '源泉徴収チェック結果・支払先別の合計・振込用の差引支払額のCSV', href: 'apps/gensen.html' },
    { id: 'kosu', category: 'データの整理・集計', title: '案件別の工数集計', pattern: '集計・分析', icon: 'timer', area: '経理・管理',
      summary: '作業日報から、案件ごと・人ごと・月ごとの作業時間と人件費を集計し、予算をどれだけ使ったかを確かめます。',
      input: '作業日報CSV（＋単価表・案件マスタ）', output: '工数集計・案件別の人件費・チェック結果のCSV', href: 'apps/kosu.html' },
    { id: 'enquete', category: 'データの整理・集計', title: 'アンケート集計', pattern: '集計・分析', icon: 'ballot', area: '総務・人事・営業',
      summary: 'Google フォームや Microsoft Forms などのアンケート回答から、質問ごとの件数・割合、満足度の平均、クロス集計、自由記述の一覧を作り、印刷用の集計レポートも出します。',
      input: 'アンケートの回答CSV（1行に1人、1列に1問）', output: '集計結果・クロス集計・自由記述のCSV、集計レポート（印刷・PDF）', href: 'apps/enquete.html' },
    { id: 'jusho', category: 'データの整理・集計', title: '住所の分割', pattern: 'データ整形・集約', icon: 'place', area: '総務・営業事務',
      summary: '1つの欄に入った住所を、都道府県・市区町村・町域・番地・建物名に分けます。確かでない行には「推測あり」「要確認」の印と理由が付きます。',
      input: '住所の列があるCSV（顧客名簿など）', output: '分けた欄を足したCSV（確度・理由つき）', href: 'apps/jusho.html' },
    { id: 'hacchu', category: '出荷・在庫', title: '在庫の発注点チェック', pattern: '突合・照合・チェック', icon: 'shopping_cart', area: '購買・在庫',
      summary: '今の在庫と出庫の実績から、商品ごとに発注点と目標在庫を計算し、いま発注すべき商品と発注数を出します。発注する分は発注書を作れるCSVで保存できます。',
      input: '今の在庫CSV（期末在庫可）・出庫の実績CSV（受払記録可）・商品マスタCSV（任意）', output: '発注明細CSV（発注書の作成用）・発注提案CSV', href: 'apps/hacchu.html' },
    { id: 'shokyaku', category: '経理・請求', title: '固定資産の減価償却', pattern: '集計・分析', icon: 'domain', area: '経理',
      summary: '固定資産台帳から、資産ごとにその期の償却費と期末の帳簿価額を計算し、勘定科目ごとの合計、来期からの償却予定、会計ソフトに取り込める償却仕訳を作ります。',
      input: '固定資産台帳CSV（資産名・取得日・取得価額・耐用年数・償却方法など）', output: '償却明細・科目別合計・償却予定表・償却仕訳（仕訳データの作成と同じ形）のCSV', href: 'apps/shokyaku.html' },
    { id: 'abc', category: 'データの整理・集計', title: 'ABC分析', pattern: '集計・分析', icon: 'leaderboard', area: '営業・購買・在庫',
      summary: '売上明細や出庫の実績を、商品・取引先・担当者などごとに合計して多い順に並べ、売上の大部分を占めるA・次のB・残りのCに分けます。パレート図と、売上×粗利のようなクロスABCも出します。',
      input: '売上明細・出庫の実績・受払の記録・集計表のCSV', output: 'ABC分析結果・ランク別要約・ABCランク表（商品コードとランク）のCSV', href: 'apps/abc.html' },
    { id: 'koguchi', category: '経理・請求', title: '小口現金出納帳', pattern: '集計・分析', icon: 'wallet', area: '経理・総務',
      summary: '手元の現金の入出金の記録から、日付順の出納帳（日ごとの残高）を作り、残高のマイナス・記録との食い違い・領収書なし・重複を確かめます。月末に金種ごとの枚数を入れると帳簿との差と補充額も出します。',
      input: '現金の入出金の記録CSV（＋金種表CSV）', output: '出納帳・科目別集計・仕訳（汎用・弥生形式）のCSV、月ごとの出納帳（印刷・PDF）', href: 'apps/koguchi.html' },
    { id: 'yukyu', category: '人事・総務', title: '有給休暇の管理簿', pattern: '突合・照合・チェック', icon: 'beach_access', area: '総務・人事',
      summary: '社員名簿と有休の取得記録から、社員ごとの残日数、2年で使えなくなる日数、年5日の取得義務の進み具合を確かめ、年次有給休暇管理簿（基準日・日数・時季）を印刷します。',
      input: '社員名簿CSV（入社日・繰越日数など）・有休の取得記録CSV', output: '残日数一覧・年5日の取得義務チェック・期限の管理用のCSV、年次有給休暇管理簿（印刷・PDF）', href: 'apps/yukyu.html' },
    { id: 'shiire', category: '経理・請求', title: '仕入請求の照合', pattern: '突合・照合・チェック', icon: 'fact_check', area: '経理・購買',
      summary: '仕入先からの請求を、発注した内容と届いた数に照らし合わせて、数量・単価の違い、届いていない分の請求、二重請求の疑いを見つけます。請求書ごとの消費税と合計も確かめ、支払条件から支払日の一覧を作ります。',
      input: '発注明細CSV・請求明細CSV（＋納品の記録・仕入先マスタ）', output: '照合結果・請求書ごとの確認・仕入先別の要約・支払予定・振込一覧のCSV', href: 'apps/shiire.html' },
    { id: 'santei', category: '人事・総務', title: '算定基礎・月額変更の判定', pattern: '突合・照合・チェック', icon: 'health_and_safety', area: '総務・給与',
      summary: '月ごとの給与データから、4〜6月の報酬で決める標準報酬月額（算定基礎）と、固定的賃金が変わったときの月額変更（随時改定）の対象者・新しい等級を出します。',
      input: '月ごとの給与データCSV（給与明細の一括印刷と同じ形も可。複数ファイル）・現在の標準報酬月額の一覧（任意）', output: '算定基礎の判定結果・月額変更の対象者・確認が要ることのCSV', href: 'apps/santei.html' },
    { id: 'calendar', category: '人事・総務', title: '会社カレンダーの作成', pattern: '帳票作成・印刷', icon: 'calendar_month', area: '総務・人事',
      summary: '国民の祝日を自動で入れた1年分（期首の月からの12か月）の会社カレンダーを作り、年末年始・夏季休暇などの会社の休日や祝日の出勤日を重ねて、月ごとの稼働日数・休日数・所定労働時間と、1年単位の変形労働時間制の目安を出します。',
      input: '年・期首の月・休みの曜日（＋会社の休日のCSV）', output: '年間・月ごとのカレンダー（印刷・PDF）、月ごとの日数・日ごとの一覧のCSV、休みの日の一覧（資金繰り表・仕入請求の照合用）、カレンダー用ファイル（.ics）', href: 'apps/calendar.html' },
    { id: 'invoice', category: '経理・請求', title: 'インボイス登録番号のチェック', pattern: '突合・照合・チェック', icon: 'verified', area: '経理',
      summary: '取引先マスタの登録番号（T＋13けた）の書き方・写し間違い・重複を確かめ、整えたマスタを作ります。国税庁の公表データとの照合や、登録番号のない相手との取引で差し引けなくなる消費税（経過措置）の目安も出します。',
      input: '取引先マスタCSV（＋国税庁の公表データ・仕入や経費の明細CSV）', output: '登録番号チェック結果・整えた取引先マスタ・経過措置の集計と明細のCSV', href: 'apps/invoice.html' },
    { id: 'rfm', category: 'データの整理・集計', title: 'RFM分析', pattern: '集計・分析', icon: 'loyalty', area: '営業・販売促進',
      summary: '売上明細から、お客さまごとに最後に買ってからの日数・買った回数・金額を出して5段階の点を付け、優良・新規・休眠しそうなどのセグメントに分けます。前回からの移り変わりと、案内状を送る相手の一覧も作れます。',
      input: '売上明細CSV（＋顧客名簿・前回のRFM結果）', output: '顧客別RFM結果・セグメント要約・移り変わり・案内状の送付先（宛名ラベル・差し込み文書で読める形）のCSV', href: 'apps/rfm.html' },
    { id: 'tanaoroshi', category: '出荷・在庫', title: '棚卸の記入表と差異', pattern: '突合・照合・チェック', icon: 'checklist', area: '在庫・経理',
      summary: '商品の一覧から、保管場所・棚の順に並んだ棚卸の記入表（帳簿の数を載せないブラインドも可）を印刷し、数えた結果を読み込むと帳簿との差異・差異金額を出して、数え直したほうがよい商品を示します。',
      input: '商品の一覧CSV（期末在庫・商品マスタ可）・数えた結果CSV（実数を書き込んだ記入表）', output: '記入表（印刷・PDF）・記入表CSV・差異一覧CSV・在庫の受払集計に戻せる棚卸の受払記録CSV', href: 'apps/tanaoroshi.html' },
    { id: 'shoyo', category: '人事・総務', title: '賞与の計算', pattern: '集計・分析', icon: 'redeem', area: '総務・給与',
      summary: '賞与の支給一覧から、社員ごとの標準賞与額・健康保険・介護保険・厚生年金・雇用保険・所得税（賞与の算出率の表）と差引支給額を計算し、賞与明細の印刷や振込データの作成にそのまま使えるファイルを作ります。',
      input: '賞与の支給一覧CSV（賞与額・前月の給与・扶養親族等の数・生年月日・口座など）', output: '賞与の計算結果・賞与明細用データ（給与明細の一括印刷用）・振込一覧（全銀データ作成用）・保険料の合計のCSV', href: 'apps/shoyo.html' },
    { id: 'tsukin', category: '人事・総務', title: '通勤手当の確認', pattern: '突合・照合・チェック', icon: 'commute', area: '総務・給与',
      summary: '通勤の届出一覧から、社員ごとの通勤手当のうち所得税がかからない額と、給与に足して課税する額を出します。電車・バスの定期代、マイカー・自転車の距離ごとの限度額、併用に対応し、会社のルールで計算した額より多い・少ない支給も見つけます。',
      input: '通勤の届出一覧CSV（通勤手段・片道距離・定期代・支給額など）', output: '通勤手当の確認結果・課税額の一覧（給与ソフト用）のCSV', href: 'apps/tsukin.html' },
    { id: 'zennen', category: 'データの整理・集計', title: '売上の前年比較', pattern: '集計・分析', icon: 'bar_chart', area: '営業・経営',
      summary: '売上明細から、今年と前年の売上を月ごとに並べて差額・前年比・累計の前年比を出します。商品・取引先・担当者などに分けると、増減を動かしたもの（寄与度）や、新しく売れたもの・売れなくなったものも分かります。',
      input: '売上明細CSV（2年分、または今年と前年の2ファイル）', output: '月別前年比・単位別前年比・寄与度のCSV', href: 'apps/zennen.html' },
  ];
  /* ホームでの並び順（カテゴリ） */
  const categories = ['経理・請求', '人事・総務', '出荷・在庫', '文書・郵送', 'データの整理・集計'];
  const KEY = 'macroapps.selected.v1';
  /* storage は localStorage 互換。使えない環境ではメモリに保持する */
  function createStore(storage) {
    let memory = null;
    function load() {
      let raw = memory;
      try { if (storage) { const s = storage.getItem(KEY); if (s != null) raw = s; } } catch (e) { /* メモリで続行 */ }
      if (raw == null) return null;
      try {
        const ids = JSON.parse(raw);
        if (!Array.isArray(ids)) return null;
        return ids.filter((id) => catalog.some((a) => a.id === id));
      } catch (e) { return null; }
    }
    function save(ids) {
      const raw = JSON.stringify(ids.filter((id) => catalog.some((a) => a.id === id)));
      memory = raw;
      try { if (storage) storage.setItem(KEY, raw); } catch (e) { /* メモリで続行 */ }
    }
    return { load, save };
  }

  /* お気に入り（左のメニューの☆）。並びは追加した順。
     まだ記録がなく、以前の「選んだ機能」が全部ではないときは、それをお気に入りとして引き継ぐ */
  const FAV_KEY = 'macroapps.favorites.v1';
  function createFavorites(storage) {
    let memory = null;
    const known = (id) => catalog.some((a) => a.id === id);
    function read() {
      let raw = memory;
      try { if (storage) { const s = storage.getItem(FAV_KEY); if (s != null) raw = s; } } catch (e) { /* メモリで続行 */ }
      if (raw == null) return null;
      try { const ids = JSON.parse(raw); return Array.isArray(ids) ? ids : null; } catch (e) { return null; }
    }
    function save(ids) {
      const uniq = [];
      ids.forEach((id) => { if (known(id) && uniq.indexOf(id) === -1) uniq.push(id); });
      const raw = JSON.stringify(uniq);
      memory = raw;
      try { if (storage) storage.setItem(FAV_KEY, raw); } catch (e) { /* メモリで続行 */ }
      return uniq;
    }
    function load() {
      const ids = read();
      if (ids) return ids.filter(known);
      const old = createStore(storage).load();
      return save(old && old.length < catalog.length ? old : []);
    }
    function has(id) { return load().indexOf(id) !== -1; }
    function toggle(id) {
      const ids = load();
      const i = ids.indexOf(id);
      if (i === -1) ids.push(id); else ids.splice(i, 1);
      return save(ids);
    }
    return { load, save, has, toggle };
  }
  return { catalog, categories, createStore, createFavorites, KEY, FAV_KEY };
});
