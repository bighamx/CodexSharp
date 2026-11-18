use codex_plus_core::script_market::{
    download_script, fetch_market_manifest, market_package_request, market_scripts_payload,
    parse_market_manifest,
};
use codex_plus_core::user_scripts::UserScriptManager;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// 脚本市场改走统一代理客户端后（#1329 / #1339），回环地址仍需直连，
// 即便进程里设置了 HTTPS_PROXY 也不能把本地请求送进代理。
#[tokio::test]
async fn fetch_market_manifest_reads_index_through_shared_client() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/index.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "version": 2,
            "updated_at": "2026-10-25",
            "scripts": [{
                "id": "demo",
                "name": "Demo",
                "version": "1.0.0",
                "script_url": format!("{}/demo.js", server.uri()),
            }],
        })))
        .mount(&server)
        .await;

    let manifest = fetch_market_manifest(&format!("{}/index.json", server.uri()))
        .await
        .unwrap();

    assert_eq!(manifest.version, 2);
    assert_eq!(manifest.scripts.len(), 1);
    assert_eq!(manifest.scripts[0].id, "demo");
}

#[tokio::test]
async fn fetch_market_manifest_error_keeps_status_context() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/index.json"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let error = fetch_market_manifest(&format!("{}/index.json", server.uri()))
        .await
        .unwrap_err();
    let message = format!("{error:#}");

    assert!(message.contains("script market index returned an error status"));
    assert!(message.contains("404"));
}

#[tokio::test]
async fn download_script_returns_body() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/demo.js"))
        .respond_with(ResponseTemplate::new(200).set_body_string("console.log('ok');"))
        .mount(&server)
        .await;

    let body = download_script(&format!("{}/demo.js", server.uri()))
        .await
        .unwrap();

    assert_eq!(body, b"console.log('ok');");
}

// 市场清单逐条脚本的更新时间（#2781）：兼容 updated_at / updatedAt，缺省为空，
// 并原样透传到给前端的 payload，供卡片显示和按更新时间排序。
#[test]
fn market_script_updated_at_is_parsed_and_forwarded() {
    let manifest = parse_market_manifest(json!({
        "version": 1,
        "updated_at": "2026-10-26T12:51:20.000Z",
        "scripts": [
            {
                "id": "snake",
                "name": "Snake",
                "version": "1.0.0",
                "script_url": "https://example.com/snake.js",
                "updated_at": " 2026-10-20T08:00:00Z ",
            },
            {
                "id": "camel",
                "name": "Camel",
                "version": "1.0.0",
                "script_url": "https://example.com/camel.js",
                "updatedAt": "2026-09-01",
            },
            {
                "id": "legacy",
                "name": "Legacy",
                "version": "1.0.0",
                "script_url": "https://example.com/legacy.js",
            },
        ],
    }))
    .unwrap();

    let updated: Vec<&str> = manifest
        .scripts
        .iter()
        .map(|script| script.updated_at.as_str())
        .collect();
    assert_eq!(updated, vec!["2026-10-20T08:00:00Z", "2026-09-01", ""]);

    let temp = tempfile::tempdir().unwrap();
    let manager = UserScriptManager::new(
        temp.path().join("builtin"),
        temp.path().join("user"),
        temp.path().join("user_scripts.json"),
    );
    let payload = market_scripts_payload(&manager, &manifest, "ok", "");
    let scripts = payload["scripts"].as_array().unwrap();
    assert_eq!(scripts[0]["updatedAt"], "2026-10-20T08:00:00Z");
    assert_eq!(scripts[1]["updatedAt"], "2026-09-01");
    assert_eq!(scripts[2]["updatedAt"], "");
}

#[test]
fn curated_packages_blocked_list_and_official_owner_check() {
    let sha = "a".repeat(40);
    let manifest = parse_market_manifest(json!({
        "version": 2,
        "scripts": [
            { "id": "old-script", "name": "老脚本", "version": "1.0.0", "script_url": "https://example.com/a.js" },
            { "kind": "package", "id": "word-count", "name": "字数统计", "repo": "BigPizzaV3/codexpp-word-count", "tag": "v1.0.0", "sha": sha, "official": true },
            { "kind": "package", "id": "fake-official", "name": "假官方", "repo": "mallory/codexpp-fake", "sha": sha, "official": true },
            { "kind": "package", "id": "bad-sha", "name": "坏 sha", "repo": "alice/x", "sha": "main" },
        ],
        "packages": [{ "id": "notes", "name": "便签", "repo": "alice/codexpp-notes", "sha": sha.to_uppercase() }],
        "blocked": ["evil/codexpp-miner", "not-a-repo"],
    }))
    .unwrap();
    assert_eq!(manifest.scripts.len(), 1, "拓展包条目不混进单文件脚本");
    let ids = manifest.packages.iter().map(|package| package.id.as_str()).collect::<Vec<_>>();
    assert_eq!(ids, ["word-count", "fake-official", "notes"], "sha 无效的条目丢弃；packages 数组也认");
    let find = |id: &str| manifest.packages.iter().find(|package| package.id == id).unwrap();
    assert!(find("word-count").is_official(), "清单声明官方且仓库属于官方账号");
    assert_eq!(find("word-count").channel(), "official");
    assert!(!find("fake-official").is_official(), "清单声明官方但仓库不属于官方账号：只算精选");
    assert_eq!(find("fake-official").channel(), "curated");
    assert_eq!(find("notes").sha, sha, "sha 统一小写");
    assert_eq!(manifest.blocked, ["evil/codexpp-miner"]);

    let filter = codex_plus_core::script_market::curated_filter(&manifest);
    assert!(filter.is_blocked("Evil/CodexPP-Miner"), "下架名单不分大小写");
    assert_eq!(filter.curated_ids["word-count"], ("BigPizzaV3/codexpp-word-count".to_string(), true));
    let pinned = find("word-count").pinned();
    assert_eq!((pinned.repo.as_str(), pinned.sha.as_str(), pinned.channel.as_str()), ("BigPizzaV3/codexpp-word-count", sha.as_str(), "official"));
}

