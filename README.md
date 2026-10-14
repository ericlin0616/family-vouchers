# 家庭票券夾

手機票券 App 直接部署在 GitHub Pages，開啟後不會轉往 ChatGPT 登入頁。

- 網站： https://ericlin0616.github.io/family-vouchers/
- 第一次使用須由家人提供含家庭存取金鑰的專屬啟用連結。金鑰在 URL fragment 中，不會送至 GitHub。啟用後會從網址列移除，保存在該瀏覽器。
- 每次解鎖使用原本的 6 位 PIN，PIN 只用於瀏覽器內 PBKDF2/AES-GCM 解密，不會傳給伺服器。
- 家人啟用各自裝置後，共用相同的加密票券與使用紀錄。

## 部署架構

`docs/` 是完整的 HTML、CSS、JavaScript App，並非跳轉入口。GitHub Pages 設為 `main` 的 `/docs`。

私密資料留在獨立的 Worker/R2 後端，不放進 GitHub。`site/` 是後端與前端的完整原始碼。
所有資料 API，包括保管箱設定、加密票券與待匯入截圖，都必須提供家庭存取金鑰。伺服器只保存其 SHA-256 雜湊，透過未公開的 runtime secret `FAMILY_ACCESS_KEY_HASH` 設定。未設定時拒絕所有資料請求。CORS 僅允許本網站與後端同源，不使用跨站 Cookie 或 ChatGPT 登入。

網站程式可公開；家庭啟用金鑰、PIN、票券序號、QR Code、原始截圖、執行期資料及私人備份都不得提交至此儲存庫。

## 更新靜態網站

修改 `site/public` 後執行：

```sh
node scripts/sync-pages.mjs
```

提交產生的 `docs/` 檔案即可更新 GitHub Pages。後端修改須另行建置及部署；更動 runtime secret 後也須部署才生效。撤換家庭金鑰時須重新提供專屬啟用連結給每台裝置。

## 主畫面使用

在 Safari 開啟專屬連結，透過「分享 → 加入主畫面」安裝。若主畫面 App 使用獨立的瀏覽器儲存空間，首次開啟時貼上同一個家庭啟用連結即可。啟用連結只給家人，PIN 請分開提供。

## 驗證

已檢查 PIN 加密、鎖定清除、批次匯入與重複略過、並行更新衝突、家庭金鑰驗證、未授權讀寫阻擋、CORS、啟用連結處理，以及 GitHub Pages 相對資產路徑。未使用 service worker 快取票券資料。
