# CLAUDE.md

匹克球（pickleball）手機網頁工具：**賽後分析**（骨架動作、站位）與**即時計分**（找球、判斷每一球、錄影）。
使用者以繁體中文溝通，介面文字全部用繁體中文。使用者只用手機上的 Claude App，沒有電腦：
所有東西都要能在 iPhone Safari 上直接使用，不能依賴 Xcode 或本機開發環境。

## 網站
- 賽後分析：https://fonghh.github.io/Funny/
- 即時計分：https://fonghh.github.io/Funny/score.html
- 壓縮影片：https://fonghh.github.io/Funny/shrink.html
- 說明書：https://fonghh.github.io/Funny/manual.pdf
- GitHub Pages 從 `claude/pickleball-pose` 分支（也是預設分支）的 `docs/` 資料夾發布，push 後約 1 分鐘上線。

## 檔案結構
- `pickleball-pose/`：**原始碼，改這裡**
  - `index.html`：賽後分析頁。是「頁面片段」（沒有 `<html>`/`<head>`），因為早期也發布成 Claude Artifact；`build_pages.py` 會包成完整網頁。
    `// PURE-START` 到 `// PURE-END` 之間是沒有 DOM 的純函式（追蹤、指標、球場辨識、建議姿勢），測試時用 `new Function` 抽出來在 Node 跑。
  - `score.html`：即時計分頁（完整網頁）。
  - `shrink.html`：壓縮影片（640 寬、約 1.5Mbps，超過 24MB 自動分段），讓使用者把長影片傳給 Claude（App 附檔上限 30MB）。左上角印原始秒數。
  - `court.js`：球場白線辨識（地板顏色 → 白線遮罩 → 方向性 Hough → 消失點找邊線 → 套 20×44 呎球場模板 → homography）。
    **注意：`index.html` 的 PURE 區段裡內嵌了一份相同程式碼，兩邊要一起改。**
    只支援手機在底線後方拍；`plausibleCourt` 會丟掉不合理的套合（寧可問手動，也不要用錯的球場判斷）。
    套合分數看整個球場（含遠端半場），先用每呎一點粗篩，再對前 20 名用每 2 像素一點細算；兩種球場線各自套，取通過檢查的最高分。
  - `ball.js`：找球（黃綠色＋移動）、`BallTracker`、`RallyJudge`（落地、一球開始/結束、判斷誰贏）、`SideOutGame`（傳統雙打計分 0-0-2）。
    有球場時 `RallyJudge` 看節奏：球過網才開始；約 4 秒沒被打回來就結束；只過網一次又離上一球不到 8 秒的當作交球；誰贏看最後一次過網後的第一個落點
    （若那個「落點」之後球爬得比落下前更高，其實是網前低擊球，改看下一個落點；一球結束時會重看最後一段，補抓落地後馬上飛出畫面的球）。
  - `match.js`：IndexedDB（資料庫 `picklepose`：`matches`、`clips`）與 `RallyRecorder`（錯開的待命錄影，做到「偵測到球的前 N 秒」開始錄）。兩頁共用。
  - `build_pages.py`：產生 `docs/`。複製 MediaPipe 執行檔與模型、做主畫面圖示與 manifest，並在頁面連結和 script 網址加上建置時間 `?v=` 避免手機吃到快取。
  - `fetch_assets.sh`：下載 MediaPipe（`mp/`）與姿態模型（`models/`），這兩個資料夾在 `pickleball-pose/` 不進 git。
  - `manual/`：說明書原始檔（`manual.html` + 截圖），`build_manual.sh` 產生 `docs/manual.pdf`。
- `docs/`：**產生出來的網站，不要手改**。包含 MediaPipe 與模型（約 28MB，會進 git）。

