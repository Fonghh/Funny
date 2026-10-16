# 匹克球動作分析（網頁版原型）

在手機瀏覽器裡直接分析匹克球影片：用 MediaPipe Pose 偵測骨架，追蹤指定球員，自動抓出每次擊球，並給出參考用的改進建議。影片不會上傳，全部在裝置上運算。

## 功能
- 從相簿選影片，點選要分析的球員（雙打時畫面有多人）
- 擊球偵測：慣用手手腕速度的峰值
- 每拍指標：擊球高度（低手／腰胸／過肩）、屈膝角度、擊球點在身體前方或後方（單鏡頭估計）
- 擊球之間的準備姿勢：拍子是否在腰部以上、是否屈膝、站姿寬度
- 時間軸圖表、每拍截圖、¼ 速重播
- 分析完成後，暫停並點選另一位球員，即可改分析他（不必重新偵測）

## 檔案
- `index.html`：整個 App（HTML、CSS、JS）
- `fetch_assets.sh`：下載 MediaPipe 執行檔（`mp/`）與姿態模型（`models/`），這些檔案太大，沒有放進 git

## 即時計分（score.html）
網址：https://fonghh.github.io/Funny/score.html

手機架在底線後方拍整面場，邊錄邊計分（雙打、傳統計分 0-0-2）。
- `ball.js`：找球（黃綠色＋有移動的小色塊）、追蹤軌跡、找落地點、判斷一球的開始與結束、計分規則
- `court.js`：球場白線辨識（分析頁與計分頁共用；分析頁另有一份內嵌在 `index.html`）
- 判斷誰贏：看最後一次落地。某一邊界內沒被接回 → 那一邊輸；某一邊界外 → 對面打出界，那一邊贏
- 自動判斷會先提示，幾秒內可以改判；也能直接手動按誰贏、復原
- 錄影（`match.js`）：只錄每一球，從偵測到球的前 3 秒（可設 1／3／5 秒）到這球結束後約 3 秒，每一球存成一段影片。
  做法是一直保持幾段錯開的「待命錄影」，一球開始時留下已經錄了夠久的那段，其餘丟掉
- 比賽紀錄和每一球的影片存在瀏覽器的 IndexedDB（`picklepose` 資料庫），賽後分析頁的「我的比賽」直接讀取；
  結束比賽後可以用分享選單存到相簿

## 網站（GitHub Pages）
網址：https://fonghh.github.io/Funny/

`docs/` 是發布用的網站，由 `build_pages.py` 產生：把 `index.html` 包成完整網頁、加上「加入主畫面」用的圖示和 manifest，並把 MediaPipe 執行檔和模型一起放進去（不依賴外部 CDN）。改完 `index.html` 後：
```bash
./fetch_assets.sh        # 第一次才需要
python3 build_pages.py   # 重新產生 ../docs
```
GitHub 設定：Settings → Pages → Deploy from a branch → `claude/pickleball-pose`、資料夾 `/docs`。

## 本機執行
```bash
./fetch_assets.sh
python3 -m http.server 8000   # 然後開 http://localhost:8000/
```
`index.html` 是頁面片段（沒有 `<html>`／`<body>`），發布成 Claude Artifact 時會自動包上外框；一般瀏覽器也能直接開。

## 限制
- 結果僅供參考：單一鏡頭、2D 影像推估 3D 姿勢
- 偵測不到球拍，只用手腕位置代替
- 擊球點前後的深度估計誤差大
