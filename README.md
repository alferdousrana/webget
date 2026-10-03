# WebGet — ব্রাউজার-ভিত্তিক ডাউনলোড ম্যানেজার

লিংক পেস্ট করুন → ভিডিও, গান, PDF, ছবি, GIF ডাউনলোড করুন। ভিডিও থেকে অডিও (MP3/M4A/OGG/Opus/WAV) কনভার্ট করুন। নেট চলে গেলে অটো পজ, নেট এলে অটো রিজিউম। কোনো ডাটাবেস লাগে না — সব ডাটা আপনার ব্রাউজারেই থাকে।

---

## কোনটা কিসের উপর চলে

| ফিচার | শুধু GitHub Pages | + CORS Proxy (ফ্রি) | + Extractor সার্ভার |
|---|---|---|---|
| সরাসরি ফাইল লিংক (যে সাইট অনুমতি দেয়) | ✅ | ✅ | ✅ |
| সরাসরি ফাইল লিংক (যে সাইট ব্লক করে / CORS) | ❌ ব্রাউজারে খোলার অপশন দেয় | ✅ | ✅ |
| পজ / রিজিউম, অটো পজ-রিজিউম | ✅ | ✅ | ✅ |
| ভিডিও → অডিও কনভার্ট | ✅ | ✅ | ✅ |
| LinkedIn (পাবলিক পোস্ট) | ❌ | ✅ | ✅ |
| YouTube, Facebook, Pinterest, Instagram, TikTok, X… | ❌ | ❌ | ✅ |

**কেন?** GitHub Pages শুধু স্ট্যাটিক ফাইল সার্ভ করে, কোনো সার্ভার-কোড চালাতে পারে না। আর ব্রাউজারের নিরাপত্তা নিয়ম (CORS) অনুযায়ী একটা ওয়েবসাইট অন্য সাইট (যেমন YouTube) থেকে সরাসরি ডাটা পড়তে পারে না। তাই সোশ্যাল মিডিয়ার জন্য একটা ছোট সহায়ক সার্ভার লাগে।

---

## ধাপ ১ — GitHub Pages এ আপলোড

1. https://github.com এ লগইন করুন → উপরে ডানে **+** → **New repository**।
2. নাম দিন যেমন `webget`। **Public** রাখুন। **Create repository** চাপুন।
3. নতুন repo পেজে **uploading an existing file** লিংকে ক্লিক করুন।
4. zip ফাইলটা আগে আপনার কম্পিউটারে **Extract** করুন। তারপর `webget` ফোল্ডারের **ভেতরের সব জিনিস** (`index.html`, `css`, `js`, `vendor`, `extras`, `README.md`) একসাথে সিলেক্ট করে ড্র্যাগ করে আপলোড বক্সে ছেড়ে দিন।
   - zip ফাইল নিজে আপলোড করবেন না, GitHub সেটা খোলে না।
   - `index.html` অবশ্যই repo-র একদম রুটে থাকতে হবে (কোনো সাব-ফোল্ডারের ভেতরে না)।
5. নিচে **Commit changes** চাপুন।
6. repo-র **Settings** → বাম পাশে **Pages** → **Source:** `Deploy from a branch` → **Branch:** `main` এবং `/ (root)` → **Save**।
7. ১-২ মিনিট অপেক্ষা করুন। একই পেজে লিংক আসবে: `https://আপনার-ইউজারনেম.github.io/webget/`

পরে কোনো ফাইল আপডেট করতে: repo তে ফাইলটা খুলুন → পেন্সিল আইকন (Edit) → বদলান → Commit। অথবা **Add file → Upload files** দিয়ে একই নামের ফাইল আবার আপলোড করুন।

---

## ধাপ ২ — CORS Proxy (ফ্রি, ৫ মিনিট) — ঐচ্ছিক কিন্তু দরকারি

এটা দিলে যেসব সাইট ডাউনলোড ব্লক করে সেগুলোও চলবে, আর LinkedIn পোস্ট পড়া যাবে।

