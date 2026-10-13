# Willow's Daily Dashboard

跨市场行情与信号看板，覆盖A股、港股、美股、日股、韩股及加密货币。页面包括市场宏观、板块ETF、个股信号、止盈提醒和止损提醒，支持市场筛选、代码或名称搜索、运行时点切换、分页与打印。

当前项目只有前端和示例数据，没有后台计算模块。数据生成可在本地完成，再将结果文件提交到仓库，由GitHub Pages发布。

## 示例数据

本版本用于检查界面效果。标的代码与名称选自用户提供的六份PDF；价格、涨跌幅、日期、交易状态、信号及止盈止损条件均为人工构造，未运行策略计算，不代表真实行情、投资建议或交易业绩。四个运行时点也属于示例。标的来源见[SAMPLE_DATA.md](SAMPLE_DATA.md)。

原始PDF、券商凭据和账户信息均不包含在发布文件中。仅发布`website`目录。

## 文件结构

```text
willow-dashboard/
├── .github/workflows/pages.yml   GitHub Pages发布配置
├── website/
│   ├── index.html               页面结构
│   ├── assets/
│   │   ├── style.css            样式
│   │   └── app.js               加载、筛选、搜索、分页与时间切换
│   └── data/
│       ├── latest.json          最近一次运行结果
│       ├── history.json         可选择的运行时点及文件路径
│       └── snapshots/           四个时点的完整结果
├── README.md
└── SAMPLE_DATA.md
```

## 发布到GitHub

把本目录的内容放到仓库最外层，保留`.github`目录。仓库首页应能看到`website`和`README.md`，不要再套一层`willow-dashboard`文件夹。

在仓库的“Settings → Pages → Build and deployment”里，将“Source”设置为“GitHub Actions”。然后进入“Actions → 发布看板 → Run workflow”，或向`main`分支提交一次修改。工作流会将`website`目录发布为网站，完成后可在“Pages”设置中打开地址。

若通过GitHub网页上传文件时隐藏目录未被选中，可在仓库点击“Add file → Create new file”，文件名填写`.github/workflows/pages.yml`，粘贴本地同名文件的内容并提交。

本配置使用GitHub Pages。公开仓库可使用免费账户发布；私有仓库需使用支持私有仓库Pages的账户方案。

## 本地查看

由于网页使用独立JSON文件，需要通过本地网页服务读取。安装Python后，在本目录运行：

```text
python -m http.server 8000 --bind 127.0.0.1 --directory website
```

然后在浏览器打开`http://127.0.0.1:8000`。直接双击`index.html`时，浏览器通常会阻止读取本地JSON，页面会给出提示。

## 替换数据

页面打开后读取`data/history.json`，默认展示最新记录指向的`data/latest.json`。切换运行时间时加载对应历史文件。搜索会匹配当前时点下所有标的的代码、名称、别名及市场，不受分页限制，也不会向外部行情服务发请求。

每份结果包括`schemaVersion`、`snapshotId`、`updatedAt`以及`macro`、`sectors`、`stocks`、`profit`、`stop`五个数组。报价与信号保存在同一个标的记录中；`signals`为数组，通常只有一项，少数为两项。

各标的同时保存`quoteAt`和`session`。后台以后需要根据具体交易所、节假日和报价时间提供状态；浏览器不会用当前时间重算历史状态。美股盘前、盘后采用相对最近一次常规交易收盘价的变化；加密货币采用24小时滚动变化，悬停涨跌幅可查看口径。

股票财报时间使用标的当地日期，可通过`earnings.status`和`earnings.session`区分预计或确认、盘前或盘后。加密货币没有财报，保持`null`。

新增运行记录时，先保存`data/snapshots/日期_时间.json`，将同一结果复制为`data/latest.json`，再更新`data/history.json`。这几个文件一起提交，以保证时间与内容一致。JSON格式版本为1；每张表内`id`必须唯一，代码保留为字符串以避免丢失前导零。

## 信号对应

颜色与用户的《均线与价格结构v6》保持一致：`support`青色、`trendStart`橙色、`breakout`绿色、`pullback`紫色。`direction`为`long`时向上，`short`时向下。`earlyExit`始终以红色向下三角呈现，含义是高乖离转弱的止盈观察。

真实数据接入时，应使用脚本最终通过冷却和方向设置的分类信号。盘中信号可能随价格变化出现或消失，每次运行应替换当前结果，不将暂态信号永久累积。
