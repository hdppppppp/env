import { useEffect, useState } from 'react';
import { save as saveFileDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { api } from './api';
import type { EnvEntry, VaultInfo } from './api';

export function VaultTab(props: {
  entries: EnvEntry[];
  currentName: string | null;
  setCurrentName: (n: string | null) => void;
  setEntries: (e: EnvEntry[]) => void;
  status: string;
  setStatus: (s: string) => void;
  markClean: () => void;
}) {
  const { entries, currentName, setCurrentName, setEntries, status, setStatus, markClean } = props;

  const [projects, setProjects] = useState<string[]>([]);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setProjects(await api.listProjects());
      setInfo(await api.vaultInfo());
    } catch (err) {
      setStatus(`读取配置库失败：${String(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToVault = async () => {
    let name = currentName;
    if (!name) {
      const input = window.prompt('存入配置库的项目名（字母数字-_.）：');
      if (!input) return;
      name = input.trim();
    }
    if (!entries.length) {
      setStatus('当前没有可保存的变量');
      return;
    }
    try {
      await api.saveProject(name, entries);
      setCurrentName(name);
      await refresh();
      setStatus(`已加密存入配置库：${name}（${entries.length} 项）`);
    } catch (err) {
      setStatus(`存入失败：${String(err)}`);
    }
  };

  const loadFromVault = async (name: string) => {
    try {
      const es = await api.loadProject(name);
      setEntries(es);
      setCurrentName(name);
      markClean();
      setStatus(`已从配置库解密载入：${name}（${es.length} 项）`);
    } catch (err) {
      setStatus(`载入失败：${String(err)}`);
    }
  };

  const delProject = async (name: string) => {
    if (!window.confirm(`确认从配置库删除「${name}」？加密数据将被移除，不可恢复。`)) return;
    try {
      await api.deleteProject(name);
      if (currentName === name) setCurrentName(null);
      await refresh();
      setStatus(`已删除 ${name}`);
    } catch (err) {
      setStatus(`删除失败：${String(err)}`);
    }
  };

  const importFile = async () => {
    const p = await openFileDialog({
      multiple: false,
      filters: [{ name: 'Env 文件', extensions: ['env', 'txt'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (typeof p !== 'string') return;
    const name = window.prompt('导入为配置库项目名：');
    if (!name) return;
    try {
      await api.importProject(name.trim(), p);
      await refresh();
      setStatus(`已导入 ${p} → 配置库 ${name.trim()}（已加密）`);
    } catch (err) {
      setStatus(`导入失败：${String(err)}`);
    }
  };

  const exportFile = async (name: string) => {
    const p = await saveFileDialog({
      defaultPath: `${name}.env`,
      filters: [{ name: 'Env 文件', extensions: ['env'] }],
    });
    if (!p) return;
    try {
      await api.exportProject(name, p);
      setStatus(`已解密导出：${name} → ${p}`);
    } catch (err) {
      setStatus(`导出失败：${String(err)}`);
    }
  };

  /* ===== 换机器迁移：密码加密导出 / 导入 ===== */

  const migrateExport = async () => {
    const dest = await saveFileDialog({
      defaultPath: 'env-vault-backup.emvault',
      filters: [{ name: 'Env Manager 迁移包', extensions: ['emvault'] }],
    });
    if (!dest) return;
    const pwd = window.prompt('设置迁移包密码（至少 6 位，新机器导入时要输入同一个）：');
    if (!pwd) return;
    setBusy(true);
    try {
      const n = await api.migrateExport(dest, pwd);
      setStatus(`✅ 已导出迁移包（${n} 个项目，密码加密）→ ${dest}`);
    } catch (err) {
      setStatus(`导出失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const migrateImport = async () => {
    const src = await openFileDialog({
      multiple: false,
      filters: [{ name: 'Env Manager 迁移包', extensions: ['emvault'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (typeof src !== 'string') return;
    const pwd = window.prompt('输入迁移包密码：');
    if (pwd === null) return;
    setBusy(true);
    try {
      const n = await api.migrateImport(src, pwd);
      await refresh();
      setStatus(`✅ 已从迁移包导入 ${n} 个项目（同名覆盖），已合并进本机加密库`);
    } catch (err) {
      setStatus(`导入失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab-body">
      <div className="toolbar">
        <button className="primary" onClick={() => void saveToVault()}>
          🔐 将当前编辑存入配置库{currentName ? `（${currentName}）` : ''}
        </button>
        <button onClick={() => void importFile()}>导入 .env 文件入库</button>
        <span className="sep" />
        <button disabled={busy} onClick={() => void migrateExport()}>
          📦 导出迁移包（换机器）
        </button>
        <button disabled={busy} onClick={() => void migrateImport()}>
          📥 导入迁移包
        </button>
        <span className="sep" />
        <button onClick={() => void refresh()}>↻ 刷新</button>
      </div>

      <div className="file-meta">
        <span className="path" title={info?.file}>
          加密库：{info ? info.file : '…'} {info ? `(${info.size_bytes} B)` : ''}
        </span>
        {info && (
          <span className="meta" title="密钥文件指纹（前 12 位）">
            密钥 {info.key_sha256.slice(0, 12)}…
          </span>
        )}
      </div>

      <div className="table-wrap">
        {projects.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🔐</div>
            <p>配置库为空</p>
            <p className="hint">
              在「文件 .env」页编辑好后点「存入配置库」，或在上面导入现有 .env 文件。
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-idx">#</th>
                <th>项目名</th>
                <th className="col-op2">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p} className={p === currentName ? 'row-dirty' : ''}>
                  <td className="col-idx">{i + 1}</td>
                  <td>
                    <input value={p} readOnly spellCheck={false} style={{ fontWeight: p === currentName ? 600 : 400 }} />
                  </td>
                  <td className="col-op2">
                    <button onClick={() => void loadFromVault(p)}>解密载入</button>
                    <button onClick={() => void exportFile(p)}>导出 .env</button>
                    <button className="vdel" onClick={() => void delProject(p)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="statusbar">
        <span>{status}</span>
        <span className="spacer" />
        <span>AES-256-GCM 加密 · 密钥仅存本机 %APPDATA%\env-manager\vault.key</span>
      </div>
    </div>
  );
}