1. https://dash.cloudflare.com এ ফ্রি একাউন্ট খুলুন।
2. বাম মেনু → **Workers & Pages** → **Create** → **Create Worker** → নাম দিন `webget-proxy` → **Deploy**।
3. **Edit code** চাপুন। আগের সব কোড মুছে `extras/cors-proxy-worker.js` ফাইলের পুরো কোড পেস্ট করুন।
4. কোডের উপরে এই লাইন বদলান:
   ```js
   'https://YOUR-GITHUB-USERNAME.github.io',
   ```
   এখানে আপনার নিজের GitHub ইউজারনেম দিন (শেষে `/webget` লাগবে না)।
5. **Deploy** চাপুন। আপনার URL হবে যেমন `https://webget-proxy.আপনার-নাম.workers.dev`
6. WebGet সাইটে → ডানে উপরে **Settings** আইকন → **Proxy URL** এ এটা দিন → **Test connection** → **Save settings**।

ফ্রি প্ল্যানে দিনে ১ লাখ রিকোয়েস্ট — ব্যক্তিগত ব্যবহারের জন্য যথেষ্ট।

---

## ধাপ ৩ — Extractor সার্ভার (YouTube, Facebook, Pinterest ইত্যাদির জন্য)

WebGet [cobalt](https://github.com/imputnet/cobalt) API ব্যবহার করে — এটা ওপেন-সোর্স, যেটা সোশ্যাল মিডিয়া লিংক থেকে আসল ভিডিও/অডিও ফাইল বের করে দেয়।

> ⚠️ পাবলিক `api.cobalt.tools` অন্য ওয়েবসাইট থেকে ব্যবহার করা যায় না (bot protection আছে)। নিজের instance চালাতে হবে।

**যা লাগবে:** Docker চলে এমন একটা সার্ভার — একটা VPS (DigitalOcean, Hetzner, Oracle Cloud Free Tier ইত্যাদি), অথবা নিজের PC + Cloudflare Tunnel।

```bash
mkdir cobalt && cd cobalt
nano docker-compose.yml
```

এটা পেস্ট করুন (`API_URL` আপনার সার্ভারের ঠিকানা দিয়ে বদলান):

```yaml
services:
  cobalt:
    image: ghcr.io/imputnet/cobalt:11
    init: true
    read_only: true
    restart: unless-stopped
    ports:
      - 9000:9000/tcp
    environment:
      API_URL: "https://cobalt.your-domain.com/"
      # অন্যরা যেন ব্যবহার না করতে পারে, তাই API key চালু রাখা ভালো:
      # API_KEY_URL: "file:///keys.json"
      # API_AUTH_REQUIRED: 1
```

```bash
docker compose up -d
```

HTTPS এর জন্য Nginx/Caddy reverse proxy বা Cloudflare Tunnel ব্যবহার করুন (GitHub Pages HTTPS, তাই extractor ও HTTPS হতে হবে)। তারপর WebGet → **Settings** → **Extractor URL** এ ঠিকানা দিন, API key থাকলে সেটাও দিন → **Test connection** → **Save**।

বিস্তারিত: https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md
API key সেটআপ (`keys.json` ফরম্যাট): https://github.com/imputnet/cobalt/blob/main/docs/protect-an-instance.md

**YouTube নিয়ে সতর্কতা:** YouTube ডাটা-সেন্টারের IP প্রায়ই ব্লক করে ("sign in to confirm you're not a bot")। তখন cobalt এর ডকুমেন্টেশন অনুযায়ী `cookies.json` বা `yt-session-generator` সেটআপ করতে হতে পারে। বাসার ইন্টারনেট থেকে চালালে সাধারণত কম সমস্যা হয়।

---

## ব্যবহার

- **লিংক যোগ:** পেজের যেকোনো জায়গায় `Ctrl + V` চাপুন, অথবা লিংক ড্র্যাগ করে ছেড়ে দিন, অথবা **Add download**।
- **পজ / রিজিউম:** সারির `⋮` মেনু, ডাবল-ক্লিক, অথবা নিচের ডিটেইলস প্যানেল। একসাথে অনেকগুলো: চেকবক্স সিলেক্ট করে উপরের `˅` মেনু।
- **নেট চলে গেলে:** সব ডাউনলোড নিজে থেকে "Waiting for network" এ চলে যায়। নেট ফিরলে নিজে থেকেই আবার শুরু হয়, যেখানে থেমেছিল সেখান থেকে।
- **অডিও কনভার্ট:** ♫ আইকন, অথবা ভিডিওর `⋮` → *Convert to audio*। প্রথমবার ~৩১ MB কনভার্টার ইঞ্জিন লোড হয়, পরে ব্রাউজার ক্যাশ থেকে আসে। কম্পিউটারের যেকোনো ভিডিও ফাইলও কনভার্ট করা যায়।
- **Bookmarklet:** Settings এ থাকা "Send to WebGet" বাটনটা bookmarks bar এ টেনে রাখুন। YouTube/Facebook পেজে থাকা অবস্থায় ক্লিক করলে লিংকটা WebGet এ চলে আসবে।

## যা জানা দরকার (সীমাবদ্ধতা)

- **ট্যাব খোলা রাখতে হবে।** ব্রাউজার ট্যাব বন্ধ করলে ডাউনলোড থামে। আবার খুললে "Paused" দেখাবে — Resume চাপলে যেখানে ছিল সেখান থেকে চলবে (যদি সার্ভার resume সাপোর্ট করে)।
- **ফাইল প্রথমে ব্রাউজারের স্টোরেজে (IndexedDB) জমা হয়**, শেষ হলে আপনার Downloads ফোল্ডারে সেভ হয়। পরে লিস্ট থেকে Delete করলে ব্রাউজারের জায়গা খালি হয়।
- কিছু সার্ভার resume সাপোর্ট করে না — সেগুলোতে পজ করলে আবার শুরু থেকে নামবে। Add করার সময়ই এটা দেখিয়ে দেয়।
- কনভার্টার ব্রাউজারের মেমোরিতে চলে, তাই ১.৮ GB এর বড় ফাইল কনভার্ট হবে না।
- DRM-যুক্ত সার্ভিস (Netflix, Spotify, Hoichoi, Chorki ইত্যাদি) কোনোভাবেই ডাউনলোড হবে না — অ্যাপ এ ব্যাপারে সতর্ক করে।
- শুধু নিজের কনটেন্ট বা অনুমতি আছে এমন কনটেন্ট ডাউনলোড করুন। YouTube সহ অনেক প্ল্যাটফর্মের শর্তে ডাউনলোড নিষেধ।

## ফাইল স্ট্রাকচার

```
index.html                  মূল পেজ
css/style.css               ডিজাইন (লাইট/ডার্ক, মোবাইল)
js/app.js                   UI, ডায়ালগ, লিস্ট
js/engine.js                ডাউনলোড ইঞ্জিন: Range রিকোয়েস্ট, পজ/রিজিউম, অফলাইন ডিটেকশন
js/store.js                 IndexedDB তে ডাটা রাখা
js/extractor.js             লিংক চেক, cobalt API, পেজ স্ক্যানার
js/platforms.js             প্ল্যাটফর্ম চেনা ও রেস্ট্রিকশন সতর্কবার্তা
js/converter.js             ffmpeg.wasm দিয়ে অডিও কনভার্ট
js/utils.js                 ছোট হেল্পার ফাংশন
vendor/ffmpeg/              ffmpeg.wasm লোডার (MIT লাইসেন্স)
extras/cors-proxy-worker.js Cloudflare Worker প্রক্সি
```

লোকালি টেস্ট করতে: ফোল্ডারে `python -m http.server 8080` চালিয়ে `http://localhost:8080` খুলুন (সরাসরি `index.html` ডাবল-ক্লিক করলে কাজ করবে না)।
