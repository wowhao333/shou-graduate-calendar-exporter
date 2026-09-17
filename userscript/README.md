# SHOU研究生课表导出 · 油猴版

## 安装

1. 安装 Tampermonkey、Violentmonkey 或兼容的用户脚本管理器。
2. 打开 `SHOU研究生课表导出.user.js`，由脚本管理器确认安装。
3. 登录 `https://yjsfw.shou.edu.cn/`。
4. 打开“培养管理 → 我的课表 → 学生课程表”。
5. 点击页面右下角“导出课表”。

## 权限

- 仅匹配 `https://yjsfw.shou.edu.cn/*`。
- 仅在研究生课表应用路径 `/sys/wdkbapp/` 中显示导出按钮，不在门户首页或其他业务页面显示。
- 使用 `@grant none`，不申请跨域请求、剪贴板或下载管理权限。
- 不读取密码和 Cookie，不上传课表。
- 所有文件都由浏览器本地 `Blob` 生成。

## 导出格式

- 通用 ICS：Apple、Google、Outlook 及支持 ICS 的安卓日历。
- Google Calendar CSV：每次上课一行。
- 标准化 JSON：用于备份和二次转换。
