# 三消关卡编写说明

本目录只负责纯数据关卡、校验、内置目录与关卡测试。共享类型在 `../engine/types.ts`；不要另造运行时 Cell 格式。`schema.ts` 不依赖外部包。

## 目录、API 与增加/删除关卡

- `builtin/*.json`：每文件一关。首批 20 关不是引擎上限；前两关 6×6，第 3—16 关 9×9，第 17—18 关 9×18，第 19—20 关 9×27，每个长图窗口 9 行。
- `registry.ts`：`builtinLevels: Level[]`，使用 eager `import.meta.glob('./builtin/*.json')` 校验并内联，按 `order`、`id` 排序（相同值用 `packId` 稳定打破平局）。文件名仅便于寻找，不决定顺序；README、测试和回放文件不会当成关卡。
- `validateLevel(value: unknown)`：返回 `{level?: Level, errors: string[], warnings: string[]}`。有任何错误就没有 `level`；成功返回独立数据副本。
- `parsePack(text)`：返回 `{levels: Level[], errors: string[]}`；支持单关对象、关卡数组、`{schemaVersion:1,levels:[完整关卡对象]}`。任何一关无效或 `packId/id` 重复，原子返回空数组，调用方不可部分提交。
- `createTemplate()`：新的独立 9×9 空图（无预置动物、障碍、绳、门），随机补齐动物，32 步、各工具 2 次，`stage1` 覆盖全图，收集 18 只小猫。复制模板后须改稳定 id，不能反复以 `new-level` 覆盖旧关。
- `levelKey(level)`：`packId + '/' + id`，也是目录和进度的稳定键。

增加：复制一个相近 JSON → 修改 `id`、`title`、`order` → 改布局/目标 → 运行本目录测试 → 试关 → 重新构建。无需修改 registry 中的列表。删除：移走/删除相应 JSON，再测试、构建。排序：只改 `order`；建议留间隔方便插入。同包同 id 不可重名，不同包可用同 id。

**稳定 id、排序与修订不同**：`id` 表示同一关身份，`order` 只是位置，`revision` 是作者递增的内容修订。改顺序不应改 id；做一关全新的关卡必须换 id；调整旧关步数或障碍时保留 id 并增加 revision。`schemaVersion` 是数据结构，`rulesVersion` 是规则，不是修订号。继续旧存档应使用存档内的关卡快照、规则版本和种子；重新开局才用最新定义。删除或改名不能让旧进度误配到另一关；不能读取旧规则时应明确报错。

## 全字段、默认值与合法范围

**导入不补缺失字段**：除 `seed` 可省略及兼容旧关卡的 `starThresholds` 可省略外，下表所有顶层字段都必填。缺省星级门槛使用 `[1000,2000,3000]`，新导出始终写入完整字段。其余默认值指 `createTemplate()`，不是缺字段时猜测。数组无内容写 `[]`。数字必须是有限整数，不能用字符串、NaN、Infinity、小数。只接受纯 JSON，拒绝未知字段、危险键（`__proto__`、`constructor`、`prototype`）、脚本、HTML 标签、外链、访问器和循环引用。

