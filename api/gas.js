// Vercel Serverless Function：同網域代理 Google Apps Script。
// 前端 app.js 以 text/plain JSON POST 到 /api/gas（見 client/index.html 的
// window.LUNCH_CONFIG.apiUrl），此函式原樣轉送，不解析、不保存帳號／訂餐資料，
// 避免瀏覽器直接呼叫跨網域的 GAS 端點。
//
// 需在 Vercel 的 Environment Variables 設定：
//   GAS_WEB_APP_URL=https://script.google.com/macros/s/你的部署ID/exec

export const config = {
  api: { bodyParser: false },
};

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res
      .status(405)
      .setHeader("Cache-Control", "no-store")
      .json({ ok: false, error: "僅接受 POST 請求。" });
    return;
  }

  if (!GAS_WEB_APP_URL) {
    console.error("[GAS Proxy] GAS_WEB_APP_URL 未設定");
    res
      .status(500)
      .setHeader("Cache-Control", "no-store")
      .json({ ok: false, error: "伺服器尚未設定 Google Apps Script 端點。" });
    return;
  }

  try {
    const body = await readRawBody(req);
    const upstream = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });

    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const responseText = await upstream.text();

    res
      .status(upstream.status)
      .setHeader("Cache-Control", "no-store")
      .setHeader("Content-Type", contentType)
      .send(responseText);
  } catch (error) {
    console.error("[GAS Proxy] 轉送失敗:", error);
    res
      .status(502)
      .setHeader("Cache-Control", "no-store")
      .json({ ok: false, error: "無法連線至訂餐服務，請稍後再試。" });
  }
}
