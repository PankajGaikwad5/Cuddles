(() => {
  const theme = window.theme || { routes: {}, moneyFormat: '₹{{amount}}', cartType: 'drawer' };
  const routes = {
    cart: '/cart',
    cartAdd: '/cart/add',
    cartChange: '/cart/change',
    cartUpdate: '/cart/update',
    allProducts: '/collections/all',
    ...theme.routes,
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Port of Shopify's money formatting so prices rendered client-side match Liquid's `money` filter.
  function formatMoney(cents, format = theme.moneyFormat) {
    if (typeof cents === 'string') cents = cents.replace('.', '');
    const value = Number(cents) || 0;
    const fmt = (n, decimals, thousands = ',', decimal = '.') => {
      const [whole, frac] = (n / 100).toFixed(decimals).split('.');
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (frac ? decimal + frac : '');
    };
    return String(format).replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => ({
      amount: fmt(value, 2),
      amount_no_decimals: fmt(value, 0),
      amount_with_comma_separator: fmt(value, 2, '.', ','),
      amount_no_decimals_with_comma_separator: fmt(value, 0, '.', ','),
      amount_with_apostrophe_separator: fmt(value, 2, "'", '.'),
      amount_with_space_separator: fmt(value, 2, ' ', ','),
    }[key] ?? fmt(value, 2)));
  }

  const resizeImage = (url, width) => {
    if (!url) return '';
    return url + (url.includes('?') ? '&' : '?') + 'width=' + width;
  };

  async function cartRequest(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body instanceof FormData ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.description || data.message || 'Something went wrong. Please try again.');
    return data;
  }
  const getCart = () => cartRequest(`${routes.cart}.js`);

  /* ---------------- /shop address ---------------- */
  // Shopify always serves all products at /collections/all. With a URL redirect
  // /shop -> /collections/all in place, show /shop in the address bar instead.
  if (theme.shopPath && document.body.classList.contains('template-collection')) {
    const here = window.location.pathname.replace(/\/$/, '');
    if (here === routes.allProducts.replace(/\/$/, '')) {
      window.history.replaceState(window.history.state, '', theme.shopPath + window.location.search + window.location.hash);
    }
  }

  /* ---------------- Smooth scroll ---------------- */
  // lerp: higher = snappier (0.1 is Lenis' default).
  let lenis = null;
  if (window.Lenis && !reduceMotion) {
    lenis = new window.Lenis({ lerp: 0.14, wheelMultiplier: 1.1, smoothWheel: true });
    const raf = (time) => {
      lenis.raf(time);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }
  let lockCount = 0;
  const lockScroll = () => {
    lockCount += 1;
    document.body.classList.add('is-locked');
    if (lenis) lenis.stop();
  };
  const unlockScroll = () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount) return;
    document.body.classList.remove('is-locked');
    if (lenis) lenis.start();
  };

  /* ---------------- Header ---------------- */
  const header = $('[data-header]');
  if (header) {
    // Transparent over any page that opens with a hero (home, About), regardless of template name.
    if (header.dataset.transparent === 'true' && $('#MainContent > :first-child.hero, #MainContent > :first-child .hero')) header.classList.add('site-header--transparent');
    const SOLID_AT = 40;
    let ticking = false;
    let lastY = window.scrollY;
    const update = () => {
      const y = Math.max(0, window.scrollY);
      header.classList.toggle('is-solid', y > SOLID_AT);

      // Hide while scrolling down (once past the header), show on any upward scroll.
      const busy = header.classList.contains('menu-open') || header.matches(':focus-within');
      if (y > lastY && y > header.offsetHeight && !busy) {
        header.classList.add('is-hidden');
      } else if (y < lastY || y <= header.offsetHeight) {
        header.classList.remove('is-hidden');
      }
      lastY = y;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();

    const toggle = $('[data-menu-toggle]', header);
    const menu = $('[data-mobile-menu]', header);
    if (toggle && menu) {
      toggle.addEventListener('click', () => {
        const open = menu.hidden;
        menu.hidden = !open;
        header.classList.toggle('menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        open ? lockScroll() : unlockScroll();
      });

      $$('[data-mobile-expand]', menu).forEach((btn) => {
        btn.addEventListener('click', () => {
          const list = btn.closest('[data-mobile-group]').querySelector('.mobile-menu__children');
          const expand = list.hidden;
          list.hidden = !expand;
          btn.setAttribute('aria-expanded', String(expand));
        });
      });
    }
  }

  $$('[data-scroll-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = window.scrollY + window.innerHeight;
      if (lenis) {
        lenis.scrollTo(target, { duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4) });
      } else {
        window.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
  });

  /* ---------------- Drawers (cart + filters) ---------------- */
  function makeDrawer(el) {
    if (!el) return null;
    let lastFocus = null;
    const panel = el.querySelector('[role="dialog"]');
    const api = {
      el,
      isOpen: () => el.classList.contains('is-open'),
      open() {
        if (api.isOpen()) return;
        lastFocus = document.activeElement;
        el.classList.add('is-open');
        el.setAttribute('aria-hidden', 'false');
        lockScroll();
        requestAnimationFrame(() => panel && panel.focus({ preventScroll: true }));
      },
      close() {
        if (!api.isOpen()) return;
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
        unlockScroll();
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
      },
    };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cart-close], [data-filter-close]')) api.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && api.isOpen()) api.close();
    });
    return api;
  }

  /* ---------------- Quantity steppers ---------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qty-step]');
    if (!btn) return;
    const input = btn.closest('[data-qty]').querySelector('input');
    const min = Number(input.min || 0);
    const next = Math.max(min, (Number(input.value) || 0) + Number(btn.dataset.qtyStep));
    if (String(next) === input.value) return;
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* ---------------- Cart ---------------- */
  const cartDrawer = makeDrawer($('[data-cart-drawer]'));
  const useDrawer = theme.cartType !== 'page' && cartDrawer;

  function updateCount(count) {
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.hidden = count === 0;
    });
    $$('[data-cart-count-label]').forEach((el) => { el.textContent = count ? `(${count})` : ''; });
  }

  function renderDrawer(cart) {
    updateCount(cart.item_count);
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    if (!cartDrawer) return;
    const list = $('[data-cart-items]', cartDrawer.el);
    const footer = $('[data-cart-footer]', cartDrawer.el);
    $('[data-cart-subtotal]', cartDrawer.el).textContent = formatMoney(cart.total_price);

    if (!cart.item_count) {
      footer.hidden = true;
      list.innerHTML = `
        <div class="cart-drawer__empty">
          <p>Your bag is empty.</p>
          <a href="${escapeHtml(routes.allProducts)}" class="button-outline">Continue shopping</a>
        </div>`;
      return;
    }

    footer.hidden = false;
    list.innerHTML = cart.items.map((item, i) => {
      const options = item.product_has_only_default_variant
        ? ''
        : (item.options_with_values || []).map((o) => `${escapeHtml(o.name)}: ${escapeHtml(o.value)}`).join(' · ');
      const compare = item.original_price > item.final_price ? ` <s>${formatMoney(item.original_line_price)}</s>` : '';
      const image = item.image
        ? `<img src="${escapeHtml(resizeImage(item.image, 240))}" alt="${escapeHtml(item.product_title)}" loading="lazy">`
        : '';
      return `
        <div class="drawer-item" data-line="${i + 1}">
          <a href="${escapeHtml(item.url)}" class="drawer-item__media">${image}</a>
          <div>
            <div class="drawer-item__top">
              <a href="${escapeHtml(item.url)}" class="drawer-item__title">${escapeHtml(item.product_title)}</a>
              <span class="drawer-item__price">${formatMoney(item.final_line_price)}${compare}</span>
            </div>
            ${options ? `<p class="drawer-item__variant">${options}</p>` : ''}
            <div class="drawer-item__actions">
              <div class="qty qty--small" data-qty>
                <button type="button" class="qty__btn" data-qty-step="-1" aria-label="Decrease quantity">&minus;</button>
                <input class="qty__input" type="number" min="0" value="${item.quantity}" data-drawer-qty="${i + 1}" aria-label="Quantity for ${escapeHtml(item.product_title)}">
                <button type="button" class="qty__btn" data-qty-step="1" aria-label="Increase quantity">+</button>
              </div>
              <button type="button" class="drawer-item__remove" data-drawer-remove="${i + 1}">Remove</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  async function changeLine(line, quantity, row) {
    if (row) row.classList.add('is-updating');
    try {
      const cart = await cartRequest(`${routes.cartChange}.js`, { line: Number(line), quantity: Number(quantity) });
      renderDrawer(cart);
      return cart;
    } catch (err) {
      const fresh = await getCart();
      renderDrawer(fresh);
      const list = cartDrawer && $('[data-cart-items]', cartDrawer.el);
      if (list) list.insertAdjacentHTML('afterbegin', `<p class="form-message form-message--error cart-drawer__error">${escapeHtml(err.message)}</p>`);
      throw err;
    }
  }

  if (cartDrawer) {
    const list = $('[data-cart-items]', cartDrawer.el);
    list.addEventListener('change', (e) => {
      const input = e.target.closest('[data-drawer-qty]');
      if (input) changeLine(input.dataset.drawerQty, input.value, input.closest('.drawer-item')).catch(() => {});
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-drawer-remove]');
      if (btn) changeLine(btn.dataset.drawerRemove, 0, btn.closest('.drawer-item')).catch(() => {});
    });
  }

  async function openCart() {
    if (!useDrawer) {
      window.location.href = routes.cart;
      return;
    }
    renderDrawer(await getCart());
    cartDrawer.open();
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-cart-open]');
    if (!trigger || !useDrawer || document.body.classList.contains('template-cart')) return;
    e.preventDefault();
    openCart().catch(() => { window.location.href = routes.cart; });
  });

  // Keep the drawer and count fresh when returning via the back button (bfcache).
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) getCart().then(renderDrawer).catch(() => {});
  });

  /* ---------------- Cart page ---------------- */
  const cartPage = $('[data-cart-page]');
  if (cartPage) {
    const reload = () => window.location.reload();
    cartPage.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-line]');
      if (!input) return;
      input.closest('.cart-line').classList.add('is-updating');
      cartRequest(`${routes.cartChange}.js`, { line: Number(input.dataset.line), quantity: Number(input.value) })
        .then(reload)
        .catch((err) => { alert(err.message); reload(); });
    });
    cartPage.addEventListener('click', (e) => {
      const link = e.target.closest('[data-cart-remove]');
      if (!link) return;
      e.preventDefault();
      cartRequest(`${routes.cartChange}.js`, { line: Number(link.dataset.cartRemove), quantity: 0 }).then(reload).catch(reload);
    });
    const note = $('[data-cart-note]', cartPage);
    if (note) {
      let t;
      note.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => cartRequest(`${routes.cartUpdate}.js`, { note: note.value }).catch(() => {}), 500);
      });
    }
  }

  /* ---------------- Horizontal sliders (Mia's Picks) ---------------- */
  $$('[data-slider]').forEach((slider) => {
    const track = $('[data-slider-track]', slider);
    const buttons = $$('[data-slider-step]', slider);
    if (!track) return;
    const sync = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      buttons.forEach((b) => {
        b.disabled = Number(b.dataset.sliderStep) < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= max;
      });
    };
    buttons.forEach((b) => b.addEventListener('click', () => {
      const item = track.firstElementChild;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const stepPx = item ? item.getBoundingClientRect().width + gap : track.clientWidth;
      track.scrollBy({ left: Number(b.dataset.sliderStep) * stepPx, behavior: reduceMotion ? 'auto' : 'smooth' });
    }));
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });

  /* ---------------- Product gallery ---------------- */
  // Desktop: thumbnails + cross-fading main image. Mobile: swipe track with dots.
  // Returns a function that shows a given media id (used when a variant is selected).
  function initGallery(gallery) {
    const track = $('[data-media-track]', gallery);
    const slides = $$('[data-media-id]', gallery);
    if (!track || !slides.length) return () => {};
    const isMobile = () => window.matchMedia('(max-width: 989px)').matches;
    let index = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));

    const mark = (i) => {
      index = i;
      const id = slides[i].dataset.mediaId;
      slides.forEach((s, j) => s.classList.toggle('is-active', j === i));
      $$('[data-media-thumb]', gallery).forEach((t) => t.classList.toggle('is-active', t.dataset.mediaThumb === id));
      $$('[data-media-dot]', gallery).forEach((d) => d.classList.toggle('is-active', d.dataset.mediaDot === id));
    };
    const go = (i) => {
      i = (i + slides.length) % slides.length;
      mark(i);
      if (isMobile()) track.scrollTo({ left: slides[i].offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
    };

    gallery.addEventListener('click', (e) => {
      const thumb = e.target.closest('[data-media-thumb]');
      if (thumb) go(slides.findIndex((s) => s.dataset.mediaId === thumb.dataset.mediaThumb));
      const step = e.target.closest('[data-media-step]');
      if (step) go(index + Number(step.dataset.mediaStep));
    });

    let settle;
    track.addEventListener('scroll', () => {
      if (!isMobile()) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (slides[i] && i !== index) mark(i);
      }, 80);
    }, { passive: true });

    if (isMobile() && index > 0) track.scrollLeft = slides[index].offsetLeft;

    return (mediaId) => {
      const i = slides.findIndex((s) => s.dataset.mediaId === String(mediaId));
      if (i >= 0 && i !== index) go(i);
    };
  }

  /* ---------------- Product form ---------------- */
  $$('[data-product]').forEach((root) => {
    const form = $('.product-form', root);
    const data = $('[data-variants]', root);
    if (!form) return;

    const variants = data ? JSON.parse(data.textContent) : [];
    const idInput = $('[data-variant-id]', form);
    const addButton = $('[data-add-button]', form);
    const errorEl = $('[data-product-error]', form);
    const priceEl = $('[data-price]', root);
    const radios = $$('[data-option-index]', form);
    const gallery = $('[data-product-media]', root);
    const showMedia = gallery ? initGallery(gallery) : () => {};
    const stepper = $('[data-bag-stepper]', form);
    const stepperQty = $('[data-bag-qty]', form);
    const viewLink = $('[data-bag-view]', root);
    let currentAvailable = !addButton.disabled;
    let cart = null;

    // Once the selected variant is in the bag, "Add to bag" becomes a − qty + stepper.
    const inBag = () => (cart ? cart.items.filter((i) => String(i.id) === idInput.value) : []);
    const syncStepper = () => {
      const qty = inBag().reduce((s, i) => s + i.quantity, 0);
      const show = qty > 0 && currentAvailable;
      addButton.hidden = show;
      if (stepper) stepper.hidden = !show;
      if (viewLink) viewLink.hidden = !show;
      if (stepperQty) stepperQty.textContent = qty;
    };
    let cartVersion = 0;
    document.addEventListener('cart:updated', (e) => {
      cartVersion += 1;
      cart = e.detail;
      syncStepper();
    });
    // Initial fetch is ignored if a newer cart update lands first (avoids stale overwrites).
    const startVersion = cartVersion;
    getCart().then((c) => {
      if (cartVersion !== startVersion) return;
      cart = c;
      syncStepper();
    }).catch(() => {});

    if (stepper) {
      stepper.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-bag-step]');
        if (!btn || stepper.classList.contains('is-busy')) return;
        const line = cart ? cart.items.findIndex((i) => String(i.id) === idInput.value) : -1;
        if (line < 0) return;
        const next = cart.items[line].quantity + Number(btn.dataset.bagStep);
        stepper.classList.add('is-busy');
        if (errorEl) errorEl.hidden = true;
        try {
          renderDrawer(await cartRequest(`${routes.cartChange}.js`, { line: line + 1, quantity: Math.max(0, next) }));
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
          renderDrawer(await getCart());
        } finally {
          stepper.classList.remove('is-busy');
        }
      });
    }

    const selected = () => {
      const values = [];
      radios.filter((r) => r.checked).forEach((r) => { values[Number(r.dataset.optionIndex)] = r.value; });
      return values;
    };

    // Strike through values that have no available variant given the other current selections.
    const markAvailability = (values) => {
      radios.forEach((radio) => {
        const i = Number(radio.dataset.optionIndex);
        const candidate = values.slice();
        candidate[i] = radio.value;
        const ok = variants.some((v) => v.available && v.options.every((o, j) => o === candidate[j]));
        radio.closest('.option-pill').classList.toggle('is-unavailable', !ok);
      });
    };

    const setButton = (state) => {
      addButton.disabled = state !== 'add';
      addButton.textContent = { add: 'Add to bag', soldout: 'Sold out', unavailable: 'Unavailable', adding: 'Adding…' }[state];
    };

    const update = () => {
      const values = selected();
      values.forEach((value, i) => {
        const label = $(`[data-option-label="${i}"]`, root);
        if (label) label.textContent = value;
      });
      markAvailability(values);
      if (errorEl) errorEl.hidden = true;

      const variant = variants.find((v) => v.options.every((o, j) => o === values[j]));
      if (!variant) {
        currentAvailable = false;
        setButton('unavailable');
        syncStepper();
        return;
      }
      idInput.value = variant.id;
      if (variant.media) showMedia(variant.media);
      priceEl.innerHTML = variant.price + (variant.compare ? ` <s>${variant.compare}</s>` : '');
      currentAvailable = variant.available;
      setButton(variant.available ? 'add' : 'soldout');
      syncStepper();

      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    };

    radios.forEach((r) => r.addEventListener('change', update));
    if (radios.length) markAvailability(selected());

    form.addEventListener('submit', async (e) => {
      if (!window.fetch) return;
      e.preventDefault();
      if (!currentAvailable) return;
      if (errorEl) errorEl.hidden = true;
      setButton('adding');
      addButton.classList.add('is-loading');
      try {
        await cartRequest(`${routes.cartAdd}.js`, new FormData(form));
        renderDrawer(await getCart());
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      } finally {
        addButton.classList.remove('is-loading');
        setButton(currentAvailable ? 'add' : 'soldout');
      }
    });
  });

  /* ---------------- Collection filters & sorting ---------------- */
  $$('[data-filter-form]').forEach((form) => {
    const drawer = makeDrawer($('[data-filter-drawer]', form));
    const openBtn = $('[data-filter-open]', form);
    if (openBtn && drawer) openBtn.addEventListener('click', () => drawer.open());

    let timer;
    const apply = () => {
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form)) {
        if (String(value).trim() !== '') params.append(key, value);
      }
      window.location.href = `${form.getAttribute('action')}?${params.toString()}`;
    };
    form.addEventListener('change', (e) => {
      if (!e.target.matches('[data-filter-input]')) return;
      clearTimeout(timer);
      timer = setTimeout(apply, e.target.type === 'number' ? 700 : 50);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply();
    });
  });

  /* ---------------- Account helpers ---------------- */
  // Login <-> password recovery panels
  const loginPanel = $('[data-login-panel]');
  const recoverPanel = $('[data-recover-panel]');
  if (loginPanel && recoverPanel) {
    const showRecover = (show) => {
      loginPanel.hidden = show;
      recoverPanel.hidden = !show;
    };
    if (window.location.hash === '#recover' || $('[data-recover-success]', recoverPanel) || $('.form-message--error', recoverPanel)) showRecover(true);
    $$('[data-recover-toggle]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      showRecover(recoverPanel.hidden);
    }));
  }

  // Generic show/hide toggles (address forms)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-target]');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.toggleTarget);
    if (target) target.hidden = !target.hidden;
  });

  // Confirm before destructive form posts
  $$('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Country -> province selects (options come from Shopify's all_country_option_tags)
  $$('[data-country-select]').forEach((country) => {
    const scope = country.closest('form');
    const province = $('[data-province-select]', scope);
    const wrapper = $('[data-province-wrapper]', scope);
    if (country.dataset.default) {
      const match = [...country.options].find((o) => o.value === country.dataset.default || o.textContent === country.dataset.default);
      if (match) country.value = match.value;
    }
    const fill = () => {
      const opt = country.options[country.selectedIndex];
      let provinces = [];
      try { provinces = JSON.parse((opt && opt.dataset.provinces) || '[]'); } catch (_) { provinces = []; }
      province.innerHTML = provinces.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
      if (province.dataset.default) province.value = province.dataset.default;
      if (wrapper) wrapper.hidden = provinces.length === 0;
    };
    country.addEventListener('change', () => {
      province.dataset.default = '';
      fill();
    });
    fill();
  });

  /* ---------------- Tab title when away ---------------- */
  const awayTitle = 'Little Ones Waiting';
  let homeTitle = document.title;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      homeTitle = document.title;
      document.title = awayTitle;
    } else {
      document.title = homeTitle;
    }
  });
})();
