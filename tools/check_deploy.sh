#!/usr/bin/env bash
# check_deploy.sh — 线上部署健康哨兵
#
# 用途：5 秒内判定 Cloudflare Pages 线上是否又被"空部署"污染。
# 背景：Pages 的 git 集成构建若读不到正确的构建目录（pages_build_output_dir），
#       会产出"空依赖"的部署——所有静态资源 404（app.js 也找不到），线上瞬间打挂。
#       本脚本通过 3 个硬指标快速识别这种状态，无需登录 Dashboard。
#
# 用法：
#   bash tools/check_deploy.sh                # 检查默认生产域
#   bash tools/check_deploy.sh <域名>          # 检查指定域（如 sb.xunyiju.com）
#
# 返回值：0 = 健康；1 = 被空部署污染 / API 无响应（需要手动 deploy 覆盖）
#
# 依赖：curl + md5sum（Git Bash / Linux 自带）

set -u

DOMAIN="${1:-renshengzhishu.pages.dev}"
BASE="https://${DOMAIN}"

# 已知的健康部署下 app.js 的大小基线（约 68828 字节）。空部署返回 0 字节。
# 用"低于基线的一半即判废"，避免因小幅改版本产生误报；确为空部署时是 0，必然触发。
EXPECTED_MIN_BYTES=20000

echo "▶ 检查线上：${BASE}"
echo ""

fail=0

# ---- 指标①静态资源 app.js 是否可访问、是否非空（空部署 = 404 + 0 字节）----
APP=$(curl -s -o /dev/null -w "%{http_code}:%{size_download}" --max-time 20 "${BASE}/js/app.js")
APP_CODE="${APP%%:*}"
APP_BYTES="${APP##*:}"
if [ "${APP_CODE}" = "200" ] && [ "${APP_BYTES}" -gt "${EXPECTED_MIN_BYTES}" ]; then
  echo "  ✅ /js/app.js        HTTP ${APP_CODE}  ${APP_BYTES} 字节  (健康)"
else
  echo "  ❌ /js/app.js        HTTP ${APP_CODE}  ${APP_BYTES} 字节  (疑似空部署! 期望 200 且 >${EXPECTED_MIN_BYTES})"
  fail=1
fi

# ---- 指标② API 前后端链是否通（health 应返回 ok:true）----
HEALTH=$(curl -s --max-time 20 "${BASE}/api/health")
case "${HEALTH}" in
  *'"ok":true'*)  echo "  ✅ /api/health      ok:true                 (前后端接应正常)" ;;
  *)              echo "  ❌ /api/health      ＜无正常反馈＞: ${HEALTH}" ; fail=1 ;;
esac

echo ""
if [ "${fail}" -eq 0 ]; then
  echo "🎉 线上健康：没有被空部署污染，前后端都通。"
  exit 0
else
  echo "🚨 检测到异常：极可能是 git 集成又产出了空部署，或 API 链断了。"
  echo "   修复：运行  wrangler pages deploy web --project-name renshengzhishu  "
  echo "         （手动显式指定 web 目录，可立即覆盖空部署；若仍被盖回，检查 wrangler.toml 的 pages_build_output_dir 是否为 \"web\"）"
  exit 1
fi