| 字段 | 模板默认值 | 范围/含义 |
| --- | --- | --- |
| schemaVersion / rulesVersion | 1 / 1 | 当前仅支持 1 |
| packId / id | custom / new-level | 各 1—64 字符，字母或数字开头，其余仅字母、数字、点、下划线、短横线；不得使用危险键名 |
| order / revision | 1 / 1 | order 为 0—1000000；revision 为 1—1000000 |
| title | 新的动物乐园 | 1—80 字符非全空白纯文本，不放 HTML 或资源地址 |
| width / height | 9 / 9 | 宽 3—12，总高 3—60；单个阶段最多 10 行 |
| mask | 9 个 `.........` | 恰好 height 个字符串，每行恰好 width 个字符；`.` 是可玩地板，`#` 是空洞；每段至少有地板 |
| palette | [0,1,2,3] | 3—8 个不重复整数 kind，各 0—27。内置关只用 4—6 个易辨认动物，例如小猫0、兔子2、乌龟4、大象6、熊猫7、蝴蝶8 |
| seed | 20261123 | 可选 0—4294967295 无符号整数；省略使用引擎默认种子。固定种子用于复现，不代表所有种子都必胜 |
| initialPieces | [] | `{row,col,kind,special?}`；kind 必须在 palette；special 可省略或 row / column / bomb / bird。bird 的 kind 仍须合法，但不参与普通颜色匹配。未配置地板由引擎补齐 |
| ice | [] | `{row,col,layers}`，layers 1—3；冰格上的动物可匹配和消除，但不能交换、下落或重排；空冰格仍可从上方补充 |
| blockers | [] | `{row,col,blocker}`，详见下一节，占格且阻挡动物 |
| locks | [] | `{row,col,type}`，type 只能 vine / fur；固定覆盖，下面的动物可预置，也可由引擎自动生成；运行时 lock id 由引擎生成，JSON 不填 |
| ropes | [] | `{from:{row,col},to:{row,col}}`；同段正交相邻地板公共边；反向也算重复；不属于清除目标 |
| portals | [] | `{id,from:{row,col},to:{row,col}}`；id 规则同关卡 id，同关唯一；端点同段、不同格，入口不可重复 |
| spawnPoints | [] | `{row,col}` 数组；空数组表示每条被空洞/障碍/锁定截断的重力通路自动供料；非空则完全使用显式源，不偷偷补源 |
| moves | 32 | 1—10000；限步而非计时；内置关宽松配置，不用少步数制造挫败 |
| starThresholds | [1000,2000,3000] | 三个严格递增的非负安全整数分数门槛，依次对应一星、二星、三星；旧关卡缺字段时使用默认值，新导出始终包含该字段 |
| tools | hammer:2, swap:2, shuffle:2 | 三键都必填，各 0—999，分别小锤子、自由交换、重排 |
| scroll | false | 布尔值；false 必须仅 1 段；true 仍须合法完整覆盖 |
| stages | stage1 从0行开始共9行、goals=[] | `{id,startRow,rows,goals}`；id 同关唯一；startRow 为 0—height-1，rows 为 1—10；按数组顺序从 0 行连续不重叠覆盖整张图，最多60段 |
| goals | 收集18只kind0 | 全局目标数组；可空。各段必须有自己的目标，只有最后一段可 goals=[] 并依靠非空全局目标完成 |

首批内置关卡使用按目标数量和特效密度调校的门槛，不再全部使用默认值。固定种子回放下的门槛如下，实际游玩仍按真实积分计算。

| 关卡 | 一星 | 二星 | 三星 |
| --- | ---: | ---: | ---: |
| 1—2 | 500 / 600 | 900 / 1000 | 1300 / 1400 |
| 3—4 | 500 / 800 | 750 / 1300 | 1000 / 1800 |
| 5—8 | 900 / 1000 / 700 / 700 | 1400 / 1700 / 1200 / 1200 | 1900 / 2400 / 1700 / 1700 |
| 9—12 | 1000 / 700 / 900 / 700 | 1800 / 1200 / 1600 / 1200 | 2600 / 1650 / 2300 / 1650 |
| 13—16 | 1000 / 1100 / 800 / 250 | 1800 / 2000 / 1400 / 500 | 2500 / 2800 / 1900 / 750 |
| 17—20 | 1500 / 1800 / 1600 / 2400 | 2400 / 2800 / 2600 / 3600 | 3100 / 3500 / 3200 / 4500 |

所有配置坐标 **0 基行/列**：左上角 `{row:0,col:0}`，9×9 的右下角 `{row:8,col:8}`。第二段第一行是 `row:9`，不是重新从 0 开始。运行时才用 `row * width + col` 的一维 Cell 下标，JSON 不接受 flat index。

同类坐标不能重复；initialPieces、ice、blockers、locks、spawnPoints 各最多 width×height 项；ropes 最多两倍格数，portals 最多格数。跨层只允许明确的合法组合：**动物 + 冰 + 一种 lock 合法**；ice 可和空动物地板或后续自动生成动物叠加；任何 blocker 不可与 initialPieces、ice、lock 叠加；vine 与 fur 不可同时覆盖一个格子；任何配置点不可落在 `#`。绳和门是边/路径信息，可以关联障碍所在的地板，障碍在时暂时截断，消失后恢复原路径。

### 九种障碍的配置

blocker 是以下严格联合类型，不能混填其他分支字段：

