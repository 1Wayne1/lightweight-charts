# 多端原生容器（规划）

目标使用 Tauri 2 封装 `apps/terminal-web`，共享 TypeScript 界面和业务模型，交付 macOS、Windows、iOS 应用。本目录目前只有平台约定，尚未生成 Rust 工程、原生配置或安装包。

## 平台职责

- macOS / Windows：窗口、快捷键、系统安全存储、应用签名及更新。
- iOS：安全区、触摸绘图、横竖屏、前后台切换、Keychain、签名及真机验证。
- 共享 Web：图表、多标签页、周期、画线适配、行情适配器、离线队列和同步状态。
- 自托管服务：账户隔离、版本控制、同步存储；与原生安装包独立部署。

Tauri 2 工程将在 Web 交互稳定后初始化；届时将 `frontendDist` 指向 `../terminal-web/dist`，开发地址使用 Web dev server，统一放在本目录的 `src-tauri/` 下。具体 CLI 和 Rust 依赖版本在接入时固定，所有 command capability 按实际用途最小化配置。

macOS 构建需要 Xcode Command Line Tools 和 Rust；Windows 需要 MSVC、Rust 与 WebView2；iOS 构建必须在 macOS 上使用 Xcode，设备安装与分发需相应 Apple 签名配置。原生发布分别在目标平台验证，Web 构建成功不能代替原生构建或 iOS 真机测试。

共享 Web 已提供手机自选表 / 图表两页导航、长按交易对切换、触摸绘图和横竖屏布局，并完成浏览器模拟验证。原生封装仍需在 iOS 真机补充绘图手势冲突、软键盘和后台恢复实测。
