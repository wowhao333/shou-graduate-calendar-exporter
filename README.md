# SHOU研究生课表导出

一个面向上海海洋大学研究生综合服务平台的课表导出工具，提供 **Chrome 扩展**和 **Tampermonkey/Violentmonkey 用户脚本**两种版本。它从当前“学生课程表”页面读取已经显示的课表，在浏览器本地生成日历文件，不读取密码、不保存 Cookie，也不会把课表上传到服务器。

> 非学校官方项目。仅在 `https://yjsfw.shou.edu.cn/*` 激活。

## 支持格式

- **通用 ICS（推荐）**：每次上课独立写入一个标准 `VEVENT`，兼容 Apple 日历、Google Calendar、Outlook，以及能够导入 ICS 的安卓日历应用。
- **Google Calendar CSV**：使用 Google Calendar 要求的英文表头，每次上课展开为一行。
- **标准化 JSON**：保存插件解析后的课程、日期和课节信息，便于备份和二次转换。

## 安装 Chrome 扩展

1. 从仓库的 [Releases](../../releases/latest) 下载 `shou-calendar-exporter-v*.zip` 并解压。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压得到的“SHOU研究生课表导出”文件夹。

## 安装油猴脚本

1. 安装 Tampermonkey、Violentmonkey 或其他兼容的用户脚本管理器。
2. 从 [Releases](../../releases/latest) 下载并打开 `shou-calendar-exporter.user.js`。
3. 在脚本管理器中确认安装。

油猴版本会在课表页右下角显示“导出课表”按钮。更多说明见 [userscript/README.md](userscript/README.md)。

## 使用

1. 登录研究生综合服务平台。
2. 打开“培养管理 → 我的课表 → 学生课程表”。
3. 确认需要导出的学期已经显示完成。
4. 点击扩展图标，或点击油猴版的“导出课表”按钮。
5. 检查自动识别的课程数、日历标题和“第一周星期一”。
6. 选择导出格式并下载。

如果自动读取失败，也可以导入教务接口返回的 JSON。接口 JSON 不包含学期第一周日期，因此需要根据校历手动填写。

## 转换规则

- 读取上方节次表中的星期、节次、周次、教师、教室和每节起止时间。
- 读取下方课程明细表中的课程代码、班级、校区和首次上课日期。
- 将相同课程的连续节次合并成一个上课时段。
- 根据“首次上课日期 + 首次周次 + 星期”反推第一周星期一。
- 按精确教学周展开每次课程，单双周和不连续周次不会被错误补齐。
- 默认删除地点中的“上海海洋大学”，保留“临港校区 + 教室”。
- 日历标题按 `Cal-26-27-1` 格式生成。

## 权限与隐私

扩展只声明：

- `activeTab`：用户点击扩展时临时访问当前页面。
- `scripting`：在当前页面及其课表 iframe 中读取已显示的表格。
- `declarativeContent`：默认禁用插件按钮，仅在 `https://yjsfw.shou.edu.cn/*` 页面启用。

扩展没有后台服务、远程统计、广告脚本或网络上传逻辑。所有导出均通过浏览器内存中的 `Blob` 完成，因此也不需要 `downloads` 权限。

## 开发与测试

项目不依赖第三方运行库。使用 Node.js 运行测试：

```bash
npm test
npm run build
```

`npm run build` 会在 `dist/` 生成 Chrome 扩展压缩包和用户脚本。测试覆盖版本同步、教学周解析、连续课节合并、日期展开、地点清理、ICS 的 CRLF/75 字节折行，以及 Google Calendar CSV 表头。

项目结构：

- `core/`：课表标准化、日期展开和导出器。
- `popup/`：Chrome 扩展界面与页面读取逻辑。
- `userscript/`：可独立安装的用户脚本。
- `tests/`：不包含真实学生信息的自动化测试。
- `tools/`：Release 附件打包脚本。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 已知限制

- 适配器依赖当前研究生平台页面中的 `#jsTbl_01` 课表和课程明细表；学校升级页面后可能需要更新选择器。
- 尚未安排时间地点的课程只会显示警告，不会生成虚假日程。
- Google Calendar 手机 App 不提供完整的文件导入入口，通常需要在电脑网页端导入 ICS/CSV，然后同步到安卓设备。
## 许可证

[MIT](LICENSE)