- snow：`{"type":"snow","layers":1}`，1—5 层；相邻消除或特效命中每波减一层。
- gift：`{"type":"gift","color":0,"reward":{"tool":"hammer","count":1}}`；color 必须在 palette，tool 为 hammer / swap / shuffle，count 为 1—99；相邻同色消除或同色特效打开，锤子直接打开，每盒只奖励一次。
- poison：`{"type":"poison"}`；相邻消除/特效/锤子可清除。普通回合未清毒则扩张一次，道具不推进扩张；目标数量超过初始毒液只给可达性警告，不伪称能够产生足够毒液。
- crystal：`{"type":"crystal","colors":[0,2,4],"index":0}`；colors 为 1—8 个不重复的 palette 颜色；index 为 0—colors.length-1，指定初始颜色，普通回合末按序变色。
- ice 使用顶层 ice，1—3层；vine、fur 使用 locks。毛球每普通回合末可能跳到相邻未锁定动物；藤蔓固定不动；被覆盖的动物不能交换/下落/重排。
- rope 和 portal 分别使用 ropes、portals；它们是第八、第九种机制，不是可清除实体。

### 目标

每项都需要全关唯一的 `id`（包括全局和所有段之间）、`type`、正整数 `count`。全局最多64项，每段最多64项。可以有多个同类目标，共用真实事件计数，不应把不同目标的 count 简单求和当成资源需求。

| type | 额外字段 | count 上限/含义 |
| --- | --- | --- |
| collect | kind，必须在 palette | 1—1000000，只统计真实消除的该动物 |
| clear | obstacle、unit | 1—1000000；obstacle 为 ice/snow/vine/gift/poison/fur/crystal；unit 为 layers 或 objects |
| special | special | 1—1000000；row/column/bomb/bird，统计实际触发，不是仅生成 |
| score | 无 | 1—1000000000，累计真实得分 |

`layers` 是减掉的层数，`objects` 是彻底清掉的实体数；3层冰最多提供3层/1实体。没有多层参数的障碍每次清除提供1层/1实体。静态障碍目标不能超过配置资源；段目标只能使用本段资源。毒液没有初始源时不能设清毒目标，有初始源时数量可随扩张变化，只警告而不做不可靠的静态上界证明。毛球、水晶、异形和门户的实战可达性也必须试关；合法 JSON 不等于一定能通关。过早离开某段后不能回来补全局目标，请合理分配局部要求。

### 门户与供料约束

门户的 from **替代该格普通向下出边**，不是额外添加两条出路；其余地板在同段向下连接紧邻地板。空洞和段边界截断普通路径。把普通边与门边一起检查：不能自环/循环，任何格不能有两个入边（普通+门户、两个门户均不行）。即使当前有雪块挡路，也按最终清掉障碍的完整图检查，不能靠临时障碍遮住循环。

安全例子：第8行第2列入口 → 第0行第6列出口，两列形成单向长通路；反向再连回来会成环。若出口在中间一行，需用空洞截断其原有上方入边，或者由别的门户替代原上方出边。

推荐 `spawnPoints:[]` 自动供料。显式模式须能覆盖完整图，以及初始 blocker/lock 截断后的每条通路；只写第一行但中间有洞/障碍通常不够，要补写下方源。毒液、毛球可能动态截断路径，显式模式仍须实际试关，不能静态保证每个未来局面有源。

## 可直接导入的完整 9×9 示例

下面每个 json 代码块都是**完整单关**，被测试逐块执行 `parsePack`，不是要复制进去的局部补丁。完整包只要把这些对象放入 levels 数组即可，不要把说明文字或 Markdown 围栏放进 JSON 文件。

```json
{
  "schemaVersion":1,"rulesVersion":1,"packId":"custom","id":"nine-square","order":1,"revision":1,"title":"九格宽的动物乐园",
  "width":9,"height":9,
  "mask":[".........",".........",".........",".........",".........",".........",".........",".........","........."],
  "palette":[0,2,4,7],"seed":20261123,
  "initialPieces":[],"ice":[],"blockers":[],"locks":[],"ropes":[],"portals":[],"spawnPoints":[],
  "moves":32,"tools":{"hammer":2,"swap":2,"shuffle":2},"scroll":false,
  "stages":[{"id":"stage1","startRow":0,"rows":9,"goals":[]}],
  "goals":[{"id":"cats","type":"collect","kind":0,"count":18}]
}
```