/// Codex 页内安装拓展包的桥接分发：参数校验，暂存与「已安装」判断用同一个配置目录（拓展目录的上一级）。
#[tokio::test]
async fn market_package_request_validates_and_discards_in_the_shared_store() {
    let temp = tempfile::tempdir().unwrap();
    let manager = UserScriptManager::new(
        temp.path().join("builtin"),
        temp.path().join("user"),
        temp.path().join("user_scripts.json"),
    );
    let missing = market_package_request(&manager, "prepare", &json!({})).await.unwrap_err();
    assert!(format!("{missing:#}").contains("缺少参数 id"));
    let unknown = market_package_request(&manager, "publish", &json!({})).await.unwrap_err();
    assert!(format!("{unknown:#}").contains("未知操作"));
    let invalid = market_package_request(&manager, "install", &json!({"token": "../evil"})).await.unwrap_err();
    assert!(format!("{invalid:#}").contains("暂存令牌无效"));
    let expired = market_package_request(&manager, "install", &json!({"token": "pkg-1"})).await.unwrap_err();
    assert!(format!("{expired:#}").contains("已失效"));

    let staged = temp.path().join(".extension_staging").join("pkg-1");
    std::fs::create_dir_all(&staged).unwrap();
    let discarded = market_package_request(&manager, "discard", &json!({"token": "pkg-1"})).await.unwrap();
    assert_eq!(discarded["status"], "ok");
    assert!(!staged.exists());
}

/// 运行时扫描结果合并进「精选」：同 id / 同仓库不重复，上游条目优先。
#[test]
fn scanned_packages_merge_into_the_market_list() {
    let sha = "b".repeat(40);
    let mut manifest = parse_market_manifest(json!({
        "version": 2,
        "packages": [{
            "id": "word-count",
            "name": "字数统计",
            "repo": "BigPizzaV3/codexpp-word-count",
            "sha": sha,
            "official": true
        }]
    }))
    .unwrap();
    let scanned = vec![
        codex_plus_core::script_market::MarketPackage {
            id: "session-context-bars".into(),
            name: "会话上下文进度条".into(),
            description: String::new(),
            version: "0.1.0".into(),
            author: "bighamx".into(),
            tags: Vec::new(),
            homepage: "https://github.com/bighamx/codexpp-session-context-bars".into(),
            icon: String::new(),
            updated_at: "2026-11-18".into(),
            repo: "bighamx/codexpp-session-context-bars".into(),
            tag: None,
            sha: "802b0b24a5e6954c2fddb7b50f84b45cdab9fe87".into(),
            official_claimed: false,
        },
        // 上游清单里已经有这个仓库：不能再出现一次。
        codex_plus_core::script_market::MarketPackage {
            id: "word-count-duplicate".into(),
            name: "重复".into(),
            description: String::new(),
            version: "1.0.0".into(),
            author: "bighamx".into(),
            tags: Vec::new(),
            homepage: String::new(),
            icon: String::new(),
            updated_at: String::new(),
            repo: "bigpizzav3/codexpp-word-count".into(),
            tag: None,
            sha: sha.clone(),
            official_claimed: false,
        },
    ];
    codex_plus_core::script_market::merge_scanned_packages(&mut manifest.packages, scanned);

    let ids: Vec<&str> = manifest.packages.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, ["word-count", "session-context-bars"], "重复仓库不追加、上游排在前");
    let scanned_entry = manifest
        .packages
        .iter()
        .find(|item| item.id == "session-context-bars")
        .unwrap();
    assert!(!scanned_entry.is_official(), "扫描来的条目不能冒充官方");
    assert_eq!(scanned_entry.sha.len(), 40, "扫描结果按提交锁定，安装只认它");
}

/// 真实打 GitHub 的扫描：CI 不跑（要联网），发布前手动 `--ignored` 验一次。
#[tokio::test]
#[ignore = "需要联网访问 GitHub"]
async fn live_scan_lists_owner_extensions() {
    let scanned = codex_plus_core::script_market::scan_owner_curated_packages("bighamx").await;
    let entry = scanned
        .iter()
        .find(|item| item.id == "session-context-bars")
        .expect("扫描结果里应当有会话上下文进度条");
    assert_eq!(entry.repo, "bighamx/codexpp-session-context-bars");
    assert_eq!(entry.sha.len(), 40);
    assert!(entry.version.starts_with("0."), "版本取自 codexpp.json：{}", entry.version);
    assert!(!entry.is_official(), "扫描条目不能冒充官方");
}
