// Local preview: renders the theme's real Liquid files with mocked Shopify objects, and
// emulates Shopify's Ajax Cart API (/cart.js, /cart/add.js, /cart/change.js, /cart/update.js),
// storefront filtering, search, customer accounts and form posts so the theme can be
// exercised end-to-end without a store. On a real store none of this file is used.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Liquid } = require('liquidjs');
const catalog = require('./catalog');
const mock = require('./mock-data');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const ORIGIN = `http://localhost:${PORT}`;

// Shopify allows a trailing `?` on some properties (form.posted_successfully?); liquidjs does not.
const shopifyCompat = (src) => src.replace(/\b(posted_successfully|comments_enabled|moderated)\?/g, '$1');
const read = (p) => shopifyCompat(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));

const liquidFs = {
  exists: async (f) => fs.existsSync(f),
  existsSync: (f) => fs.existsSync(f),
  readFile: async (f) => shopifyCompat(fs.readFileSync(f, 'utf8')),
  readFileSync: (f) => shopifyCompat(fs.readFileSync(f, 'utf8')),
  resolve: (root, file, ext) => path.resolve(root, file.endsWith(ext) ? file : file + ext),
  contains: (root, file) => path.resolve(file).startsWith(path.resolve(root)),
  dirname: path.dirname,
  sep: path.sep,
};

const liquid = new Liquid({
  root: [path.join(ROOT, 'snippets')],
  extname: '.liquid',
  fs: liquidFs,
  dynamicPartials: true,
  cache: false,
});

