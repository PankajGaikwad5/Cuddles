// Non-product sample content for the local preview: pages, journal, customer, orders.
const { products, imageFor } = require('./catalog');

const lorem =
  '<p>Cuddles began with a simple idea: clothes and home pieces that feel as good as they look, made slowly by people who care. Every piece is designed to be worn, washed and loved for years.</p>' +
  '<p>We work with small family-run mills and makers, choosing natural fibres that soften with time. Nothing is rushed, and nothing is made in excess.</p>';

const PAGES = {
  about: { title: 'About', content: lorem },
  categories: { title: 'Categories', content: '<p>Browse by category from the Shop menu, or explore every piece in <a href="/collections/all">All Pieces</a>.</p>' },
  contact: { title: 'Get in Touch', content: '<p>Questions about an order, sizing or care? Send us a note and we\'ll reply within two working days.</p>' },
  faq: { title: 'FAQ', content: '' },
  'shipping-returns': { title: 'Shipping & Returns', content: '' },
  sitemap: { title: 'Sitemap', content: '' },
  llms: { title: 'Brand profile', content: '' },
};
const getPage = (handle) => {
  const p = PAGES[handle] || { title: handle.replace(/-/g, ' '), content: lorem };
  return { ...p, handle, url: `/pages/${handle}`, object_type: 'page' };
};

const ARTICLES = [
  ['the-slow-knit', 'The Slow Knit', 'Q', ['Craft']],
  ['caring-for-wool', 'Caring for Wool', 'E', ['Care']],
  ['a-winter-at-home', 'A Winter at Home', 'T', ['Stories']],
  ['meet-the-mill', 'Meet the Mill', 'K', ['Craft', 'Stories']],
  ['layering-guide', 'The Layering Guide', 'B', ['Style']],
  ['our-yarns', 'Our Yarns, Explained', 'N', ['Craft']],
].map(([handle, title, key, tags], i) => ({
  handle,
  title,
  tags,
  url: `/blogs/journal/${handle}`,
  object_type: 'article',
  image: { ...imageFor(key), alt: title },
  published_at: new Date(2026, 9, 12 - i * 9).toISOString(),
  author: 'The Cuddles Team',
  excerpt: '',
  content: lorem + lorem,
  comments: [],
  comments_count: 0,
}));

const blog = {
  title: 'Our World',
  handle: 'journal',
  url: '/blogs/journal',
  articles: ARTICLES,
  articles_count: ARTICLES.length,
  all_tags: [...new Set(ARTICLES.flatMap((a) => a.tags))],
  comments_enabled: true,
  moderated: true,
};

const address = (id, first, last, address1, city, zip, country, province = '') => ({
  id,
  first_name: first,
  last_name: last,
  name: `${first} ${last}`,
  company: '',
  address1,
  address2: '',
  city,
  zip,
  country,
  province,
  phone: '',
  url: `/account/addresses/${id}`,
});
const addresses = [
  address(1, 'Aisha', 'Mehta', '14 Palm Grove, Bandra West', 'Mumbai', '400050', 'India', 'Maharashtra'),
  address(2, 'Aisha', 'Mehta', '22 Lavelle Road', 'Bengaluru', '560001', 'India', 'Karnataka'),
];

const orderLine = (p, qty) => ({
  title: `${p.title} - ${p.variants[0].title}`,
  product: p,
  quantity: qty,
  final_price: p.price,
  final_line_price: p.price * qty,
});
const makeOrder = (num, lines, date) => {
  const subtotal = lines.reduce((s, l) => s + l.final_line_price, 0);
  return {
    id: num,
    name: `#${num}`,
    customer_url: `/account/orders/${num}`,
    created_at: date,
    financial_status_label: 'Paid',
    fulfillment_status_label: num === 1002 ? 'Unfulfilled' : 'Fulfilled',
    line_items: lines,
    line_items_subtotal_price: subtotal,
    shipping_methods: [{ title: 'Standard', price: 0 }],
    tax_lines: [{ title: 'GST', rate: 0.12, price: Math.round((subtotal * 12) / 112) }],
    cart_level_discount_applications: [],
    total_price: subtotal,
    billing_address: addresses[0],
    shipping_address: addresses[0],
  };
};
const orders = [
  makeOrder(1002, [orderLine(products[0], 1), orderLine(products[3], 2)], '2026-10-02T10:00:00Z'),
  makeOrder(1001, [orderLine(products[6], 1)], '2026-08-14T10:00:00Z'),
];

const customer = {
  first_name: 'Aisha',
  last_name: 'Mehta',
  name: 'Aisha Mehta',
  email: 'aisha@example.com',
  orders,
  orders_count: orders.length,
  addresses,
  addresses_count: addresses.length,
  default_address: addresses[0],
  new_address: {},
};

// Shape of Shopify's all_country_option_tags (provinces as JSON in data-provinces).
const countryOption = (name, provinces = []) =>
  `<option value="${name}" data-provinces='${JSON.stringify(provinces.map((p) => [p, p])).replace(/'/g, '&#39;')}'>${name}</option>`;
const ALL_COUNTRY_OPTION_TAGS = [
  countryOption('United Kingdom', ['England', 'Scotland', 'Wales', 'Northern Ireland']),
  countryOption('United States', ['California', 'New York', 'Texas', 'Washington']),
  countryOption('India', ['Delhi', 'Karnataka', 'Maharashtra', 'Punjab']),
  countryOption('France'),
  countryOption('Germany'),
].join('\n');

module.exports = { getPage, blog, customer, orders, ALL_COUNTRY_OPTION_TAGS };
