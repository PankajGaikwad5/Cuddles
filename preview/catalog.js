// Sample products and collections for the local preview only (stock Unsplash images).
const img = (id) => ({ src: `https://images.unsplash.com/photo-${id}?w=1200&q=80`, alt: '' });

const POOL = {
  A: '1515886657613-9f3515b0c78f', B: '1496747611176-843222e1e57c', C: '1490481651871-ab68de25d43d',
  D: '1539109136881-3be0616acf4b', E: '1434389677669-e08b4cac3105', F: '1576566588028-4147f3842f27',
  G: '1591047139829-d91aecb6caea', H: '1583743814966-8936f5b7be1a', I: '1551488831-00ddcb6c6bd3',
  J: '1618354691373-d851c5c3a990', K: '1578587018452-892bacefd3f2', L: '1620799140408-edc6dcb6d633',
  M: '1608234808654-2a8875faa7fd', N: '1584370848010-d7fe6bc767ec', O: '1611312449408-fcece27cdbb7',
  P: '1525507119028-ed4c629a60a3', Q: '1556905055-8f358a7a47b2', R: '1564584217132-2271feaeb3c5',
  S: '1594633312681-425c7b97ccd1', T: '1572804013309-59a88b7e92f1',
};
const imageFor = (key) => img(POOL[key]);

const DESCRIPTION =
  '<p>Cut for an easy, relaxed fit and finished by hand in small batches. Soft against the skin and made to soften further with every wear.</p><p>Model is 5\'9" and wears a size S.</p>';

const SPECS = [
  ['oat-cable-knit-jumper', 'Oat Cable Knit Jumper', 449000, 'ABC', 'knitwear'],
  ['cocoa-ribbed-cardigan', 'Cocoa Ribbed Cardigan', 399000, 'DEF', 'knitwear'],
  ['cloud-lounge-set', 'Cloud Lounge Set', 349000, 'GHI', 'loungewear'],
  ['honey-wool-wrap', 'Honey Wool Wrap', 249000, 'JKL', 'accessories'],
  ['bark-merino-roll-neck', 'Bark Merino Roll Neck', 379000, 'MNO', 'knitwear', { compare: 459000 }],
  ['linen-sleep-shirt', 'Linen Sleep Shirt', 229000, 'PQR', 'loungewear'],
  ['heirloom-throw', 'Heirloom Throw', 549000, 'STA', 'blankets'],
  ['soft-cotton-jogger', 'Soft Cotton Jogger', 199000, 'BDF', 'loungewear', { soldOut: true }],
  ['alpaca-crew-neck', 'Alpaca Crew Neck', 479000, 'CEG', 'knitwear'],
  ['waffle-robe', 'Waffle Robe', 299000, 'HJL', 'loungewear'],
  ['cashmere-beanie', 'Cashmere Beanie', 149000, 'IKM', 'accessories'],
  ['nest-blanket', 'Nest Blanket', 429000, 'NPR', 'blankets'],
];

const OPTIONS = {
  knitwear: [['Colour', ['Oat', 'Cocoa']], ['Size', ['XS', 'S', 'M', 'L', 'XL']]],
  loungewear: [['Colour', ['Cream', 'Clay']], ['Size', ['XS', 'S', 'M', 'L']]],
  blankets: [['Size', ['Throw', 'Double', 'King']]],
  accessories: [['Colour', ['Oat', 'Cocoa', 'Honey']]],
};

const COLLECTION_TITLES = {
  all: 'All Pieces', new: 'New In', knitwear: 'Knitwear', loungewear: 'Loungewear',
  blankets: 'Blankets', accessories: 'Accessories',
};

const SORT_OPTIONS = [
  { value: 'manual', name: 'Featured' },
  { value: 'best-selling', name: 'Best selling' },
  { value: 'title-ascending', name: 'A–Z' },
  { value: 'price-ascending', name: 'Price, low to high' },
  { value: 'price-descending', name: 'Price, high to low' },
  { value: 'created-descending', name: 'Newest' },
];

let nextVariantId = 1000;
const cartesian = (lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((v) => [...a, v])), [[]]);