/* ======================= Policies ======================= */
// Mirrors Settings > Policies using the drafts in /policies.
const POLICY_TITLES = {
  'refund-policy': 'Refund policy', 'shipping-policy': 'Shipping policy', 'privacy-policy': 'Privacy policy',
  'terms-of-service': 'Terms of service', 'contact-information': 'Contact information',
};
const policies = () => Object.entries(POLICY_TITLES)
  .filter(([h]) => fs.existsSync(path.join(ROOT, 'policies', h + '.html')))
  .map(([handle, title]) => ({
    handle, title, url: `/policies/${handle}`,
    body: fs.readFileSync(path.join(ROOT, 'policies', handle + '.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
  }));

/* ======================= State ======================= */
const state = { lines: [], note: '', loggedIn: false };
let pageCtx = {};
let postedForm = '';

// Shopify's default INR format: ₹{{amount}} -> ₹4,490.00
const money = (cents) => `₹${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function cartLines() {
  return state.lines
    .map((line, i) => {
      const found = catalog.findVariant(line.id);
      if (!found) return null;
      const { product, variant } = found;
      return {
        key: `${variant.id}:${i}`,
        id: variant.id,
        variant_id: variant.id,
        product_id: product.id,
        handle: product.handle,
        sku: variant.sku,
        quantity: line.quantity,
        title: `${product.title} - ${variant.title}`,
        product_title: product.title,
        variant_title: variant.title,
        price: variant.price,
        original_price: variant.price,
        final_price: variant.price,
        line_price: variant.price * line.quantity,
        original_line_price: variant.price * line.quantity,
        final_line_price: variant.price * line.quantity,
        url: variant.url,
        url_to_remove: `/cart/change?line=${i + 1}&quantity=0`,
        image: product.featured_image.src,
        featured_image: { url: product.featured_image.src, alt: product.title },
        product_has_only_default_variant: false,
        options_with_values: product.options.map((name, j) => ({ name, value: variant.options[j] })),
        properties: {},
        _product: product,
        _variant: variant,
      };
    })
    .filter(Boolean);
}

function cartJSON() {
  const items = cartLines().map(({ _product, _variant, url_to_remove, ...rest }) => rest);
  const total = items.reduce((s, i) => s + i.final_line_price, 0);
  return {
    token: 'preview',
    note: state.note,
    attributes: {},
    item_count: items.reduce((s, i) => s + i.quantity, 0),
    items,
    total_price: total,
    original_total_price: total,
    items_subtotal_price: total,
    total_discount: 0,
    currency: 'INR',
    requires_shipping: items.length > 0,
  };
}

function cartLiquid() {
  const lines = cartLines().map((l) => ({
    ...l,
    image: { src: l.image, alt: l.product_title },
    product: l._product,
    variant: l._variant,
    properties: [],
  }));
  const json = cartJSON();
  return { ...json, items: lines, currency: { iso_code: 'INR' }, cart_level_discount_applications: [] };
}

function addToCart(id, quantity = 1) {
  const found = catalog.findVariant(id);
  if (!found) throw Object.assign(new Error('Product not found'), { status: 404 });
  if (!found.variant.available) {
    throw Object.assign(new Error(`${found.product.title} is sold out.`), { status: 422 });
  }
  const qty = Math.max(1, Number(quantity) || 1);
  const existing = state.lines.find((l) => String(l.id) === String(id));
  if (existing) existing.quantity += qty;
  else state.lines.push({ id: Number(id), quantity: qty });
  return cartJSON().items.find((i) => String(i.id) === String(id));
}

function changeLine({ line, id, quantity }) {
  let index = line ? Number(line) - 1 : -1;
  if (index < 0 && id) index = state.lines.findIndex((l, i) => `${l.id}:${i}` === String(id) || String(l.id) === String(id));
  if (index < 0 || !state.lines[index]) throw Object.assign(new Error('Line item not found'), { status: 400 });
  const qty = Math.max(0, Number(quantity) || 0);
  if (qty === 0) state.lines.splice(index, 1);
  else state.lines[index].quantity = qty;
}

/* ======================= Globals ======================= */
function globals() {
  const settings = readJSON('config/settings_data.json').current;
  return {
    shop: {
      name: 'Cuddles',
      url: ORIGIN,
      description: 'Soft goods, made slowly.',
      money_format: '₹{{amount}}',
      money_with_currency_format: '₹{{amount}} INR',
      customer_accounts_enabled: true,
      enabled_payment_types: ['visa', 'master', 'american_express', 'paypal', 'apple_pay', 'shopify_pay'],
      password_message: 'Something soft is on its way.',
      checkout: { guest_login: false },
      policies: policies(),
      types: ['Tops', 'Bottoms', 'Sets', 'Throws & Blankets', 'Wraps & Scarves'],
    },
    pages: Object.fromEntries(STORE_PAGES.map((h) => [h, mock.getPage(h)])),
    settings,
    request: { locale: { iso_code: 'en' }, design_mode: false, origin: ORIGIN, page_type: 'index' },
    canonical_url: ORIGIN,
    current_page: 1,
    template: { name: 'index' },
    page_title: 'Cuddles',
    page_description: '',
    routes: {
      root_url: '/',
      search_url: '/search',
      cart_url: '/cart',
      cart_add_url: '/cart/add',
      cart_change_url: '/cart/change',
      cart_update_url: '/cart/update',
      cart_clear_url: '/cart/clear',
      collections_url: '/collections',
      all_products_collection_url: '/collections/all',
      account_url: '/account',
      account_login_url: '/account/login',
      account_logout_url: '/account/logout',
      account_register_url: '/account/register',
      account_addresses_url: '/account/addresses',
      product_recommendations_url: '/recommendations/products',
    },
    cart: cartLiquid(),
    customer: state.loggedIn ? mock.customer : null,
    collections: catalog.allCollections(),
    all_country_option_tags: mock.ALL_COUNTRY_OPTION_TAGS,
    additional_checkout_buttons: false,
    // Same menus a brand-new Shopify store starts with, so the preview matches a fresh import.
    linklists: {
      'main-menu': { links: [link('Home', '/'), link('Catalog', '/collections/all'), link('Contact', '/pages/contact')] },
      footer: { links: [link('Search', '/search')] },
    },
    content_for_header: '',
    ...pageCtx,
  };
}
function link(title, url, links = []) {
  return { title, url, links, active: false };
}

/* ======================= Sections ======================= */
// JSON templates store collections/products as handles; Shopify hands Liquid the objects.
function resolveRefs(fields = [], values) {
  const out = { ...values };
  for (const f of fields) {
    const v = out[f.id];
    if (!v) continue;
    if (f.type === 'collection') out[f.id] = catalog.getCollection(v);
    if (f.type === 'product') out[f.id] = catalog.getProduct(v);
    if (f.type === 'product_list') out[f.id] = [].concat(v).map((h) => catalog.getProduct(h)).filter(Boolean);
    if (f.type === 'collection_list') out[f.id] = [].concat(v).map((h) => catalog.getCollection(h));
  }
  return out;
}

/* ======================= Sections (render) ======================= */
function parseSection(type) {
  const src = read(`sections/${type}.liquid`);
  const m = src.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
  return { src, schema: m ? JSON.parse(m[1]) : {} };
}
const defaults = (fields = []) => Object.fromEntries(fields.filter((f) => f.id).map((f) => [f.id, f.default ?? '']));

async function renderSection(type, data = {}, id = type) {
  const { src, schema } = parseSection(type);
  const blocks = (data.block_order || []).map((bid) => {
    const b = data.blocks[bid];
    const def = (schema.blocks || []).find((d) => d.type === b.type) || {};
    return { id: bid, type: b.type, shopify_attributes: '', settings: { ...defaults(def.settings), ...b.settings } };
  });
  const section = { id, settings: resolveRefs(schema.settings, { ...defaults(schema.settings), ...(data.settings || {}) }), blocks };
  blocks.forEach((b) => {
    const def = (schema.blocks || []).find((d) => d.type === b.type) || {};
    b.settings = resolveRefs(def.settings, b.settings);
  });
  // Shopify makes global objects (shop, collections, cart…) available inside {% render %} snippets too.
  const g = globals();
  const html = await liquid.parseAndRender(src, { ...g, section }, { globals: g });
  return `<div id="shopify-section-${id}" class="shopify-section">${html}</div>`;
}

/* ======================= Shopify tags ======================= */
const blockTag = (name, wrap) => ({
  parse(token, remain) {
    this.args = token.args;
    this.tpls = [];
    const stream = this.liquid.parser.parseStream(remain);
    stream
      .on(`tag:end${name}`, () => stream.stop())
      .on('template', (tpl) => this.tpls.push(tpl))
      .on('end', () => { throw new Error(`${name} tag not closed`); });
    stream.start();
    if (wrap.parse) wrap.parse.call(this, token);
  },
  *render(ctx, emitter) {
    yield* wrap.render.call(this, ctx, emitter);
  },
});

liquid.registerTag('schema', {
  parse(_, remain) {
    let t;
    while ((t = remain.shift())) if (t.name === 'endschema') return;
  },
  render: () => '',
});

liquid.registerTag('layout', { parse() {}, render: () => '' });

liquid.registerTag('section', {
  parse(token) { this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); },
  async render() {
    const data = (readJSON('config/settings_data.json').current.sections || {})[this.name] || {};
    return renderSection(this.name, data, this.name);
  },
});

const FORM_ACTIONS = {
  product: '/cart/add', contact: '/contact', customer: '/contact', customer_login: '/account/login',
  create_customer: '/account', recover_customer_password: '/account/recover', reset_customer_password: '/account/reset',
  activate_customer_password: '/account/activate', customer_address: '/account/addresses',
  new_comment: '/blogs/journal/comments', storefront_password: '/password', localization: '/localization',
  guest_login: '/account/login',
};

liquid.registerTag('form', blockTag('form', {
  parse() {
    this.type = (this.args.match(/^\s*['"]([^'"]+)['"]/) || [])[1];
    this.objExpr = (this.args.match(/^\s*['"][^'"]+['"]\s*,\s*([a-zA-Z_][\w.]*)\s*(?:,|$)/) || [])[1];
    this.attrs = [...this.args.matchAll(/(\w+):\s*['"]([^'"]*)['"]/g)].map(([, k, v]) => ` ${k}="${v}"`).join('');
  },
  *render(ctx, emitter) {
    const obj = this.objExpr ? this.liquid.evalValueSync(this.objExpr, ctx) : null;
    let action = FORM_ACTIONS[this.type] || `/${this.type}`;
    if (this.type === 'customer_address' && obj && obj.id) action = `/account/addresses/${obj.id}`;
    const form = {
      ...(obj || {}),
      posted_successfully: postedForm === this.type,
      errors: null,
      password_needed: true,
      set_as_default_checkbox: '',
    };
    emitter.write(`<form method="post" action="${action}" accept-charset="UTF-8"${this.attrs}>`);
    emitter.write(`<input type="hidden" name="form_type" value="${this.type}"><input type="hidden" name="utf8" value="✓">`);
    ctx.push({ form });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
    emitter.write('</form>');
  },
}));

// Renders its body once; the preview never has more than one page.
liquid.registerTag('paginate', blockTag('paginate', {
  *render(ctx, emitter) {
    ctx.push({ paginate: { pages: 1, parts: [], current_page: 1 } });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
  },
}));

/* ======================= Shopify filters ======================= */
const attr = (v) => String(v ?? '').replace(/"/g, '&quot;');
const named = (args) => Object.fromEntries(args.filter(Array.isArray));
const PAYMENT_LABELS = { visa: 'VISA', master: 'MC', american_express: 'AMEX', paypal: 'PayPal', apple_pay: 'Pay', shopify_pay: 'Shop' };

liquid.registerFilter('asset_url', (f) => `/assets/${f}`);
liquid.registerFilter('shopify_asset_url', (f) => `https://cdn.shopify.com/s/shopify/${f}`);
liquid.registerFilter('stylesheet_tag', (u) => `<link rel="stylesheet" href="${u}">`);
liquid.registerFilter('preload_tag', (u, ...args) => {
  const a = named(args);
  return `<link rel="preload" href="${u}"${Object.entries(a).map(([k, v]) => ` ${k}="${attr(v)}"`).join('')}>`;
});
liquid.registerFilter('script_tag', (u) => `<script src="${u}"></script>`);
liquid.registerFilter('image_url', (img) => (img && (img.src || img.url)) || (typeof img === 'string' ? img : ''));
liquid.registerFilter('image_tag', (u, ...args) => {
  const a = named(args);
  const extra = Object.entries(a).filter(([k]) => k !== 'alt').map(([k, v]) => ` ${k}="${attr(v)}"`).join('');
  return `<img src="${u}" alt="${attr(a.alt)}"${extra}>`;
});
liquid.registerFilter('video_tag', () => '');
liquid.registerFilter('placeholder_svg_tag', () => '<svg viewBox="0 0 100 100"></svg>');
liquid.registerFilter('money', money);
liquid.registerFilter('money_with_currency', (c) => `${money(c)} INR`);
liquid.registerFilter('money_without_currency', (c) => (Number(c || 0) / 100).toFixed(2));
liquid.registerFilter('default_errors', (e) => (e ? `<ul><li>${[].concat(e).join('</li><li>')}</li></ul>` : ''));
liquid.registerFilter('link_to', (text, url) => `<a href="${url}">${text}</a>`);
liquid.registerFilter('payment_type_svg_tag', (type) =>
  `<svg class="payment-icon" viewBox="0 0 38 24" role="img" aria-label="${type}"><rect x=".5" y=".5" width="37" height="23" rx="3" fill="none" stroke="currentColor" stroke-opacity=".45"/><text x="19" y="15.5" font-size="7" font-family="sans-serif" text-anchor="middle" fill="currentColor">${PAYMENT_LABELS[type] || type}</text></svg>`);
liquid.registerFilter('payment_button', () => '');
liquid.registerFilter('format_address', (a) =>
  a ? [a.name, a.company, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join('<br>') : '');
liquid.registerFilter('format_code', (c) => c);
liquid.registerFilter('url_for_type', (t) => `/collections/types?q=${encodeURIComponent(t)}`);
liquid.registerFilter('handleize', (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
liquid.registerFilter('pluralize', (n, one, many) => (Number(n) === 1 ? one : many));
liquid.registerFilter('highlight', (s) => s);
liquid.registerFilter('t', (key) => key);

/* ======================= Live reload ======================= */
const clients = new Set();
// Reloads on file changes, and also once the server comes back after a restart.
const RELOAD = `<script>(()=>{const es=new EventSource('/__reload');es.onmessage=()=>location.reload();es.onerror=()=>{es.close();setInterval(()=>fetch(location.href,{cache:'no-store'}).then(()=>location.reload()).catch(()=>{}),1000)}})()</script>`;
let timer;
for (const dir of ['layout', 'sections', 'snippets', 'templates', 'assets', 'config']) {
  fs.watch(path.join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => clients.forEach((res) => res.write('data: reload\n\n')), 80);
  });
}

/* ======================= Rendering ======================= */
async function renderTemplate(name) {
  const tpl = readJSON(`templates/${name}.json`);
  const sections = await Promise.all(tpl.order.map((id) => renderSection(tpl.sections[id].type, tpl.sections[id], id)));
  const layout = tpl.layout || 'theme';
  const g = globals();
  const html = await liquid.parseAndRender(read(`layout/${layout}.liquid`), {
    ...g,
    content_for_layout: sections.join('\n'),
  }, { globals: g });
  return html.replace('</body>', `${RELOAD}</body>`);
}

/* ======================= Request helpers ======================= */
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

function parseBody(raw, type = '') {
  const entries = [];
  if (type.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { return {}; }
  }
  if (type.includes('multipart/form-data')) {
    const boundary = (type.match(/boundary=(.+)$/) || [])[1];
    for (const part of raw.split(`--${boundary}`).slice(1, -1)) {
      const [head, ...rest] = part.split('\r\n\r\n');
      const name = (head.match(/name="([^"]+)"/) || [])[1];
      if (name) entries.push([name, rest.join('\r\n\r\n').replace(/\r\n$/, '')]);
    }
  } else {
    for (const [k, v] of new URLSearchParams(raw)) entries.push([k, v]);
  }
  const out = {};
  for (const [k, v] of entries) {
    const key = k.replace(/\[\]$/, '');
    if (k.endsWith('[]')) (out[key] = out[key] || []).push(v);
    else out[key] = v;
  }
  return out;
}

const send = (res, status, body, type = 'text/html; charset=utf-8', headers = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json');
const redirect = (res, location) => send(res, 303, '', 'text/plain', { Location: location });
const withParam = (url, key, value) => {
  const u = new URL(url || '/', ORIGIN);
  u.searchParams.set(key, value);
  return u.pathname + u.search;
};

/* ======================= Cart & form endpoints ======================= */
async function handlePost(req, res, url) {
  const body = parseBody(await readBody(req), req.headers['content-type']);
  const isJs = url.endsWith('.js');
  const route = url.replace(/\.js$/, '');
  try {
    switch (route) {
      case '/cart/add': {
        let added;
        if (Array.isArray(body.items)) added = { items: body.items.map((i) => addToCart(i.id, i.quantity)) };
        else added = addToCart(body.id, body.quantity);
        return isJs ? json(res, 200, added) : redirect(res, '/cart');
      }
      case '/cart/change':
        changeLine(body);
        return isJs ? json(res, 200, cartJSON()) : redirect(res, '/cart');
      case '/cart/update':
      case '/cart': {
        if (body.updates) {
          const updates = Array.isArray(body.updates) ? body.updates : Object.values(body.updates);
          updates.map(Number).forEach((q, i) => { if (state.lines[i]) state.lines[i].quantity = q; });
          state.lines = state.lines.filter((l) => l.quantity > 0);
        }
        if (typeof body.note === 'string') state.note = body.note;
        if ('checkout' in body) return redirect(res, '/checkout');
        return isJs ? json(res, 200, cartJSON()) : redirect(res, '/cart');
      }
      case '/cart/clear':
        state.lines = [];
        return isJs ? json(res, 200, cartJSON()) : redirect(res, '/cart');
      case '/account/login':
      case '/account':
        state.loggedIn = true;
        return redirect(res, '/account');
      default:
        // contact, newsletter, recover, address, comment, password: echo success back to the page.
        return redirect(res, withParam(req.headers.referer, 'posted', body.form_type || 'contact'));
    }
  } catch (err) {
    const status = err.status || 422;
    if (isJs) return json(res, status, { status, message: 'Cart Error', description: err.message });
    return send(res, status, err.message, 'text/plain');
  }
}

/* ======================= Page routing ======================= */
// Pages that exist in the store. A fresh store has Contact; FAQ and Shipping & Returns are the
// ones the setup notes ask you to create. There is deliberately no About page, to exercise the
// theme's built-in fallback.
const STORE_PAGES = ['contact', 'faq', 'shipping-returns'];
function routePage(url, query) {
  const ctx = (name, extra = {}) => ({ name, ctx: { template: { name: name.split('/').pop().split('.')[0], suffix: name.split('.')[1] || null, directory: name.includes('/') ? name.split('/')[0] : null }, request: { locale: { iso_code: 'en' }, origin: ORIGIN, page_type: name.split('/').pop().split('.')[0] }, canonical_url: ORIGIN + url, ...extra } });
  let m;

  // Alternate templates via ?view= (e.g. /?view=about -> templates/index.about.json), like Shopify.
  if (url === '/') {
    const view = query.get('view');
    if (view && fs.existsSync(path.join(ROOT, 'templates', `index.${view}.json`))) return ctx(`index.${view}`, { page_title: view });
    return ctx('index');
  }
  if (url === '/cart') return ctx('cart', { page_title: 'Your bag' });
  if (url === '/collections' || url === '/collections/') return ctx('list-collections', { page_title: 'Collections' });
  if ((m = url.match(/^\/collections\/([^/]+)\/?$/))) {
    const collection = catalog.getCollection(m[1], query.get('sort_by') || 'manual', query);
    return ctx('collection', { collection, page_title: collection.title });
  }
  if ((m = url.match(/^\/(?:collections\/[^/]+\/)?products\/([^/]+)/))) {
    const product = catalog.getProduct(m[1], query.get('variant'));
    if (product) return ctx('product', { product, page_title: product.title, page_image: product.featured_image });
  }
  if (url === '/search') {
    const q = (query.get('q') || '').trim().toLowerCase();
    const results = q
      ? [
          ...catalog.products.filter((p) => p.title.toLowerCase().includes(q) || p.category.includes(q)),
          ...mock.blog.articles.filter((a) => a.title.toLowerCase().includes(q)),
        ]
      : [];
    return ctx('search', { page_title: 'Search', search: { performed: !!q, terms: query.get('q') || '', results, results_count: results.length } });
  }
  if ((m = url.match(/^\/pages\/([^/]+)/)) && STORE_PAGES.includes(m[1])) {
    const page = mock.getPage(m[1]);
    const special = { contact: 'page.contact', faq: 'page.faq', 'shipping-returns': 'page.shipping-returns' }[m[1]];
    return ctx(special || 'page', { page, page_title: page.title });
  }
  // A fresh store's default blog exists but has no posts.
  if (url === '/blogs/news' || url === '/blogs/news/') {
    return ctx('blog', { blog: { title: 'News', handle: 'news', url: '/blogs/news', articles: [], articles_count: 0, all_tags: [] }, page_title: 'News' });
  }
  if (/^\/blogs\/[^/]+\/?$/.test(url) || url.includes('/tagged/')) {
    const tag = url.split('/tagged/')[1];
    const articles = tag ? mock.blog.articles.filter((a) => a.tags.some((t) => t.toLowerCase() === tag)) : mock.blog.articles;
    return ctx('blog', { blog: { ...mock.blog, articles }, current_tags: tag ? [mock.blog.all_tags.find((t) => t.toLowerCase() === tag)] : null, page_title: mock.blog.title });
  }
  if ((m = url.match(/^\/blogs\/journal\/([^/]+)/))) {
    const article = mock.blog.articles.find((a) => a.handle === m[1]);
    if (article) return ctx('article', { blog: mock.blog, article, page_title: article.title, page_image: article.image });
  }
  if (url === '/account/login') return ctx('customers/login', { page_title: 'Log in' });
  if (url === '/account/register') return ctx('customers/register', { page_title: 'Create account' });
  if (url === '/account/reset') return ctx('customers/reset_password', { email: 'alex@example.com', page_title: 'Reset password' });
  if (url === '/account/activate') return ctx('customers/activate_account', { page_title: 'Activate account' });
  if (url.startsWith('/account')) {
    if (!state.loggedIn) return { redirect: '/account/login' };
    if (url === '/account/addresses') return ctx('customers/addresses', { page_title: 'Addresses' });
    if ((m = url.match(/^\/account\/orders\/(\d+)/))) {
      const order = mock.orders.find((o) => String(o.id) === m[1]);
      if (order) return ctx('customers/order', { order, page_title: `Order ${order.name}` });
    }
    if (url === '/account') return ctx('customers/account', { page_title: 'My account' });
  }
  if ((m = url.match(/^\/policies\/([^/]+)/))) {
    const policy = policies().find((p) => p.handle === m[1]);
    if (policy) return ctx('page', { page: { title: policy.title, content: policy.body }, page_title: policy.title });
  }
  if (url === '/password') return ctx('password');
  if (url === '/checkout') {
    return ctx('page', {
      page_title: 'Checkout',
      page: {
        title: 'Checkout',
        content: `<p>On your live store this step hands over to Shopify's secure checkout, with your bag of ${cartJSON().item_count} item(s) totalling ${money(cartJSON().total_price)}.</p><p><a href="/cart">Back to bag</a></p>`,
      },
    });
  }
  return { ...ctx('404', { page_title: 'Page not found' }), status: 404 };
}

/* ======================= Server ======================= */
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2' };

http
  .createServer(async (req, res) => {
    const full = new URL(req.url, ORIGIN);
    const url = decodeURIComponent(full.pathname);
    try {
      if (url === '/__reload') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.startsWith('/assets/')) {
        const file = path.join(ROOT, 'assets', path.basename(url));
        if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
        const type = MIME[path.extname(file)] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (range) {
          // Byte ranges so browsers can stream/seek video like a real CDN.
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === 'POST') return handlePost(req, res, url);
      if (url === '/cart.js' || url === '/cart.json') return json(res, 200, cartJSON());
      if (url === '/cart/change') {
        changeLine({ line: full.searchParams.get('line'), quantity: full.searchParams.get('quantity') });
        return redirect(res, '/cart');
      }
      if (url === '/account/logout') {
        state.loggedIn = false;
        return redirect(res, '/');
      }

      // Same as a Shopify URL redirect: /shop -> /collections/all (theme.js then shows /shop).
      if (url === '/shop' || url === '/shop/') return redirect(res, '/collections/all' + full.search);
      const route = routePage(url, full.searchParams);
      if (route.redirect) return redirect(res, route.redirect);
      postedForm = full.searchParams.get('posted') || '';
      pageCtx = route.ctx;
      const html = await renderTemplate(route.name);
      send(res, route.status || 200, html);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, String(err.stack || err), 'text/plain');
    }
  })
  .listen(PORT, () => console.log(`Cuddles preview: ${ORIGIN}`));
