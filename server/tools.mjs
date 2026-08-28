// tools.mjs — 能被"手机遥控"运行的本地工具白名单。
//
// 这是人生之书「智能体 → 交互键 → 跑本机」能力的唯一登记处。
// 家人电脑上能跑的脚本，只有这里列出来的才会被 /api/v1/tools/run 执行。
// 手机端只能通过 id 触发，不能传任意命令 —— 白名单就是安全边界。
//
// 【加一个新脚本】只需在下面数组里加一个对象，不用改任何代码：
//   {
//     id: '唯一英文id',            // 界面/接口用来指名哪个脚本
//     name: '显示给家人看的名字',     // 智能体面板下拉里显示
//     cmd: '可执行程序',            // 比如 'python' / 'node' / 'ffmpeg'
//     args: ['参数1', '参数2'],      // 固定参数（运行时不传参）
//     workdir: '工作目录',          // 脚本运行时的当前目录（可选）
//     timeoutMs: 120000           // 超时（毫秒），合成视频这类要给足
//   }
//
// 说明：脚本都在"家人电脑"上执行（手机跑不了 python/ffmpeg）。
// 手机只是发指令、看结果的遥控器，本地不存脚本。
//
// ⚠️ 双重门才能生效：改了这个白名单，还要在服务端 .env 设 ENABLE_TOOLS=1，
//    /api/v1/tools/* 接口才会开放。默认关，防"公网能触发本机脚本"被误开。

export const TOOL_WHITELIST = [
  {
    id: 'bilibili-merge',
    name: 'B站视频合成',
    cmd: 'python',
    args: [
      'C:/Users/l2535/Desktop/jiaoben/bilibili_videos.py',
      'C:/Users/l2535/Downloads/1111',        // 素材来源（B站 DASH 分片）
      'C:/Users/l2535/Desktop/jiaoben'        // 合成后输出
    ],
    workdir: 'C:/Users/l2535/Desktop/jiaoben',
    timeoutMs: 120000
  }
];

// 按 id 找工具，找不到返回 null。
export function findTool(id) {
  return TOOL_WHITELIST.find((t) => t.id === id) || null;
}
