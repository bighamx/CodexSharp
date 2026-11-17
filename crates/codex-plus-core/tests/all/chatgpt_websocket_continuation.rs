//! 守卫：WebSocket 续聊的上下文不能被请求整理吞掉。
//!
//! ChatGPT 走 WebSocket 时，续聊请求只带新增的输入，工具调用、item id 和
//! `previous_response_id` 都指向那条上游连接上已经存在的对象。按 HTTP 的规则整理
//! （删 `previous_response_id`、去掉 item id、重写/削弱 call_id、把找不到调用的
//! 工具输出改成说明文字）会让上游对不上号，表现为「上下文丢失」「工具结果丢失」。
//!
//! 这笔修复落在 `gateway/chatgpt_backend.rs` 与 `gateway/pipeline.rs`，而上游频繁
//! 重写这两个文件；同步上游时用「取上游」的合并策略会静默把它盖掉。这里的断言在
//! 覆盖发生时会直接变红（函数被删则是编译失败）。

use codex_plus_core::gateway::chatgpt_backend::adapt_request_for_transport;
use serde_json::{json, Value};

fn continuation_body() -> (Value, Value) {
    let input = json!([
        {
            "type": "message",
            "role": "user",
            "id": "msg_1",
            "status": "completed",
            "content": [{ "type": "input_text", "text": "跑一下测试" }]
        },
        {
            "type": "function_call",
            "name": "shell",
            "call_id": "call_abc",
            "arguments": "{}",
            "id": "fc_1",
            "status": "completed"
        },
        {
            "type": "function_call_output",
            "call_id": "call_abc",
            "output": "ok",
            "id": "fco_1"
        }
    ]);
    let body = json!({
        "model": "chatgpt/gpt-6.1-sol",
        "previous_response_id": "resp_prev",
        "input": input.clone(),
    });
    (body, input)
}

#[test]
fn websocket_continuation_keeps_response_link_and_items_verbatim() {
    let (mut body, input) = continuation_body();

    adapt_request_for_transport(&mut body, None, true);

    assert_eq!(
        body.get("previous_response_id").and_then(Value::as_str),
        Some("resp_prev"),
        "WS 续聊必须把 previous_response_id 传给上游，否则上游不知道接哪段历史"
    );
    assert_eq!(body.get("input"), Some(&input), "WS 续聊的输入项必须原样转发");
    assert!(
        body.get("prompt_cache_key").is_none(),
        "WS 续聊不该凭空造 prompt_cache_key：换 key 会把同一段会话拆成两条缓存"
    );
}

#[test]
fn http_requests_keep_the_old_shaping() {
    let (mut body, _) = continuation_body();

    adapt_request_for_transport(&mut body, None, false);

    assert!(
        body.get("previous_response_id").is_none(),
        "HTTP 请求体里保留 previous_response_id 会顶掉客户端自带的历史"
    );
    let first = &body["input"][0];
    assert!(first.get("id").is_none(), "HTTP 路径照旧去掉 item id");
    assert!(first.get("status").is_none(), "HTTP 路径照旧去掉 status");
}

#[test]
fn websocket_without_previous_response_id_still_shapes_input() {
    // 首轮 WS 请求没有续聊引用，历史是完整的，照旧整理。
    let (mut body, _) = continuation_body();
    body.as_object_mut().unwrap().remove("previous_response_id");

    adapt_request_for_transport(&mut body, None, true);

    assert!(
        body.get("previous_response_id").is_none(),
        "没有续聊引用的请求不该被塞进 previous_response_id"
    );
    assert!(
        body["input"][0].get("id").is_none(),
        "首轮 WS 请求仍要按 HTTP 的规则整理输入项"
    );
}

#[test]
fn empty_previous_response_id_is_not_a_continuation() {
    let (mut body, _) = continuation_body();
    body["previous_response_id"] = json!("   ");

    adapt_request_for_transport(&mut body, None, true);

    let first = &body["input"][0];
    assert!(
        first.get("id").is_none(),
        "空的 previous_response_id 不算续聊，输入项仍要整理"
    );
}

#[test]
fn pipeline_passes_the_websocket_flag_from_the_live_request() {
    // 调用点被改回 `adapt_request(...)`（恒为 false）时，上面几条虽然还绿，线上却
    // 又变回 475K 那类上下文错乱，所以这里连调用点一起钉住。
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/gateway/pipeline.rs"
    ))
    .expect("读不到 pipeline.rs");
    assert!(
        source.contains("adapt_request_for_transport(")
            && source.contains("crate::responses_websocket::active()"),
        "pipeline 必须按当前请求是否为 WebSocket 传入 transport 标志"
    );
}
