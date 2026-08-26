# Isha Place – Vijayanagar (static site)

## Run locally

From this folder:

```bash
chmod +x serve.sh   # first time only
./serve.sh
```

Then open [http://localhost:8765/](http://localhost:8765/).

Use another port if this one is busy:

```bash
PORT=8080 ./serve.sh
```

Set your Apps Script web app URL in `config.js` (see `setup-guide.md`) so programs, volunteering, forms, and the admin page work against your Google Sheet.

Admins can sign in at `admin.html` to update listings, photos, and home-page text without opening the spreadsheet.

The standalone promotions board is available at `admin-promotions.html` after signing in through the admin page.
