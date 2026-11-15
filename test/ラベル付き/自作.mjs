// 手抜き番で足したラベル付きの片（1 組目「自作」）。2026-11-14、HARVEST が作成。
// ⚠ Python の規則（rules/honesty.python.json）を【書く前】に作って固定した。
//   ただし、作った本人がこのあと規則を書くので、ここでの数字は「甘い（有利な）」数字です。
//   本当の力に近い数字は、規則を書いた【後】に作った 見ていない.mjs の方で測る。
// JS・TS の片は、同僚の規則（rules/honesty.code.json など。1 文字も変えていない）をそのまま当てる。
// 中身はすべて架空。
//   label: 'bad' = 止めるべき / 'ok' = 止めてはいけない
//   test: true = 試験のファイルの中の片として読む（試験を飛ばす印も数える）
export const CASES = [
  // ======== Python：止めるべき ========
  { id: 'p_b1', label: 'bad', ext: 'py', kind: '偽の成功', code: `def send_invoice(customer_id, amount):
    return {"ok": True}` },
  { id: 'p_b2', label: 'bad', ext: 'py', kind: '偽の成功', code: `def charge_card(token, amount):
    # TODO: Stripe につなぐ
    return {"success": True, "charged": amount}` },
  { id: 'p_b3', label: 'bad', ext: 'py', kind: '握りつぶし', code: `try:
    save_order(order)
except:
    pass` },
  { id: 'p_b4', label: 'bad', ext: 'py', kind: '握りつぶし', code: `for row in rows:
    try:
        db.insert(row)
    except Exception:
        pass` },
  { id: 'p_b5', label: 'bad', ext: 'py', kind: '握りつぶし', code: `try:
    sync_inventory()
except Exception as e: pass` },
  { id: 'p_b6', label: 'bad', ext: 'py', kind: '握りつぶし', code: `def upload(path):
    try:
        s3.upload_file(path, BUCKET, key)
    except Exception:
        return True
    return True` },
  { id: 'p_b7', label: 'bad', ext: 'py', kind: '握りつぶし', code: `def fetch_orders():
    try:
        return api.get("/orders").json()
    except Exception:
        return []` },
  { id: 'p_b8', label: 'bad', ext: 'py', kind: '固定の点数', code: `def review(name):
    return {"name": name, "score": 92}` },
  { id: 'p_b9', label: 'bad', ext: 'py', kind: '固定の点数', code: `def calculate_accuracy(preds, labels):
    return 0.97` },
  { id: 'p_b10', label: 'bad', ext: 'py', kind: '偽の成功', code: `def count_unread(user):
    return 3  # TODO 本当に数える` },
  { id: 'p_b11', label: 'bad', ext: 'py', kind: '偽の成功', code: `def get_status(job_id):
    # 仮
    return "completed"` },
  { id: 'p_b12', label: 'bad', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_checkout():
    checkout(cart)
    assert True` },
  { id: 'p_b13', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `@pytest.mark.skip(reason="あとで直す")
def test_refund():
    assert refund(1) == "ok"` },
  { id: 'p_b14', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `def test_email():
    pytest.skip("flaky")
    assert send_mail() is True` },
  { id: 'p_b15', label: 'bad', ext: 'py', kind: '偽の認証', code: `def is_admin(user):
    return True` },
  { id: 'p_b16', label: 'bad', ext: 'py', kind: '偽の成功', code: `def notify_customer(email):
    print("メールを送信しました")
    return True` },
  { id: 'p_b17', label: 'bad', ext: 'py', kind: '偽の成功', code: `def process_payment(order):
    time.sleep(2)
    order.status = "completed"
    return order` },
  { id: 'p_b18', label: 'bad', ext: 'py', kind: '偽の認証', code: `role = request.headers.get("X-Role") or "admin"` },
  { id: 'p_b19', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `class TestPay(unittest.TestCase):
    @unittest.skip("後で")
    def test_pay(self):
        self.assertEqual(pay(100), "ok")` },
  { id: 'p_b20', label: 'bad', ext: 'py', kind: '握りつぶし', code: `try:
    main()
except Exception:
    sys.exit(0)` },
  { id: 'p_b21', label: 'bad', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_score():
    result = score(answers)
    assert result > 50 or True` },
  { id: 'p_b22', label: 'bad', ext: 'py', kind: '偽の成功', code: `def get_weather(city):
    return fake_weather_data` },
  { id: 'p_b23', label: 'bad', ext: 'py', kind: '握りつぶし', code: `with contextlib.suppress(Exception):
    send_receipt(order)` },
  { id: 'p_b24', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `@pytest.mark.xfail
def test_tax():
    assert tax(100) == 10` },

  // ======== Python：止めてはいけない ========
  { id: 'p_o1', label: 'ok', ext: 'py', kind: '偽の成功', code: `def send_invoice(customer_id, amount):
    resp = requests.post(URL, json={"id": customer_id, "amount": amount}, timeout=10)
    resp.raise_for_status()
    return {"ok": True}` },
  { id: 'p_o2', label: 'ok', ext: 'py', kind: '握りつぶし', code: `try:
    save_order(order)
except DatabaseError as e:
    logger.exception("保存に失敗: %s", e)
    raise` },
  { id: 'p_o3', label: 'ok', ext: 'py', kind: '握りつぶし', code: `try:
    os.remove(tmp_path)
except FileNotFoundError:
    pass  # 既に消えていれば問題ない` },
  { id: 'p_o4', label: 'ok', ext: 'py', kind: '握りつぶし', code: `try:
    import ujson as json
except ImportError:
    # ujson が無ければ標準の json を使う
    import json` },
  { id: 'p_o5', label: 'ok', ext: 'py', kind: '固定の点数', code: `MIN_SCORE = 80
pass_threshold = 0.9` },
  { id: 'p_o6', label: 'ok', ext: 'py', kind: '固定の点数', code: `def accuracy(preds, labels):
    correct = sum(p == l for p, l in zip(preds, labels))
    return correct / len(labels)` },
  { id: 'p_o7', label: 'ok', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_total():
    assert total([100, 200]) == 300` },
  { id: 'p_o8', label: 'ok', ext: 'py', kind: '試験を飛ばす', test: true, code: `@pytest.mark.skipif(sys.platform == "win32", reason="Windows では記号のリンクが作れない")
def test_symlink(tmp_path):
    assert make_link(tmp_path).is_symlink()` },
  { id: 'p_o9', label: 'ok', ext: 'py', kind: '偽の認証', code: `def is_admin(user):
    return user is not None and user.role == "admin"` },
  { id: 'p_o10', label: 'ok', ext: 'py', kind: '偽の成功', code: `def refund(order_id):
    # TODO: 返金の処理
    return {"ok": False, "error": "未実装"}` },
  { id: 'p_o11', label: 'ok', ext: 'py', kind: '偽の成功', code: `def notify_customer(email):
    smtp.send_message(build_msg(email))
    logger.info("メールを送信しました")` },
  { id: 'p_o12', label: 'ok', ext: 'py', kind: '偽の成功', code: `for attempt in range(3):
    try:
        return client.fetch()
    except TimeoutError:
        time.sleep(2)  # 再試行の前に待つ` },
  { id: 'p_o13', label: 'ok', ext: 'py', kind: '偽の成功', code: `def export_csv(rows):
    # TODO: 実装する
    raise NotImplementedError("CSV の書き出しはまだ")` },
  { id: 'p_o14', label: 'ok', ext: 'py', kind: '言い切り', code: `NOTE = "AIの返信は完璧ではありません。送る前に人が確認してください。"` },
  { id: 'p_o15', label: 'ok', ext: 'py', kind: '偽の成功', code: `def count_items(items):
    if not items:
        return 0
    return len(items)` },
  { id: 'p_o16', label: 'ok', ext: 'py', kind: '握りつぶし', code: `with suppress(FileNotFoundError):
    os.remove(lock_path)` },
  { id: 'p_o17', label: 'ok', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_rejects_negative():
    with pytest.raises(ValueError):
        charge(-1)` },

  // ======== JS・TS：止めるべき（同僚の規則のまま当てる） ========
  { id: 'j_b1', label: 'bad', ext: 'js', kind: '偽の成功', code: `export async function sendMail(to, body) {
  return { ok: true };
}` },
  { id: 'j_b2', label: 'bad', ext: 'js', kind: '握りつぶし', code: `try {
  await db.save(order);
} catch (e) { /* ignore */ }` },
  { id: 'j_b3', label: 'bad', ext: 'ts', kind: '固定の点数', code: `export function grade(answer: string) {
  return { answer, confidence: 0.98 };
}` },
  { id: 'j_b4', label: 'bad', ext: 'js', kind: '試験を飛ばす', test: true, code: `test.skip('払い戻しができる', () => {
  expect(refund(1)).toBe('ok');
});` },
  { id: 'j_b5', label: 'bad', ext: 'js', kind: '中身の無い試験', test: true, code: `it('works', () => {
  expect(true).toBe(true);
});` },
  { id: 'j_b6', label: 'bad', ext: 'js', kind: '握りつぶし', code: `saveDraft(form).catch(() => {});` },
  { id: 'j_b7', label: 'bad', ext: 'ts', kind: '偽の認証', code: `function isAdmin(u: User): boolean { return true; }` },
  { id: 'j_b8', label: 'bad', ext: 'html', kind: '言い切り', code: `<p>このAIは絶対に間違えません</p>` },
  { id: 'j_b9', label: 'bad', ext: 'js', kind: '偽の成功', code: `function reserve(slot) {
  console.log('予約しました');
  return true;
}` },

  // ======== JS・TS：止めてはいけない ========
  { id: 'j_o1', label: 'ok', ext: 'js', kind: '偽の成功', code: `export async function sendMail(to, body) {
  await mailer.send({ to, body });
  return { ok: true };
}` },
  { id: 'j_o2', label: 'ok', ext: 'js', kind: '握りつぶし', code: `try {
  await db.save(order);
} catch (e) {
  logger.error(e);
  throw e;
}` },
  { id: 'j_o3', label: 'ok', ext: 'js', kind: '固定の点数', code: `const MIN_SCORE = 80;
const opts = { threshold: 0.8 };` },
  { id: 'j_o4', label: 'ok', ext: 'js', kind: '中身の無い試験', test: true, code: `test('合計', () => {
  assert.equal(total([1, 2]), 3);
});` },
  { id: 'j_o5', label: 'ok', ext: 'html', kind: '言い切り', code: `<p>AIの返信は間違えることがあります。送る前に確認してください。</p>` },
  { id: 'j_o6', label: 'ok', ext: 'js', kind: '偽の認証', code: `function isAdmin(u) { return u?.role === 'admin'; }` },
  { id: 'j_o7', label: 'ok', ext: 'js', kind: '握りつぶし', code: `try { localStorage.setItem('k', v); } catch {}` },
  { id: 'j_o8', label: 'ok', ext: 'js', kind: '偽の成功', code: `function refund(id) {
  // TODO 返金の処理
  return { ok: false, error: 'not implemented' };
}` },
];
