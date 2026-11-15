// ラベル付きの片（2 組目「見ていない」）。2026-11-14、HARVEST が作成。
// ⚠ Python の規則を【書いた後】に、AI が実際に書きそうな言い方で作った。
//   この組を測ったあと、規則は【直していない】（直すと、この組も甘い数字になるため）。
//   ただし作ったのは規則を書いた本人なので、第三者の片より有利な可能性は残る。
// 中身はすべて架空。label: 'bad' = 止めるべき / 'ok' = 止めてはいけない / test: true = 試験のファイルの片
export const CASES = [
  // ======== Python：止めるべき ========
  { id: 'u_pb1', label: 'bad', ext: 'py', kind: '偽の成功', code: `class PaymentService:
    def capture(self, order_id: str) -> dict:
        """Capture the payment."""
        return {"status": "captured", "order_id": order_id}` },
  { id: 'u_pb2', label: 'bad', ext: 'py', kind: '偽の成功', code: `async def send_line_message(user_id, text):
    # 本番では LINE の API を呼ぶ
    return {"ok": True}` },
  { id: 'u_pb3', label: 'bad', ext: 'py', kind: '握りつぶし', code: `def load_config(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}` },
  { id: 'u_pb4', label: 'bad', ext: 'py', kind: '握りつぶし', code: `try:
    resp = requests.post(WEBHOOK_URL, json=payload, timeout=5)
except requests.RequestException:
    ...` },
  { id: 'u_pb5', label: 'bad', ext: 'py', kind: '握りつぶし', code: `def safe_run(job):
    try:
        job.run()
    except BaseException:
        return None` },
  { id: 'u_pb6', label: 'bad', ext: 'py', kind: '握りつぶし', code: `for user in users:
    try:
        mailer.send(user.email, body)
    except Exception as exc:
        logger.debug(exc)
        continue
print("全員に送信しました")` },
  { id: 'u_pb7', label: 'bad', ext: 'py', kind: '固定の点数', code: `result = {
    "model": "v2",
    "accuracy": 0.95,
    "evaluated_at": today(),
}` },
  { id: 'u_pb8', label: 'bad', ext: 'py', kind: '固定の点数', code: `def evaluate(model, dataset):
    # TODO: 本当に評価する
    return {"f1": 0.91, "precision": 0.93}` },
  { id: 'u_pb9', label: 'bad', ext: 'py', kind: '偽の成功', code: `def fetch_exchange_rate(currency):
    return 150.0  # とりあえず固定` },
  { id: 'u_pb10', label: 'bad', ext: 'py', kind: '偽の成功', code: `def search_properties(area):
    # TODO: DB から取る
    return SAMPLE_PROPERTIES` },
  { id: 'u_pb11', label: 'bad', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_create_user(client):
    resp = client.post("/users", json={"name": "テスト太郎"})
    assert resp` },
  { id: 'u_pb12', label: 'bad', ext: 'py', kind: '中身の無い試験', test: true, code: `class TestInvoice(unittest.TestCase):
    def test_total(self):
        self.assertTrue(True)` },
  { id: 'u_pb13', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `pytestmark = pytest.mark.skip(reason="CI で落ちるので一旦")

def test_sync():
    assert sync() == 3` },
  { id: 'u_pb14', label: 'bad', ext: 'py', kind: '試験を飛ばす', test: true, code: `def test_upload(tmp_path):
    if not os.environ.get("RUN_SLOW"):
        return
    assert upload(tmp_path / "a.txt")` },
  { id: 'u_pb15', label: 'bad', ext: 'py', kind: '偽の認証', code: `def require_login(view):
    def wrapper(request, *args, **kwargs):
        return view(request, *args, **kwargs)
    return wrapper` },
  { id: 'u_pb16', label: 'bad', ext: 'py', kind: '偽の認証', code: `def verify_webhook_signature(body: bytes, signature: str) -> bool:
    # 署名の確認はあとで
    return True` },
  { id: 'u_pb17', label: 'bad', ext: 'py', kind: '偽の成功', code: `def backup_database():
    logging.info("Backup completed successfully")
    return 0` },
  { id: 'u_pb18', label: 'bad', ext: 'py', kind: '偽の成功', code: `async def generate_report(job):
    await asyncio.sleep(3)
    job.state = "finished"
    await job.save()` },
  { id: 'u_pb19', label: 'bad', ext: 'py', kind: '偽の認証', code: `user = get_current_user() or User(name="guest", is_admin=True)` },
  { id: 'u_pb20', label: 'bad', ext: 'py', kind: '握りつぶし', code: `if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(e)
        sys.exit(0)` },

  // ======== Python：止めてはいけない ========
  { id: 'u_po1', label: 'ok', ext: 'py', kind: '偽の成功', code: `class PaymentService:
    def capture(self, order_id: str) -> dict:
        charge = self.gateway.capture(order_id)
        return {"status": "captured", "order_id": order_id, "id": charge.id}` },
  { id: 'u_po2', label: 'ok', ext: 'py', kind: '握りつぶし', code: `def load_config(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("設定ファイルがありません: %s。既定値を使います", path)
        return dict(DEFAULTS)` },
  { id: 'u_po3', label: 'ok', ext: 'py', kind: '握りつぶし', code: `try:
    from rich import print
except ImportError:  # rich が無ければ普通の print を使う
    pass` },
  { id: 'u_po4', label: 'ok', ext: 'py', kind: '固定の点数', code: `PASSING_SCORE = 60
DEFAULT_CONFIDENCE = 0.5` },
  { id: 'u_po5', label: 'ok', ext: 'py', kind: '固定の点数', code: `def f1_score(p, r):
    if p + r == 0:
        return 0.0
    return 2 * p * r / (p + r)` },
  { id: 'u_po6', label: 'ok', ext: 'py', kind: '中身の無い試験', test: true, code: `def test_create_user(client):
    resp = client.post("/users", json={"name": "テスト太郎"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "テスト太郎"` },
  { id: 'u_po7', label: 'ok', ext: 'py', kind: '試験を飛ばす', test: true, code: `@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg が無い環境")
def test_convert(tmp_path):
    assert convert(tmp_path / "a.wav").suffix == ".mp3"` },
  { id: 'u_po8', label: 'ok', ext: 'py', kind: '偽の認証', code: `def verify_webhook_signature(body: bytes, signature: str) -> bool:
    expected = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)` },
  { id: 'u_po9', label: 'ok', ext: 'py', kind: '偽の成功', code: `def backup_database():
    subprocess.run(["pg_dump", "-f", OUT], check=True)
    logging.info("Backup completed successfully")` },
  { id: 'u_po10', label: 'ok', ext: 'py', kind: '偽の成功', code: `async def poll_status(job):
    while job.state != "finished":
        await asyncio.sleep(3)  # poll
        await job.refresh()` },
  { id: 'u_po11', label: 'ok', ext: 'py', kind: '偽の認証', code: `role = request.headers.get("X-Role") or "viewer"` },
  { id: 'u_po12', label: 'ok', ext: 'py', kind: '偽の成功', code: `def is_even(n: int) -> bool:
    return n % 2 == 0` },
  { id: 'u_po13', label: 'ok', ext: 'py', kind: '言い切り', code: `HELP = "この見積もりは目安です。正確な金額は担当者が確認します。"` },
  { id: 'u_po14', label: 'ok', ext: 'py', kind: '偽の成功', code: `def save_note(db, note):
    db.execute("INSERT INTO notes VALUES (?)", (note,))
    db.commit()
    return {"ok": True}` },

  // ======== JS・TS：止めるべき ========
  { id: 'u_jb1', label: 'bad', ext: 'ts', kind: '偽の成功', code: `export async function syncCalendar(): Promise<{ synced: boolean }> {
  // later: call Google Calendar
  return { synced: true };
}` },
  { id: 'u_jb2', label: 'bad', ext: 'js', kind: '握りつぶし', code: `process.on('unhandledRejection', () => {});` },
  { id: 'u_jb3', label: 'bad', ext: 'js', kind: '試験を飛ばす', test: true, code: `describe.skip('checkout', () => {
  it('charges the card', async () => { expect(await charge()).toBe(true); });
});` },
  { id: 'u_jb4', label: 'bad', ext: 'tsx', kind: '偽の成功', code: `const onSubmit = () => {
  toast.success('送信しました');
};` },
  { id: 'u_jb5', label: 'bad', ext: 'js', kind: '固定の点数', code: `res.json({ userId, matchRate: 98 });` },
  { id: 'u_jb6', label: 'bad', ext: 'html', kind: '言い切り', code: `<h2>導入すればミスはゼロに。100%正確な自動入力</h2>` },

  // ======== JS・TS：止めてはいけない ========
  { id: 'u_jo1', label: 'ok', ext: 'ts', kind: '偽の成功', code: `export async function syncCalendar(): Promise<{ synced: boolean }> {
  const r = await calendar.events.list({ calendarId: 'primary' });
  return { synced: r.status === 200 };
}` },
  { id: 'u_jo2', label: 'ok', ext: 'js', kind: '握りつぶし', code: `process.on('unhandledRejection', (e) => { logger.error(e); process.exitCode = 1; });` },
  { id: 'u_jo3', label: 'ok', ext: 'tsx', kind: '偽の成功', code: `const onSubmit = async () => {
  const r = await fetch('/api/contact', { method: 'POST', body });
  if (r.ok) toast.success('送信しました');
};` },
  { id: 'u_jo4', label: 'ok', ext: 'html', kind: '言い切り', code: `<p>入力の間違いを減らします（ゼロにはなりません）。</p>` },
];
