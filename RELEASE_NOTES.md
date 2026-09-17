## SHOU研究生课表导出 v0.1.1

首个公开版本，提供两种安装方式：

- `shou-calendar-exporter-v0.1.1.zip`：Chrome 扩展，解压后通过“加载已解压的扩展程序”安装。
- `shou-calendar-exporter.user.js`：Tampermonkey、Violentmonkey 等用户脚本管理器安装。

主要能力：

- 从上海海洋大学研究生综合服务平台的学生课程表页面读取已显示的数据。
- 导出通用 ICS，兼容 Apple 日历、Google Calendar、Outlook 及支持 ICS 的安卓日历。
- 导出 Google Calendar CSV 和标准化 JSON。
- 使用课表中的真实上下课时间，按教学周展开日程并合并连续课节。
- 默认移除地点中的“上海海洋大学”，日历名采用 `Cal-26-27-1` 格式。
- 所有数据仅在浏览器本地处理，不读取密码或 Cookie，不上传课表。
