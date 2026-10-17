// Runs Shopify's Theme Check (the same linter `shopify theme check` uses) on this theme.
const path = require('path');
const { themeCheckRun } = require('@shopify/theme-check-node');

const root = path.resolve(__dirname, '..');
const SEVERITY = ['error', 'warning', 'info'];

themeCheckRun(root, undefined, () => {})
  .then(({ offenses }) => {
    const own = offenses.filter((o) => !/node_modules|\/preview\//.test(o.uri));
    for (const o of own) {
      const file = decodeURIComponent(o.uri).split(/cuddles site\//)[1] || o.uri;
      console.log(`${SEVERITY[o.severity]}\t${o.check}\t${file}:${o.start.line + 1}\t${o.message}`);
    }
    console.log(own.length ? `\n${own.length} offense(s)` : 'Theme Check: no offenses');
    process.exit(own.some((o) => o.severity === 0) ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
