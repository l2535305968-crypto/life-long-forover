// intent.js — 判断老人这句话属于哪种，以及字符 bigram 相似度。
//
// 这是访谈引擎的"耳朵"之一：先分清老人是在拒绝、在沉默、还是真的往下讲了。
// 纯函数，不碰 DOM，可以在 Node 里直接测。
//
// 设计原则（来自访谈方法论）：
//   - 拒绝要听得出来，但不能追问、不能劝，更不能纠正。
//   - "忘了 / 记不清 / 说不上来" 算沉默，不算拒绝。老人不是不肯说，是说不上来。
//   - 重复讲同一件事是重要信息，用相似度把它识别出来，但不能当面点破。

export const INTENT = Object.freeze({
  EMPTY: 'empty',           // 空或没有可识别内容
  REFUSE: 'refuse',         // 明确不肯说
  SILENCE: 'silence',       // 说不上来 / 忘了 / 只有语气词
  SUBSTANTIVE: 'substantive' // 有实质内容，往下讲了
});

// 明确拒答的强信号。宁可少收，不可误伤（比如"算了"在口语里也常是"作罢"，
// 但也可能出现在别处，所以不用它）。"不好说"偏"拿不准"，归沉默，不归拒绝。
const REFUSE_PHRASES = [
  '不想说', '不愿意说', '不乐意说', '不能说', '说不得',
  '别提了', '别问了', '不说了', '不讲了', '打住', '免谈',
  '没啥好说', '没什么好说', '没得说', '这个不说', '这不说', '不提了'
];

// 说不上来 / 记不清的信号。
const SILENCE_PHRASES = [
  '忘了', '记不清', '记不得', '记不住', '想不起', '想不起来',
  '不知道', '说不上来', '说不上', '没印象', '没记住', '不记得', '不好说'
];

// 只有标点、空白，没有任何实义。
const PUNCT_ONLY = /^[\s，。！？、；…,\.!?;:~·\u3000]*$/;

// 至少一个汉字 / 字母 / 数字才算有内容。
const MEANINGFUL = /[\u4e00-\u9fffA-Za-z0-9]/;

// 去掉标点和空白的字符，只保留能参与相似度比较的东西。
const PUNCT_OR_SPACE = /[\s，。！？、；：""''（）,.!?;:'"()\-—–~·\u3000]/g;

// 纯语气词 / 感叹字。这些字单独出现或堆在一起时，不算"说了内容"。
const INTERJECTION_CHARS = '嗯啊哦噢哎唉诶呃昂哼哈呀呢吧嘛嘿嗨哟唔嗳欸';

// 口头填充词。老人说"那个……""就是……"时其实还没想好，属于沉默。
const FILLER_WORDS = ['那个啥', '怎么说呢', '那个', '这个', '就是说', '反正就是', '什么来着', '咋说', '怎么说', '就是', '然后', '反正'];

export function clean(text) {
  return String(text == null ? '' : text).trim();
}

export function hasContent(text) {
  return MEANINGFUL.test(clean(text));
}

export function looksLikeRefusal(text) {
  const t = clean(text);
  if (!t) return false;
  for (const p of REFUSE_PHRASES) if (t.includes(p)) return true;
  return false;
}

export function looksLikeSilence(text) {
  const t = clean(text);
  if (!t || PUNCT_ONLY.test(t)) return true;

  // 去掉口头填充词和纯语气字之后，如果啥也不剩，就是还没想好/只应了一声。
  let stripped = t;
  for (const w of FILLER_WORDS) stripped = stripped.split(w).join('');
  stripped = stripped.replace(new RegExp(`[${INTERJECTION_CHARS}]+`, 'g'), '');
  stripped = stripped.replace(PUNCT_OR_SPACE, '');
  if (!MEANINGFUL.test(stripped)) return true;

  // 长句子里出现"忘了"多半是真的在讲事，短句里出现才是说不上来。
  if (t.length <= 10) {
    for (const p of SILENCE_PHRASES) if (t.includes(p)) return true;
  }
  return false;
}

export function classify(text) {
  const t = clean(text);
  if (!t || !hasContent(t)) return INTENT.EMPTY;
  if (looksLikeRefusal(t)) return INTENT.REFUSE;
  if (looksLikeSilence(t)) return INTENT.SILENCE;
  return INTENT.SUBSTANTIVE;
}

// 字符 bigram 集合。
export function bigrams(text) {
  const s = clean(text).replace(PUNCT_OR_SPACE, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// 相似度，用 containment（交集 / 较短者大小），0 到 1。
// 用来判断"这次是不是又在讲上次那件事"。短于 4 个字的内容不参与比较。
export function similarity(a, b) {
  const sa = clean(a).replace(PUNCT_OR_SPACE, '');
  const sb = clean(b).replace(PUNCT_OR_SPACE, '');
  if (sa.length < 4 || sb.length < 4) return 0;
  const A = bigrams(sa);
  const B = bigrams(sb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}

// 这条新回答，是否在"重复"历史里某条实质回答。
export function isRepeatAgainstHistory(text, historyTexts, threshold = 0.55) {
  const t = clean(text);
  if (t.length < 4) return false;
  for (const h of historyTexts || []) {
    if (similarity(t, h) >= threshold) return true;
  }
  return false;
}