调整难度先增加 moves、降低 count 或把 palette 从6种减至4种，不要用大量难辨认种类挤满棋盘。改 palette 时必须同步所有预置动物、礼盒颜色、水晶序列和 collect 目标。

## 异形、多层冰雪与绳边示例

含缺角与中央孔，冰和藤蔓合法叠加；锁下动物自动补齐。雪块与冰放在不同格。

```json
{
  "schemaVersion":1,"rulesVersion":1,"packId":"custom","id":"shaped-garden","order":2,"revision":1,"title":"池塘边的冰雪",
  "width":9,"height":9,
  "mask":["#.......#",".........",".........",".........","....#....",".........",".........",".........","#.......#"],
  "palette":[0,2,4,7],"seed":2202,"initialPieces":[],
  "ice":[{"row":2,"col":2,"layers":2}],
  "blockers":[{"row":5,"col":5,"blocker":{"type":"snow","layers":3}}],
  "locks":[{"row":2,"col":2,"type":"vine"}],
  "ropes":[{"from":{"row":3,"col":3},"to":{"row":3,"col":4}}],"portals":[],"spawnPoints":[],
  "moves":48,"tools":{"hammer":2,"swap":2,"shuffle":2},"scroll":false,
  "stages":[{"id":"stage1","startRow":0,"rows":9,"goals":[]}],
  "goals":[{"id":"snow","type":"clear","obstacle":"snow","unit":"layers","count":3},{"id":"ice","type":"clear","obstacle":"ice","unit":"layers","count":2}]
}
```

## 传送门、礼盒奖励与水晶示例

门连底部到另一列顶部，不形成环或歧义入边。小锤子可打开礼盒，奖励两次自由交换。

```json
{
  "schemaVersion":1,"rulesVersion":1,"packId":"custom","id":"portal-gifts","order":3,"revision":1,"title":"门后的彩色礼物",
  "width":9,"height":9,
  "mask":[".........",".........",".........",".........",".........",".........",".........",".........","........."],
  "palette":[0,2,4,7],"seed":2203,"initialPieces":[],"ice":[],
  "blockers":[{"row":3,"col":3,"blocker":{"type":"gift","color":0,"reward":{"tool":"swap","count":2}}},{"row":5,"col":5,"blocker":{"type":"crystal","colors":[0,2,4],"index":1}}],
  "locks":[],"ropes":[],"portals":[{"id":"gate","from":{"row":8,"col":2},"to":{"row":0,"col":6}}],"spawnPoints":[],
  "moves":48,"tools":{"hammer":2,"swap":2,"shuffle":2},"scroll":false,
  "stages":[{"id":"stage1","startRow":0,"rows":9,"goals":[]}],
  "goals":[{"id":"gifts","type":"clear","obstacle":"gift","unit":"objects","count":1},{"id":"crystals","type":"clear","obstacle":"crystal","unit":"objects","count":1}]
}
```

## 9×18 分段滚动示例

每段9行，只有当前段参与操作、重力、特效、动态障碍。第一段结束后冻结，剩余步数、道具和全局进度延续。第二段 goals=[] 合法，因为它是末段且全局目标不为空。

```json
{
  "schemaVersion":1,"rulesVersion":1,"packId":"custom","id":"two-gardens","order":4,"revision":1,"title":"两座花园",
  "width":9,"height":18,
  "mask":[".........",".........",".........",".........",".........",".........",".........",".........",".........","#.......#",".........",".........",".........",".........",".........",".........",".........","#.......#"],
  "palette":[0,2,4,7],"seed":2204,"initialPieces":[],"ice":[],"blockers":[],"locks":[],"ropes":[],"portals":[],"spawnPoints":[],
  "moves":64,"tools":{"hammer":2,"swap":2,"shuffle":2},"scroll":true,
  "stages":[{"id":"first","startRow":0,"rows":9,"goals":[{"id":"first-cats","type":"collect","kind":0,"count":15}]},{"id":"second","startRow":9,"rows":9,"goals":[]}],
  "goals":[{"id":"journey-rabbits","type":"collect","kind":2,"count":36}]
}
```

## 两种使用流程与离线限制

