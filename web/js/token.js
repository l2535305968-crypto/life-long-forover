// token.js — 家庭令牌（x-tts-token）的单一来源。
//
// 为什么需要它：之前手机全靠 Cloudflare 页面函数替浏览器补 x-tts-token header。
// 改成手机直连 ECS 后没有 Cloudflare 了，前端必须自己带上这个令牌，服务端的
// /api/tts、/api/asr、/api/upload、/api/v1/tools/* 才会放行（否则 401）。
//
// 令牌存在 localStorage（rss.familyToken），只在抽屉里填一次，不下发到 HTML。
// 在 Cloudflare 路径下它会被真 token 覆盖，无副作用；直连路径下它就是校验值。

const KEY = 'rss.familyToken';

export function getFamilyToken() {
  try {
    return (localStorage.getItem(KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setFamilyToken(t) {
  try {
    localStorage.setItem(KEY, String(t || '').trim());
  } catch { /* 忽略 */ }
}

// 生成一个合并了家庭令牌的 fetch headers。
// extra：额外 header（如 content-type）；未填令牌时原样返回 extra。
export function withTokenHeaders(extra = {}) {
  const tok = getFamilyToken();
  if (!tok) return extra;
  return { ...extra, 'x-tts-token': tok };
}
