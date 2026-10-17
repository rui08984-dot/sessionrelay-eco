// dsh-srelay-panel · 客户端（DSH 原生「SessionRelay 记忆台」控制台）
//
// ═══ 设计语言：瑞士国际主义 × 编辑杂志网格（Swiss Style × Editorial Grid） ═══
// · 骨架（Minimalism & Swiss Style）：
//   - 单色黑白底，仅保留单一交互强调色，高对比度可读性（≥ 4.5:1）。
//   - 严格直角（border-radius: 0px）、坚决无软阴影（box-shadow: none）。
//   - 间距基准 2rem（32px），栏距 2rem，无多余毛玻璃与无意义渐变装饰。
//   - 交互触点一眼可辨：实线边框、悬停黑白反色反转、可见的高对比焦点环。
// · 内容层（Editorial Grid / Magazine）：
//   - 刊头双线规则（Rule lines）、大字重无衬线粗黑标题、正文可读衬线。
//   - 首字下沉（Drop cap 4em）、引言块（Blockquote 1.5em）、非对称流动网格。
// · 架构约束与自包含：
//   - 零 npm 依赖、单文件自包含 ESM，由 DSH 模块加载器运行时注入 React。
//   - 零第二套判据：所有数据与阈值严格源自宿主接口 /srelay/api/*。
//   - 自包含滚动视口：修复父容器 overflow:hidden 导致的滚轮失效。

