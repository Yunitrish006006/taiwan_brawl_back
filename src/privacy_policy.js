const EFFECTIVE_DATE = '2026-04-21';
const CONTACT_EMAIL = 'yunitrish0419@gmail.com';
const APP_NAME = '鬼島亂鬥';
const APP_PACKAGE = 'com.yunitrish.taiwanbrawl';

function privacyPolicyHtml() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_NAME} 隱私政策</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
      background: #0d0d0d;
      color: #e0e0e0;
      margin: 0;
      padding: 0;
      line-height: 1.7;
      font-size: 15px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }
    h1 {
      font-size: 28px;
      font-weight: 300;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .meta {
      font-size: 13px;
      color: #888;
      margin-bottom: 40px;
    }
    h2 {
      font-size: 17px;
      font-weight: 600;
      color: #ffffff;
      margin-top: 36px;
      margin-bottom: 10px;
      padding-left: 12px;
      border-left: 3px solid #0070f3;
    }
    p { margin: 0 0 12px; color: #c8c8c8; }
    ul { margin: 0 0 12px; padding-left: 20px; color: #c8c8c8; }
    li { margin-bottom: 6px; }
    a { color: #0070f3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .divider {
      border: none;
      border-top: 1px solid #2a2a2a;
      margin: 40px 0;
    }
    .footer {
      margin-top: 48px;
      font-size: 13px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${APP_NAME} 隱私政策</h1>
    <p class="meta">套件名稱：${APP_PACKAGE}　｜　生效日期：${EFFECTIVE_DATE}</p>

    <p>
      歡迎使用《${APP_NAME}》。本隱私政策說明我們如何收集、使用及保護您的個人資料。
      使用本應用程式即表示您同意本政策所述之條款。
    </p>

    <h2>一、收集的資料</h2>
    <p>我們可能收集以下類型的資料：</p>
    <ul>
      <li><strong>帳號資訊</strong>：透過 Google 登入取得您的姓名、電子郵件地址及大頭貼圖片。</li>
      <li><strong>個人資料</strong>：您在應用程式內自訂的暱稱、頭像及個人簡介。</li>
      <li><strong>遊戲資料</strong>：對戰紀錄、牌組設定及遊戲進度。</li>
      <li><strong>社交資料</strong>：好友名單、訊息紀錄。</li>
      <li><strong>裝置資訊</strong>：由 Google AdMob 廣告 SDK 自動收集，包含裝置識別碼及廣告互動資料（詳見第四節）。</li>
      <li><strong>推播通知 Token</strong>：用於傳送遊戲通知及好友邀請。</li>
    </ul>

    <h2>二、資料的使用目的</h2>
    <ul>
      <li>提供帳號登入與身份識別。</li>
      <li>儲存並同步遊戲進度與設定。</li>
      <li>提供好友系統與即時訊息功能。</li>
      <li>傳送與遊戲相關的推播通知。</li>
      <li>顯示個人化廣告（透過 Google AdMob）。</li>
      <li>分析應用程式使用情況以改善服務品質。</li>
    </ul>

    <h2>三、資料的儲存與安全</h2>
    <p>
      您的資料儲存於 Cloudflare 的雲端基礎設施（D1 資料庫），並透過加密連線（HTTPS）傳輸。
      我們採用合理的技術措施保護您的資料，但網際網路傳輸並無法保證絕對安全。
    </p>
    <p>
      我們不會在未經您同意的情況下出售、出租或交換您的個人資料給第三方。
    </p>

    <h2>四、第三方服務</h2>
    <p>本應用程式使用以下第三方服務，其各自適用其隱私政策：</p>
    <ul>
      <li>
        <strong>Google Sign-In</strong>：用於帳號登入。
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google 隱私政策</a>
      </li>
      <li>
        <strong>Google AdMob</strong>：用於顯示廣告，可能收集您的裝置識別碼與廣告互動資料。
        <a href="https://support.google.com/admob/answer/6128543" target="_blank" rel="noopener">AdMob 隱私說明</a>
      </li>
    </ul>
    <p>
      您可至裝置設定中選擇退出個人化廣告：
      Android：設定 → Google → 廣告；iOS：設定 → 隱私權 → Apple 廣告。
    </p>

    <h2>五、資料保留期間</h2>
    <p>
      帳號資料將保留至您主動刪除帳號為止。
      遊戲紀錄及訊息在帳號刪除後將一併移除。
      如需刪除帳號，請以電子郵件聯繫我們（見第七節）。
    </p>

    <h2>六、兒童隱私</h2>
    <p>
      本應用程式不針對 13 歲以下兒童設計，亦不刻意收集兒童的個人資料。
      若您發現兒童在未經家長同意的情況下提供了個人資料，請聯繫我們，我們將立即刪除相關資料。
    </p>

    <h2>七、聯絡我們</h2>
    <p>
      若您對本隱私政策有任何疑問或欲行使資料刪除權，請透過以下方式聯繫我們：
    </p>
    <p>
      電子郵件：<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </p>

    <h2>八、政策更新</h2>
    <p>
      我們可能不定期修訂本隱私政策。修訂後將在本頁面更新生效日期，
      重大變更將透過應用程式內通知告知您。繼續使用本應用程式即視為接受修訂後的政策。
    </p>

    <hr class="divider">
    <div class="footer">
      &copy; ${new Date().getFullYear()} ${APP_NAME}　｜　最後更新：${EFFECTIVE_DATE}
    </div>
  </div>
</body>
</html>`;
}

export function handlePrivacyPolicy(request) {
  const html = privacyPolicyHtml();
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff'
  };
  return new Response(html, { status: 200, headers });
}
