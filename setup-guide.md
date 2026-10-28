# Setup Guide — Isha Place, Vijayanagar Website

## What you have
- `index.html` — Home page  
- `programs.html` — Programs listing  
- `volunteering.html` — Volunteering listing  
- `detail.html` — Detail page + contact form  
- `admin-promotions.html` — Standalone promotions day board
- `admin.html` / `admin.js` — Admin login to edit content  
- `site.js` — Loads home/footer text from the sheet  
- `style.css` — All styling  
- `config.js` — Where you paste your Apps Script URL  
- `apps-script.js` — The Google Apps Script code  

---

## STEP 1 — Create Your Google Sheet

1. Go to **sheets.google.com** → New spreadsheet
2. Name it: `Isha Place, Vijayanagar`
3. Create **3 tabs** (click + at bottom):
   - `Programs`
   - `Volunteering`
   - `Contacts` *(the script creates this automatically, but you can make it now)*

### Programs tab — add these headers in Row 1:
| title | description | date | location | duration | image | registerlink | status |
|-------|-------------|------|----------|----------|-------|--------------|--------|

### Volunteering tab — add these headers in Row 1:
| title | description | date | location | duration | image | status |
|-------|-------------|------|----------|----------|-------|--------|

**Tips:**
- `status` column: type `active` to show, `inactive` to hide
- `image` column: paste the Google Drive shareable URL (see Step 1b)
- `registerlink`: paste the external registration URL (for programs only)

---

## STEP 1b — Upload Images to Google Drive

1. Create a folder in Google Drive called `Centre Images`
2. Upload your images there
3. Right-click any image → **Share** → **Anyone with the link can view** → Copy link
4. The link looks like: `https://drive.google.com/file/d/FILEID/view`
5. Convert it to a direct image URL:
   - Take the `FILEID` from the link
   - Use this format: `https://drive.google.com/uc?id=FILEID`
   - Paste **that** URL into the image column

---

## STEP 2 — Set Up Google Apps Script

1. In your Google Sheet → click **Extensions** → **Apps Script**
2. Delete all existing code in the editor
3. Open `apps-script.js` from your files → **copy all the code**
4. Paste it into the Apps Script editor
5. Click 💾 **Save** (name the project "Centre Website")

### Deploy as Web App:
1. Click **Deploy** (top right) → **New deployment**
2. Click the gear icon ⚙️ next to "Type" → select **Web app**
3. Fill in:
   - Description: `Centre Website`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Click **Authorize access** → Choose your Google account → Allow
6. **Copy the Web App URL** — it looks like:
   `https://script.google.com/macros/s/XXXXXXXXX/exec`

---

## STEP 3 — Paste the URL into config.js

1. Open `config.js`
2. Replace `YOUR_APPS_SCRIPT_URL_HERE` with the URL you copied
3. Save the file

```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXXXX/exec";
```

---

## STEP 4 — Host on GitHub Pages

1. Go to **github.com** → Sign up (free)
2. Click **New repository**
   - Name: `centre-website`
   - Visibility: **Public**
   - Click **Create repository**
3. Click **uploading an existing file**
4. Drag and drop ALL your files:
   - index.html
   - programs.html
   - volunteering.html
   - detail.html
   - style.css
   - config.js
5. Click **Commit changes**
6. Go to **Settings** → **Pages** (left sidebar)
7. Under "Branch" → select **main** → click **Save**
8. Wait ~1 minute → your site is live at:
   `https://yourusername.github.io/centre-website`

---

## STEP 5 — Add Your First Program

1. Open your Google Sheet → `Programs` tab
2. Add a row under the headers:

| title | description | date | location | duration | image | registerlink | status |
|-------|-------------|------|----------|----------|-------|--------------|--------|
| Morning Yoga | A rejuvenating yoga session... | May 10, 2025 | Isha Place, Vijayanagar, Bangalore | 2 hours | https://drive.google.com/uc?id=YOUR_ID | https://bookmyshow.com/... | active |

3. Go to your website URL → click Programs → your listing appears!

---

## How to Update Content Later

Use the **admin** page at `admin.html` (also linked as “Admin login” in the footer).

You can still edit the Google Sheet directly if you prefer.

---

## STEP 6 — Admin (edit the site without opening Sheets)

The public site still **reads** from Google Sheets. The admin page **writes** back to those sheets, and uploads photos to Google Drive.

Google does **not** ask for Drive access when you click Deploy. You have to **Run** a function once.

1. Paste the updated `apps-script.js` into Apps Script (replace all existing code).
2. At the top of the file, set `ADMIN_PASSWORD` to your admin password (6+ characters). **Save**.
3. In the toolbar, open the function dropdown (it may say `onOpen` or `doGet`) → choose **`setupAdmin`** → click **Run**.
4. A permissions window appears:
   - Choose your Google account
   - If you see “Google hasn’t verified this app” → **Advanced** → **Go to … (unsafe)**
   - Click **Allow** (this includes Drive)
5. **Deploy → Manage deployments → pencil → New version → Deploy**.
6. Open `/admin.html` and sign in with that password.

The **Website** menu on the spreadsheet only appears after this Run/Allow step, and only after you fully reload the sheet. You do not need that menu if you set `ADMIN_PASSWORD` in the script.

### What you can edit
- **Programs** — title, description, date, timings, location, duration, frequency, register link, status (Open/Closed), image
- **Volunteering** — same fields except frequency/register; status is Active/Inactive
- **Home & footer** — hero quote, about text, address, phone, hours, desktop/mobile hero photos

Images are stored in a Drive folder named **Isha Place Centre Images** (created automatically) and the URL is written into the sheet.

The admin session lasts about 6 hours in that browser tab.

---

## Troubleshooting

**"Could not load programs" error:**
- Check that your Apps Script URL is correctly pasted in `config.js`
- Make sure you deployed with "Anyone" access

**Images not showing:**
- Make sure you used the `https://drive.google.com/uc?id=FILEID` format
- Check that the Drive file is shared as "Anyone with link"

**Form submissions not saving:**
- Re-deploy your Apps Script (Deploy → Manage deployments → Edit → Deploy)
- Make sure you authorized the script

**Admin login fails / cannot upload images:**
- Set the password from the sheet: **Website → Set admin password**
- Redeploy the web app as a **new version** after pasting the updated script
- When Google asks for Drive access, click Allow
- Serve the site over http (e.g. `python3 -m http.server 8765`), not as a local `file://` page

---

## Your Site Structure

```
yourusername.github.io/centre-website/
├── index.html         ← Home
├── programs.html      ← All programs
├── volunteering.html  ← All volunteering
├── detail.html        ← Single item detail
├── admin.html         ← Admin login / content editor
├── admin.js
├── site.js            ← Loads home/footer text from the Site sheet
├── style.css          ← Styling
├── config.js          ← Apps Script URL
└── apps-script.js     ← Paste into Google Apps Script
```
