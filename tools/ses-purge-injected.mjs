// 把「采集层现在会丢掉的注入消息」从**存量**里精确清掉（定位靠事件 kind 的 seq，不靠内容特征）。
//
// 为什么可逆：DSH 会话文件是唯一事实源，本脚本只删索引行；要恢复跑 srelay rebuild 即可重采。
// 默认 dry-run，--apply 才真删。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const APPLY = process.argv.includes("--apply");
function lines(file) { const raw = fs.readFileSync(file); const offs = []; let i = raw.indexOf(MAGIC); while (i !== -1) { offs.push(i); i = raw.indexOf(MAGIC, i + 4) } offs.push(raw.length); const out = []; for (let k = 0; k < offs.length - 1; k++) { try { const s = zlib.zstdDecompressSync(raw.subarray(offs[k], offs[k + 1])).toString("utf8"); for (const l of s.split("\n")) if (l.trim()) out.push(l) } catch { } } return out; }
function slugOf(root) {
  let out = "";
  for (const ch of path.resolve(root)) { const c = ch.codePointAt(0) ?? 0; if (ch === ":") continue; if (ch === "\\" || ch === "/") { out += "-"; continue } if (ch === " ") { out += "~0020"; continue } if (c < 0x80) { out += ch; continue } out += "~" + c.toString(16).toUpperCase().padStart(4, "0") }
  return "--" + out + "--";
}
const idOf = (uuid) => createHash("sha1").update("dsh:" + uuid).digest("hex").slice(0, 16);
for (const root of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const dir = path.join(os.homedir(), ".dsh", "sessions", slugOf(root));
  if (!fs.existsSync(dir)) { console.log(root + "：DSH 会话目录不存在，跳过"); continue }
  const db = new DatabaseSync(path.join(root, ".sessionrelay", "relay.sqlite"), APPLY ? {} : { readOnly: true });
  const del = db.prepare("DELETE FROM messages WHERE session_id = ? AND seq_num = ?");
  let sessions = 0, victims = 0, chars = 0, kinds = {};
  for (const d of fs.readdirSync(dir)) {
    const m = /^session-(.+)$/.exec(d); if (!m) continue;
    const sp = path.join(dir, d); try { if (!fs.statSync(sp).isDirectory()) continue } catch { continue }
    const f = fs.readdirSync(sp).find((x) => x.endsWith(".jsonl.zstd")); if (!f) continue;
    const sid = idOf(m[1]);
    const has = db.prepare("SELECT count(*) n FROM messages WHERE session_id = ?").get(sid);
    if (!has.n) continue;
    sessions++;
    for (const l of lines(path.join(sp, f))) {
      let o; try { o = JSON.parse(l) } catch { continue }
      if (o.type !== "user/message" || typeof o.seq !== "number") continue;
      const k = o.data?.source?.kind;
      if (typeof k !== "string" || k === "user") continue;
      kinds[k] = (kinds[k] ?? 0) + 1;
      const row = db.prepare("SELECT length(content) n FROM messages WHERE session_id = ? AND seq_num = ?").get(sid, o.seq);
      if (!row) continue;
      victims++; chars += row.n ?? 0;
      if (APPLY) del.run(sid, o.seq);
    }
  }
  console.log((APPLY ? "已清理 " : "[dry-run] 将清理 ") + root + "：命中会话 " + sessions + " 场，消息 " + victims + " 条 / " + chars + " 字");
  console.log("   按 kind: " + JSON.stringify(kinds));
  db.close();
}