const products = SPECS.map(([handle, title, price, imgs, category, extra = {}], index) => {
  const options = OPTIONS[category];
  const url = `/products/${handle}`;
  const variants = cartesian(options.map(([, values]) => values)).map((opts, i) => {
    const id = nextVariantId++;
    return {
      id,
      title: opts.join(' / '),
      options: opts,
      option1: opts[0] || null,
      option2: opts[1] || null,
      price,
      compare_at_price: extra.compare || null,
      sku: `CUD-${index + 1}-${i + 1}`,
      url: `${url}?variant=${id}`,
      // Sold-out product, plus a couple of sold-out sizes elsewhere to show the strike-through.
      available: !extra.soldOut && !(index % 3 === 0 && i % 4 === 3),
    };
  });
  const images = imgs.split('').map((k) => ({ ...imageFor(k), alt: title }));
  const media = images.map((im, i) => ({ id: (index + 1) * 100 + i, media_type: 'image', alt: title, preview_image: im, src: im.src }));
  // Each colour gets its own image, like assigning variant images in Shopify admin.
  const colourIndex = options.findIndex(([name]) => name === 'Colour');
  if (colourIndex >= 0) {
    const colours = options[colourIndex][1];
    variants.forEach((v) => { v.featured_media = media[colours.indexOf(v.options[colourIndex]) % media.length]; });
  }
  return {
    id: index + 1,
    handle,
    title,
    url,
    category,
    object_type: 'product',
    price,
    compare_at_price: extra.compare || null,
    price_varies: false,
    available: variants.some((v) => v.available),
    featured_image: images[0],
    images,
    media,
    featured_media: media[0],
    description: DESCRIPTION,
    content: DESCRIPTION,
    options: options.map(([name]) => name),
    variants,
    has_only_default_variant: false,
    created_at: index,
  };
});

// Stand-in for the ₹200 "Gift box" product the store owner creates in admin (picked in theme settings).
// Kept out of `products` so it never shows in collections, like the live theme hides it.
const giftBoxImage = { ...imageFor('K'), alt: 'Gift box' };
const giftBoxVariant = { id: 9001, title: 'Default Title', options: ['Default Title'], option1: 'Default Title', price: 20000, compare_at_price: null, sku: 'CUD-GIFT', url: '/products/gift-box?variant=9001', available: true };
const giftBox = {
  id: 9000, handle: 'gift-box', title: 'Gift box', url: '/products/gift-box', category: 'gift', object_type: 'product',
  price: 20000, compare_at_price: null, price_varies: false, available: true,
  featured_image: giftBoxImage, images: [giftBoxImage],
  media: [{ id: 900000, media_type: 'image', alt: 'Gift box', preview_image: giftBoxImage, src: giftBoxImage.src }],
  description: '<p>Wrapped in our signature box, ready to give.</p>', content: '',
  options: ['Title'], variants: [giftBoxVariant], has_only_default_variant: true, created_at: -1,
};
giftBox.featured_media = giftBox.media[0];
const everyProduct = [...products, giftBox];

const findVariant = (id) => {
  for (const p of everyProduct) {
    const v = p.variants.find((x) => String(x.id) === String(id));
    if (v) return { product: p, variant: v };
  }
  return null;
};

function sortProducts(list, sortBy) {
  const by = {
    'title-ascending': (a, b) => a.title.localeCompare(b.title),
    'price-ascending': (a, b) => a.price - b.price,
    'price-descending': (a, b) => b.price - a.price,
    'created-descending': (a, b) => b.created_at - a.created_at,
    'best-selling': (a, b) => ((a.id * 7) % 12) - ((b.id * 7) % 12),
  }[sortBy];
  return by ? list.slice().sort(by) : list.slice();
}

/* ---------- Storefront filtering (mirrors Shopify's filter.v.* params) ---------- */
const optionValues = (p, name) => {
  const i = p.options.indexOf(name);
  return i < 0 ? [] : [...new Set(p.variants.map((v) => v.options[i]))];
};