window.__ModuleLoader__.load({
  id: 'dsh-srelay-panel',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'srelay';
    const API = 'srelay/api/';

    // ── 相对地址解析（前缀安全） ──
    function apiUrl(method) {
      const base = (typeof document !== 'undefined' && document.baseURI)
        || (typeof location !== 'undefined' ? location.href : 'http://dsh.internal/');
      return new URL(API + method, new URL('.', base).href).href;
    }

    async function rpc(method, params, opts) {
      const post = opts && opts.post;
      const url = post
        ? apiUrl(method)
        : apiUrl(method) + '?' + new URLSearchParams(flatten(params || {})).toString();
      const res = await fetch(url, post
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}) }
        : { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!json) throw new Error('宿主未返回有效 JSON（HTTP ' + res.status + '）');
      if (!json.ok) {
        const msg = (json.error && json.error.message) || '调用失败';
        throw new Error(msg);
      }
      return json.data;
    }

    function flatten(o) {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (v !== null && v !== undefined) {
          out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
      }
      return out;
    }

    // ── 格式化工具（纯展示） ──
    const n = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : String(v ?? '—'));
    const pct = (v) => (typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—');
    const mb = (v) => (typeof v === 'number' ? (v / 1048576).toFixed(1) + ' MB' : '—');
    const when = (s) => (s ? String(s).replace('T', ' ').slice(0, 19) : '—');
    const ago = (ms) => {
      if (ms === null || ms === undefined) return '—';
      const s = Math.round(ms / 1000);
      if (s < 60) return s + ' 秒前';
      if (s < 3600) return Math.round(s / 60) + ' 分钟前';
      if (s < 86400) return (s / 3600).toFixed(1) + ' 小时前';
      return Math.round(s / 86400) + ' 天前';
    };

    // ── 复制文本助手 ──
    function copyText(text, cb) {
      if (!text) return;
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => cb && cb(true)).catch(() => cb && cb(false));
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          if (cb) cb(true);
        } catch {
          if (cb) cb(false);
        }
      }
    }

    // ── 注入瑞士国际主义 × 编辑杂志样式表 ──
    function ensureStyleSheet() {
      if (typeof document === 'undefined') return;
      const STYLE_ID = 'dsh-srelay-panel-styles';
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .srelay-root {
          /* 瑞士国际主义单色黑白骨架 + 单一强调色系统，映射宿主 --dsw-* 令牌 */
          --sr-bg: var(--dsw-alias-bg-base, #ffffff);
          --sr-surface: var(--dsw-alias-bg-layer-1, #f8f9fa);
          --sr-surface-subtle: var(--dsw-alias-bg-layer-2, #f1f3f5);
          --sr-border: var(--dsw-alias-border-l1, #000000);
          --sr-border-subtle: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.15));
          --sr-text: var(--dsw-alias-label-primary, #000000);
          --sr-text-muted: var(--dsw-alias-label-secondary, #444444);
          --sr-text-subtle: var(--dsw-alias-label-tertiary, #777777);
          --sr-accent: var(--dsw-alias-interactive-primary, #0047cc);
          --sr-accent-contrast: #ffffff;
          --sr-danger: #c92a2a;
          --sr-warn: #e67700;
          --sr-success: #2b8a3e;

          /* 排版字体规范：标题粗黑体、正文可读衬线 */
          --sr-font-sans: "Helvetica Neue", Helvetica, Arial, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
          --sr-font-serif: Georgia, "Noto Serif SC", "Songti SC", SimSun, Cambria, serif;
          --sr-font-mono: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;

          /* 严格直角与无软阴影 */
          --sr-radius: 0px;
          --sr-shadow: none;

          /* 尺寸与自包含滚动容器（彻底根治父级 overflow:hidden 导致的滚轮失效） */
          box-sizing: border-box;
          height: 100%;
          width: 100%;
          min-height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          background-color: var(--sr-bg);
          color: var(--sr-text);
          font-family: var(--sr-font-serif);
          line-height: 1.6;
          -webkit-font-smoothing: antialiased;
          scrollbar-gutter: stable;
        }

        /* 暗色模式语义增强（跟随宿主暗色属性） */
        body[data-ds-dark-theme] .srelay-root,
        [data-theme="dark"] .srelay-root {
          --sr-bg: var(--dsw-alias-bg-base, #101216);
          --sr-surface: var(--dsw-alias-bg-layer-1, #181b20);
          --sr-surface-subtle: var(--dsw-alias-bg-layer-2, #21262d);
          --sr-border: var(--dsw-alias-border-l1, #ffffff);
          --sr-border-subtle: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.22));
          --sr-text: var(--dsw-alias-label-primary, #ffffff);
          --sr-text-muted: var(--dsw-alias-label-secondary, #b0b4ba);
          --sr-text-subtle: var(--dsw-alias-label-tertiary, #808690);
          --sr-accent: var(--dsw-alias-interactive-primary, #38bdf8);
          --sr-accent-contrast: #000000;
          --sr-danger: #ff6b6b;
          --sr-warn: #fcc419;
          --sr-success: #51cf66;
        }

        .srelay-root * {
          box-sizing: border-box;
          border-radius: 0px !important;
          box-shadow: none !important;
        }

        /* 杂志刊头规则线 */
        .srelay-rule-heavy {
          border-top: 3px solid var(--sr-border);
          margin: 0;
        }
        .srelay-rule-light {
          border-top: 1px solid var(--sr-border);
          margin: 0;
        }

        /* 首字下沉（Drop Cap 4em） */
        .srelay-dropcap {
          float: left;
          font-family: var(--sr-font-sans);
          font-size: 3.8em;
          line-height: 0.82;
          padding-top: 4px;
          padding-right: 12px;
          padding-bottom: 2px;
          font-weight: 900;
          color: var(--sr-text);
        }

        /* 引言块（Blockquote 1.5em） */
        .srelay-blockquote {
          font-size: 1.25em;
          line-height: 1.5;
          margin: 1.5rem 0;
          padding: 0.75rem 1.5rem;
          border-left: 3px solid var(--sr-border);
          background: var(--sr-surface);
          font-style: italic;
          color: var(--sr-text);
        }

        /* 实体按钮（可点击区域一眼可辨，黑白反色高对比反馈） */
        .srelay-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 6px 14px;
          border: 1.5px solid var(--sr-border);
          background: var(--sr-bg);
          color: var(--sr-text);
          font-family: var(--sr-font-sans);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;
          user-select: none;
          text-decoration: none;
        }
        .srelay-btn:hover:not(:disabled) {
          background: var(--sr-text);
          color: var(--sr-bg);
          border-color: var(--sr-text);
        }
        .srelay-btn:active:not(:disabled) {
          transform: translateY(1px);
        }
        .srelay-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          border-style: dashed;
        }
        .srelay-btn-primary {
          background: var(--sr-text);
          color: var(--sr-bg);
          border-color: var(--sr-text);
        }
        .srelay-btn-primary:hover:not(:disabled) {
          background: var(--sr-accent);
          color: var(--sr-accent-contrast);
          border-color: var(--sr-accent);
        }
        .srelay-btn-danger {
          border-color: var(--sr-danger);
          color: var(--sr-danger);
          background: transparent;
        }
        .srelay-btn-danger:hover:not(:disabled) {
          background: var(--sr-danger);
          color: #ffffff;
        }
        .srelay-btn-active {
          background: var(--sr-text);
          color: var(--sr-bg);
        }

        /* 输入控件 */
        .srelay-input, .srelay-select {
          padding: 8px 12px;
          border: 1.5px solid var(--sr-border) !important;
          background: var(--sr-bg);
          color: var(--sr-text);
          font-family: var(--sr-font-sans);
          font-size: 12px;
          font-weight: 500;
          outline: none;
          transition: border-color 150ms ease, outline 150ms ease;
        }
        .srelay-input:hover, .srelay-select:hover {
          border-color: var(--sr-text-muted) !important;
        }
        .srelay-input:focus, .srelay-select:focus {
          border-color: var(--sr-accent) !important;
          outline: 2px solid var(--sr-accent) !important;
          outline-offset: 1px;
        }
        .srelay-input::placeholder, .srelay-select::placeholder {
          color: var(--sr-text-subtle);
          font-style: italic;
          opacity: 0.75;
        }
        .srelay-root input[type="checkbox"] {
          cursor: pointer;
          accent-color: var(--sr-accent);
        }

        /* 焦点环可见（键盘可达性） */
        .srelay-btn:focus-visible,
        .srelay-tab:focus-visible,
        .srelay-input:focus-visible,
        .srelay-select:focus-visible {
          outline: 2px solid var(--sr-accent) !important;
          outline-offset: 2px !important;
        }

        /* 杂志栏目导航 */
        .srelay-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border: 1.5px solid transparent;
          border-bottom: none;
          background: transparent;
          color: var(--sr-text-muted);
          font-family: var(--sr-font-sans);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 200ms ease;
          position: relative;
        }
        .srelay-tab:hover {
          color: var(--sr-text);
          border-color: var(--sr-border-subtle);
        }
        .srelay-tab.is-active {
          color: var(--sr-text);
          background: var(--sr-bg);
          border-color: var(--sr-border);
          border-bottom: 2px solid var(--sr-bg);
          margin-bottom: -1px;
        }

        /* 编辑杂志卡片容器 */
        .srelay-card {
          background: var(--sr-bg);
          border: 1.5px solid var(--sr-border);
          padding: 18px 20px;
          position: relative;
        }
        .srelay-card-header {
          font-family: var(--sr-font-sans);
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding-bottom: 8px;
          margin-bottom: 14px;
          border-bottom: 1.5px solid var(--sr-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        /* 状态与指示器 */
        .srelay-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border: 1px solid var(--sr-border);
          font-family: var(--sr-font-sans);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          background: var(--sr-surface);
          color: var(--sr-text);
        }
        .srelay-badge-active {
          background: var(--sr-text);
          color: var(--sr-bg);
          border-color: var(--sr-text);
        }
        .srelay-badge-status {
          width: 56px;
          justify-content: center;
          text-align: center;
        }

        /* 动效克制与减弱动效响应 */
        @media (prefers-reduced-motion: reduce) {
          .srelay-root * {
            transition: none !important;
            animation: none !important;
          }
        }

        /* 响应式断点（桌面宽屏多列、平板、移动单列） */
        .srelay-grid-editorial {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 2rem;
        }
        .srelay-col-8 { grid-column: span 8; }
        .srelay-col-4 { grid-column: span 4; }
        .srelay-col-6 { grid-column: span 6; }
        .srelay-col-12 { grid-column: span 12; }

        @media (max-width: 900px) {
          .srelay-col-8, .srelay-col-4, .srelay-col-6 {
            grid-column: span 12 !important;
          }
          .srelay-grid-editorial {
            gap: 1.25rem;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // ── SVG 图标库（直角克制极简线条） ──
    function Icon(props) {
      const name = props.name;
      const size = props.size || 14;
      const stroke = props.stroke || 'currentColor';
      const fill = props.fill || 'none';
      const sw = props.strokeWidth || 1.8;

      const p = { width: size, height: size, viewBox: '0 0 24 24', fill, stroke, strokeWidth: sw, strokeLinecap: 'square', strokeLinejoin: 'miter' };

      switch (name) {
        case 'brain':
          return h('svg', p,
            h('path', { d: 'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z' }),
            h('path', { d: 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z' }));
        case 'radar':
          return h('svg', p,
            h('path', { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z' }),
            h('path', { d: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' }),
            h('path', { d: 'M12 2v2M12 20v2M2 12h2M20 12h2' }));
        case 'layers':
          return h('svg', p,
            h('polygon', { points: '12 2 2 7 12 12 22 7 12 2' }),
            h('polyline', { points: '2 17 12 22 22 17' }),
            h('polyline', { points: '2 12 12 17 22 12' }));
        case 'sliders':
          return h('svg', p,
            h('line', { x1: '4', y1: '21', x2: '4', y2: '14' }),
            h('line', { x1: '4', y1: '10', x2: '4', y2: '3' }),
            h('line', { x1: '12', y1: '21', x2: '12', y2: '12' }),
            h('line', { x1: '12', y1: '8', x2: '12', y2: '3' }),
            h('line', { x1: '20', y1: '21', x2: '20', y2: '16' }),
            h('line', { x1: '20', y1: '12', x2: '20', y2: '3' }),
            h('line', { x1: '1', y1: '14', x2: '7', y2: '14' }),
            h('line', { x1: '9', y1: '8', x2: '15', y2: '8' }),
            h('line', { x1: '17', y1: '16', x2: '23', y2: '16' }));
        case 'terminal':
          return h('svg', p,
            h('polyline', { points: '4 17 10 11 4 5' }),
            h('line', { x1: '12', y1: '19', x2: '20', y2: '19' }));
        case 'refresh':
          return h('svg', p,
            h('path', { d: 'M21.5 2v6h-6M2.5 22v-6h6' }),
            h('path', { d: 'M19.5 13a7.5 7.5 0 0 1-13.3 4.2L2.5 16M4.5 11a7.5 7.5 0 0 1 13.3-4.2L21.5 8' }));
        case 'search':
          return h('svg', p,
            h('circle', { cx: '11', cy: '11', r: '8' }),
            h('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }));
        case 'check':
          return h('svg', p,
            h('polyline', { points: '20 6 9 17 4 12' }));
        case 'alert':
          return h('svg', p,
            h('circle', { cx: '12', cy: '12', r: '10' }),
            h('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
            h('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }));
        case 'copy':
          return h('svg', p,
            h('rect', { x: '9', y: '9', width: '13', height: '13' }),
            h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }));
        case 'lock':
          return h('svg', p,
            h('rect', { x: '3', y: '11', width: '18', height: '11' }),
            h('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }));
        case 'chevron-right':
          return h('svg', p,
            h('polyline', { points: '9 18 15 12 9 6' }));
        case 'chevron-down':
          return h('svg', p,
            h('polyline', { points: '6 9 12 15 18 9' }));
        default:
          return h('svg', p,
            h('rect', { x: '3', y: '3', width: '18', height: '18' }));
      }
    }

    // ── 数据拉取 Hook（严格修复切 Tab 白屏竞态） ──
    function useApi(method, params, intervalMs, enabled) {
      const isEnabled = enabled !== false;
      const key = (isEnabled && params !== null) ? JSON.stringify(params || {}) : null;
      const [state, setState] = React.useState({ data: null, error: null, at: null, loading: !!key });
      const [reloadKey, setReloadKey] = React.useState(0);

      React.useEffect(() => {
        if (key === null) {
          // 停用时不将现有数据清空，仅标记 loading 为 false，防止快速切回时闪现空白
          setState((s) => ({ ...s, loading: false }));
          return undefined;
        }
        let alive = true;
        setState((s) => ({ ...s, loading: s.data === null }));
        const pull = () => rpc(method, JSON.parse(key))
          .then((d) => {
            if (alive) setState({ data: d, error: null, at: new Date(), loading: false });
          })
          .catch((e) => {
            if (alive) setState((s) => ({ data: s.data, error: String((e && e.message) || e), at: s.at, loading: false }));
          });

        pull();
        if (!intervalMs || intervalMs <= 0) return () => { alive = false; };
        const timer = setInterval(pull, intervalMs);
        return () => { alive = false; clearInterval(timer); };
      }, [method, key, intervalMs, reloadKey]);

      const refresh = React.useCallback(() => {
        setReloadKey((k) => k + 1);
      }, []);

      return { ...state, refresh };
    }

    // ── 通用骨架加载屏（防止切 Tab 时整块空白） ──
    function SectionLoading(props) {
      return h('div', {
        className: 'srelay-card',
        style: {
          padding: '3rem 2rem',
          textAlign: 'center',
          borderStyle: 'dashed',
          margin: '1.5rem 0',
        },
      },
        h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' } },
          props.label || '正在加载数据…'
        ),
        h('div', { style: { fontSize: 12, color: 'var(--sr-text-muted)', marginTop: 8 } },
          '请稍候…'
        )
      );
    }

    // ── 通用组件：口径抽屉（铁律 22：所有数字可溯源） ──
    function CriteriaBox(props) {
      const [open, setOpen] = React.useState(false);
      const items = props.criteria || {};
      const keys = Object.keys(items);
      if (!keys.length) return null;

      return h('div', { style: { marginTop: '2rem' } },
        h('button', {
          className: 'srelay-btn',
          style: { fontSize: 11, padding: '5px 10px' },
          onClick: () => setOpen((o) => !o),
          'aria-expanded': open,
        },
          h(Icon, { name: open ? 'chevron-down' : 'chevron-right', size: 12 }),
          '统计与计算规则（' + keys.length + ' 项）'
        ),
        open ? h('div', {
          className: 'srelay-card',
          style: { marginTop: 10, padding: '16px 20px', background: 'var(--sr-surface)', fontSize: 12, lineHeight: 1.7 },
        },
          h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 } },
            '统计规则说明'
          ),
          keys.map((k) => h('div', { key: k, style: { marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
            h('strong', { style: { fontFamily: 'var(--sr-font-mono)', color: 'var(--sr-accent)', marginRight: 8 } }, k),
            h('span', { style: { color: 'var(--sr-text-muted)' } }, items[k])
          ))
        ) : null
      );
    }

    // ── 通用组件：HUD 杂志大字报指标卡 ──
    function HudCard(props) {
      return h('div', {
        className: 'srelay-card',
        title: props.title || undefined,
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '16px 18px',
          borderLeft: props.accent ? '4px solid ' + props.accent : '1.5px solid var(--sr-border)',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
          h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sr-text-muted)' } }, props.label),
          props.icon ? h(Icon, { name: props.icon, size: 14, stroke: props.accent || 'var(--sr-text)' }) : null
        ),
        h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, color: 'var(--sr-text)', marginTop: 'auto' } }, props.value),
        h('div', { style: { fontSize: 11, color: 'var(--sr-text-subtle)', marginTop: 6, fontStyle: 'italic', minHeight: 16, lineHeight: 1.4 } }, props.hint || '')
      );
    }

    // ─────────────────────────── 视图 1：总览（Overview） ───────────────────────────
    function OverviewView(props) {
      const { data, error, loading, refresh } = props.api;
      const [filter, setFilter] = React.useState('');
      const [copiedPath, setCopiedPath] = React.useState(null);

      if (loading && !data) {
        return h(SectionLoading, { label: '正在加载项目与经验数据…' });
      }
      if (error && !data) {
        return h('div', {
          className: 'srelay-card',
          style: { borderColor: 'var(--sr-danger)', padding: 20 },
        },
          h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 15, color: 'var(--sr-danger)', marginBottom: 6 } }, '无法连接 SessionRelay 服务'),
          h('div', { style: { fontSize: 12, marginBottom: 12 } }, error),
          h('button', { className: 'srelay-btn', onClick: refresh }, '重试连接')
        );
      }

      const t = (data && data.totals) || {};
      const wd = (data && data.watchdog) || {};
      // [1021] 全局守护是否活着 —— 离线徽章要用它区分「待命」与「离线」（见下方渲染处注释）
      const watchdogAlive = wd.online === true;
      const lc = (data && data.lifecycle) || {};
      const projects = (data && data.projects) || [];
      const errors = (data && data.errors) || [];
      const semantic = (data && data.semantic) || {};

      const maxSessions = Math.max(1, ...projects.map((p) => p.sessions || 0));
      const filteredProjects = projects.filter((p) => {
        if (!filter.trim()) return true;
        const q = filter.trim().toLowerCase();
        return p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q);
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // 错误广播横幅
        errors.length > 0 ? h('div', {
          className: 'srelay-card',
          style: { borderColor: 'var(--sr-warn)', background: 'var(--sr-surface)', padding: '12px 16px' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 12, color: 'var(--sr-warn)' } },
            h(Icon, { name: 'alert', size: 14, stroke: 'var(--sr-warn)' }),
            '提示：检测到 ' + errors.length + ' 处项目异常'
          ),
          h('ul', { style: { margin: '8px 0 0 18px', fontSize: 12, color: 'var(--sr-text)' } },
            errors.map((e, idx) => h('li', { key: idx }, e))
          )
        ) : null,

        // 遥测 HUD 指标网格（响应式）
        h('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' },
        },
          h(HudCard, { label: '01 / 对话总场次', value: n(t.sessions), hint: '已记录的对话场次', accent: 'var(--sr-accent)', icon: 'radar' }),
          h(HudCard, { label: '02 / 沉淀有效结论', value: n(t.decisions), hint: '提炼沉淀的有效结论', accent: 'var(--sr-text)', icon: 'check' }),
          h(HudCard, {
            label: '03 / 待决关键问题',
            value: n(t.unresolved),
            hint: '需关注：尚未形成结论的讨论点',
            title: '待决关键问题需人工关注：会话中提出的讨论点尚未闭环为有效结论，标黄提示优先处理',
            accent: 'var(--sr-warn)',
            icon: 'alert',
          }),
          h(HudCard, { label: '04 / 已归档正文', value: n(t.archived), hint: '已清理原始正文，保留结论', icon: 'layers' }),
          h(HudCard, { label: '05 / 可注入经验', value: n(data && data.lessons ? data.lessons.injectable : 0), hint: '可供新对话调用的经验', accent: 'var(--sr-accent)', icon: 'brain' }),
          h(HudCard, { label: '06 / 存储物理占用', value: mb(t.dbBytes), hint: '包含索引与缓存文件' })
        ),

        // 项目库排版矩阵（非对称网格）
        h('div', { className: 'srelay-card' },
          h('div', { className: 'srelay-card-header' },
            h('span', null, '已登记项目 (' + projects.length + ')'),
            h('div', { style: { position: 'relative', width: 'clamp(180px, 30vw, 260px)' } },
              h('input', {
                className: 'srelay-input',
                style: { width: '100%', paddingLeft: 28, fontSize: 11 },
                placeholder: '搜索项目名称或目录…',
                value: filter,
                onChange: (e) => setFilter(e.target.value),
              }),
              h('span', { style: { position: 'absolute', left: 8, top: 7, color: 'var(--sr-text-subtle)', pointerEvents: 'none' } },
                h(Icon, { name: 'search', size: 13 })
              )
            )
          ),
          filteredProjects.length === 0 ? h('div', { style: { padding: '2rem 0', textAlign: 'center', color: 'var(--sr-text-muted)', fontSize: 13 } },
            filter ? '未找到匹配的项目' : '暂无登记项目'
          ) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            filteredProjects.map((p) => {
              const pctWidth = Math.max(2, Math.round(((p.sessions || 0) / maxSessions) * 100));
              return h('div', {
                key: p.root,
                style: {
                  padding: '12px 16px',
                  background: 'var(--sr-surface)',
                  border: '1.5px solid var(--sr-border-subtle)',
                },
              },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 14, color: 'var(--sr-text)' } }, p.name),
                    p.daemonAlive
                      ? h('span', { className: 'srelay-badge srelay-badge-active', title: '后台服务运行正常' }, '在线')
                      // [1021 修「面板显示离线」] 原来只要本项目的 lock 不是新鲜的就标「离线」。
                      //   但守护有两种形态：本项目独占的，和 **--global 接管全部项目**的。
                      //   后者只给「有动静」的项目刷新锁文件 ⇒ 一个今天没动过的项目会永远显示「离线」，
                      //   而全局守护明明活着（实测：全局 watchdog online=true，但 work/mc整合包 标离线）。
                      //   这是**显示误导**，不是故障。改成三态：本项目锁新鲜 = 在线；否则看全局守护：
                      //   活着 = 「待命」（它会在你下次使用这个项目时接管），真没守护 = 「离线」。
                      : (watchdogAlive
                          ? h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-border-strong, var(--sr-text-faint))', color: 'var(--sr-text-muted)' }, title: '本项目最近没有活动，全局守护待命中——下次使用这个项目时会自动接管' }, '待命')
                          : h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-warn)', color: 'var(--sr-warn)' }, title: '后台服务未启动' }, '离线')),
                    p.ok ? null : h('span', {
                      className: 'srelay-badge',
                      style: { borderColor: 'var(--sr-danger)', color: 'var(--sr-danger)' },
                    }, p.error || '读取失败')
                  ),
                  h('div', { style: { display: 'flex', gap: 14, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' } },
                    h('span', null, h('strong', { style: { fontFamily: 'var(--sr-font-sans)' } }, n(p.sessions)), ' 场对话'),
                    h('span', null, h('strong', { style: { fontFamily: 'var(--sr-font-sans)' } }, n(p.decisions)), ' 条结论'),
                    h('span', null, h('strong', { style: { fontFamily: 'var(--sr-font-sans)' } }, n(p.unresolved)), ' 件待定'),
                    h('span', { style: { fontFamily: 'var(--sr-font-mono)' } }, mb(p.dbBytes)),
                    h('button', {
                      className: 'srelay-btn',
                      style: { padding: '2px 8px', fontSize: 11 },
                      onClick: () => {
                        props.onSelectProject && props.onSelectProject(p.root);
                      },
                    }, '查看与设置')
                  )
                ),
                // 实体比例标尺
                h('div', {
                  style: { height: 3, background: 'var(--sr-border-subtle)', margin: '10px 0 8px', overflow: 'hidden' },
                },
                  h('div', { style: { height: '100%', width: pctWidth + '%', background: 'var(--sr-text)' } })
                ),
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--sr-text-subtle)' } },
                  h('div', {
                    style: { cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', textDecoration: 'underline' },
                    title: '点击复制路径: ' + p.root,
                    onClick: () => copyText(p.root, (ok) => { if (ok) setCopiedPath(p.root); setTimeout(() => setCopiedPath(null), 2000); }),
                  },
                    copiedPath === p.root ? '✓ 路径已复制' : p.root
                  ),
                  h('span', null, '最近更新：' + (p.lastEventAt ? when(p.lastEventAt) : '无记录'))
                )
              );
            })
          )
        ),

        // 后台生命周期与语义看板
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' } },
          // 生命周期
          h('div', { className: 'srelay-card' },
            h('div', { className: 'srelay-card-header' },
              h('span', null, '后台维护任务'),
              h('span', { style: { fontSize: 11, fontFamily: 'var(--sr-font-sans)', color: wd.online ? 'var(--sr-text)' : 'var(--sr-warn)' } },
                wd.online ? '活跃: ' + ago(wd.ageMs) : '后台离线'
              )
            ),
            h('div', { style: { fontSize: 12, color: 'var(--sr-text-muted)', marginBottom: 12 } },
              '已执行 ' + n(lc.rounds) + ' 次 · 最近运行：' + when(lc.lastAt)
            ),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 } },
              (lc.stages || []).map((s) => {
                const isDue = (lc.dueNow || []).includes(s.id);
                return h('div', {
                  key: s.id,
                  style: {
                    padding: '8px 10px',
                    background: 'var(--sr-surface)',
                    border: '1px solid ' + (isDue ? 'var(--sr-text)' : 'var(--sr-border-subtle)'),
                  },
                },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                    h('strong', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 11 } }, s.label),
                    isDue ? h('span', { className: 'srelay-badge srelay-badge-active', style: { fontSize: 9 } }, '待运行') : null
                  ),
                  h('div', { style: { fontSize: 11, color: 'var(--sr-text-subtle)', marginTop: 4 } },
                    '每 ' + Math.round(s.everySec / 60) + ' 分钟' + (s.ms !== null ? ' · ' + s.ms + 'ms' : '')
                  )
                );
              })
            )
          ),

          // 语义检索增强
          h('div', { className: 'srelay-card' },
            h('div', { className: 'srelay-card-header' },
              h('span', null, '语义检索状态'),
              h('span', { className: 'srelay-badge' }, semantic.runtime && semantic.runtime.loaded ? '已加载' : '按需加载')
            ),
            h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--sr-text)', marginBottom: 8 } },
              semantic.summary || '未启用语义引擎'
            ),
            h('p', { style: { fontSize: 12, color: 'var(--sr-text-muted)', lineHeight: 1.6, margin: 0 } },
              semantic.note || '支持按项目单独配置语义检索。模型仅在检索时按需载入，空闲时自动释放内存。'
            )
          )
        ),

        // 口径解释抽屉
        h(CriteriaBox, { criteria: data && data.criteria })
      );
    }

    // ─────────────────────────── 视图 2：经验（Lessons） ───────────────────────────
    function LessonsView(props) {
      const { data, error, loading, refresh } = props.api;
      const [filter, setFilter] = React.useState('');
      const [statusFilter, setStatusFilter] = React.useState('all');
      const [gradeFilter, setGradeFilter] = React.useState('all');
      const [copiedId, setCopiedId] = React.useState(null);

      if (loading && !data) {
        return h(SectionLoading, { label: '正在加载经验库…' });
      }
      if (error && !data) {
        return h('div', { className: 'srelay-card', style: { borderColor: 'var(--sr-danger)', padding: 20 } },
          h('div', { style: { color: 'var(--sr-danger)', fontWeight: 700 } }, error),
          h('button', { className: 'srelay-btn', style: { marginTop: 10 }, onClick: refresh }, '重试')
        );
      }

      const items = (data && data.items) || [];
      const total = data ? data.total : 0;
      const injectable = data ? data.injectable : 0;
      const admissionRate = data ? data.admissionRate : 0;
      const threshold = data ? data.threshold : 0;
      const byStatus = (data && data.byStatus) || {};
      const byGrade = (data && data.byGrade) || {};

      const filtered = items.filter((item) => {
        if (statusFilter === 'injectable' && !item.injectable) return false;
        if (statusFilter === 'review' && !item.needsReview) return false;
        if (statusFilter !== 'all' && statusFilter !== 'injectable' && statusFilter !== 'review' && item.status !== statusFilter) return false;
        if (gradeFilter !== 'all' && item.grade !== gradeFilter) return false;
        if (filter.trim()) {
          const q = filter.trim().toLowerCase();
          return item.text.toLowerCase().includes(q) || (item.domain && item.domain.toLowerCase().includes(q));
        }
        return true;
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // 杂志引言块与标尺
        h('div', { className: 'srelay-card' },
          h('div', { className: 'srelay-card-header' },
            h('span', null, '跨项目经验池'),
            h('span', { style: { fontFamily: 'var(--sr-font-mono)' } }, '准入率: ' + pct(admissionRate))
          ),
          h('div', { className: 'srelay-blockquote' },
            '“状态为 verified 或 confirmed、定级非 inferred，且活力分 ≥ ' + threshold + ' 的经验，会自动注入新会话。”'
          ),
          // 准入指标比例条
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 } },
            h('span', null, '经验总数: ' + n(total) + ' 条'),
            h('span', null, '可注入: ' + n(injectable) + ' 条 (' + pct(admissionRate) + ')')
          ),
          h('div', { style: { height: 6, background: 'var(--sr-border-subtle)', overflow: 'hidden' } },
            h('div', { style: { height: '100%', width: pct(admissionRate), background: 'var(--sr-text)' } })
          )
        ),

        // 筛选栏
        h('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 16px',
            border: '1.5px solid var(--sr-border)',
            background: 'var(--sr-surface)',
          },
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 11, fontWeight: 800 } }, '筛选:'),
            h('select', {
              className: 'srelay-select',
              value: statusFilter,
              onChange: (e) => setStatusFilter(e.target.value),
            },
              h('option', { value: 'all' }, '全部状态 (' + total + ')'),
              h('option', { value: 'injectable' }, '可注入 (' + injectable + ')'),
              h('option', { value: 'review' }, '待复核 (' + (data ? data.needsReview : 0) + ')'),
              Object.keys(byStatus).map((st) => h('option', { key: st, value: st }, st + ' (' + byStatus[st] + ')'))
            ),
            h('select', {
              className: 'srelay-select',
              value: gradeFilter,
              onChange: (e) => setGradeFilter(e.target.value),
            },
              h('option', { value: 'all' }, '全部定级'),
              Object.keys(byGrade).map((gr) => h('option', { key: gr, value: gr }, '定级: ' + gr + ' (' + byGrade[gr] + ')'))
            )
          ),
          h('div', { style: { position: 'relative', width: 'clamp(180px, 28vw, 260px)' } },
            h('input', {
              className: 'srelay-input',
              style: { width: '100%', paddingLeft: 28 },
              placeholder: '搜索经验正文或领域…',
              value: filter,
              onChange: (e) => setFilter(e.target.value),
            }),
            h('span', { style: { position: 'absolute', left: 8, top: 7, color: 'var(--sr-text-subtle)', pointerEvents: 'none' } },
              h(Icon, { name: 'search', size: 13 })
            )
          )
        ),

        // 经验条目杂志卡片列表
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          filtered.length === 0 ? h('div', { className: 'srelay-card', style: { padding: '2.5rem', textAlign: 'center', color: 'var(--sr-text-muted)' } },
            '未找到匹配的经验。'
          ) : filtered.map((item) => h('div', {
            key: item.id,
            className: 'srelay-card',
            style: {
              borderLeft: item.injectable ? '4px solid var(--sr-text)' : '1.5px solid var(--sr-border)',
            },
          },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 } },
              h('div', { style: { flex: 1 } },
                h('div', { style: { fontSize: 14, lineHeight: 1.6, color: 'var(--sr-text)', marginBottom: 8 } },
                  item.text
                ),
                h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--sr-text-muted)', fontFamily: 'var(--sr-font-sans)' } },
                  h('span', { className: 'srelay-badge ' + (item.injectable ? 'srelay-badge-active' : '') },
                    item.injectable ? '● 可注入' : '○ 仅存档'
                  ),
                  item.needsReview ? h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-warn)', color: 'var(--sr-warn)' } }, '待复核') : null,
                  h('span', null, '定级: ' + item.grade),
                  h('span', null, '领域: ' + (item.domain || item.scope || '通用')),
                  h('span', null, '活力分: ' + item.live),
                  h('span', null, '命中: ' + item.hits + ' / 采纳: ' + item.uses),
                  h('span', null, '建于 ' + item.createdAt.slice(0, 10))
                )
              ),
              h('button', {
                className: 'srelay-btn',
                style: { padding: '3px 8px', fontSize: 10, flexShrink: 0 },
                title: '复制正文',
                onClick: () => copyText(item.text, (ok) => { if (ok) setCopiedId(item.id); setTimeout(() => setCopiedId(null), 1800); }),
              },
                h(Icon, { name: copiedId === item.id ? 'check' : 'copy', size: 11 }),
                copiedId === item.id ? '已复制' : '复制'
              )
            )
          ))
        ),

        // 口径
        h(CriteriaBox, { criteria: {
          '经验准入规则': '状态为 verified 或 confirmed、定级非 inferred，且活力分 ≥ ' + threshold + ' 的经验会自动注入新对话。活力分随时间衰减，长期未被命中的经验会自动移出注入队列。',
        } })
      );
    }

    // ─────────────────────────── 视图 3：压缩图谱（Compression） ───────────────────────────
    // ─────────────────────── 视图：知识图谱（Graph）───────────────────────
    //
    // 为什么不做力导向图：本库 5036 标签 / 44604 边。渲染它要图形库、1000 节点就卡，
    //   而且**用户从一团毛线球里看不出任何东西**。有信息量的只有三件：新鲜度、枢纽、追溯。
    //   所以这里做「统计 + 枢纽榜」，不做可视化玩具。
    // ───────────────────── 力导向图（[1021] 用户要的"蒲公英状/游离+连线"）─────────────────────
    // 为什么自己写而不用 d3：面板是自包含插件，不引第三方依赖（引了就要进 vendor，体积和供应链都变）。
    // 100 节点 / 1200 边的力模拟，纯 JS O(n²) 每帧一万次距离计算，现代浏览器毫秒级就够，不值得为它加库。
    //
    // 三道力：
    //   ① 斥力（所有节点两两相斥）—— 让它们散开、不糊成一坨，这是"蒲公英散开"的来源；
    //   ② 弹簧（有边的节点互相拉）—— 让共现的词聚成簇，这是"簇"的来源；
    //   ③ 向心（轻微拉向画布中心）—— 防止整张图飘出视野。
    // 阻尼 0.82 让它们慢慢停下来；拖动某个点时会对它周边的邻居"加热"，松开后重新收敛。
    function ForceGraph(props) {
      const nodes = props.nodes || [];
      const links = props.links || [];
      const wrapRef = React.useRef(null);
      const canvasRef = React.useRef(null);
      const simRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const hoverRef = React.useRef(null);
      const [hover, setHover] = React.useState(null);
      const [dragging, setDragging] = React.useState(false);
      const [size, setSize] = React.useState({ w: 800, h: 480 });

      // 尺寸跟随容器：面板宽度是可变的（侧栏收起/展开），写死尺寸会在窄屏炸掉。
      React.useEffect(() => {
        if (!wrapRef.current) return undefined;
        const el = wrapRef.current;
        const apply = () => {
          const w = Math.max(320, el.clientWidth || 800);
          setSize({ w, h: Math.round(Math.min(560, Math.max(380, w * 0.56))) });
        };
        apply();
        let ro = null;
        try { ro = new ResizeObserver(apply); ro.observe(el); } catch { window.addEventListener('resize', apply); }
        return () => {
          try { if (ro) ro.disconnect(); else window.removeEventListener('resize', apply); } catch {}
        };
      }, []);

      // ── 建图：节点、边、**膜桥**（把游离的小集团接回主体）──
      //
      // 用户要的是「蒲公英 + 细胞膜」那种感觉：主体有结构，游离的小团不是飘在外面不管，
      // 而是被一层"膜"轻轻牵着 —— 所以对每个**非主连通分量**和**零度节点**，
      // 找它最近的邻居连一条**弱桥**（弹簧系数只有正常边的 1/4，画成虚线）。
      // 不这么做的后果：孤立点只受向心力，会慢慢飘到边缘、被斥力推来推去，
      // 看起来像垃圾而不是结构。
      React.useEffect(() => {
        if (!nodes.length) return undefined;
        const maxS = Math.max(1, ...nodes.map((x) => x.sessions || 0));
        const N = nodes.map((nd, i) => {
          const ang = (i / nodes.length) * Math.PI * 2;
          const rad = Math.min(size.w, size.h) * 0.34;
          return {
            ...nd,
            x: size.w / 2 + Math.cos(ang) * rad * (0.55 + Math.random() * 0.6),
            y: size.h / 2 + Math.sin(ang) * rad * (0.55 + Math.random() * 0.6),
            vx: 0, vy: 0,
            fixed: false,
            phase: Math.random() * Math.PI * 2,   // 呼吸用的相位，让每个点节奏不同
            r: 4 + 14 * Math.sqrt((nd.sessions || 0) / maxS),
          };
        });
        const L = links.filter((l) => l.a < N.length && l.b < N.length).map((l) => ({ ...l }));

        // 连通分量 + 膜桥
        const deg = new Array(N.length).fill(0);
        for (const l of L) { deg[l.a]++; deg[l.b]++; }
        const parent = N.map((_, i) => i);
        const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
        for (const l of L) uni(l.a, l.b);
        const groups = new Map();
        for (let i = 0; i < N.length; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
        let mainRoot = null, mainSize = 0;
        for (const [r, g] of groups) if (g.length > mainSize) { mainSize = g.length; mainRoot = r; }
        const near = (from, pool) => {
          let best = -1, bd = Infinity;
          for (const j of pool) {
            if (j === from) continue;
            const dx = N[from].x - N[j].x, dy = N[from].y - N[j].y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = j; }
          }
          return best;
        };
        const bridges = [];
        if (mainRoot !== null) {
          const mainSet = groups.get(mainRoot);
          // [红队第二轮 P8 修] 去重：孤立点原本被**两个**循环各桥一次
          //   （分量循环给 w=0.25，零度循环又给 w=0.18）⇒ 双倍拉力 + 两条重叠虚线，
          //   与注释「每个游离分量只桥一条」自相矛盾。用一张 key 表保证一对端点只出现一次。
          const seen = new Set();
          const addBridge = (from, to, w) => {
            if (from < 0 || to < 0 || from === to) return;
            const k = Math.min(from, to) + '-' + Math.max(from, to);
            if (seen.has(k)) return;
            seen.add(k);
            bridges.push({ a: from, b: to, w });
          };
          for (const [r, g] of groups) {
            if (r === mainRoot) continue;
            // 每个游离分量只桥**一条**：桥多了会把小团整个吸平，反而没有"游离感"
            // 取分量里离主体最近的那个点作代表（单点分量就是它自己）
            const from = g.length === 1 ? g[0] : near(mainSet[0], g);
            const to = near(from, mainSet);
            addBridge(from, to, 0.25);
          }
          // 零度节点（完全没边的）也要牵一下，否则它们在边缘乱飘。
          // 上面那条循环已经把单点分量的孤立点桥过了，这里只兜**没有主体可桥**的极端情况。
          for (let i = 0; i < N.length; i++) {
            if (deg[i] !== 0) continue;
            addBridge(i, near(i, mainSet), 0.18);
          }
        }
        // deg / 标签集在**建图时**算好一次（不每帧排序）
        const maxS2init = Math.max(1, ...N.map((x) => x.sessions || 1));
        const labSet = new Set(N.map((x, i) => ({ i, s: x.sessions || 0 }))
          .sort((a, b) => b.s - a.s).slice(0, 22).map((x) => x.i));
        simRef.current = { nodes: N, links: L, bridges, deg, labSet, maxS2init, heat: 1 };
        // 重建 sim 时必须清拖拽状态：否则 dragRef 指着**已经不在新图里**的节点对象
        return () => { simRef.current = null; dragRef.current = null; };
      }, [nodes, links, size.w, size.h]);

      // hover 走 ref：放进绘制依赖会让每次悬停都重启 RAF（画面会一顿一顿的）
      React.useEffect(() => { hoverRef.current = hover; }, [hover]);

      // 画 + 跑物理
      React.useEffect(() => {
        const cv = canvasRef.current;
        const sim = simRef.current;
        if (!cv || !sim) return undefined;
        const ctx = cv.getContext('2d');
        if (!ctx) return undefined;
        const dpr = window.devicePixelRatio || 1;
        cv.width = Math.round(size.w * dpr);
        cv.height = Math.round(size.h * dpr);
        cv.style.width = size.w + 'px';
        cv.style.height = size.h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        let raf = 0;
        let alive = true;
        let frame = 0;
        const css = getComputedStyle(document.body);
        const accent = (css.getPropertyValue('--sr-accent') || '#5b8def').trim() || '#5b8def';
        const muted = (css.getPropertyValue('--sr-text-muted') || '#8b95a7').trim() || '#8b95a7';
        const border = (css.getPropertyValue('--sr-border') || 'rgba(128,128,128,.25)').trim() || 'rgba(128,128,128,.25)';

        // 边的曲率：用端点索引算一个稳定的小偏移 —— 直线会显得很"工程图"，
        // 微微弯一点更像生物结构；同一对端点每帧都得到同一个曲率（不会抖）。
        const curveOf = (a, b) => {
          const h = ((a * 73856093) ^ (b * 19349663)) >>> 0;
          return (((h % 1000) / 1000) - 0.5) * 0.34;
        };

        const tick = () => {
          if (!alive) return;
          frame++;
          const N = sim.nodes;
          const cx = size.w / 2, cy = size.h / 2;
          const hoverIdx = hoverRef.current;
          const deg = sim.deg || [];
          const labSet = sim.labSet || new Set();

          // ① 斥力：两两相斥（平方反比，封顶防爆）
          for (let i = 0; i < N.length; i++) {
            const a = N[i];
            for (let j = i + 1; j < N.length; j++) {
              const b = N[j];
              let dx = a.x - b.x, dy = a.y - b.y;
              let d2 = dx * dx + dy * dy;
              if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
              const d = Math.sqrt(d2);
              // 斥力按**两端度数**加权：100 个点却有 1200 条边时，纯 1/d² 会被弹簧压成一团
            // （实测：原参数下 100 点挤在画布 40% 区域、标签糊死）。度数高的点推得更开，
            // 天然把图分成几簇，比手工调阈值稳。
            const f = Math.min(9000, (2600 + 520 * (deg[i] + deg[j])) / d2) * sim.heat;
              const ux = dx / d, uy = dy / d;
              a.vx += ux * f / 10; a.vy += uy * f / 10;
              b.vx -= ux * f / 10; b.vy -= uy * f / 10;
            }
          }

          // ② 弹簧：有边的互相拉向理想长度；**膜桥**用更弱的系数
          const spring = (list, baseK) => {
            for (const l of list) {
              const a = N[l.a], b = N[l.b];
              if (!a || !b) continue;
              const dx = b.x - a.x, dy = b.y - a.y;
              const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              // 理想长度跟两端半径挂钩：大点之间留得宽一点，否则边会穿进圆里
              const ideal = 118 + (a.r + b.r) * 1.25;
              const k = baseK * Math.min(2.2, 1 + (l.w || 0) * 0.6);
              const f = (d - ideal) * k * sim.heat;
              const ux = dx / d, uy = dy / d;
              a.vx += ux * f; a.vy += uy * f;
              b.vx -= ux * f; b.vy -= uy * f;
            }
          };
          spring(sim.links, 0.011);
          spring(sim.bridges || [], 0.004);

          // ③ 向心（很弱）+ **呼吸** + 阻尼 + 积分
          //
          // 「Q弹」的三个来源：
          //   a) 阻尼从 0.82 提到 0.90 —— 保留速度惯性，不再"一碰就停"；
          //   b) heat 下限从 0.02 提到 0.09 —— 永远有一点点活力，不会彻底冻住；
          //   c) 每个点带一个相位不同的极小呼吸位移 —— 让静止时也在"活着"，但幅度小到不干扰读图。
          for (const p of N) {
            if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
            p.vx += (cx - p.x) * 0.00045 * sim.heat;
            p.vy += (cy - p.y) * 0.00045 * sim.heat;
            p.vx *= 0.90; p.vy *= 0.90;
            p.x += p.vx; p.y += p.vy;
            const pad = p.r + 6;
            if (p.x < pad) { p.x = pad; p.vx = Math.abs(p.vx) * 0.5; }
            if (p.x > size.w - pad) { p.x = size.w - pad; p.vx = -Math.abs(p.vx) * 0.5; }
            if (p.y < pad) { p.y = pad; p.vy = Math.abs(p.vy) * 0.5; }
            if (p.y > size.h - pad) { p.y = size.h - pad; p.vy = -Math.abs(p.vy) * 0.5; }
          }

          sim.heat *= 0.9965;
          if (sim.heat < 0.09) sim.heat = 0.09;

          // ── 绘制 ──
          ctx.clearRect(0, 0, size.w, size.h);

          // [红队第二轮 P6 修] 曲率算的是**下标**，不是节点对象 ——
          //   原写法 curveOf(Math.min(a,b), Math.max(a,b)) 传的是两个节点对象，
          //   Math.min(obj) = NaN → 位运算把 NaN 归成 0 → curv 恒为同一个值，
          //   于是"每条边曲率不同"这件事**从未发生**（实测三条边曲率全是 -0.17）。
          //   现在由调用方传下标进来。
          const drawEdge = (a, b, ia, ib) => {
            const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
            const curv = Number.isFinite(lo) && Number.isFinite(hi) ? curveOf(lo, hi) : 0;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const px = -dy * curv * 0.5, py = dx * curv * 0.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(mx + px, my + py, b.x, b.y);
            ctx.stroke();
          };

          // 膜桥：虚线、极淡 —— 表达"牵着，但没绑死"
          if (sim.bridges && sim.bridges.length) {
            ctx.save();
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = accent;
            for (const br of sim.bridges) {
              const A = sim.nodes[br.a], B = sim.nodes[br.b];
              if (!A || !B) continue;
              const hot = hoverIdx !== null && (hoverIdx === br.a || hoverIdx === br.b);
              ctx.globalAlpha = hot ? 0.5 : 0.10;
              ctx.lineWidth = hot ? 1.3 : 0.7;
              drawEdge(A, B, br.a, br.b);
            }
            ctx.restore();
            ctx.globalAlpha = 1;
          }

          // 边：权重映射成透明度与粗细（弱边几乎看不见，避免糊成一片）
          const maxW = Math.max(1, ...sim.links.map((l) => l.w || 1));
          for (const l of sim.links) {
            const A = sim.nodes[l.a], B = sim.nodes[l.b];
            if (!A || !B) continue;
            const t = Math.min(1, (l.w || 0) / maxW);
            const hot = hoverIdx !== null && (hoverIdx === l.a || hoverIdx === l.b);
            ctx.strokeStyle = hot ? accent : muted;
            ctx.globalAlpha = hot ? 0.6 : 0.07 + t * 0.24;
            ctx.lineWidth = hot ? 1.7 : 0.5 + t * 1.2;
            drawEdge(A, B, l.a, l.b);
          }
          ctx.globalAlpha = 1;

          // 节点
          const maxS2 = Math.max(1, ...sim.nodes.map((x) => x.sessions || 1));
          for (let i = 0; i < sim.nodes.length; i++) {
            const p = sim.nodes[i];
            const hot = hoverIdx === i;
            // 呼吸位移：±1.2px，频率跟相位走
            const breathe = Math.sin(frame * 0.012 + p.phase) * 1.2;
            const px = p.x + breathe * 0.6, py = p.y + breathe;
            // 光晕：让大点在深色底上也"浮"着
            const gr = ctx.createRadialGradient(px, py, 0, px, py, p.r * (hot ? 3.0 : 2.5));
            gr.addColorStop(0, hot ? accent : border);
            gr.addColorStop(1, 'transparent');
            ctx.fillStyle = gr;
            ctx.beginPath(); ctx.arc(px, py, p.r * (hot ? 3.0 : 2.5), 0, Math.PI * 2); ctx.fill();

            const t = Math.sqrt((p.sessions || 0) / maxS2);
            ctx.fillStyle = hot || p.fixed ? accent : muted;
            ctx.globalAlpha = 0.35 + t * 0.6;
            ctx.beginPath(); ctx.arc(px, py, p.r, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;

            // 拖拽中的点加一圈实线环，告诉用户"它现在是被你钉住的"
            if (p.fixed) {
              ctx.strokeStyle = accent; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.arc(px, py, p.r + 4, 0, Math.PI * 2); ctx.stroke();
              ctx.globalAlpha = 1;
            }

            // 只给"有分量"的点写标签，否则 100 个词条叠在一起什么都看不清
            // 标签只给**最大的 22 个**（sort 后取前 N），否则 100 个词条在密集区叠成一片
            // —— 实测按比例筛（0.16）在长尾分布下会放过 40+ 个，还是会糊。
            if (labSet.has(i) || hot || p.fixed) {
              ctx.fillStyle = hot ? accent : muted;
              ctx.globalAlpha = hot ? 1 : 0.85;
              ctx.font = (hot ? '600 ' : '') + Math.max(10, Math.min(13, 9 + p.r * 0.35)) + 'px system-ui, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(p.name || '').slice(0, 10), px, py - p.r - 8);
              ctx.globalAlpha = 1;
            }
          }

          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { alive = false; cancelAnimationFrame(raf); };
      }, [size.w, size.h, nodes, links]);

      // 命中测试：平方距离，命中半径放宽 1.8 倍（小点也能点到）
      const hitAt = (clientX, clientY) => {
        const sim = simRef.current, cv = canvasRef.current;
        if (!sim || !cv) return null;
        const rect = cv.getBoundingClientRect();
        const mx = clientX - rect.left, my = clientY - rect.top;
        let best = null, bestD = Infinity;
        sim.nodes.forEach((p, i) => {
          const dx = p.x - mx, dy = p.y - my;
          const d = dx * dx + dy * dy;
          const rad = p.r * 1.8;
          if (d < rad * rad && d < bestD) { bestD = d; best = i; }
        });
        return best === null ? null : { i: best, mx, my };
      };

      const onMove = (e) => {
        const sim = simRef.current;
        if (!sim) return;
        const d = dragRef.current;
        if (d) {
          const cv = canvasRef.current;
          if (!cv) return;
          const rect = cv.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          const p = d.node;                                    // 对象引用，不用下标（sim 重建后下标会指错人）
          if (!p || !sim.nodes.includes(p)) { dragRef.current = null; setDragging(false); return; }
          const now = performance.now();
          const dt = Math.max(8, now - d.t);
          // ⚠️ [1021 修「拖拽时张牙舞爪疯狂乱跳」]
          //   原写法 d.vx = (mx - p.x)/dt*16 —— 而 p.x 正是被鼠标**钉住**的位置，
          //   于是 (mx - p.x) 恒等于常量 -d.dx。拿常量除以每帧变化的 dt，
          //   "速度"每帧符号乱翻；松手时又把它当抛掷速度 → 节点被甩得满屏乱窜。
          //   正确口径：速度 = **鼠标这一帧移动了多远 / 这一帧多久**。
          d.vx = ((mx - d.lx) / dt) * 16;
          d.vy = ((my - d.ly) / dt) * 16;
          d.lx = mx; d.ly = my; d.t = now;
          p.x = mx + d.dx; p.y = my + d.dy;
          p.vx = 0; p.vy = 0;
          return;
        }
        const hit = hitAt(e.clientX, e.clientY);
        setHover(hit ? hit.i : null);
      };

      const onDown = (e) => {
        const sim = simRef.current;
        if (!sim) return;
        const hit = hitAt(e.clientX, e.clientY);
        if (!hit) return;
        const p = sim.nodes[hit.i];
        dragRef.current = {
          node: p,                                       // 对象引用（不是下标）
          dx: p.x - hit.mx, dy: p.y - hit.my,            // 抓住时的手-点偏移，保证按下不"跳一下"
          lx: hit.mx, ly: hit.my,                        // 上一帧鼠标位置（算速度用）
          vx: 0, vy: 0, t: performance.now(),
        };
        p.fixed = true;                       // 钉住：松手前不动
        sim.heat = Math.max(sim.heat, 0.9);   // 唤醒，邻居会跟着让位
        setDragging(true);
        e.preventDefault();
      };

      const onUp = () => {
        const sim = simRef.current, d = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        if (!sim || !d) return;
        const p = d.node;
        if (!p) return;
        p.fixed = false;
        // 甩出去：把拖拽末速度交给节点，配合 0.90 阻尼会"弹"回去而不是"吸"回去
        p.vx = Math.max(-40, Math.min(40, d.vx || 0)) * 0.9;
        p.vy = Math.max(-40, Math.min(40, d.vy || 0)) * 0.9;
        sim.heat = Math.max(sim.heat, 0.95);
      };

      const hovered = hover !== null ? nodes[hover] : null;

      if (!nodes.length) {
        return h('div', { className: 'srelay-card', style: { padding: '2rem', textAlign: 'center', color: 'var(--sr-text-muted)' } },
          '图谱还没建过 —— 让它跑几轮生命周期，或点上面的「重建标签」');
      }

      return h('div', { className: 'srelay-card', ref: wrapRef, style: { position: 'relative', overflow: 'hidden' } },
        h('canvas', {
          ref: canvasRef,
          onMouseMove: onMove,
          onMouseDown: onDown,
          onMouseUp: onUp,
          onMouseLeave: () => { setHover(null); if (dragRef.current) onUp(); },
          style: { display: 'block', width: '100%', cursor: dragging ? 'grabbing' : (hovered ? 'grab' : 'default'), touchAction: 'none' },
        }),
        hovered ? h('div', { style: {
          position: 'absolute', left: 12, bottom: 12, padding: '6px 10px', borderRadius: 6,
          background: 'var(--sr-bg, rgba(0,0,0,.55))', border: '1px solid var(--sr-border)',
          fontSize: 12, fontFamily: 'var(--sr-font-mono)',
        } }, hovered.name + ' · ' + hovered.sessions + ' 个会话' + (hovered.kind ? ' · ' + hovered.kind : '')) : null,
        h('div', { style: { position: 'absolute', right: 12, top: 10, fontSize: 11, color: 'var(--sr-text-muted)' } },
          nodes.length + ' 个标签 · ' + links.length + ' 条共现 · 虚线＝游离小团的膜桥'),
        h('div', { style: { position: 'absolute', left: 12, top: 10, fontSize: 11, color: 'var(--sr-text-muted)' } },
          '● 按住拖动可钉住节点 · 松手会弹回')
      );
    }

    function GraphView(props) {
      const projects = (props.projects || []).filter((p) => p.ok);
      const [root, setRoot] = React.useState(props.selectedRoot || (projects[0] && projects[0].root) || '');
      React.useEffect(() => {
        if (props.selectedRoot && props.selectedRoot !== root) setRoot(props.selectedRoot);
      }, [props.selectedRoot]);
      const { data, error, loading, at } = useApi('graph', root ? { root } : null, 15000);

      if (!projects.length) {
        return h('div', { className: 'srelay-card', style: { padding: '2.5rem', textAlign: 'center', color: 'var(--sr-text-muted)' } }, '暂无可用的项目库。');
      }
      if (loading) return h('div', { className: 'srelay-card', style: { padding: '2.5rem', textAlign: 'center', color: 'var(--sr-text-muted)' } }, '正在读取标签图谱…');
      if (error) return h('div', { className: 'srelay-card', style: { padding: '2.5rem', color: 'var(--sr-warn)' } }, '读取失败：' + (error.message || error));
      if (!data || !data.ok) {
        return h('div', { className: 'srelay-card', style: { padding: '2.5rem', color: 'var(--sr-text-muted)', lineHeight: 1.8 } }, (data && data.error) || '图谱还没建过。');
      }

      const st = data.stats || {};
      const stale = st.stale === true;
      const shownSessions = st.builtSessions === null || st.builtSessions === undefined ? st.sessions : st.builtSessions;
      const fmtAt = (s) => {
        if (!s) return '未知';
        const d = new Date(s);
        return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : String(s);
      };

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // ① 力导向图放最上面 —— 用户要的就是这个，统计数字往下挪。
        //   nodes/links 由 panelGraph 给出；空数组时组件自己显示「还没可画的标签关系」。
        h(ForceGraph, { nodes: data.nodes || [], links: data.links || [] }),
        // ② 统计：三项封顶。屏幕上东西越少，每一件越被看见。
        h('div', { className: 'srelay-card' },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 24 } },
            [['标签', n(st.tags)], ['共现关系', n(st.edges)], ['覆盖会话', n(shownSessions)]].map(([label, val]) =>
              h('div', { key: label },
                h('div', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 26, fontWeight: 700, lineHeight: 1.1 } }, String(val)),
                h('div', { style: { fontSize: 11, letterSpacing: '.06em', color: 'var(--sr-text-faint)', marginTop: 6 } }, label)
              )
            )
          ),
          // ② 新鲜度：图谱是生命周期的一个阶段（每天重建），过期必须看得见 —— 否则它会静默腐烂。
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--sr-border-subtle)' } },
            h('span', { style: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 6, background: stale ? 'var(--sr-warn)' : 'var(--sr-ok)' } }),
            h('span', { style: { fontSize: 13, color: 'var(--sr-text-muted)', lineHeight: 1.7 } },
              stale
                ? '与当前库不一致 —— 会话数变了但图谱没重建。生命周期每天会重建一次；急用可去「维护」里手动重建。'
                : '最近重建 ' + fmtAt(st.builtAt) + '，与当前库一致。'
            )
          )
        ),

        // ③ 枢纽榜：这才是「图」的价值 —— 看出什么东西串起了最多会话。
        h('div', { className: 'srelay-card' },
          h('div', { style: { fontSize: 11, letterSpacing: '.08em', color: 'var(--sr-text-faint)', marginBottom: 14 } }, '串联会话最多的标签'),
          (data.hubs && data.hubs.length)
            ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0 28px' } },
                data.hubs.map((t, i) => h('div', {
                  key: t.name + i,
                  style: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--sr-border-subtle)' },
                },
                  h('span', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 11, color: 'var(--sr-text-faint)', minWidth: 20 } }, String(i + 1).padStart(2, '0')),
                  h('span', { style: { flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
                  h('span', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 11, color: 'var(--sr-text-muted)' } }, n(t.sessions))
                ))
              )
            : h('div', { style: { fontSize: 13, color: 'var(--sr-text-muted)' } }, '还没有标签。')
        ),

        // ④ 诚实说明：图谱不参与检索。这句必须写在界面上 ——
        //   否则用户会以为它是检索增强，试两次没区别就以为系统坏了。
        h('div', { className: 'srelay-card', style: { fontSize: 12, lineHeight: 1.8, color: 'var(--sr-text-muted)' } }, data.roleNote || '')
      );
    }
    function CompressionView(props) {
      const projects = (props.projects || []).filter((p) => p.ok);
      const [root, setRoot] = React.useState(props.selectedRoot || (projects[0] && projects[0].root) || '');
      const [deep, setDeep] = React.useState(false);

      React.useEffect(() => {
        if (props.selectedRoot && props.selectedRoot !== root) {
          setRoot(props.selectedRoot);
        }
      }, [props.selectedRoot]);

      const { data, error, loading, refresh } = useApi('compression', root ? { root, deep } : null, 0);

      if (!projects.length) {
        return h('div', { className: 'srelay-card', style: { padding: '2.5rem', textAlign: 'center', color: 'var(--sr-text-muted)' } },
          '暂无可用的项目库。'
        );
      }

      const l0 = (data && data.l0) || {};
      const l2 = (data && data.l2) || {};
      const aging = (data && data.aging) || null;
      const layers = (data && data.layers) || [];

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // 控制条
        h('div', { className: 'srelay-card', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 12, fontWeight: 800 } }, '项目:'),
            h('select', {
              className: 'srelay-select',
              value: root,
              onChange: (e) => setRoot(e.target.value),
              style: { minWidth: 'clamp(200px, 30vw, 300px)' },
            },
              projects.map((p) => h('option', { key: p.root, value: p.root }, p.name + ' (' + p.sessions + ' 场会话)'))
            )
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', {
              className: 'srelay-btn ' + (deep ? 'srelay-btn-active' : ''),
              onClick: () => setDeep((d) => !d),
              title: deep ? '已开启完整测算' : '开启完整测算',
            },
              h(Icon, { name: 'radar', size: 13 }),
              deep ? '已开启完整测算' : '开启完整测算'
            ),
            h('button', { className: 'srelay-btn', onClick: refresh },
              h(Icon, { name: 'refresh', size: 12 }),
              '重新测算'
            )
          )
        ),

        // 加载占位保护（彻底消灭切 Tab 整块空白）
        loading && !data ? h(SectionLoading, { label: '正在测算压缩数据…' }) : null,

        data ? h(React.Fragment, null,
          // 五层架构透视
          h('div', { className: 'srelay-card' },
            h('div', { className: 'srelay-card-header' },
              h('span', null, '分层压缩机制'),
              h('span', { style: { fontSize: 11, color: 'var(--sr-text-muted)' } }, '存储优化机制')
            ),
            h('div', { style: { overflowX: 'auto' } },
              h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' } },
                h('thead', null,
                  h('tr', { style: { borderBottom: '2px solid var(--sr-border)', fontFamily: 'var(--sr-font-sans)', fontWeight: 800 } },
                    // [1021 修表格塌陷] 原来五列都没宽度约束，「处理规则」那列内容最长，
                    //   把剩余宽度全吃光 ⇒ 最后一列「节省空间」被压成**竖排单字**、数据行的「—」也看着像脱节的孤立符号。
                    //   修法：给四列定宽 + 最后一列 nowrap 右对齐，只让「处理规则」占弹性宽度。
                    h('th', { style: { padding: '8px 10px', width: 52 } }, '层级'),
                    h('th', { style: { padding: '8px 10px', width: 132 } }, '机制'),
                    h('th', { style: { padding: '8px 10px', width: 84 } }, '状态'),
                    h('th', { style: { padding: '8px 10px' } }, '处理规则'),
                    h('th', { style: { padding: '8px 10px', width: 76, whiteSpace: 'nowrap', textAlign: 'right' } }, '节省空间')
                  )
                ),
                h('tbody', null,
                  layers.map((l) => h('tr', {
                    key: l.id,
                    style: { borderBottom: '1px solid var(--sr-border-subtle)' },
                  },
                    h('td', { style: { padding: '10px 10px', fontFamily: 'var(--sr-font-mono)', fontWeight: 700 } }, l.id),
                    h('td', { style: { padding: '10px 10px', fontWeight: 600 } }, l.name),
                    h('td', { style: { padding: '10px 10px' } },
                      l.status === 'active' || l.status === 'on' ? h('span', { className: 'srelay-badge srelay-badge-active srelay-badge-status' }, '运行中')
                        : l.status === 'rejected' ? h('span', { className: 'srelay-badge srelay-badge-status', style: { borderColor: 'var(--sr-danger)', color: 'var(--sr-danger)' } }, '已停用')
                        : l.status === 'off' ? h('span', { className: 'srelay-badge srelay-badge-status', style: { borderColor: 'var(--sr-border-subtle)', color: 'var(--sr-text-subtle)' } }, '未启用')
                        : h('span', { className: 'srelay-badge srelay-badge-status' }, l.status)
                    ),
                    h('td', { style: { padding: '10px 10px', color: 'var(--sr-text-muted)' } }, l.note || l.rule || '—'),
                    h('td', { style: { padding: '10px 10px', fontFamily: 'var(--sr-font-mono)', whiteSpace: 'nowrap', textAlign: 'right', color: l.savings ? 'inherit' : 'var(--sr-text-faint)' } }, l.savings || '—')
                  ))
                )
              )
            )
          ),

          // L0 去重度量与 L2 归档雷达
          h('div', { className: 'srelay-grid-editorial' },
            // L0 详情
            h('div', { className: 'srelay-col-6' },
              h('div', { className: 'srelay-card', style: { height: '100%' } },
                h('div', { className: 'srelay-card-header' },
                  h('span', null, 'L0 逐字去重'),
                  h('span', { style: { fontFamily: 'var(--sr-font-mono)' } }, '重复项: ' + n(l0.dupEntries ?? l0.dupCount))
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '结论总数:'),
                    h('strong', null, n(l0.totalDecisions ?? l0.merged))
                  ),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '重复结论数:'),
                    h('strong', null, n(l0.dupEntries ?? l0.dupCount))
                  ),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '去重压缩率:'),
                    h('strong', null, pct(l0.dupRatio))
                  )
                )
              )
            ),

            // L2 归档雷达
            h('div', { className: 'srelay-col-6' },
              h('div', { className: 'srelay-card', style: { height: '100%' } },
                h('div', { className: 'srelay-card-header' },
                  h('span', null, 'L2 正文归档'),
                  h('span', { style: { fontFamily: 'var(--sr-font-mono)' } }, '已释放: ' + mb(l2.bytesFreed ?? l2.totalFreedBytes))
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 } },
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '已归档对话正文:'),
                    h('strong', null, n(l2.archived ?? l2.archivedSessions) + ' 场')
                  ),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '清理正文释放存储:'),
                    h('strong', null, mb(l2.bytesFreed ?? l2.totalFreedBytes))
                  ),
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--sr-border-subtle)' } },
                    h('span', null, '保留期保护门限:'),
                    h('strong', null, (aging ? aging.hotDays : 30) + ' 天（活跃度门限 0.667）')
                  )
                )
              )
            )
          ),

          // 口径
          h(CriteriaBox, { criteria: data.criteria })
        ) : null
      );
    }

    // ─────────────────────────── 视图 4：设置（Settings） ───────────────────────────
    // 覆盖核心清单全部 8 组前缀（含 compress），采用动态推导 + 预置元数据结合，绝不遗漏孤儿旋钮
    const GROUP_META = {
      capture: '01 / 采集设置 · 记录范围与目录',
      search: '02 / 检索设置 · 分词与时间范围',
      privacy: '03 / 隐私保护 · 排除与脱敏',
      identity: '04 / 身份标识 · 项目名称与作者',
      semantic: '05 / 语义检索 · 模型与匹配阈值',
      compress: '06 / 模型压缩 · 智能提炼与合并',
      archive: '07 / 自动归档 · 期限与清理节奏',
      recompute: '08 / 规则更新 · 重新计算间隔',
      // [1021] 新增：时间衰减。此前面板里根本没有这一组 —— 模块和配置都在，
      //   但用户看不到、也改不了（「模块做完 ≠ 功能做完」的又一次）。
      decay: '09 / 时间衰减 · 让近期的事排在前面',
    };

    function SettingsView(props) {
      const projects = (props.projects || []).filter((p) => p.ok);
      const [root, setRoot] = React.useState(props.selectedRoot || (projects[0] && projects[0].root) || '');
      const [searchQuery, setSearchQuery] = React.useState('');
      const [draft, setDraft] = React.useState({});
      const [saveStatus, setSaveStatus] = React.useState(null);

      React.useEffect(() => {
        if (props.selectedRoot && props.selectedRoot !== root) {
          setRoot(props.selectedRoot);
        }
      }, [props.selectedRoot]);

      React.useEffect(() => {
        setDraft({});
        setSaveStatus(null);
      }, [root]);

      const { data, error, loading, refresh } = useApi('config', root ? { root } : null, 0);

      const knobs = (data && data.knobs) || [];
      const dirtyCount = Object.keys(draft).length;

      // 动态从返回的 knobs 里提取全部前缀，保证无任何死角
      const dynamicPrefixes = Array.from(new Set(knobs.map((k) => k.path.split('.')[0])));
      const allPrefixes = dynamicPrefixes.length > 0 ? dynamicPrefixes : Object.keys(GROUP_META);

      const handleSave = async () => {
        if (!dirtyCount) return;
        setSaveStatus({ loading: true, msg: '正在保存配置…' });
        try {
          const res = await rpc('applyConfig', { root, patch: draft }, { post: true });
          if (!res.ok) {
            const rejectedDetail = (res.rejected || []).map((r) => r.path + ': ' + r.reason).join('; ');
            setSaveStatus({
              bad: true,
              msg: (res.error || '保存未通过') + (rejectedDetail ? ' (' + rejectedDetail + ')' : ''),
            });
            return;
          }
          let successText = '已保存 ' + res.changed.length + ' 项设置。';
          if (res.warnings && res.warnings.length) {
            successText += ' ⚠ 注意：' + res.warnings.join('；');
          }
          setSaveStatus({ bad: false, msg: successText });
          setDraft({});
          refresh();
        } catch (e) {
          setSaveStatus({ bad: true, msg: '保存失败: ' + String((e && e.message) || e) });
        }
      };

      if (!projects.length) {
        return h('div', { className: 'srelay-card', style: { padding: '2.5rem', textAlign: 'center', color: 'var(--sr-text-muted)' } },
          '未检测到项目，无法进行设置。'
        );
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // 控制条
        h('div', { className: 'srelay-card', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 12, fontWeight: 800 } }, '目标项目:'),
            h('select', {
              className: 'srelay-select',
              value: root,
              onChange: (e) => setRoot(e.target.value),
              style: { minWidth: 'clamp(200px, 30vw, 300px)' },
            },
              projects.map((p) => h('option', { key: p.root, value: p.root }, p.name))
            ),
            h('span', { style: { fontSize: 11, color: 'var(--sr-text-subtle)', fontFamily: 'var(--sr-font-mono)' } },
              data ? data.configFile : ''
            )
          ),
          h('div', { style: { position: 'relative', width: 'clamp(180px, 28vw, 260px)' } },
            h('input', {
              className: 'srelay-input',
              style: { width: '100%', paddingLeft: 28 },
              placeholder: '搜索设置项或键名…',
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
            }),
            h('span', { style: { position: 'absolute', left: 8, top: 7, color: 'var(--sr-text-subtle)', pointerEvents: 'none' } },
              h(Icon, { name: 'search', size: 13 })
            )
          )
        ),

        // 浮动修改暂存条（强提示、一眼可辨的写回按钮）
        dirtyCount > 0 ? h('div', {
          className: 'srelay-card',
          style: {
            background: 'var(--sr-text)',
            color: 'var(--sr-bg)',
            borderColor: 'var(--sr-text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 18px',
          },
        },
          h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 13, fontWeight: 700 } },
            '已修改 ' + dirtyCount + ' 项设置，尚未保存'
          ),
          h('div', { style: { display: 'flex', gap: 10 } },
            h('button', {
              className: 'srelay-btn',
              style: { background: 'transparent', color: 'var(--sr-bg)', borderColor: 'var(--sr-bg)' },
              onClick: () => setDraft({}),
            }, '放弃修改'),
            h('button', {
              className: 'srelay-btn',
              style: { background: 'var(--sr-bg)', color: 'var(--sr-text)', borderColor: 'var(--sr-bg)' },
              onClick: handleSave,
            }, '保存设置')
          )
        ) : null,

        // 状态反馈
        saveStatus ? h('div', {
          className: 'srelay-card',
          style: {
            borderColor: saveStatus.bad ? 'var(--sr-danger)' : 'var(--sr-text)',
            padding: '12px 16px',
            fontSize: 12,
          },
        },
          saveStatus.msg
        ) : null,

        loading && !data ? h(SectionLoading, { label: '正在加载设置项…' }) : null,

        // 分组旋钮卡片
        data ? h(React.Fragment, null,
          allPrefixes.map((prefix) => {
            const list = knobs.filter((k) => {
              if (!k.path.startsWith(prefix + '.')) return false;
              if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase();
                return k.label.toLowerCase().includes(q) || k.path.toLowerCase().includes(q) || (k.hint && k.hint.toLowerCase().includes(q));
              }
              return true;
            });
            if (!list.length) return null;

            const groupTitle = GROUP_META[prefix] || (prefix + ' · 基础设置');

            return h('div', { key: prefix, className: 'srelay-card' },
              h('div', { className: 'srelay-card-header' },
                h('span', null, groupTitle),
                h('span', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 11, color: 'var(--sr-text-muted)' } }, list.length + ' 项')
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                list.map((k) => {
                  const curVal = k.path in draft ? draft[k.path] : k.value;
                  const isModified = k.path in draft;
                  const setVal = (v) => setDraft((d) => ({ ...d, [k.path]: v }));

                  let widget = null;
                  if (k.type === 'boolean') {
                    widget = h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 } },
                      h('input', {
                        type: 'checkbox',
                        checked: !!curVal,
                        onChange: (e) => setVal(e.target.checked),
                      }),
                      curVal ? '开启' : '关闭'
                    );
                  } else if (k.type === 'enum') {
                    widget = h('select', {
                      className: 'srelay-select',
                      value: String(curVal),
                      onChange: (e) => setVal(e.target.value),
                    },
                      (k.options || []).map((o) => h('option', { key: o, value: o }, o))
                    );
                  } else if (k.type === 'string-list') {
                    const selected = Array.isArray(curVal) ? curVal : [];
                    widget = h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                      (k.options || []).map((o) => h('label', { key: o, style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' } },
                        h('input', {
                          type: 'checkbox',
                          checked: selected.includes(o),
                          onChange: (e) => {
                            const next = e.target.checked ? [...selected, o] : selected.filter((x) => x !== o);
                            setVal(next);
                          },
                        }),
                        o
                      ))
                    );
                  } else if (k.type === 'number') {
                    widget = h('input', {
                      type: 'number',
                      className: 'srelay-input',
                      style: { width: 120 },
                      value: String(curVal ?? ''),
                      min: k.min,
                      max: k.max,
                      step: k.step || 1,
                      placeholder: k.hint ? '数值' : '输入数字…',
                      onChange: (e) => setVal(e.target.value === '' ? '' : Number(e.target.value)),
                    });
                  } else {
                    widget = h('input', {
                      type: 'text',
                      className: 'srelay-input',
                      style: { width: '100%', maxWidth: 320 },
                      value: String(curVal ?? ''),
                      placeholder: k.envVar ? ('$' + k.envVar) : '输入内容…',
                      onChange: (e) => setVal(e.target.value),
                    });
                  }

                  let sourceBadge = null;
                  if (isModified) {
                    sourceBadge = h('span', {
                      className: 'srelay-badge',
                      style: { borderColor: 'var(--sr-accent)', color: 'var(--sr-accent)', fontWeight: 800 },
                      title: k.source === 'default' ? '草稿已偏离默认值，点击上方「保存设置」生效' : '草稿已修改，点击上方「保存设置」生效',
                    }, k.source === 'default' ? '偏离默认' : '已修改');
                  } else if (k.source === 'env') {
                    sourceBadge = h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-warn)', color: 'var(--sr-warn)' }, title: '来自环境变量 ' + (k.envVar || '') }, '环境变量');
                  } else if (k.source === 'config') {
                    sourceBadge = h('span', { className: 'srelay-badge srelay-badge-active', title: '来自项目自定义配置' }, '项目配置');
                  } else {
                    sourceBadge = h('span', { className: 'srelay-badge', title: '当前使用核心最优默认值' }, '默认');
                  }

                  return h('div', {
                    key: k.path,
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      // 行距加宽（1021）：原来 12px/16px 太挤，和 13px 标题、11px 等宽副标题叠在一起
                      //   会糊成一团——用户反馈「输入框不明显、字段挤」。改成 18/20 + lineHeight。
                      gap: 18,
                      alignItems: 'flex-start',
                      padding: '18px 20px',
                      lineHeight: 1.6,
                      background: isModified ? 'var(--sr-surface-subtle)' : 'var(--sr-surface)',
                      border: '1.5px solid ' + (isModified ? 'var(--sr-text)' : 'var(--sr-border-subtle)'),
                    },
                  },
                    h('div', { style: { flex: '1 1 200px', minWidth: 200 } },
                      h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 13, color: 'var(--sr-text)' } }, k.label),
                      h('div', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 11, color: 'var(--sr-text-subtle)', marginTop: 2 } }, k.path)
                    ),
                    h('div', { style: { flex: '1 1 260px' } }, widget),
                    h('div', { style: { flex: '2 1 240px', fontSize: 12, color: 'var(--sr-text-muted)' } },
                      k.hint,
                      // ⚠ = 「这个值改了有风险，不是必填错误」。加 title 让鼠标悬停能看懂——
                      //   否则用户只看到一个感叹号，不知道是「坏了」还是「注意」。
                      k.warning ? h('div', {
                        style: { color: 'var(--sr-warn)', fontWeight: 600, marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' },
                        title: '注意：这不是错误，而是「改这个值有副作用」的提醒',
                      },
                        h('span', { 'aria-hidden': 'true' }, '⚠'),
                        h('span', null, k.warning)
                      ) : null
                    ),
                    h('div', { style: { flexShrink: 0 } }, sourceBadge)
                  );
                })
              )
            );
          })
        ) : null
      );
    }

    // ─────────────────────────── 视图 5：系统动作（Actions） ───────────────────────────
    function ActionsView(props) {
      const { data, error, loading, refresh } = props.api;
      const [applyWrite, setApplyWrite] = React.useState(false);
      const [activeOp, setActiveOp] = React.useState(null);
      const [result, setResult] = React.useState(null);
      const [copiedLog, setCopiedLog] = React.useState(false);

      const runAction = async (op) => {
        setActiveOp(op);
        setResult(null);
        try {
          const res = await rpc('run', { op, apply: applyWrite }, { post: true });
          setResult(res);
        } catch (e) {
          setResult({ ok: false, error: String((e && e.message) || e) });
        } finally {
          setActiveOp(null);
        }
      };

      if (loading && !data) {
        return h(SectionLoading, { label: '正在获取系统维护操作…' });
      }
      if (error && !data) {
        return h('div', { className: 'srelay-card', style: { borderColor: 'var(--sr-danger)', padding: 20 } }, error);
      }

      const actions = (data && data.actions) || [];
      const hasCli = !!(data && data.cli);

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
        // 顶部警示与保险锁
        h('div', { className: 'srelay-card' },
          h('div', { className: 'srelay-card-header' },
            h('span', null, '系统维护操作'),
            h('span', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 11 } }, '安全保护')
          ),
          h('div', { className: 'srelay-blockquote' },
            '“为防止误操作，涉及修改数据的操作默认处于保护状态，需先解锁才能执行。”'
          ),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 14 } },
            h('label', {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                border: '1.5px solid var(--sr-border)',
                background: applyWrite ? 'var(--sr-text)' : 'var(--sr-surface)',
                color: applyWrite ? 'var(--sr-bg)' : 'var(--sr-text)',
                cursor: 'pointer',
                fontFamily: 'var(--sr-font-sans)',
                fontSize: 12,
                fontWeight: 700,
                userSelect: 'none',
              },
            },
              h('input', {
                type: 'checkbox',
                checked: applyWrite,
                onChange: (e) => setApplyWrite(e.target.checked),
              }),
              h(Icon, { name: 'lock', size: 14, stroke: 'currentColor' }),
              applyWrite ? '保护锁已解除：允许写入数据' : '保护锁已开启：禁止写入操作'
            ),
            !hasCli ? h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-warn)', color: 'var(--sr-warn)' } },
              '命令行工具未就绪 · 暂不支持维护操作'
            ) : null
          )
        ),

        // 动作卡片清单
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          actions.map((act) => {
            const isWriting = act.writes;
            const isBlocked = isWriting && !applyWrite;
            const isCurrent = activeOp === act.id;

            return h('div', {
              key: act.id,
              className: 'srelay-card',
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              },
            },
              h('div', { style: { flex: '1 1 300px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  h('span', { style: { fontFamily: 'var(--sr-font-sans)', fontWeight: 800, fontSize: 14, color: 'var(--sr-text)' } }, act.title),
                  isWriting ? h('span', { className: 'srelay-badge', style: { borderColor: 'var(--sr-warn)', color: 'var(--sr-warn)' } }, '写入')
                    : h('span', { className: 'srelay-badge srelay-badge-active' }, '只读')
                ),
                h('div', { style: { fontSize: 12, color: 'var(--sr-text-muted)', marginTop: 4 } }, act.desc)
              ),
              h('button', {
                className: 'srelay-btn ' + (isWriting ? (applyWrite ? 'srelay-btn-danger' : '') : 'srelay-btn-primary'),
                disabled: !hasCli || isBlocked || activeOp !== null,
                title: isBlocked ? '此操作会修改数据，请先解除上方保护锁' : '',
                onClick: () => runAction(act.id),
              },
                isCurrent ? '正在执行…' : '执行'
              )
            );
          })
        ),

        // 控制台终端日志输出窗口
        result ? h('div', { className: 'srelay-card', style: { padding: 16 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--sr-font-sans)', fontSize: 12, fontWeight: 700 } },
              h(Icon, { name: result.ok ? 'check' : 'alert', size: 15, stroke: result.ok ? 'var(--sr-success)' : 'var(--sr-danger)' }),
              h('span', { style: { color: result.ok ? 'var(--sr-success)' : 'var(--sr-danger)' } },
                result.ok ? '执行成功' : '执行失败'
              ),
              result.durationMs !== undefined ? h('span', { style: { color: 'var(--sr-text-subtle)', marginLeft: 8 } },
                (result.durationMs / 1000).toFixed(2) + 's'
              ) : null
            ),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('button', {
                className: 'srelay-btn',
                style: { padding: '3px 8px', fontSize: 11 },
                onClick: () => copyText((result.out || '') + '\n' + (result.err || '') + '\n' + (result.error || ''), (ok) => {
                  if (ok) setCopiedLog(true);
                  setTimeout(() => setCopiedLog(false), 2000);
                }),
              },
                h(Icon, { name: copiedLog ? 'check' : 'copy', size: 11 }),
                copiedLog ? '已复制' : '复制输出'
              ),
              h('button', {
                className: 'srelay-btn',
                style: { padding: '3px 8px', fontSize: 11 },
                onClick: () => setResult(null),
              }, '清空')
            )
          ),
          h('pre', {
            style: {
              background: 'var(--sr-surface)',
              border: '1.5px solid var(--sr-border)',
              padding: '12px 14px',
              margin: 0,
              fontSize: 12,
              fontFamily: 'var(--sr-font-mono)',
              color: 'var(--sr-text)',
              maxHeight: 280,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            },
          },
            (result.out || '') + (result.err ? '\n[STDERR]\n' + result.err : '') + (result.error ? '\n[ERROR] ' + result.error : '') || '（无输出内容）'
          )
        ) : null
      );
    }

    // ─────────────────────────── 主控制台面板（Main Page） ───────────────────────────
    function MainPage() {
      ensureStyleSheet();
      const [tab, setTab] = React.useState('overview');
      const [selectedRoot, setSelectedRoot] = React.useState('');
      const [autoRefresh, setAutoRefresh] = React.useState(true);

      const ovApi = useApi('overview', {}, autoRefresh ? 15000 : 0);
      const lessonsApi = useApi('lessons', { limit: 300 }, autoRefresh ? 30000 : 0, tab === 'lessons');
      const actionsApi = useApi('actions', {}, 0, tab === 'actions');

      React.useEffect(() => {
        if (!selectedRoot && ovApi.data && ovApi.data.projects && ovApi.data.projects.length) {
          const firstOk = ovApi.data.projects.find((p) => p.ok);
          if (firstOk) setSelectedRoot(firstOk.root);
        }
      }, [selectedRoot, ovApi.data]);

      // 键盘导航：1-5 键切页，R 刷新
      React.useEffect(() => {
        const onKeyDown = (e) => {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;

          if (e.key === '1') setTab('overview');
          else if (e.key === '2') setTab('lessons');
          else if (e.key === '3') setTab('compression');
          else if (e.key === '4') setTab('settings');
          else if (e.key === '5') setTab('actions');
          else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            ovApi.refresh();
            if (tab === 'lessons') lessonsApi.refresh();
            if (tab === 'actions') actionsApi.refresh();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [tab, ovApi, lessonsApi, actionsApi]);

      const TABS = [
        { id: 'overview', label: '01 / 总览', keyNum: '1', icon: 'radar' },
        { id: 'lessons', label: '02 / 经验', keyNum: '2', icon: 'brain' },
        { id: 'compression', label: '03 / 压缩', keyNum: '3', icon: 'layers' },
        // [1021] 知识图谱：把「标签图」从只能 CLI 看的东西变成面板里能看的东西。
        { id: 'graph', label: '04 / 图谱', keyNum: '4', icon: 'network' },
        { id: 'settings', label: '05 / 设置', keyNum: '5', icon: 'sliders' },
        { id: 'actions', label: '06 / 维护', keyNum: '6', icon: 'terminal' },
      ];

      const projects = (ovApi.data && ovApi.data.projects) || [];

      return h('div', {
        className: 'srelay-root',
      },
        // 核心内边距包装层（响应式宽幅网格，非居中对称死板模板）
        h('div', {
          style: {
            padding: 'clamp(1.5rem, 3vw, 3rem) clamp(1rem, 4vw, 4rem)',
            maxWidth: '1440px',
            margin: '0 auto',
            width: '100%',
          },
        },
          // 杂志刊头（Masthead / Editorial Header）
          h('header', {
            style: {
              paddingBottom: '1.5rem',
              marginBottom: '1rem',
            },
          },
            h('div', { className: 'srelay-rule-heavy', style: { marginBottom: 12 } }),
            h('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                gap: 16,
              },
            },
              h('div', null,
                h('div', {
                  style: {
                    fontFamily: 'var(--sr-font-sans)',
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: 'var(--sr-text-muted)',
                    marginBottom: 4,
                  },
                },
                  'SESSIONRELAY 本地记忆管理'
                ),
                h('h1', {
                  style: {
                    margin: 0,
                    fontFamily: 'var(--sr-font-sans)',
                    fontSize: 'clamp(24px, 4vw, 36px)',
                    fontWeight: 900,
                    letterSpacing: '-0.03em',
                    lineHeight: 1.05,
                    color: 'var(--sr-text)',
                  },
                },
                  'SessionRelay 记忆台'
                )
              ),

              // 刊头右侧状态与操作
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                h('button', {
                  className: 'srelay-btn',
                  style: { fontSize: 11, padding: '4px 8px' },
                  onClick: () => setAutoRefresh((a) => !a),
                  title: '切换自动刷新',
                },
                  autoRefresh ? '● 自动刷新 (15s)' : '○ 暂停刷新'
                ),
                h('button', {
                  className: 'srelay-btn',
                  style: { padding: '4px 10px', fontSize: 11 },
                  onClick: () => {
                    ovApi.refresh();
                    if (tab === 'lessons') lessonsApi.refresh();
                    if (tab === 'actions') actionsApi.refresh();
                  },
                  title: '快捷键: R',
                },
                  h(Icon, { name: 'refresh', size: 12 }),
                  '刷新 [R]'
                )
              )
            ),

            // 杂志副标与首字下沉介绍
            h('div', { style: { marginTop: '1.25rem', fontSize: 13, color: 'var(--sr-text-muted)' } },
              h('span', { className: 'srelay-dropcap' }, 'S'),
              'essionRelay 汇集各客户端的对话记忆，展示会话沉淀、有效结论、可复用经验与存储状态。'
            ),
            h('div', { className: 'srelay-rule-light', style: { marginTop: 14 } })
          ),

          // 杂志栏目导航条
          h('nav', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1.5px solid var(--sr-border)',
              marginBottom: '2rem',
              flexWrap: 'wrap',
            },
          },
            h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              TABS.map((t) => h('button', {
                key: t.id,
                className: 'srelay-tab ' + (tab === t.id ? 'is-active' : ''),
                onClick: () => setTab(t.id),
                'aria-selected': tab === t.id,
                role: 'tab',
              },
                h(Icon, { name: t.icon, size: 13 }),
                t.label,
                h('span', { style: { fontFamily: 'var(--sr-font-mono)', fontSize: 10, opacity: 0.6 } }, '[' + t.keyNum + ']')
              ))
            ),
            h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 11, color: 'var(--sr-text-subtle)', padding: '6px 0' } },
              '按 1-5 键切换页面 · 按 R 键刷新'
            )
          ),

          // 主视图挂载（修复 Tab 切换的空白）
          h('main', null,
            tab === 'overview' ? h(OverviewView, {
              api: ovApi,
              onSelectProject: (pRoot) => {
                setSelectedRoot(pRoot);
                setTab('settings');
              },
            }) : null,

            tab === 'lessons' ? h(LessonsView, {
              api: lessonsApi,
            }) : null,

            tab === 'compression' ? h(CompressionView, {
              projects,
              selectedRoot,
            }) : null,

            tab === 'graph' ? h(GraphView, {
              projects,
              selectedRoot,
            }) : null,

            tab === 'settings' ? h(SettingsView, {
              projects,
              selectedRoot,
            }) : null,

            tab === 'actions' ? h(ActionsView, {
              api: actionsApi,
            }) : null
          )
        )
      );
    }

    // ─────────────────────────── 左栏图标组件（sidebar.panellist） ───────────────────────────
    function SidebarPanelIcon(props) {
      const s = (props && props.size) || 20;
      const active = props && props.active;
      return h('svg', {
        width: s,
        height: s,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: active ? 2.2 : 1.7,
        strokeLinecap: 'square',
        strokeLinejoin: 'miter',
        opacity: active ? 1 : 0.85,
        'aria-label': 'SessionRelay 记忆台',
      },
        h('rect', { x: 3, y: 3, width: 18, height: 18 }),
        h('line', { x1: '3', y1: '9', x2: '21', y2: '9' }),
        h('line', { x1: '9', y1: '21', x2: '9', y2: '9' }),
        h('line', { x1: '14', y1: '14', x2: '17', y2: '14' })
      );
    }

    // ─────────────────────────── 兜底抽屉（betterSidebar tab） ───────────────────────────
    function SideTab(props) {
      const onOpen = props && props.onOpen;
      const { data, error, loading } = useApi('overview', {}, 20000);

      if (loading && !data) return h('div', { style: { padding: 14, fontSize: 11, color: 'var(--sr-text-muted)' } }, '正在加载…');
      if (error && !data) return h('div', { style: { padding: 14, fontSize: 11, color: 'var(--sr-danger)' } }, '连接服务失败：' + error);

      const t = (data && data.totals) || {};
      const lessons = (data && data.lessons) || {};

      return h('div', { style: { padding: '16px 14px', fontSize: 12, color: 'inherit', fontFamily: 'var(--sr-font-serif)' } },
        h('div', { style: { fontFamily: 'var(--sr-font-sans)', fontSize: 22, fontWeight: 900, color: 'inherit' } }, n(t.sessions)),
        h('div', { style: { fontSize: 11, opacity: 0.75, marginTop: 2 } },
          '场对话 · ' + n(t.decisions) + ' 条结论 · ' + n(t.unresolved) + ' 件待定'
        ),
        h('div', { style: { marginTop: 14, fontWeight: 700, fontSize: 12, fontFamily: 'var(--sr-font-sans)' } },
          '可注入经验：' + n(lessons.injectable) + ' 条'
        ),
        h('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 } },
          (data && data.projects ? data.projects.slice(0, 5) : []).map((p) => h('div', {
            key: p.root,
            style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.85 },
          },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 } }, p.name),
            h('span', { style: { fontFamily: 'var(--sr-font-mono)' } }, n(p.sessions))
          ))
        ),
        h('button', {
          className: 'srelay-btn',
          style: { width: '100%', marginTop: 16, justifyContent: 'center' },
          onClick: () => onOpen && onOpen(),
        }, '打开记忆台')
      );
    }

    // ── 插件声明与导出 ──
    return {
      name: 'dsh-srelay-panel',
      inject: ['slots', 'layout'],
      apply(ctx) {
        try {
          // ① 左栏入口槽位：sidebar.panellist（list/root），id 寻址 main 的 key
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: '记忆台' },
            SidebarPanelIcon
          ));

          // ② 主面板槽位：main（keyed/root），使用同一个 id
          ctx.slots.inject('main', () => ctx.slots.register(
            { name: 'main', key: PANEL_ID },
            MainPage
          ));

          // ③ 兜底兼容：betterSidebar 右栏抽屉
          const bs = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : null;
          if (bs && typeof bs.registerTab === 'function') {
            ctx.effect(() => bs.registerTab({
              id: 'srelay-panel',
              title: '记忆台',
              description: '本机各项目的 SessionRelay 记忆（对话/结论/未决/经验）',
              order: 40,
              single: true,
              component: (p) => h(SideTab, {
                ...p,
                onOpen: () => {
                  try {
                    ctx.layout.selectPanel(PANEL_ID);
                  } catch (e) {
                    console.error('[srelay-panel] selectPanel 失败: ' + String((e && e.message) || e));
                  }
                },
              }),
            }));
          }
        } catch (e) {
          console.error('[srelay-panel] 客户端槽位注册失败: ' + String((e && e.message) || e));
        }
      },
    };
  },
});
