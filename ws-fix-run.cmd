@echo off
cd /d E:\git\CodexPlusPlus
cargo test --offline -p codex-plus-core --test all > ws-fix-tests.log 2>&1
if errorlevel 1 exit /b 1
cargo build --offline --release -p codex-plus-manager > ws-fix-build.log 2>&1
