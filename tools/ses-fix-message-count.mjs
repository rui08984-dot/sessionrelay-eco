// 修复 sessions.message_count：清理注入消息时没同步这一列，所有按条数的口径都会偏
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const APPLY = process.argv.includes("--apply");
for (const root of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const db = new DatabaseSync(root + "/.sessionrelay/relay.sqlite", APPLY ? {} : { readOnly: true });
  const rows = db.prepare("SELECT id, message_count, (SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id) AS real FROM sessions").all();
  const bad = rows.filter((r) => (r.message_count ?? 0) !== (r.real ?? 0));
  const delta = bad.reduce((a, b) => a + ((b.message_count ?? 0) - (b.real ?? 0)), 0);
  console.log(root + "：计数不符 " + bad.length + " 场（虚高合计 " + delta + " 条）");
  for (const b of bad.slice(0, 3)) console.log("   " + String(b.id).slice(0, 10) + " 记 " + b.message_count + " 实 " + b.real);
  if (APPLY && bad.length) {
    const st = db.prepare("UPDATE sessions SET message_count = (SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id) WHERE id = ?");
    for (const b of bad) st.run(b.id);
    console.log("   已修正 " + bad.length + " 行");
  }
  db.close();
}
