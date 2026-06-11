#!/bin/bash
# 删除并以纯 tt-u 身份重建 felt-lab 仓库(需先: gh auth refresh -h github.com -s delete_repo)
# 用法: bash scripts/recreate-repo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 校验本地提交身份 =="
git log -1 --format='%an <%ae>' | grep -q 'tt-u <153491149+tt-u@users.noreply.github.com>' \
  || { echo "本地提交作者不是 tt-u, 中止"; exit 1; }
git log -1 --format=%B | grep -qi 'co-authored' && { echo "提交信息含 Co-Authored 尾注, 中止"; exit 1; }
echo "单提交, 作者 tt-u, 无第三方署名 ✓"

echo "== 删除远端仓库 =="
gh repo delete tt-u/felt-lab --yes

echo "== 重建并推送 =="
git remote remove origin 2>/dev/null || true
gh repo create felt-lab --public --source=. --push \
  --description "德州扑克对战训练: 范围对范围策略对手 + 实时决策拆解 + 兔子洞复盘"

echo "== 配置 secret 与 Pages =="
gh secret set DEEPSEEK_API_KEY --repo tt-u/felt-lab --body "$(grep DEEPSEEK_API_KEY .env.local | cut -d= -f2)"
gh api repos/tt-u/felt-lab/pages -X POST -f build_type=workflow >/dev/null 2>&1 || true

echo "== 等待部署 =="
sleep 10
RUN_ID=$(gh run list --repo tt-u/felt-lab --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --repo tt-u/felt-lab --exit-status

echo "== 验证 =="
URL=$(gh api repos/tt-u/felt-lab/pages -q .html_url)
curl -s -o /dev/null -w "站点 ${URL}: %{http_code}\n" "$URL"
echo "贡献者:"
gh api repos/tt-u/felt-lab/contributors -q '.[].login'
