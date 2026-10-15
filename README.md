# 家庭票券夾

手機票券 App 直接部署在 GitHub Pages，開啟後不會轉往 ChatGPT 登入頁。

- 網站： https://ericlin0616.github.io/family-vouchers/
- 第一次使用須由家人提供含家庭存取金鑰的專屬啟用連結。金鑰在 URL fragment 中，不會送至 GitHub。專屬資訊保留於網址片段，方便書籤或主畫面啟動；原始金鑰不會作為 URL 傳給 GitHub，請勿公開完整連結。
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

在 Safari 開啟專屬連結，透過「分享 → 加入主畫面」安裝。先輸入 PIN 打開一次，讓裝置保存記憶，再加入主畫面。啟用金鑰存於 localStorage 與 IndexedDB；另以 PIN 加密後保存於 Secure、SameSite Cookie，供 Safari 建立主畫面 App 時延續登入記憶。Cookie 不含原始金鑰或 PIN。manifest 保留穩定 ID，但不再固定一般啟動網址，讓安裝頁面的專屬網址成為預設。

舊版圖示反覆要求啟用時，需從更新後且已啟用的 Safari 頁面重新加入一次。設定中的「儲存裝置恢復備份」會下載 PIN 加密的裝置資料；清除網站資料或換裝置後可選擇這個檔案並輸入 PIN 恢復，無須找回聊天紀錄。備份不含票券照片。私人瀏覽或系統清除所有網站儲存時，仍可能需要恢復；不保證瀏覽器永不清除資料。啟用連結只給家人，PIN 請分開提供。

## 驗證

已檢查 PIN 加密、鎖定清除、批次匯入與重複略過、並行更新衝突、家庭金鑰驗證、未授權讀寫阻擋、CORS、啟用連結處理，以及 GitHub Pages 相對資產路徑。未使用 service worker 快取票券資料。
