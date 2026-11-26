# 月亮茶屋桌宠

月亮茶屋是 Windows 上的透明桌宠。内置月铃和狐狸橘栗，提供 7 套预设服装和 24 件可自由组合的单品。托盘可切换服装和动作、调整大小、呼出聊天、隐藏或退出。

## 项目文件说明

| 路径 | 用途 |
| --- | --- |
| [`src/main/index.ts`](src/main/index.ts) | Electron 主进程入口。管理桌宠和聊天窗口、托盘、鼠标穿透及应用生命周期。 |
| [`src/main/local-model.ts`](src/main/local-model.ts) 与 [`dialogue.ts`](src/main/dialogue.ts) | 启动与切换本机 DeepSeek、千問，处理流式回复、聊天上下文和云端备用。 |
| [`src/main/search.ts`](src/main/search.ts) 与 [`storage.ts`](src/main/storage.ts) | 接入联网搜索，读写每位角色的聊天记录与使用者设置。 |
| [`src/preload.ts`](src/preload.ts) 与 [`src/shared/contracts.ts`](src/shared/contracts.ts) | 定义主进程和前端之间的通信接口与数据类型。 |
| [`src/renderer/`](src/renderer/) 与 [`ui/`](ui/) | 桌宠动画、聊天、设置和试衣间。HTML、CSS 和界面逻辑分别存放。 |
| [`assets/characters/`](assets/characters/) | 七套预设造型。每套含角色清单、PNG 原始帧、点击遮罩和托盘头像。 |
| [`assets/video/`](assets/video/) | 预设动作的透明 WebM 及对应的逐帧像素命中数据。 |
| [`assets/wardrobe/`](assets/wardrobe/) | 可自由混搭的服装单品、插画、发型与搭配清单。 |
| [`scripts/bake-sprites/`](scripts/bake-sprites/) | 把角色动作输出成透明 WebM 和点击区数据。 |
| [`scripts/windows-download/`](scripts/windows-download/) | Windows 发版启动器。首次运行会自动取得并校验两个本机模型。 |
| [`services/`](services/) | Python 搜索脚本、依赖列表，以及模型和推理运行时的来源、版本及校验值。 |
| [`test/`](test/) 与 [`docs/`](docs/) | 自动化测试、验收条件和版本测试记录。 |
| [`package.json`](package.json) 与 [`forge.config.cjs`](forge.config.cjs) | 开发命令、依赖和 Windows 打包设置。 |

## Windows 使用

