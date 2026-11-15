import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { RunTab } from './RunTab';
import { VaultTab } from './VaultTab';
import { api } from './api';
import type { EnvEntry, EnvFile, SystemEntry } from './api';

const SECRET_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE)/i;

function isSecret(key: string) {
  return SECRET_RE.test(key);
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------------- 文件标签页 ---------------- */

function FileTab(props: {
  envFile: EnvFile | null;
  entries: EnvEntry[];
  dirty: boolean;
  showSecrets: boolean;
  filter: string;
  status: string;
  setEntries: (e: EnvEntry[]) => void;
  setShowSecrets: (b: boolean) => void;
  setFilter: (s: string) => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onReveal: () => void;
}) {
  const {
    envFile, entries, dirty, showSecrets, filter, status,
    setEntries, setShowSecrets, setFilter,
    onOpen, onSave, onSaveAs, onNew, onImport, onExport, onReveal,
  } = props;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries.map((e, i) => ({ e, i }));
    return entries
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          e.key.toLowerCase().includes(f) ||
          e.value.toLowerCase().includes(f) ||
          (e.comment ?? '').toLowerCase().includes(f),
      );
  }, [entries, filter]);

  const upd = (i: number, patch: Partial<EnvEntry>) => {
    const next = entries.slice();
    next[i] = { ...next[i], ...patch };
    setEntries(next);
  };

  return (
    <div className="tab-body">
      <div className="toolbar">
        <button onClick={onNew}>新建</button>
        <button onClick={onOpen}>打开 .env</button>
        <button className="primary" onClick={onSave} disabled={!envFile}>
          保存{dirty ? ' ●' : ''}
        </button>
        <button onClick={onSaveAs}>另存为</button>
        <span className="sep" />
        <button onClick={onImport}>导入 JSON</button>
        <button onClick={onExport} disabled={!entries.length}>
          导出 JSON
        </button>
        <span className="sep" />
        <button onClick={() => setShowSecrets(!showSecrets)}>
          {showSecrets ? '🙈 隐藏密文' : '👁 显示密文'}
        </button>
        <button onClick={onReveal} disabled={!envFile}>
          在资源管理器中显示
        </button>
        <input
          className="filter"
          placeholder="筛选 key / value / 注释…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {!envFile ? (
        <div className="empty">
          <div className="empty-icon">⚙️</div>
          <p>尚未打开任何 .env 文件</p>
          <p className="hint">
            点击「打开 .env」选择文件，或「新建」从零开始；也可以直接把 .env 拖进窗口。
          </p>
        </div>
      ) : (
        <>
          <div className="file-meta">
            <span className="path" title={envFile.path}>
              {envFile.path}
            </span>
            <span className="meta">
              {entries.length} 项 · {envFile.encoding} · {fmtSize(envFile.size_bytes)}
            </span>
            {dirty && <span className="dirty">未保存</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-idx">#</th>
                  <th className="col-key">KEY</th>
                  <th className="col-val">VALUE</th>
                  <th className="col-comment">注释</th>
                  <th className="col-op"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ e, i }) => {
                  const secret = isSecret(e.key);
                  return (
                    <tr key={i} className={secret ? 'row-secret' : ''}>
                      <td className="col-idx">{i + 1}</td>
                      <td className="col-key">
                        <input
                          value={e.key}
                          spellCheck={false}
                          onChange={(ev) => upd(i, { key: ev.target.value })}
                        />
                      </td>
                      <td className="col-val">
                        <input
                          value={showSecrets || !secret ? e.value : '•'.repeat(Math.min(e.value.length, 24))}
                          spellCheck={false}
                          type={showSecrets || !secret ? 'text' : 'password'}
                          onChange={(ev) => upd(i, { value: ev.target.value })}
                        />
                        {secret && <span className="badge">密</span>}
                      </td>
                      <td className="col-comment">
                        <input
                          value={e.comment ?? ''}
                          placeholder="—"
                          onChange={(ev) => upd(i, { comment: ev.target.value || null })}
                        />
                      </td>
                      <td className="col-op">
                        <button
                          className="danger"
                          title="删除该行"
                          onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={5} className="no-match">
                      没有匹配「{filter}」的变量
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="toolbar bottom">
            <button
              onClick={() =>
                setEntries([...entries, { key: '', value: '', comment: null }])
              }
            >
              ＋ 添加变量
            </button>
          </div>
        </>
      )}

      <div className="statusbar">
        <span>{status}</span>
        <span className="spacer" />
        <span>Ctrl+S 保存 · 值支持引号 · 含 % 时写入 REG_EXPAND_SZ</span>
      </div>
    </div>
  );
}

