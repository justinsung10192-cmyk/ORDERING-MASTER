# 班級訂午餐系統

手機優先的班級訂午餐、錢包與取餐核對系統。

## 技術架構
- 前端：原生 HTML + Tailwind CDN + Vanilla JS（`client/index.html` → `client/src/app.js`）
- 後端資料：Google Apps Script + Google 試算表（`Code.gs`）
- 部署：Vercel（靜態前端 + `api/gas.js` 同網域代理）

## 資料夾結構
| 路徑 | 說明 |
| --- | --- |
| `client/index.html` | 前端頁面與 UI 模板 |
| `client/src/app.js`、`lunchDomain.js` | 前端主程式與業務邏輯 |
| `client/public/images/` | 品牌圖片 |
| `api/gas.js` | `/api/gas` 代理（轉送 Google Apps Script） |
| `Code.gs` | Apps Script 後端（部署說明見 `GAS_DEPLOYMENT.md`） |
| `vercel.json` | Vercel 建置設定 |

## 本機預覽
```bash
npm install
npm run dev
```

## 部署到 Vercel
1. 推到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "初始版本"
   git branch -M main
   git remote add origin https://github.com/你的帳號/你的儲存庫.git
   git push -u origin main
   ```
2. 到 [vercel.com/new](https://vercel.com/new) 匯入該儲存庫。
3. 新增環境變數 `GAS_WEB_APP_URL` = 你的 Apps Script `/exec` 網址。
4. 按 Deploy。

## 注意
- Apps Script「專案設定 → 指令碼屬性」的 `FRONTEND_URL` 要改為 Vercel 正式網址（影響「忘記密碼」信）。