## 改完要做的事
```bash
cd pickleball-pose
./fetch_assets.sh            # 只有 mp/ 或 models/ 不存在時才需要
python3 build_pages.py       # 重新產生 ../docs
git add -A pickleball-pose docs && git commit && git push -u origin claude/pickleball-pose
```
改了介面或功能時，說明書（`manual/manual.html` 與截圖）可能也要更新，再跑 `manual/build_manual.sh`。

## 測試方式（雲端容器沒有 iPhone）
- 用 Playwright 的 Chromium：`import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'`，
  WebGL 要加 `--use-gl=swiftshader --enable-unsafe-swiftshader`（很慢：16 秒影片分析約 4–7 分鐘）。
- Chromium 不能播 H.264：測試影片先用 ffmpeg 轉成 webm。
- 模擬鏡頭：`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=xxx.y4m`（會循環播放，要在後面接一段靜止畫面才會有「一球結束」）。
- 用 `python3 -m http.server` 開 `docs/`，路徑要模擬 `/Funny/`。
- 這個容器連不到 fonghh.github.io 和 jsDelivr；部署狀態用 GitHub Actions 的 `pages build and deployment` 看。
- `node pickleball-pose/tests/replay_img3668.mjs`：使用者真實影片（隔圍網、低角度）錄下的候選點＋使用者標的正確答案，重播後逐球對照。目前 6 段只對 1 段，是低角度的已知限制。
- `node pickleball-pose/tests/replay_broadcast.mjs`：YouTube 職業賽轉播兩段（高處、底線正後方，自動辨識球場）＋使用者確認的答案，目前 2/2。
- `node pickleball-pose/tests/sim_rally.mjs`：模擬比賽（一般來回、交球、發球直接得分、打出界、回球掛網、深球彈兩次、網前低擊球後打出界），改 `RallyJudge` 後先跑這個。
- 頁面上有除錯用的 `window.__summary()`、`window.__score()`、`window.__dbg`、`window.__match()`。
- 用真實影片調整判斷：在頁面裡攔截 `step(t, cands)` 把每張的候選點存下來，之後在 Node 用 `BallTracker`/`RallyJudge` 重播，不用每次重跑瀏覽器。注意 `start()` 會清掉球場，要等 `running` 之後再設。
- 計分頁設定裡有「診斷資訊」開關，會在畫面下方顯示每秒張數、處理時間、像球的點數、球場是否辨識、軌跡與狀態；請使用者在真機截圖回報。
- 所有測試都是電腦版瀏覽器模擬，回報時要講清楚「還沒在 iPhone 上驗證」。

## iPhone Safari 踩過的坑
- 影片**沒播放過就不會解碼畫面**：匯入後要先 `play()` 再 `pause()`，並加逾時保護。
- **隱藏的 `<video>` 不會載入**：截圖要從主影片抓，不要用第二個隱藏的 video。
- 設定相同的 `currentTime` 可能不會觸發 `seeked`：seek 一律加逾時。
- 瀏覽器錄的影片可能沒有長度（`duration` 是 Infinity）：先把 `currentTime` 設很大，等 `durationchange`。
- **即時鏡頭的畫面時間戳記不可靠**（`requestVideoFrameCallback` 的 `mediaTime` 在手機上可能一直不變）：鏡頭模式一律用 `performance.now()` 計時；只有播放影片檔時才用 `mediaTime`。電腦模擬鏡頭測不出這個問題。
- GitHub Pages 讓手機快取 10 分鐘：頁面之間的連結和 script 要帶 `?v=` 建置時間。
- Safari 可能清掉 7 天沒開的網站資料（IndexedDB 裡的比賽與影片）。

## 設計
- 深色 HUD 風格；賽後分析的主色是青色 `#3fd4ff`，即時計分的主色是黃色 `#f3d23c`。
- 影片中的球員骨架是藍色，建議姿勢是紅色虛線。
- 手動修正區用橘色虛線框。
- 所有判斷都是「參考用」：自動判斷一定要搭配手動修正或確認。
