#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // CLI 模式：env-manager.exe vault-print <project>
    // 本机密钥解密配置库中的项目环境，以 KEY=VALUE 输出到 stdout（供 envmanager/脚本消费）
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(|s| s.as_str()) == Some("vault-print") {
        match args.get(1) {
            Some(project) => match env_manager_lib::vault::load_project(project.clone()) {
                Ok(entries) => {
                    for e in entries {
                        println!("{}={}", e.key, e.value);
                    }
                    std::process::exit(0);
                }
                Err(err) => {
                    eprintln!("vault-print: {}", err);
                    std::process::exit(1);
                }
            },
            None => {
                eprintln!("用法: env-manager.exe vault-print <project>");
                std::process::exit(2);
            }
        }
    }
    // 其余参数（.env 路径）走正常 GUI
    env_manager_lib::run()
}
