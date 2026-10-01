# Cloud Delivery — marketing site

A standalone static page (HTML + CSS, no build step) that explains the product and links to a live console.
It is deployed separately from the console so ISV installs of the product never show marketing.

- `index.html`, `styles.css` — the page for software companies (ISVs)
- `field/` — the page for Microsoft field teams (SEs, CSAs, SSPs, partners): `field/index.html`, `field/field.css`
  (builds on `../styles.css`) and `field/shots/` (real screenshots of the console). Same config, same live demo.
- `config.js` — where the buttons point (`consoleUrl`, `repoUrl`); set per environment
- `staticwebapp.config.json` — Azure Static Web Apps settings

Live at **https://balunywa.github.io/deployment-delight/** (software companies) and
**https://balunywa.github.io/deployment-delight/field/** (Microsoft field teams). `.github/workflows/pages.yml` publishes
`site/` (both pages) to GitHub Pages on every change.

Preview locally:

```sh
cd site && python3 -m http.server 8088
```

Deploy to Azure Static Web Apps:

```sh
az staticwebapp create --name cloud-delivery-site --resource-group <rg> --location eastus2 --sku Free
npx @azure/static-web-apps-cli deploy ./site --deployment-token <token> --env production
```

Demo data on the page uses the fictional ISV GridWorks and fictional utility customers.
