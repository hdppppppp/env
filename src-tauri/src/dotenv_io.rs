use std::fs;
use std::path::Path;

use crate::types::{EnvEntry, EnvFile};

/// 解析 .env 文件，保留注释与顺序。
/// 支持 `KEY=value`、`export KEY=value`、`# comment`、引号值。
pub fn parse_env_file(path: &str) -> Result<EnvFile, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    let bytes = fs::read(p).map_err(|e| format!("读取失败: {}", e))?;
    let size = bytes.len() as u64;
    let (text, encoding) = decode_text(&bytes)?;
    let (header, entries) = split_header_and_entries(&text);
    Ok(EnvFile {
        path: path.to_string(),
        header,
        entries,
        encoding: encoding.to_string(),
        size_bytes: size,
    })
}

/// 从文本解析 entries（供配置库解密后使用；runner 与测试共用）
#[allow(dead_code)]
pub fn parse_text(text: &str) -> Vec<EnvEntry> {
    split_header_and_entries(text).1
}

/// 把 entries 渲染为 .env 文本（供配置库加密前使用）
pub fn render(entries: &[EnvEntry]) -> String {
    let mut out = String::new();
    let n = entries.len();
    for (i, e) in entries.iter().enumerate() {
        if let Some(c) = &e.comment {
            for line in c.lines() {
                out.push_str(&format!("# {}\n", line));
            }
        }
        if needs_quotes(&e.value) {
            out.push_str(&format!("{}=\"{}\"\n", e.key, e.value));
        } else {
            out.push_str(&format!("{}={}\n", e.key, e.value));
        }
        if i != n - 1 {
            out.push('\n');
        }
    }
    out
}

fn decode_text(bytes: &[u8]) -> Result<(String, &'static str), String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok((String::from_utf8_lossy(&bytes[3..]).into_owned(), "UTF-8 (BOM)"));
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok((s.to_string(), "UTF-8")),
        Err(_) => {
            // 简单兜底：当作 GBK 不可靠，这里直接做有损替换并标注
            Ok((String::from_utf8_lossy(bytes).into_owned(), "UTF-8 (有损)"))
        }
    }
}

fn split_header_and_entries(text: &str) -> (String, Vec<EnvEntry>) {
    let mut header_lines: Vec<&str> = Vec::new();
    let mut entries: Vec<EnvEntry> = Vec::new();
    let mut in_header = true;
    let mut pending_comment: Option<String> = None;

    for raw in text.lines() {
        let trimmed = raw.trim();
        if in_header {
            // 头部 = 文件开头连续的注释/空行
            if trimmed.is_empty() || trimmed.starts_with('#') {
                header_lines.push(raw);
                continue;
            } else {
                in_header = false;
            }
        }

        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            // 挂到下一条 entry 的注释
            let c = trimmed.trim_start_matches('#').trim();
            pending_comment = Some(match pending_comment.take() {
                Some(prev) => format!("{}\n{}", prev, c),
                None => c.to_string(),
            });
            continue;
        }

        let body = trimmed.strip_prefix("export ").map(|s| s.trim()).unwrap_or(trimmed);
        if let Some(eq) = body.find('=') {
            let key = body[..eq].trim().to_string();
            let mut value = body[eq + 1..].trim().to_string();
            // 去掉行尾内联注释（仅当值不是引号包裹时）
            if !value.starts_with('"') && !value.starts_with('\'') {
                if let Some(pos) = find_inline_comment(&value) {
                    value = value[..pos].trim_end().to_string();
                }
            }
            // 去包裹引号
            if value.len() >= 2 {
                let b = value.as_bytes();
                let (l, r) = (b[0], b[value.len() - 1]);
                if (l == b'"' && r == b'"') || (l == b'\'' && r == b'\'') {
                    value = value[1..value.len() - 1].to_string();
                }
            }
            entries.push(EnvEntry {
                key,
                value,
                comment: pending_comment.take(),
            });
        } else {
            // 无法解析的行，当作 key 为该行、值为空，避免丢失
            entries.push(EnvEntry {
                key: body.to_string(),
                value: String::new(),
                comment: pending_comment.take(),
            });
        }
    }
    (header_lines.join("\n"), entries)
}

fn find_inline_comment(v: &str) -> Option<usize> {
    //  require " #" 前有空格，避免 URL 中的 # 被误判
    v.find(" #").map(|i| i)
}

/// 写回 .env：头部注释 + KEY=value，含值的单行注释
pub fn write_env_file(path: &str, entries: &[EnvEntry]) -> Result<(), String> {
    let out = render(entries);
    fs::write(path, out).map_err(|e| format!("写入失败: {}", e))
}

fn needs_quotes(v: &str) -> bool {
    v.is_empty() || v.contains(' ') || v.contains('\t') || v.contains('\n') || v.contains('#')
        || v.starts_with('$')
}