function applyFilters(list, query) {
  const avail = query.getAll('filter.v.availability');
  const gte = query.get('filter.v.price.gte');
  const lte = query.get('filter.v.price.lte');
  return list.filter((p) => {
    if (avail.length && !avail.includes(p.available ? '1' : '0')) return false;
    for (const name of ['Colour', 'Size']) {
      const wanted = query.getAll(`filter.v.option.${name.toLowerCase()}`);
      if (wanted.length && !optionValues(p, name).some((v) => wanted.includes(v))) return false;
    }
    if (gte && p.price < Number(gte) * 100) return false;
    if (lte && p.price > Number(lte) * 100) return false;
    return true;
  });
}

function buildFilters(base, query, path) {
  const urlWithout = (param, value) => {
    const q = new URLSearchParams(query);
    const kept = q.getAll(param).filter((v) => value !== undefined && v !== value);
    q.delete(param);
    kept.forEach((v) => q.append(param, v));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const listFilter = (label, param, values) => {
    const active = query.getAll(param);
    const vals = values.map(({ label: l, value, count }) => ({
      label: l,
      value,
      param_name: param,
      count,
      active: active.includes(value),
      url_to_remove: urlWithout(param, value),
    }));
    return { type: 'list', label, param_name: param, values: vals, active_values: vals.filter((v) => v.active) };
  };
  const optionFilter = (name) => {
    const all = [...new Set(base.flatMap((p) => optionValues(p, name)))];
    if (!all.length) return null;
    return listFilter(name, `filter.v.option.${name.toLowerCase()}`,
      all.map((v) => ({ label: v, value: v, count: base.filter((p) => optionValues(p, name).includes(v)).length })));
  };
  const max = Math.max(0, ...base.map((p) => p.price));
  const gte = query.get('filter.v.price.gte');
  const lte = query.get('filter.v.price.lte');
  const priceUrl = (() => {
    const q = new URLSearchParams(query);
    q.delete('filter.v.price.gte');
    q.delete('filter.v.price.lte');
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  })();
  return [
    listFilter('Availability', 'filter.v.availability', [
      { label: 'In stock', value: '1', count: base.filter((p) => p.available).length },
      { label: 'Out of stock', value: '0', count: base.filter((p) => !p.available).length },
    ]),
    optionFilter('Colour'),
    optionFilter('Size'),
    {
      type: 'price_range',
      label: 'Price',
      range_max: max,
      min_value: { param_name: 'filter.v.price.gte', value: gte ? Number(gte) * 100 : null },
      max_value: { param_name: 'filter.v.price.lte', value: lte ? Number(lte) * 100 : null },
      url_to_remove: priceUrl,
      active_values: [],
    },
  ].filter(Boolean);
}

function getCollection(handle, sortBy = 'manual', query = new URLSearchParams()) {
  let base = products;
  if (handle === 'new') base = products.slice(0, 6);
  else if (COLLECTION_TITLES[handle] && handle !== 'all') base = products.filter((p) => p.category === handle);
  const path = `/collections/${handle}`;
  const filtered = applyFilters(base, query);
  return {
    handle,
    title: COLLECTION_TITLES[handle] || handle.replace(/-/g, ' '),
    url: path,
    description: '<p>Considered pieces in natural fibres, made slowly and designed to be lived in.</p>',
    products: sortProducts(filtered, sortBy),
    products_count: filtered.length,
    all_products_count: base.length,
    sort_by: sortBy,
    default_sort_by: 'manual',
    sort_options: SORT_OPTIONS,
    filters: buildFilters(base, query, path),
    featured_image: base[0] && base[0].featured_image,
  };
}

const allCollections = () =>
  ['new', 'knitwear', 'loungewear', 'blankets', 'accessories'].map((h) => getCollection(h));

function getProduct(handle, variantId) {
  const p = everyProduct.find((x) => x.handle === handle);
  if (!p) return null;
  const selected =
    p.variants.find((v) => String(v.id) === String(variantId)) || p.variants.find((v) => v.available) || p.variants[0];
  return {
    ...p,
    selected_or_first_available_variant: selected,
    options_with_values: p.options.map((name, i) => ({
      name,
      values: [...new Set(p.variants.map((v) => v.options[i]))],
      selected_value: selected.options[i],
    })),
    collections: [getCollection(p.category), getCollection('all')],
  };
}

module.exports = { products, getCollection, getProduct, allCollections, findVariant, imageFor };
