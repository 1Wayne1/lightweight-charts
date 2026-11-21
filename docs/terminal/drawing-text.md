# 绘图对象附加文字

依据 TradingView 官方帮助中的文字入口和设置截图实现，范围限于当前已有绘图工具。资料核对的是官方文档与截图，未声称复刻其未公开实现。

## 支持范围

| 对象 | 图上文字与设置 |
| --- | --- |
| 趋势线、射线、延长线、水平线、水平射线、箭头、双向箭头 | 沿线显示，可选上方 / 居中 / 下方、左 / 中 / 右；斜线文字跟随斜率。双向箭头沿用箭头实现 |
| 垂直线 | 顶部 / 中间 / 底部，水平或垂直文字方向 |
| 矩形 | 默认居中，支持文字位置和水平对齐 |
| 圆、椭圆 | 中心显示纯文字 |
| 平行通道、平顶 / 平底通道、不相交通道 | 文字跟随通道斜率，可选上方 / 内部 / 下方及水平对齐 |
| 价格范围、日期范围、价格与日期范围 | 自定义备注与统计标签独立显示 |
| 向上 / 向下箭头标记 | 备注在标记旁，箭头保持固定大小，标记颜色与文字颜色独立 |
| 斐波那契回撤、趋势斐波那契扩展 | 每个可见层级独立文字，沿用层级颜色，共用字号与位置 / 对齐设置 |

普通对象的文字设置提供显示开关、颜色、字号、粗体、斜体、不透明度和多行文本。主文字标注工具也支持粗体、斜体和文字不透明度。斐波那契文字在样式页的各层级行中编辑，不提供没有官方依据的独立粗体 / 斜体入口。

信息线、趋势角度的统计说明与自定义备注不同；旋转矩形、三角形、十字线及旗形标记没有在本次核对资料中确认自定义文字入口，未添加入口。

## 交互

- 选中对象时，空文字位置显示“添加文字”；未选中、隐藏、锁定或关闭文字显示时不出现空提示。
- 点击图上的文字或提示直接输入。Enter 确定、Shift Enter 换行、Escape 取消，也可点勾确认或点击外部保存；中文输入法候选确认不会提前提交。
- 工具操作栏可添加 / 编辑文字；齿轮或双击对象打开设置，文字页可整体修改。设置对话框使用独立草稿，取消无改动。
- 一次提交只有一个撤销记录。切换图表会销毁仍打开的编辑器；编辑器跟随图上锚点并限制在可见视口内，适配手机横竖屏和软键盘可见区域。

## 存储兼容

继续使用 schemaVersion 1 的可选样式字段扩展。新增 `attachedText` 与旧的主标注 `text` 分开，旧线条的默认 `Text` 或 `标注` 不会变成可见备注。缺省附加文字为空；缺省文字样式由插件补齐。`fibLevels[].text` 可选，旧层级继续正常读取。

解析时校验文字长度、布尔值、对齐枚举和不透明度范围；未知属性及不支持版本仍保留原始数据并阻止覆盖。文字随画线保存，仍只持久化 UTC 时间与价格锚点，不保存屏幕位置。撤销 / 重做、删除墓碑、跨周期与历史补齐沿用现有流程。

## 官方依据

- [趋势线文字与对齐](https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/)
- [水平线](https://www.tradingview.com/support/solutions/43000518124-horizontal-line-drawing-tool/) / [水平射线](https://www.tradingview.com/support/solutions/43000518121-horizontal-ray-drawing-tool/) / [垂直线文字方向](https://www.tradingview.com/support/solutions/43000518093-vertical-line-drawing-tool/)
- [射线](https://www.tradingview.com/support/solutions/43000518113-ray-drawing-tool/) / [延长线](https://www.tradingview.com/support/solutions/43000518131-extended-line-drawing-tool/) / [箭头](https://www.tradingview.com/support/solutions/43000518134-arrow-drawing-tool/)
- [矩形](https://www.tradingview.com/support/solutions/43000516984-rectangle-drawing-tool/) / [圆和椭圆文字](https://www.tradingview.com/support/solutions/43000672263-how-do-you-add-text-to-a-circle-or-ellipse/)
- [通道文字](https://www.tradingview.com/support/solutions/43000710744-how-to-add-text-to-channel-drawing-tools/)
- [日期与价格范围](https://www.tradingview.com/support/solutions/43000516996-date-and-price-range-drawing-tools/) / [箭头标记](https://www.tradingview.com/support/solutions/43000518087-arrow-marks-drawing-tools/)
- [斐波那契回撤](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) / [趋势斐波那契扩展](https://www.tradingview.com/support/solutions/43000518137-trend-based-fib-extension-drawing-tool/)
