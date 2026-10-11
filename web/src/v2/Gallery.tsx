import { useEffect, useRef, useState } from 'react';

/* 评审画廊：同一套原型在固定窗口尺寸下的关键状态。
   每张都是可交互的真实页面（iframe），不是静态图片。 */

interface Shot {
  title: string;
  note: string;
  url: string;
  w: number;
  h: number;
}

const SHOTS: Shot[] = [
  {
    title: '1 · 进入项目',
    note: '内容不多时：项目名、一句当前重点、一个「继续上次的工作」入口，然后是需要你处理的 3 件事。没有统计卡片，没有图表。',
    url: '?shot=1#/',
    w: 1440,
    h: 900,
  },
  {
    title: '2 · 任务执行（辅助面板关闭，专注）',
    note: '正文固定 760px 阅读宽度居中。工具活动折叠成一句话，失败的那条命令仍然可见。运行状态与中止放在输入框上方，与发送分开。',
    url: '?shot=1#/task/t142',
    w: 1440,
    h: 900,
  },
  {
    title: '2b · 等待你确认',
    note: '写入请求就地出现：动作、理由、影响范围、文件列表全部可见，不折叠。输入框上方的状态行同步说明执行已暂停。',
    url: '?shot=1#/task/t143',
    w: 1440,
    h: 900,
  },
  {
    title: '3 · 同一任务打开辅助面板（文件）',
    note: '面板以 400px 打开在主区右侧，主区让出空间。对话的阅读宽度不变，只是两侧留白变少。侧栏仍然展开。',
    url: '?shot=1&aux=files#/task/t142',
    w: 1440,
    h: 900,
  },
  {
    title: '3b · 拖宽辅助面板到 560px 之后',
    note: '主区余量不足以同时放下展开的侧栏，侧栏自动退为图标轨（用户偏好不变，窗口变大后恢复）。正文宽度仍保持可读。',
    url: '?shot=1&aux=details&auxw=560#/task/t142',
    w: 1440,
    h: 900,
  },
  {
    title: '4 · 代码审查',
    note: '进入审查时侧栏默认收为图标轨，代码获得主要空间；并排 diff。底部决策条：检查结果一句话（2 项未运行写明）+ 要求修改 / 接受结果。',
    url: '?shot=1#/task/t144/review',
    w: 1440,
    h: 900,
  },
  {
    title: '4b · 审查 + 检查证据面板',
    note: '点击底部检查摘要打开检查面板：真实命令、退出码、耗时；未运行的写明原因，不画成通过。',
    url: '?shot=1&aux=checks#/task/t144/review',
    w: 1440,
    h: 900,
  },
  {
    title: '5 · 智能体管理',
    note: '按引擎分组，任务分派给「实例」。Codex 已接入的两个实例各自显示真实可用性；能力矩阵只引用有运行证据的条目。Claude Code、DeepSeek Harness 在虚线的「规划中」区域，无法被选中。',
    url: '?shot=1#/agents',
    w: 1440,
    h: 900,
  },
  {
    title: '6 · 1280 × 800：执行 + 辅助面板',
    note: '同样打开面板，空间不够同时放下侧栏，侧栏自动收起；面板与主区并排保留。',
    url: '?shot=1&aux=details#/task/t142',
    w: 1280,
    h: 800,
  },
  {
    title: '7 · 1024 × 720：较小窗口的取舍',
    note: '审查视图：侧栏为图标轨，检查面板改为浮层盖在 diff 上（Esc 关闭），文件列表收起为 diff 顶部的入口，diff 切为统一视图。没有任何区域被压到不可用。',
    url: '?shot=1&aux=checks&files=0&diff=unified#/task/t144/review',
    w: 1024,
    h: 720,
  },
];

function Frame({ s, scale }: { s: Shot; scale: number }) {
  return (
    <div className="frame-wrap" style={{ width: s.w * scale, height: s.h * scale }}>
      <iframe
        title={s.title}
        src={s.url}
        width={s.w}
        height={s.h}
        style={{ transform: `scale(${scale})` }}
        loading="lazy"
      />
    </div>
  );
}

export function Gallery() {
  const ref = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(1200);
  useEffect(() => {
    const on = () => setCw((ref.current?.clientWidth ?? 1264) - 64);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  return (
    <div className="gallery" ref={ref}>
      <h1>AgentDesk · 视觉与布局样稿</h1>
      <p style={{ color: 'var(--text-2)', margin: 0, fontSize: 13 }}>
        以下每一帧都是可点击的原型页面，按标注的窗口尺寸渲染后等比缩小。全部为演示数据。
        直接打开 <a href="./">原型</a> 可以完整操作；旧版原型保留在 <a href="./v1.html">v1.html</a>。
      </p>
      {SHOTS.map((s) => (
        <section key={s.title} className="shot">
          <h2>
            {s.title}
            <span className="meta" style={{ fontWeight: 400, marginLeft: 8 }}>
              {s.w} × {s.h}
            </span>
          </h2>
          <p>{s.note}</p>
          <Frame s={s} scale={Math.min(1, cw / s.w)} />
        </section>
      ))}
    </div>
  );
}
