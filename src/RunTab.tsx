import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from './api';
import type { Toolchain } from './api';

interface OutputLine {
  seq: number;
  text: string;
  stream: 'out' | 'err' | 'sys';
}

interface RunState {
  runId: number;
  running: boolean;
  exitCode: number | null;
  killed: boolean;
}

const PRESETS: { label: string; cmd: string }[] = [
  { label: 'npm run dev', cmd: 'npm run dev' },
  { label: 'npm start', cmd: 'npm start' },
  { label: 'npm install', cmd: 'npm install' },
  { label: 'pnpm dev', cmd: 'pnpm dev' },
  { label: 'node app.js', cmd: 'node app.js' },
  { label: 'go run .', cmd: 'go run .' },
  { label: 'go build', cmd: 'go build' },
  { label: 'python main.py', cmd: 'python main.py' },
  { label: '自定义…', cmd: '' },
];

export function RunTab(props: {
  envPath: string | null;
  status: string;
  setStatus: (s: string) => void;
}) {
  const { envPath, status, setStatus } = props;

  const [command, setCommand] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [toolchains, setToolchains] = useState<Toolchain[]>([]);
  const seqRef = useRef(0);
  const nextRunId = useRef(1);
  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<Array<() => void>>([]);

  // 事件订阅（挂载一次）
  useEffect(() => {
    let disposed = false;
    (async () => {
      const u1 = await listen<{ run_id: number; line: string; stream: string }>('run-output', (ev) => {
        const s = ev.payload.stream as 'out' | 'err';
        setLines((prev) => [
          ...prev.slice(-2000),
          { seq: seqRef.current++, text: ev.payload.line, stream: s },
        ]);
      });
      const u2 = await listen<{ run_id: number; code: number | null; killed: boolean }>('run-exit', (ev) => {
        setRun((r) =>
          r && r.runId === ev.payload.run_id
            ? { ...r, running: false, exitCode: ev.payload.code, killed: ev.payload.killed }
            : r,
        );
        setLines((prev) => [
          ...prev,
          {
            seq: seqRef.current++,
            text: ev.payload.killed
              ? '— 已被手动终止 —'
              : `— 进程退出，code=${ev.payload.code ?? '?'} —`,
            stream: 'sys',
          },
        ]);
      });
      if (disposed) {
        u1();
        u2();
      } else {
        unlistenRef.current.push(u1, u2);
      }
    })();
    return () => {
      disposed = true;
      unlistenRef.current.forEach((f) => f());
      unlistenRef.current = [];
    };
  }, []);

  // 工具链探测
  useEffect(() => {
    api
      .detectToolchains()
      .then(setToolchains)
      .catch(() => setToolchains([]));
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // 默认工作目录 = .env 所在目录
  useEffect(() => {
    if (envPath && !workDir) {
      const i = envPath.lastIndexOf('\\');
      if (i > 0) setWorkDir(envPath.slice(0, i));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envPath]);

  const start = async () => {
    if (!command.trim()) {
      setStatus('请输入要运行的命令');
      return;
    }
    if (!envPath) {
      setStatus('请先在「文件 .env」页打开一个 .env 文件，其变量才会注入');
      return;
    }
    setLines([]);
    setRun({ runId: nextRunId.current, running: true, exitCode: null, killed: false });
    setStatus(`运行中：${command}`);
    try {
      await api.runInEnv(nextRunId.current, command.trim(), envPath, workDir.trim() || null);
      nextRunId.current += 1;
    } catch (err) {
      setRun(null);
      setLines((prev) => [...prev, { seq: seqRef.current++, text: `启动失败：${String(err)}`, stream: 'err' }]);
      setStatus(`启动失败：${String(err)}`);
    }
  };

  const stop = async () => {
    if (!run) return;
    try {
      await api.stopRun(run.runId);
    } catch {
      /* 进程可能已退出 */
    }
  };

  return (
    <div className="tab-body">
      <div className="toolbar">
        <input
          className="run-cmd"
          placeholder="命令，如 npm run dev / go run . / python main.py"
          value={command}
          spellCheck={false}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (!run || !run.running)) void start();
          }}
        />
        {run?.running ? (
          <button className="danger-solid" onClick={() => void stop()}>
            ■ 停止
          </button>
        ) : (
          <button className="primary" onClick={() => void start()}>
            ▶ 运行
          </button>
        )}
        <button onClick={() => setLines([])} disabled={!lines.length}>
          清空输出
        </button>
      </div>

      <div className="toolbar presets">
        <span className="preset-label">预设：</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="preset"
            onClick={() => {
              if (p.cmd) setCommand(p.cmd);
            }}
            title={p.cmd || '选择后自行输入'}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="run-meta">
        <span className="meta-chip" title="当前注入的 .env">
          环境文件：{envPath ?? '未打开（先去「文件 .env」页打开）'}
        </span>
        <span className="meta-chip" title="子进程工作目录">
          工作目录：
          <input
            className="workdir"
            value={workDir}
            spellCheck={false}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="默认为 .env 所在目录"
          />
        </span>
        <span className="meta-chip">
          可用工具：
          {toolchains.length
            ? toolchains.map((t) => (
                <span key={t.name} className={t.available ? 'tc-ok' : 'tc-no'}>
                  {t.name}{' '}
                </span>
              ))
            : '检测中…'}
        </span>
        {run?.running && <span className="dirty">运行中…</span>}
        {run && !run.running && (
          <span className="meta-chip">
            已退出 code={run.exitCode ?? '?'}
            {run.killed ? '（手动终止）' : ''}
          </span>
        )}
      </div>

      <div className="output-wrap" ref={outputRef}>
        {lines.length === 0 ? (
          <div className="output-empty">
            <p>
              在上方输入命令并点「▶ 运行」，将把 <b>.env</b> 的变量注入子进程环境后启动。
            </p>
            <p className="hint">
              规则：.env 变量与系统环境合并，同名时 .env 优先；只影响本次启动的进程，不写注册表。
            </p>
            <p className="hint">输出实时显示，npm / go / node / python 等命令直接可用。</p>
          </div>
        ) : (
          <pre className="output">
            {lines.map((l) => (
              <div key={l.seq} className={`ln ln-${l.stream}`}>
                {l.text}
              </div>
            ))}
          </pre>
        )}
      </div>

      <div className="statusbar">
        <span>{status}</span>
        <span className="spacer" />
        <span>同名变量 .env 覆盖系统 · 终止会结束整个进程树</span>
      </div>
    </div>
  );
}
