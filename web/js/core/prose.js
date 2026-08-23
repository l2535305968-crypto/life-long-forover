// 人生之书：传记文风规则与时代锚点
// 纯数据，机器可检查。正则一律用字符串表示，宿主自行 new RegExp(source, flags)。
// 底线：传记正文只能写老人真说过的话，禁止替老人编造场景、天气、对白、心理。

export const prose = {
  version: '1.0',

  // ============ 硬禁令：命中即不合格 ============
  banned: [
    {
      id: 'colon',
      name: '中英文冒号',
      pattern: { source: '[：:]', flags: 'g' },
      allowIn: ['url'],
      hint: '把冒号拆成两句普通话，时间写成三点半，不要写 3:30',
      severity: 'error'
    },
    {
      id: 'emDash',
      name: '破折号',
      pattern: { source: '—', flags: 'g' },
      allowIn: [],
      hint: '改成逗号或句号',
      severity: 'error'
    },
    {
      id: 'enDash',
      name: '连接号式破折号',
      pattern: { source: '–', flags: 'g' },
      allowIn: [],
      hint: '这是英文短横，改成中文标点',
      severity: 'error'
    },
    {
      id: 'notBut',
      name: '不是而是',
      pattern: { source: '不是[^。！？]{1,20}而是', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，直接说事实',
      severity: 'error'
    },
    {
      id: 'bingFei',
      name: '并非而是',
      pattern: { source: '并非[^。！？]{1,20}而是', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，直接说事实',
      severity: 'error'
    },
    {
      id: 'buZaiYu',
      name: '不在于而在于',
      pattern: { source: '不在于[^。！？]{1,20}而在于', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，拆成两句普通话说',
      severity: 'error'
    },
    {
      id: 'yuQiShuo',
      name: '与其说不如说',
      pattern: { source: '与其说[^。！？]{1,20}不如说', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，直接说事实',
      severity: 'error'
    },
    {
      id: 'buZhiHuan',
      name: '不只还也',
      pattern: { source: '不只[^。！？]{1,20}[还也]', flags: 'g' },
      allowIn: [],
      hint: '递进翻案句式，拆开说',
      severity: 'error'
    },
    {
      id: 'biaoMian',
      name: '表面实际',
      pattern: { source: '表面[^。！？]{1,20}实际', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，直接说事实',
      severity: 'error'
    },
    {
      id: 'kanSi',
      name: '看似实则',
      pattern: { source: '看似[^。！？]{1,20}实则', flags: 'g' },
      allowIn: [],
      hint: '翻案句式，直接说事实',
      severity: 'error'
    },
    {
      id: 'shuoBaiLe',
      name: '说白了',
      pattern: { source: '说白了', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉，直接说事',
      severity: 'error'
    },
    {
      id: 'shuoChuanLe',
      name: '说穿了',
      pattern: { source: '说穿了', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉，直接说事',
      severity: 'error'
    },
    {
      id: 'xianShuoJieLun',
      name: '先说结论',
      pattern: { source: '先说结论', flags: 'g' },
      allowIn: [],
      hint: '汇报腔，老人不这么说话',
      severity: 'error'
    },
    {
      id: 'gengWeiMiao',
      name: '更微妙的是',
      pattern: { source: '更微妙的是', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'haiYouYiCeng',
      name: '还有一层',
      pattern: { source: '还有一层', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'zhiShuoDuiYiBan',
      name: '只说对了一半',
      pattern: { source: '只说对了一半', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'zhiDeZhuYi',
      name: '值得注意的是',
      pattern: { source: '值得注意的是', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'xuYaoZhiChu',
      name: '需要指出的是',
      pattern: { source: '需要指出的是', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'congMouYiYiShuo',
      name: '从某种意义上说',
      pattern: { source: '从某种意义上说', flags: 'g' },
      allowIn: [],
      hint: '洞察路标，删掉',
      severity: 'error'
    },
    {
      id: 'fuNeng',
      name: '赋能',
      pattern: { source: '赋能', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成人、动作和钱',
      severity: 'error'
    },
    {
      id: 'biHuan',
      name: '闭环',
      pattern: { source: '闭环', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成事情怎么一件件做完',
      severity: 'error'
    },
    {
      id: 'zhuaShou',
      name: '抓手',
      pattern: { source: '抓手', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成具体做的事',
      severity: 'error'
    },
    {
      id: 'diCengLuoJi',
      name: '底层逻辑',
      pattern: { source: '底层逻辑', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成日子怎么过的',
      severity: 'error'
    },
    {
      id: 'keLiDu',
      name: '颗粒度',
      pattern: { source: '颗粒度', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成熟不细致',
      severity: 'error'
    },
    {
      id: 'xinZhi',
      name: '心智',
      pattern: { source: '心智', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成老人的想法',
      severity: 'error'
    },
    {
      id: 'laQi',
      name: '拉齐',
      pattern: { source: '拉齐', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成说拢了、讲明白了',
      severity: 'error'
    },
    {
      id: 'duiQi',
      name: '对齐',
      pattern: { source: '对齐', flags: 'g' },
      allowIn: [],
      hint: '商业黑话，换成商量好了',
      severity: 'error'
    },
    {
      id: 'fuPan',
      name: '复盘（传记语境）',
      pattern: { source: '复盘', flags: 'g' },
      allowIn: [],
      hint: '工作词，老人不这么说，写那阵子怎么过的',
      severity: 'error'
    },
    {
      id: 'shiDaiYiLiSha',
      name: '时代的一粒沙',
      pattern: { source: '时代的一粒沙', flags: 'g' },
      allowIn: [],
      hint: '借喻包装，删掉，写老人自己的经历',
      severity: 'error'
    },
    {
      id: 'mingYunChiLun',
      name: '命运的齿轮',
      pattern: { source: '命运的齿轮', flags: 'g' },
      allowIn: [],
      hint: '借喻包装，删掉，写老人自己的经历',
      severity: 'error'
    }
  ],

  // ============ 警告词：结合语境判断，不直接判不合格 ============
  warnings: [
    { id: 'journey', name: '旅程', pattern: { source: '旅程', flags: 'g' }, hint: '老人不这么说，改成那些年、那阵子', severity: 'warn' },
    { id: 'zhengCheng', name: '征程', pattern: { source: '征程', flags: 'g' }, hint: '改成具体的日子', severity: 'warn' },
    { id: 'chenDian', name: '沉淀', pattern: { source: '沉淀', flags: 'g' }, hint: '只说化学沉淀时才保留，其余换说法', severity: 'warn' },
    { id: 'xieTong', name: '协同', pattern: { source: '协同', flags: 'g' }, hint: '换成一家人怎么搭把手', severity: 'warn' },
    { id: 'lianLu', name: '链路', pattern: { source: '链路', flags: 'g' }, hint: '换成事情的前后经过', severity: 'warn' },
    { id: 'shengTaiWei', name: '生态位', pattern: { source: '生态位', flags: 'g' }, hint: '说本义才保留', severity: 'warn' },
    { id: 'fanShi', name: '范式', pattern: { source: '范式', flags: 'g' }, hint: '换成老人的习惯做法', severity: 'warn' },
    { id: 'fangFaLun', name: '方法论', pattern: { source: '方法论', flags: 'g' }, hint: '换成具体的做法', severity: 'warn' },
    { id: 'heXinBianLiang', name: '核心变量', pattern: { source: '核心变量', flags: 'g' }, hint: '换成影响日子的事', severity: 'warn' },
    { id: 'shiDaiHongLiu', name: '时代的洪流', pattern: { source: '时代的洪流', flags: 'g' }, hint: '借喻，换成老人的具体经历', severity: 'warn' },
    { id: 'liShiCheLun', name: '历史的车轮', pattern: { source: '历史的车轮', flags: 'g' }, hint: '借喻，别用', severity: 'warn' },
    { id: 'jianZheng', name: '见证', pattern: { source: '见证', flags: 'g' }, hint: '换成亲眼看见、赶上这类说法', severity: 'warn' },
    { id: 'jingCaiRenSheng', name: '精彩人生', pattern: { source: '精彩人生', flags: 'g' }, hint: '替老人下结论了', severity: 'warn' },
    { id: 'pingFanWeiDa', name: '平凡而伟大', pattern: { source: '平凡而伟大', flags: 'g' }, hint: '替老人下结论了', severity: 'warn' },
    { id: 'chuanCheng', name: '传承', pattern: { source: '传承', flags: 'g' }, hint: '老人会说留给后人的话，不说传承', severity: 'warn' },
    { id: 'jingShenCaiFu', name: '精神财富', pattern: { source: '精神财富', flags: 'g' }, hint: '产品话，换成老人原话', severity: 'warn' },
    { id: 'zhengRong', name: '峥嵘', pattern: { source: '峥嵘', flags: 'g' }, hint: '文绉绉，老人不这么说', severity: 'warn' },
    { id: 'cangHaiSangTian', name: '沧海桑田', pattern: { source: '沧海桑田', flags: 'g' }, hint: '成语抬价，换白话', severity: 'warn' },
    { id: 'wenDu', name: '温度', pattern: { source: '温度', flags: 'g' }, hint: '只在说天气或体温时保留', severity: 'warn' },
    { id: 'langChao', name: '浪潮', pattern: { source: '浪潮', flags: 'g' }, hint: '借喻包装抽象概念时提醒', severity: 'warn' },
    { id: 'yaoShi', name: '钥匙', pattern: { source: '钥匙', flags: 'g' }, hint: '借喻包装时提醒，说真钥匙没事', severity: 'warn' },
    { id: 'cangKu', name: '仓库', pattern: { source: '仓库', flags: 'g' }, hint: '借喻包装时提醒', severity: 'warn' },
    { id: 'chouTi', name: '抽屉', pattern: { source: '抽屉', flags: 'g' }, hint: '借喻包装时提醒', severity: 'warn' },
    { id: 'tanTa', name: '坍塌', pattern: { source: '坍塌', flags: 'g' }, hint: '借喻包装时提醒，说房子塌了没事', severity: 'warn' }
  ],

  // ============ 传记段落模板 ============
  templates: [
    // 开篇：名字与出生
    { id: 'birth-plain', stage: 'opening', needs: ['name', 'birthPlace'], text: '{{name}}生在{{birthPlace}}。', note: '最朴素的出生写法，地点只写老人说过的' },
    { id: 'birth-with-year', stage: 'opening', needs: ['name', 'birthYear', 'birthPlace'], text: '{{name}}是{{birthYear}}年生在{{birthPlace}}的。', note: '出生年按老人原话说，拿不准就不要用这条' },
    { id: 'opening-hometown', stage: 'opening', needs: ['name', 'birthPlace', 'familyRoots'], text: '{{name}}的根在{{birthPlace}}，家里{{familyRoots}}。', note: 'familyRoots 填老人说过的家世，比如祖上种地' },

    // 童年：吃住
    { id: 'childhood-food', stage: 'childhood', needs: ['childhoodFood'], text: '小时候吃的是{{childhoodFood}}。', note: '吃食按老人原话写，不要添油加醋' },
    { id: 'childhood-food-hard', stage: 'childhood', needs: ['childhoodFood', 'childhoodFoodHard'], text: '小时候吃{{childhoodFood}}，{{childhoodFoodHard}}。', note: '后半句填老人自己说的难处，比如常常吃不饱' },
    { id: 'childhood-home', stage: 'childhood', needs: ['childhoodHome'], text: '小时候的家在{{childhoodHome}}。', note: '土房就是土房，按老人说的写' },
    { id: 'childhood-play', stage: 'childhood', needs: ['childhoodPlay'], text: '放学没有旁的玩，{{childhoodPlay}}就算一天里最快活的事。', note: '玩的法子按老人原话说' },

    // 上学
    { id: 'school-name', stage: 'schooling', needs: ['schoolName'], text: '书是在{{schoolName}}念的。', note: '学堂名字按老人说的写' },
    { id: 'school-distance', stage: 'schooling', needs: ['schoolDistance'], text: '上学要走{{schoolDistance}}，来回都是靠两条腿。', note: '路程按老人原话说，比如三里地' },
    { id: 'school-end', stage: 'schooling', needs: ['schoolEndReason'], text: '后来{{schoolEndReason}}，书没再念下去。', note: 'schoolEndReason 填老人说的原因，比如家里供不起' },

    // 青年：第一份活计
    { id: 'first-job-age', stage: 'youth', needs: ['firstJob', 'firstJobAge'], text: '{{firstJobAge}}岁那年，他头一回出去挣钱，干的是{{firstJob}}。', note: '年龄和活计都按老人原话' },
    { id: 'first-job-place', stage: 'youth', needs: ['firstJob', 'firstJobPlace'], text: '第一份活计在{{firstJobPlace}}，做{{firstJob}}。', note: '地点按老人说的写' },
    { id: 'first-job-pay', stage: 'youth', needs: ['firstJob', 'firstJobPay'], text: '干{{firstJob}}挣得不多，一个月{{firstJobPay}}。', note: '工钱按老人原话写，他说多少就多少' },

    // 成家与生养
    { id: 'wedding-year', stage: 'family', needs: ['spouse', 'weddingYear'], text: '{{weddingYear}}年成的家，老伴是{{spouse}}。', note: '结婚年份按老人原话' },
    { id: 'wedding-plain', stage: 'family', needs: ['spouse'], text: '老伴叫{{spouse}}，两个人搭伙过了几十年。', note: '只在老人愿意提老伴时用' },
    { id: 'children-count', stage: 'family', needs: ['children'], text: '孩子一共{{children}}个。', note: '个数按老人原话' },
    { id: 'raising-kids', stage: 'family', needs: ['children', 'raisingHard'], text: '拉扯{{children}}个孩子那些年，{{raisingHard}}。', note: 'raisingHard 填老人自己说的难处' },

    // 中年：搬迁、最难的一年、手艺、老物件
    { id: 'move-plain', stage: 'midlife', needs: ['movedFrom', 'movedTo'], text: '后来从{{movedFrom}}搬到了{{movedTo}}，日子换了过法。', note: '搬家和过法都要老人说过才用' },
    { id: 'move-year', stage: 'midlife', needs: ['movedFrom', 'movedTo', 'moveYear'], text: '{{moveYear}}年，全家从{{movedFrom}}搬到{{movedTo}}。', note: '年份按老人原话' },
    { id: 'hardest-year', stage: 'midlife', needs: ['hardestYear', 'hardestThing'], text: '最难的是{{hardestYear}}年，{{hardestThing}}。', note: '最难的事填老人原话，不替他挑' },
    { id: 'hardest-plain', stage: 'midlife', needs: ['hardestThing'], text: '他这辈子最难的关口，他说是{{hardestThing}}。', note: '他说是三个字不能省，那是老人自己的判断' },
    { id: 'craft-years', stage: 'midlife', needs: ['craft', 'craftYears'], text: '{{craft}}这门手艺，他做了{{craftYears}}年。', note: '手艺名和年数按老人原话' },
    { id: 'craft-teacher', stage: 'midlife', needs: ['craft', 'craftTeacher'], text: '{{craft}}是{{craftTeacher}}教他的。', note: '师傅按老人说的写' },
    { id: 'object-kept', stage: 'midlife', needs: ['objectName'], text: '家里那件{{objectName}}，到现在还留着。', note: '老物件按老人说的写' },
    { id: 'object-story', stage: 'midlife', needs: ['objectName', 'objectStory'], text: '那件{{objectName}}，{{objectStory}}。', note: '物件的来历按老人原话' },

    // 晚年：退休与日常
    { id: 'retire-year', stage: 'later', needs: ['retirementJob', 'retiredYear'], text: '{{retiredYear}}年退休，退休前做了一辈子{{retirementJob}}。', note: '退休年份按老人原话' },
    { id: 'retire-plain', stage: 'later', needs: ['retirementJob'], text: '退休前他做{{retirementJob}}，退了休才算闲下来。', note: '闲下来是老人自己的说法才用' },
    { id: 'daily-life', stage: 'later', needs: ['dailyLife'], text: '如今的日子，{{dailyLife}}。', note: '照抄老人描述现在日子的原话' },
    { id: 'hobby', stage: 'later', needs: ['hobby'], text: '他现在每天{{hobby}}，日子不闷。', note: '日子不闷只在老人流露过这个意思时用' },

    // 随时可用
    { id: 'food-memory', stage: 'anytime', needs: ['foodMemory'], text: '说到吃，他记得{{foodMemory}}。', note: '吃的记忆按老人原话' },
    { id: 'transport-memory', stage: 'anytime', needs: ['transportMemory'], text: '年轻那会儿出远门，{{transportMemory}}。', note: '出行的记忆按老人原话' },
    { id: 'money-memory', stage: 'anytime', needs: ['moneyMemory'], text: '那阵子钱值钱，{{moneyMemory}}。', note: '钱的事按老人原话，比如几分钱一根冰棍' },
    { id: 'neighbor-story', stage: 'anytime', needs: ['neighborStory'], text: '老街坊的事，他记得{{neighborStory}}。', note: '街坊的事按老人原话' },

    // 收尾：想留给后人的话
    { id: 'words-for-kids', stage: 'closing', needs: ['wordsForDescendants'], text: '他想留给后人的话不多，{{wordsForDescendants}}。', note: '话要老人自己说过的' },
    { id: 'words-plain', stage: 'closing', needs: ['wordsForDescendants'], text: '到末了他说，{{wordsForDescendants}}。', note: '引用老人原话' },
    { id: 'closing-today', stage: 'closing', needs: ['name', 'laterLife'], text: '如今{{name}}在{{laterLife}}，这是他现在过着的日子。', note: '只写老人说过的现状' },
    { id: 'closing-wish', stage: 'closing', needs: ['familyWish'], text: '他盼着家里人{{familyWish}}。', note: '盼头按老人原话' },
    { id: 'closing-end', stage: 'closing', needs: ['name'], text: '{{name}}这一辈子，就讲到这里。', note: '全书收尾，不作总结升华' }
  ],

  // ============ 段落连接说法（不用路标词） ============
  connectors: [
    '那几年',
    '再往后',
    '这中间',
    '后来',
    '再后来',
    '那时候',
    '那阵子',
    '转过年来',
    '等到',
    '日子过着过着',
    '回头说',
    '说起来',
    '还有一桩事',
    '前前后后',
    '打那以后',
    '从那以后',
    '头两年',
    '后来的日子',
    '慢慢',
    '就这么着',
    '一晃',
    '没几年'
  ],

  // ============ 时代锚点（只收真实、公认、可核验的事件） ============
  eraAnchors: [
    { year: 1931, label: '九一八事变', tags: ['全国', '战事'] },
    { year: 1937, label: '七七事变，全面抗战开始', tags: ['全国', '战事'] },
    { year: 1937, label: '南京大屠杀', tags: ['全国', '战事'] },
    { year: 1945, label: '抗日战争胜利', tags: ['全国', '战事'] },
    { year: 1946, label: '解放战争全面开始', tags: ['全国', '战事'] },
    { year: 1949, label: '中华人民共和国成立', tags: ['全国'] },
    { year: 1950, label: '新解放区土地改革开始', tags: ['农村'] },
    { year: 1950, label: '抗美援朝战争开始', tags: ['全国', '战事'] },
    { year: 1950, label: '飞鸽牌自行车投产', tags: ['生活'] },
    { year: 1952, label: '推行速成识字法，扫盲运动兴起', tags: ['上学'] },
    { year: 1953, label: '第一个五年计划开始', tags: ['全国', '建设'] },
    { year: 1953, label: '抗美援朝战争结束', tags: ['全国', '战事'] },
    { year: 1954, label: '新中国第一部宪法颁布', tags: ['全国'] },
    { year: 1955, label: '发行新版人民币', tags: ['生活'] },
    { year: 1956, label: '公私合营基本完成', tags: ['城市'] },
    { year: 1957, label: '反右运动', tags: ['全国'] },
    { year: 1958, label: '大跃进与人民公社化运动', tags: ['农村', '全国'] },
    { year: 1958, label: '第一台国产黑白电视机研制成功', tags: ['生活', '科技'] },
    { year: 1960, label: '三年困难时期', tags: ['全国', '农村'] },
    { year: 1964, label: '第一颗原子弹爆炸成功', tags: ['全国', '科技'] },
    { year: 1966, label: '文化大革命开始', tags: ['全国'] },
    { year: 1968, label: '知识青年上山下乡', tags: ['青年'] },
    { year: 1970, label: '第一颗人造卫星东方红一号发射成功', tags: ['全国', '科技'] },
    { year: 1970, label: '第一台国产彩色电视机研制成功', tags: ['生活', '科技'] },
    { year: 1971, label: '中国恢复联合国合法席位', tags: ['全国'] },
    { year: 1976, label: '唐山大地震', tags: ['全国', '灾害'] },
    { year: 1976, label: '文化大革命结束', tags: ['全国'] },
    { year: 1977, label: '恢复高考', tags: ['上学'] },
    { year: 1978, label: '小岗村实行包产到户', tags: ['农村'] },
    { year: 1978, label: '十一届三中全会，改革开放开始', tags: ['全国'] },
    { year: 1980, label: '深圳等经济特区设立', tags: ['城市'] },
    { year: 1982, label: '计划生育成为基本国策', tags: ['家庭'] },
    { year: 1982, label: '家庭联产承包责任制全面推开', tags: ['农村'] },
    { year: 1984, label: '城市经济体制改革开始', tags: ['城市'] },
    { year: 1986, label: '义务教育法颁布，九年义务教育推行', tags: ['上学'] },
    { year: 1987, label: '第一代移动电话大哥大进入中国', tags: ['生活', '科技'] },
    { year: 1989, label: '南方打工潮兴起', tags: ['城市', '打工'] },
    { year: 1990, label: '上海证券交易所开业', tags: ['城市', '财经'] },
    { year: 1992, label: '邓小平南方谈话', tags: ['全国'] },
    { year: 1992, label: '下海经商潮', tags: ['城市'] },
    { year: 1993, label: '粮票退出日常生活', tags: ['生活'] },
    { year: 1995, label: '全国实行双休日', tags: ['生活'] },
    { year: 1997, label: '香港回归祖国', tags: ['全国'] },
    { year: 1998, label: '长江流域特大洪水，全民抗洪', tags: ['全国', '灾害'] },
    { year: 1998, label: '停止福利分房', tags: ['城市', '家庭'] },
    { year: 1998, label: '国企改革深入，职工下岗再就业', tags: ['城市', '家庭'] },
    { year: 1999, label: '澳门回归祖国', tags: ['全国'] },
    { year: 2001, label: '中国加入世界贸易组织', tags: ['全国'] },
    { year: 2001, label: '北京申办奥运成功', tags: ['全国'] },
    { year: 2001, label: '取消电话初装费', tags: ['生活', '科技'] },
    { year: 2003, label: '非典疫情', tags: ['全国', '健康'] },
    { year: 2003, label: '神舟五号载人飞船发射成功', tags: ['全国', '科技'] },
    { year: 2008, label: '第一条高速铁路京津城际通车', tags: ['交通'] },
    { year: 2008, label: '汶川地震', tags: ['全国', '灾害'] },
    { year: 2008, label: '北京奥运会举办', tags: ['全国'] },
    { year: 2010, label: '上海世博会举办', tags: ['全国'] },
    { year: 2011, label: '微信上线，智能手机开始普及', tags: ['生活', '科技'] }
  ],

  // ============ 生成传记的写作约束 ============
  writingRules: [
    '只能用老人自己说过的内容，没说的一律不写。',
    '老人没提过的场景、天气、对白和心理，一个都不许补。',
    '时间、地点、人名拿不准的，按老人原话的说法写，不替老人定。',
    '老人说记不清的地方，照实写记不清，不用大概、可能去补圆。',
    '全篇用老人说话的口吻，不用书面腔和播音腔。',
    '段落之间用顺口的白话连接，不用接下来、另一方面、总而言之这类路标。',
    '正文不要用冒号、破折号和不是而是式的翻案句子。',
    '不要用说白了、说穿了、值得注意的是这类话给自己的话抬价。',
    '不要用赋能、闭环、抓手、底层逻辑这类商业词。',
    '不要用比喻包装老人的经历，实话实说。',
    '老人没说全的地方，用诚实的话带过，不编细节凑字。',
    '数字按老人原话写，他说大概七八个就写七八个。',
    '称呼按老人的习惯写，老伴、孩子、老家都随他说。',
    '老人自己没下的结论，不替他总结这辈子过得怎样。',
    '一段只讲一件具体的事，几件事不揉在一起。',
    '结尾落在老人自己的话上，不另起炉灶升华。',
    '老人说过的原话尽量保留，只把不通顺的地方顺一顺。',
    '写得比材料短可以，写得比材料多不行。'
  ],

  // ============ 素材不够时的诚实占位说法 ============
  gapPhrases: [
    '这一段他没细说。',
    '问到这里，他只说了个大概。',
    '那几年的年月，他记不真了。',
    '有些事他不愿意多提。',
    '他直说记不清了。',
    '问起那段日子，他说不好说。',
    '这件事在他嘴里只有一两句话。',
    '后来的事，他没有往下讲。',
    '再往下问，他就把话岔开了。',
    '这一节先记到这里。'
  ]
};
