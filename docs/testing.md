# 测试说明

## 自动测试

```text
npm run typecheck
npm test
npm run test:phase0
npm run test:phase1
npm run test:phase2
npm run test:phase3
```

浏览器测试使用本机 Chrome、`file://`、Playwright offline context，并拦截和记录所有 HTTP/HTTPS 请求。

## 当前已验证环境

- macOS Chrome 153.0.8010.36：Phase 0～3 通过。
- Microsoft Edge：当前开发机未安装，待 Windows 实机验证。
- Windows Chrome：待实机验证。

## 人工验收清单

1. 物理断开网络。
2. 双击 `release/EnglishReader.html`。
3. 等待模型状态变为“语音模型已就绪”。
4. 分别切换美式、英式和六个音色试听。
5. 用任务中的发音词表进行人工听感检查。
6. 生成并播放 WAV，再导出到播放器验证。
7. DevTools Network 应为 0 个 HTTP/HTTPS 请求。
8. 在中文路径、带空格路径和 U 盘上重复。