从 [GitHub Releases](https://github.com/wuzeqing811-hue/moon-teahouse-pet/releases) 下载 `MoonTeahouse-1.9.0-Windows-Online-Setup.zip`，完整解压到可写入的文件夹，再双击 `Start Moon Teahouse.cmd`。首次启动会自动下载 DeepSeek 与千問，合计约 2.24 GB。两份文件校验后会自动打开桌宠。以后可以直接运行 `MoonTeahouse.exe`，从「设置 → 聊天模型」离线切换两个模型。

安装版运行 `MoonTeahouse-Setup.exe`。已含两个模型的离线便携版完整解压后，直接运行 `MoonTeahouse.exe`。右键任务栏通知区域的头像可以查看菜单。

- 点击角色时会播放打瞌睡，并打开聊天。聊天已打开时，点击仍露出的角色可重新播放动画。拖动角色移动窗口，在角色上滚动鼠标滚轮缩放。
- 聊天视窗的宽度和高度可在「设置 → 聊天視窗」分别输入，点「套用」即时调整并保存。托盘「缩放」和「玩偶縮放」用于调整桌宠尺寸。
- 换装从托盘的「换装」菜单选择，或在聊天窗打开「设置」。角色、服装、位置及尺寸会保存在本机。
- 在托盘选「自由搭配」，选择角色后分别挑选上衣、下装、发型、发色和瞳色。使用「套用到桌寵」保存，每位角色各有一份搭配。试衣间可预览通用动作与每位角色的三个专属动画。「使用原套裝」可恢复该角色的预设造型。
- 托盘「动作」菜单和试衣间可单独播放招手、打瞌睡以及角色专属动作。招手持续 2.25 秒，动作播完自动回到待机。拖曳桌宠时会自动播放拖曳动作。月铃可以端茶、眨眼和行礼，橘栗可以嗅闻、甩尾和扑叶。
- 在试衣间展开「單關節預覽」，选择部位并拖动角度滑杆。两位内置角色都可以控制头部、左右肩肘及左右髋膝，橘栗还可以单独摆尾。点击其他动作即可回到动画预览。
- 关闭聊天窗后可以继续操作桌宠。左键点击托盘头像可显示或隐藏桌宠。结束程序时选择托盘的「退出」。
- 默认只使用本机模型。需要联网搜索时勾选「联网搜索」或输入 `/search 关键词`。

## 配置聊天与搜索

1. 在「设置 → 聊天模型 → 本機模型」选择 DeepSeek 或千問 Qwen2.5（1.5B），然后保存。桌宠会停止上一套内置模型并启动所选模型。等聊天窗口显示已就绪后便可离线聊天，无需填写密钥。退出桌宠会关闭推理程序。也可以在同一菜单选择 [Ollama](https://ollama.com/download) 和本机已安装的 Ollama 模型。
2. 需要云端备用时，在设置中允许云端并选择 **DeepSeek Flash** 或自定义兼容 API。DeepSeek 填入自己的 API 密钥，保存后可点「检测已保存的密钥」。自定义 API 仍使用原有的地址、模型名和密钥。普通聊天在本地不可用或在输出前失败时调用已启用的备用服务。密钥由系统安全存储分别加密。
3. 「联网搜索」可选 ddgs、SearXNG 或 DeepSeek。ddgs 需要 Python 3.10+ 和 `python -m pip install ddgs==9.16.1`。在虚拟环境安装时，在设置中填对应 `python.exe` 路径。SearXNG 实例需启用 JSON 输出。选择 DeepSeek 后，`/search 关键词` 或勾选「联网搜索」会直接调用 DeepSeek，并在回复中显示引用和来源。启用 DeepSeek 云端服务后，`/read https://example.com/` 可读取公开网页。

独立会话按角色 ID 存在 Electron 的 `userData/history/` 中。每次向模型提交最近 10 轮历史，可在设置里修改。ddgs 和 SearXNG 接收当次查询词。DeepSeek 搜索、链接阅读或云端备用会发送当前消息和上下文，可能产生 API 费用。DeepSeek 可选深度思考，聊天窗显示进度并保存回复正文与来源。

## 开发与打包

Windows x64 与 Node.js 22.12+。在仓库根目录安装依赖并启动开发版。

```powershell
npm ci
npm start
```

停止开发版后，可以在同一目录运行测试或生成分发包。

```powershell
npm test
npm run make
```

Forge 将安装包和便携 ZIP 写入 `out/make/`。如果网络无法访问 Electron 的下载地址，可将对应版本的官方 Electron ZIP 放入单独目录，并设置 `TEAHOUSE_ELECTRON_ZIP_DIR` 为该目录的绝对路径。首次运行开发版还需要 Electron npm 包下载它自己的开发运行时。

从 GitHub 获取源码后，可以直接启动窗口、换装并测试界面。本机聊天需要另外准备模型与推理运行时，版本、下载来源和 SHA-256 见 [模型配置说明](services/deepseek-runtime-notice.txt)。

打包含模型的 Windows 版本前，将 `TEAHOUSE_DEEPSEEK_RUNTIME` 指向名为 `deepseek-runtime` 的目录。目录内需有 `llama-server.exe`、对应的 DLL、`model.gguf` 和许可证。开发版从项目目录的同级 `deepseek-runtime` 读取这些文件，安装版从 Electron 的 `resources/deepseek-runtime` 读取。

双模型便携版还包含一个名为 `qwen-model` 的资源目录。将 `TEAHOUSE_QWEN_MODEL` 指向该目录，里面应有官方 `qwen2.5-1.5b-instruct-q4_k_m.gguf` 与 `LICENSE-Qwen2.5`。安装版也支持将同一模型放进 Electron 的 `userData/models/`，以后升级可继续使用该文件。

## 添加服装或动作

自由搭配支持两位内置角色。单品目录位于 `assets/wardrobe/catalog.json`，共有 12 件上衣、6 款裙子、6 款裤子和 6 种发型（含原发型）。每件单品有一张同名的透明插画，位于 `assets/wardrobe/illustrated/`。试衣间与桌宠共用这些插画。`src/renderer/illustrated.ts` 让腰带、袖口和裤腿随动作对齐，最终合成 320 × 320 像素的角色帧，按待机帧透明度更新点击区域。旧版已保存的搭配会自动使用新图。预设与导入角色包继续由各自的清单加载。

复制 `assets/characters/character_01` 作为示例，给 `manifest.json` 设置唯一 `id`。同一角色的各套服装使用相同 `characterId`、`characterName` 和 `persona`，便于分组并共享会话。新角色使用新的 `characterId`。设置中选择「导入角色包」，再选择包含 `manifest.json` 的目录。软件将有效素材复制进 `userData/characters/`，也可在该目录编辑已导入角色的清单并刷新。

导入角色包的画布与遮罩必须是同样大小的正方形 PNG。纯白且不透明的像素触发交互，其余像素穿透。导入的角色包需含循环 `idle`，有 `drag`、`click` 时分别响应拖拽和单击。其他动作自动出现在托盘「动作」菜单。`canvas.anchor` 是缩放锚点，内置角色统一使用 `(160, 174)`。

内置七套造型各有七段 320 × 320 的透明 VP9 WebM，存放在 `assets/video/`。待机和拖曳使用角色包的帧率，招手、打瞌睡与角色专属动作以 24 fps 输出。桌宠先解码新片段，再切换到对应的 `<video>`，单次片段结束后回待机。每段的 `.hit` 数据跟随视频帧更新身体命中区。自由搭配首次套用会先合成待机片段，再陆续保存其余片段到 `userData/video-cache/`。再次选择同一搭配可复用缓存。

动作或插画修改后运行 `npm run bake:clips`，用 Electron 的编码器重新生成内置 WebM 和点击区数据。只重制单个动作时可附加 `-- --action=scent`，将 `scent` 替换为对应动作 ID。`src/main/reactions.ts` 定义动作，`src/renderer/joints.ts` 定义旋转中心和关节关系，`src/renderer/reaction-art.ts` 负责姿态变形与特效。试衣间继续用这套绘图逻辑即时预览。

接口资料见 [Electron 窗口交互](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)、[Ollama 聊天 API](https://docs.ollama.com/api/chat)、[ddgs](https://pypi.org/project/ddgs/)、[SearXNG 搜索 API](https://docs.searxng.org/dev/search_api.html)、[DeepSeek 聊天机器人指南](https://api-docs.deepseek.com/guides/build_a_chatbot/) 和 [DeepSeek 网页工具](https://api-docs.deepseek.com/guides/web_tools/)。