/* ---------------- 系统变量标签页 ---------------- */

function SystemTab(props: {
  entries: SystemEntry[];
  dirtyNames: Set<string>;
  showSecrets: boolean;
  status: string;
  setShowSecrets: (b: boolean) => void;
  onRefresh: () => void;
  onAdd: () => void;
  onUpd: (name: string, value: string) => void;
  onCommit: (name: string, value: string) => void;
  onDelete: (name: string) => void;
  onBroadcast: () => void;
}) {
  const {
    entries, dirtyNames, showSecrets, status,
    setShowSecrets, onRefresh, onAdd, onUpd, onCommit, onDelete, onBroadcast,
  } = props;

  return (
    <div className="tab-body">
      <div className="toolbar">
        <button onClick={onRefresh}>↻ 刷新</button>
        <button onClick={onAdd}>＋ 新建变量</button>
        <span className="sep" />
        <button onClick={() => setShowSecrets(!showSecrets)}>
          {showSecrets ? '🙈 隐藏密文' : '👁 显示密文'}
        </button>
        <button className="primary" onClick={onBroadcast}>
          广播环境变更（新进程生效）
        </button>
      </div>

      <div className="file-meta">
        <span className="path">注册表 HKCU\Environment（仅当前用户）</span>
        {dirtyNames.size > 0 && <span className="dirty">{dirtyNames.size} 项未提交</span>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-idx">#</th>
              <th className="col-key">变量名</th>
              <th className="col-val">值</th>
              <th className="col-op"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const secret = isSecret(e.name);
              const dirty = dirtyNames.has(e.name);
              return (
                <tr key={e.name} className={dirty ? 'row-dirty' : ''}>
                  <td className="col-idx">{i + 1}</td>
                  <td className="col-key">
                    <input value={e.name} readOnly spellCheck={false} />
                  </td>
                  <td className="col-val">
                    <input
                      value={showSecrets || !secret ? e.value : '•'.repeat(Math.min(e.value.length, 24))}
                      type={showSecrets || !secret ? 'text' : 'password'}
                      spellCheck={false}
                      onChange={(ev) => onUpd(e.name, ev.target.value)}
                      onBlur={(ev) => {
                        if (ev.target.value !== e.value || dirty) onCommit(e.name, ev.target.value);
                      }}
                    />
                    {secret && <span className="badge">密</span>}
                  </td>
                  <td className="col-op">
                    <button className="danger" title="删除该变量" onClick={() => onDelete(e.name)}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="statusbar">
        <span>{status}</span>
        <span className="spacer" />
        <span>修改立即写注册表 · 已运行程序需重启才会读到新值</span>
      </div>
    </div>
  );
}

/* ---------------- 主应用 ---------------- */

export default function App() {
  const [tab, setTab] = useState<'file' | 'system' | 'run' | 'vault'>('file');
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [boot, setBoot] = useState(true);
  const [recent, setRecent] = useState<string[]>([]);
  const [envFile, setEnvFile] = useState<EnvFile | null>(null);
  const [entries, setEntriesState] = useState<EnvEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('就绪');

  const [sysEntries, setSysEntries] = useState<SystemEntry[]>([]);
  const [sysEdits, setSysEdits] = useState<Record<string, string>>({});
  const [sysLoaded, setSysLoaded] = useState(false);

  const setEntries = (e: EnvEntry[]) => {
    setEntriesState(e);
    setDirty(true);
  };

  /* 启动：读取状态并尝试加载最近文件 */
  useEffect(() => {
    (async () => {
      try {
        const s = await api.getState();
        setRecent(s.recent);
        if (s.current_path) {
          try {
            const f = await api.loadEnvFile(s.current_path);
            setEnvFile(f);
            setEntriesState(f.entries);
            setDirty(false);
            setStatus(`已打开 ${f.path}`);
          } catch (err) {
            setStatus(`自动打开失败：${String(err)}`);
          }
        }
      } catch (err) {
        setStatus(`初始化失败：${String(err)}`);
      } finally {
        setBoot(false);
      }
    })();
  }, []);

  const loadFile = useCallback(async (path: string) => {
    try {
      const f = await api.loadEnvFile(path);
      setEnvFile(f);
      setEntriesState(f.entries);
      setDirty(false);
      const r = await api.addRecent(path);
      setRecent(r);
      await api.setCurrentPath(path);
      setStatus(`已打开 ${path}`);
    } catch (err) {
      setStatus(`打开失败：${String(err)}`);
    }
  }, []);

  const onOpen = useCallback(async () => {
    const p = await openFileDialog({
      multiple: false,
      filters: [{ name: 'Env 文件', extensions: ['env', 'txt', 'conf'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (typeof p === 'string') await loadFile(p);
  }, [loadFile]);

  const doSave = useCallback(
    async (forceDialog: boolean) => {
      let target = envFile?.path;
      if (!target || forceDialog) {
        const p = await saveFileDialog({
          defaultPath: '.env',
          filters: [{ name: 'Env 文件', extensions: ['env'] }],
        });
        if (!p) return;
        target = p;
      }
      try {
        const f = await api.saveEnvFile(target, entries);
        setEnvFile(f);
        setEntriesState(f.entries);
        setDirty(false);
        const r = await api.addRecent(target);
        setRecent(r);
        await api.setCurrentPath(target);
        setStatus(`已保存 ${target}`);
      } catch (err) {
        setStatus(`保存失败：${String(err)}`);
      }
    },
    [envFile, entries],
  );

  /* Ctrl+S */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void doSave(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doSave]);

  /* 拖拽打开（Tauri v2 通过 onDragDropEvent 拿绝对路径） */
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    const un = getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type === 'drop') {
        const paths = ev.payload.paths;
        if (paths && paths.length > 0) void loadFile(paths[0]);
      }
    });
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
      void un.then((f) => f());
    };
  }, [loadFile]);

  /* 系统变量 */
  const refreshSystem = useCallback(async () => {
    try {
      const list = await api.listSystemEnv();
      setSysEntries(list);
      setSysEdits({});
      setSysLoaded(true);
      setStatus(`已读取 ${list.length} 个用户环境变量`);
    } catch (err) {
      setStatus(`读取失败：${String(err)}`);
    }
  }, []);

  useEffect(() => {
    if (tab === 'system' && !sysLoaded && !boot) void refreshSystem();
  }, [tab, sysLoaded, boot, refreshSystem]);

  const onImport = useCallback(async () => {
    const p = await openFileDialog({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof p !== 'string') return;
    try {
      const imported = await api.importJson(p);
      // 合并：同名覆盖，其余追加
      const map = new Map(entries.map((e) => [e.key, e]));
      for (const e of imported) map.set(e.key, e);
      const merged = [...map.values()];
      setEntries(merged);
      setStatus(`已从 ${p} 导入 ${imported.length} 项（合并后 ${merged.length} 项），记得保存`);
    } catch (err) {
      setStatus(`导入失败：${String(err)}`);
    }
  }, [entries]);

  const onExport = useCallback(async () => {
    const p = await saveFileDialog({
      defaultPath: 'env-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!p) return;
    try {
      await api.exportJson(p, entries);
      setStatus(`已导出 ${entries.length} 项到 ${p}`);
    } catch (err) {
      setStatus(`导出失败：${String(err)}`);
    }
  }, [entries]);

  if (boot) {
    return <div className="boot">加载中…</div>;
  }

  const sysDirty = new Set(Object.keys(sysEdits));

  return (
    <div className="app">
      <header className="titlebar">
        <div className="logo">🔧 Env Manager</div>
        <nav className="tabs">
          <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
            文件 .env
          </button>
          <button className={tab === 'system' ? 'active' : ''} onClick={() => setTab('system')}>
            系统环境变量
          </button>
          <button className={tab === 'run' ? 'active' : ''} onClick={() => setTab('run')}>
            运行
          </button>
          <button className={tab === 'vault' ? 'active' : ''} onClick={() => setTab('vault')}>
            配置库
          </button>
        </nav>
        <div className="recent">
          <select
            value=""
            onChange={(e) => {
              const p = e.target.value;
              if (p === '__clear__') {
                api.clearRecent().then(setRecent);
              } else if (p) {
                void loadFile(p);
              }
            }}
          >
            <option value="">最近打开…</option>
            {recent.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {recent.length > 0 && <option value="__clear__">— 清空记录 —</option>}
          </select>
        </div>
      </header>

      {tab === 'file' ? (
        <FileTab
          envFile={envFile}
          entries={entries}
          dirty={dirty}
          showSecrets={showSecrets}
          filter={filter}
          status={status}
          setEntries={setEntries}
          setShowSecrets={setShowSecrets}
          setFilter={setFilter}
          onOpen={onOpen}
          onSave={() => void doSave(false)}
          onSaveAs={() => void doSave(true)}
          onNew={() => {
            setEnvFile(null);
            setEntriesState([]);
            setDirty(true);
            setStatus('新建空文件，点「保存」选择位置');
          }}
          onImport={() => void onImport()}
          onExport={() => void onExport()}
          onReveal={() => {
            if (envFile) void api.revealInExplorer(envFile.path);
          }}
        />
      ) : tab === 'system' ? (
        <SystemTab
          entries={sysEntries}
          dirtyNames={sysDirty}
          showSecrets={showSecrets}
          status={status}
          setShowSecrets={setShowSecrets}
          onRefresh={() => void refreshSystem()}
          onAdd={async () => {
            const name = window.prompt('新变量名：');
            if (!name) return;
            try {
              await api.setSystemEnv(name, '');
              await refreshSystem();
              setStatus(`已创建 ${name}`);
            } catch (err) {
              setStatus(`创建失败：${String(err)}`);
            }
          }}
          onUpd={(name, value) => setSysEdits((m) => ({ ...m, [name]: value }))}
          onCommit={async (name, value) => {
            try {
              await api.setSystemEnv(name, value);
              setSysEntries((list) => list.map((e) => (e.name === name ? { ...e, value } : e)));
              setSysEdits((m) => {
                const n = { ...m };
                delete n[name];
                return n;
              });
              setStatus(`已写入 ${name}`);
            } catch (err) {
              setStatus(`写入失败：${String(err)}`);
              await refreshSystem();
            }
          }}
          onDelete={async (name) => {
            if (!window.confirm(`确认删除环境变量「${name}」？此操作立即生效且不可撤销。`)) return;
            try {
              await api.deleteSystemEnv(name);
              await refreshSystem();
              setStatus(`已删除 ${name}`);
            } catch (err) {
              setStatus(`删除失败：${String(err)}`);
            }
          }}
          onBroadcast={async () => {
            try {
              await api.refreshEnvBroadcast();
              setStatus('已广播 WM_SETTINGCHANGE，新启动的程序将读取最新环境');
            } catch (err) {
              setStatus(`广播失败：${String(err)}`);
            }
          }}
        />
      ) : tab === 'vault' ? (
        <VaultTab
          entries={entries}
          currentName={vaultName}
          setCurrentName={setVaultName}
          setEntries={(e) => {
            setEntriesState(e);
            setDirty(true);
          }}
          status={status}
          setStatus={setStatus}
          markClean={() => setDirty(false)}
        />
      ) : (
        <RunTab envPath={envFile?.path ?? null} status={status} setStatus={setStatus} />
      )}
    </div>
  );
}
