# 参与贡献

感谢你帮助改进 SHOU研究生课表导出。

## 开始开发

1. 安装 Node.js 22 或更高版本。
2. 运行 `npm test` 验证解析和导出逻辑。
3. 运行 `npm run build` 生成可发布文件。
4. 在 Chrome 的扩展程序页面加载 `dist` 中压缩包解压后的目录，或在用户脚本管理器中安装 `dist/SHOU研究生课表导出.user.js`。

项目没有第三方运行时依赖。请勿提交真实课表、姓名、学号、Cookie、访问令牌或其他个人信息。

## 提交问题

请说明：使用的浏览器或用户脚本管理器版本、出现问题的页面、预期结果和实际结果。若需提供页面结构或接口 JSON，请先删除姓名、学号、课程安排等个人数据。

## 提交代码

- 一个 Pull Request 只处理一类问题。
- 新增解析规则时请补充测试，并使用匿名、虚构的测试数据。
- 提交前运行 `npm test` 和 `npm run build`。
- 提交消息建议采用 Conventional Commits，例如 `fix: support updated timetable markup`。
