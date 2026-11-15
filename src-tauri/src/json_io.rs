use std::fs;

use crate::types::EnvEntry;

/// 导入 JSON：支持 `[{key,value,comment?}]` 或 `{ "KEY": "VALUE" }` 两种格式
pub fn import_json_file(path: &str) -> Result<Vec<EnvEntry>, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("读取失败: {}", e))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON 解析失败: {}", e))?;

    let mut out = Vec::new();
    match v {
        serde_json::Value::Array(items) => {
            for it in items {
                let obj = match it {
                    serde_json::Value::Object(m) => m,
                    _ => return Err("数组元素必须是对象 {key, value}".into()),
                };
                let key = obj
                    .get("key")
                    .and_then(|k| k.as_str())
                    .ok_or("缺少 key 字段")?
                    .to_string();
                let value = match obj.get("value") {
                    Some(serde_json::Value::String(s)) => s.clone(),
                    Some(other) => serde_json::to_string(other).unwrap_or_default(),
                    None => String::new(),
                };
                let comment = obj
                    .get("comment")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());
                out.push(EnvEntry { key, value, comment });
            }
        }
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                let value = match val {
                    serde_json::Value::String(s) => s.clone(),
                    other => serde_json::to_string(&other).unwrap_or_default(),
                };
                out.push(EnvEntry {
                    key: k,
                    value,
                    comment: None,
                });
            }
        }
        _ => return Err("JSON 根必须是对象或数组".into()),
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(out)
}

/// 导出 JSON
pub fn export_json_file(path: &str, entries: &[EnvEntry]) -> Result<String, String> {
    let pretty = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(path, &pretty).map_err(|e| format!("写入失败: {}", e))?;
    Ok(pretty)
}