1. **改源文件后构建**：修改 `src/match3/levels/builtin/*.json` → 测试、试关 → 在项目根目录 `npm run build` → 分发新生成的 `dist/index.html`。JSON eager 打包在单 HTML 里，离线运行时不 fetch 本目录文件、不下载外链图片、不连接服务端。
2. **游戏中导入/编辑**：文件选择单关或整包 → 校验和差异预览 → 同 `packId/id` 明确选择覆盖/另存/取消 → 保存到独立自定义目录。修改内置关建议复制到 custom 包，不覆盖原定义。编辑器导出是浏览器下载 JSON，**不会自动改写本项目文件夹或旧 HTML**；想纳入下次构建，作者需把导出文件手动放进 builtin 并检查 packId/id。删除自定义配置不等于删除已下载文件。

包限制：每关序列化 UTF-8 JSON 最多256 KiB，每包输入最多2 MiB，每包1—200关；200是导入安全限额，20只是首批数量。错误不能改变现有关卡目录/存档；存储不足时保留草稿并提供导出，不报告保存成功。本模块只解析数据，覆盖确认、存储和下载由上层负责。正常进度、自定义目录、编辑草稿分别使用三消独立存储，不使用连连看旧存档键。

## 道具、试关与测试模式

- 小锤子优先损伤冰/覆盖/占格障碍，否则消除动物；打中特效会触发。自由交换只允许相邻可移动动物，可跨绳但不可跨洞/冰/锁；重排保留障碍、覆盖和特效，不能移动冰上或锁下动物。三者均不扣普通步数、不推进毒液/毛球/水晶的回合行动。礼盒奖励只在本局有效，重试重置。
- 编辑器试关用当前草稿的独立会话，不写正常解锁/成绩，不能把“结构合法”显示成“已验证必胜”。可重置，查看目标并单步操作。
- 独立“测试／破解模式”不是编辑器替代品：任选内置/导入关、无限步数（默认开）、无限道具（默认开）、自动走一步、重开本关、一键通关、立即失败、退出测试。自动一步必须执行真实合法交换；无限资源不绕过位置规则；一键通关只检查结算界面，不是关卡可通关证明。
- 测试不写正常存档、解锁、成绩；退出恢复正常局暂停状态；刷新不恢复测试局。暂停期间不能操作或推进动态障碍。固定种子胜利回放必须用 normal 模式和真实交换/道具，不能用 COMPLETE 或直接改目标计数。

## 常见错误与验证命令

错误包含字段路径和必要坐标，如 `ice: (2,2) 不可与占格 blocker 叠加`、`stages[1]: 阶段须按行连续`、`portals: 存在歧义入边`、`goals.ice: 目标超过可清层数`。先修错误，再读 warnings；动态毒液、毛球、水晶及特殊地形警告要求实际试关，不应当作格式错误拦截。预置动物已有三连会提示警告，请改为待交换的教学布局，不能依靠开局自动消除偷过关。

在项目根目录运行：

```sh
npx vitest run src/match3/levels --maxWorkers=2
```

测试覆盖严格 unknown、恶意/未知字段、大小限制、尺寸、层叠、枚举、目标上界、段覆盖、绳边、门户DAG、显式供料、原子导入、20关顺序/尺寸/九机制覆盖以及本说明所有 JSON 块。还检查无开局三连、额外三个种子的合法动作稳定性，并对 `winning-replays.json` 中全部20关固定种子胜利路线各重放两次，断言确定性、真实目标完成、正常步数和道具限制。回放的 `[from,to]` 是运行时一维交换下标，`["hammer",at]` 是锤击，`["shuffle"]` 是重排；这不是关卡 JSON 坐标格式。

改关后原路线可能失效。`replays.test.ts` 内有仅供开发使用的有限动作搜索器，不在游戏运行时加载；它只调用真实 SWAP/HAMMER/SHUFFLE，没有 COMPLETE、无限资源或直接改棋盘。可在 Git Bash 显式重新生成全部路线（仅全部成功才覆盖回放文件），然后重新运行正常测试：

```sh
M3_GENERATE_REPLAYS=1 npx vitest run src/match3/levels/replays.test.ts --maxWorkers=1
npx vitest run src/match3/levels --maxWorkers=2
```

有限贪心搜索失败不证明关卡无解，可人工试关改进布局或提供真实操作路线；不能用强制通关代替验收。单个种子的胜利仅证明存在这条路线，不能推论任意种子和操作都能通关。
