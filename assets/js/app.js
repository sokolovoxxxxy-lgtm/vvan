/* =========================================================
   VVAN BARBERSHOP — интерактив
   ========================================================= */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------
     1. Плавный скролл с учётом sticky-хедера
     --------------------------------------------------------- */
  function headerOffset() {
    var h = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    return parseInt(h, 10) || 64;
  }

  function scrollToId(id) {
    var el = document.querySelector(id);
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset();
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  }

  $$('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      closeAllPopups();
      scrollToId(id);
      if (history.pushState) history.pushState(null, '', id);
    });
  });

  /* ---------------------------------------------------------
     2. Бургер-меню
     --------------------------------------------------------- */
  var burger = $('#burger');
  var mobileMenu = $('#mobileMenu');

  function openMenu() {
    if (!mobileMenu) return;
    mobileMenu.hidden = false;
    burger.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Закрыть меню');
    document.body.classList.add('menu-open');
  }
  function closeMenu() {
    if (!mobileMenu || mobileMenu.hidden) return;
    mobileMenu.hidden = true;
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Открыть меню');
    document.body.classList.remove('menu-open');
  }
  if (burger) {
    burger.addEventListener('click', function () {
      mobileMenu.hidden ? openMenu() : closeMenu();
    });
  }

  /* ---------------------------------------------------------
     3. Активный пункт навигации при скролле
     --------------------------------------------------------- */
  var staticMode = /[?&]static\b/.test(location.search);
  var navLinks = $$('.nav__link');
  var sections = $$('section[data-nav]');

  function updateActiveNav() {
    var pos = window.pageYOffset + headerOffset() + window.innerHeight * 0.35;
    var current = null;
    sections.forEach(function (sec) {
      if (sec.offsetTop <= pos) current = sec.dataset.nav;
    });
    navLinks.forEach(function (l) {
      l.classList.toggle('is-active', current !== null && l.getAttribute('href') === '#' + current);
    });
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateActiveNav();
      ticking = false;
    });
  }, { passive: true });
  if (!staticMode) updateActiveNav();

  /* ---------------------------------------------------------
     4. Появление секций при скролле
     --------------------------------------------------------- */
  var revealEls = $$('.reveal');
  if (staticMode) {
    document.documentElement.classList.add('no-anim');
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-visible');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------------------------------------------------------
     5. Слайдер hero
     --------------------------------------------------------- */
  var slides = $$('.hero__slide');
  var counterBtn = $('#heroCounter');
  var currentEl = $('#heroCurrent');
  var totalEl = $('#heroTotal');
  var slideIndex = 0;
  var slideTimer = null;
  var SLIDE_MS = 5000;

  if (totalEl) totalEl.textContent = String(slides.length).padStart(2, '0');

  function showSlide(i) {
    if (!slides.length) return;
    slideIndex = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle('is-active', k === slideIndex); });
    if (currentEl) currentEl.textContent = String(slideIndex + 1).padStart(2, '0');
  }
  function nextSlide() { showSlide(slideIndex + 1); }
  function startSlider() {
    stopSlider();
    if (slides.length < 2) return;
    slideTimer = window.setInterval(nextSlide, SLIDE_MS);
  }
  function stopSlider() {
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
  }
  function restartSlider() { startSlider(); }

  if (counterBtn) {
    counterBtn.addEventListener('click', function () { nextSlide(); restartSlider(); });
  }
  var heroEl = $('.hero');
  if (heroEl) {
    var touchX = null;
    heroEl.addEventListener('touchstart', function (e) { touchX = e.changedTouches[0].clientX; }, { passive: true });
    heroEl.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 48) { nextSlide(); restartSlider(); }
      touchX = null;
    }, { passive: true });
  }
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stopSlider() : startSlider();
  });
  showSlide(0);
  if (!staticMode) startSlider();

  /* ---------------------------------------------------------
     6. Кастомные селекты (услуга / мастер)
     --------------------------------------------------------- */
  function initSelect(btn) {
    if (!btn) return;
    var menu = btn.nextElementSibling;
    if (!menu || !menu.classList.contains('select__menu')) return;
    var valueEl = btn.querySelector('.select__value');
    var placeholder = valueEl.textContent;
    var items = $$('li[role="option"]', menu);

    function open() {
      closeAllPopups(btn);
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var sel = items.filter(function (li) { return li.getAttribute('aria-selected') === 'true'; })[0];
      (sel || items[0]).classList.add('is-focus');
    }
    function close() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      items.forEach(function (li) { li.classList.remove('is-focus'); });
    }
    function select(li) {
      items.forEach(function (x) { x.setAttribute('aria-selected', String(x === li)); });
      var val = li.dataset.value || '';
      valueEl.textContent = li.textContent;
      valueEl.classList.toggle('is-placeholder', val === '');
      btn.dataset.value = val;
      btn.dispatchEvent(new CustomEvent('change', { detail: val }));
      close();
      btn.focus();
    }

    btn.addEventListener('click', function () {
      menu.hidden ? open() : close();
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      if (e.key === 'Escape') close();
    });
    items.forEach(function (li) {
      li.addEventListener('click', function () { select(li); });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(li); }
      });
    });
    menu.addEventListener('keydown', function (e) {
      var idx = items.findIndex(function (li) { return li.classList.contains('is-focus'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items.forEach(function (li) { li.classList.remove('is-focus'); });
        idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[idx].classList.add('is-focus');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Escape') {
        close(); btn.focus();
      }
    });

    btn._close = close;
    btn._placeholder = placeholder;
    btn.selectValue = function (val) {
      var li = items.filter(function (x) { return (x.dataset.value || '') === val; })[0];
      if (!li) return;
      items.forEach(function (x) { x.setAttribute('aria-selected', String(x === li)); });
      valueEl.textContent = li.textContent;
      valueEl.classList.toggle('is-placeholder', val === '');
      btn.dataset.value = val;
    };
    btn.reset = function () {
      items.forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
      valueEl.textContent = placeholder;
      valueEl.classList.add('is-placeholder');
      btn.dataset.value = '';
    };
  }

  var selectService = $('#f-service');
  var selectMaster = $('#f-master');
  initSelect(selectService);
  initSelect(selectMaster);

  function closeAllPopups(except) {
    [selectService, selectMaster, selectDatetime].forEach(function (b) {
      if (!b || b === except) return;
      if (b._close) b._close();
      if (b === selectDatetime) closeDatetime();
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.field')) closeAllPopups();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeAllPopups(); closeMenu(); }
  });

  /* ---------------------------------------------------------
     7. Дата и время: 14 дней + слоты 10:00–21:00
     --------------------------------------------------------- */
  var selectDatetime = $('#f-datetime');
  var datetimePanel = $('#datetimePanel');
  var daysWrap = $('#dtDays');
  var slotsWrap = $('#dtSlots');
  var monthLabel = $('#dtMonth');

  var DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  var chosen = { date: null, time: '' };

  // мок-занятость: детерминированная, чтобы слоты не менялись при перерисовке
  function isBusy(date, hour) {
    var now = new Date();
    var sameDay = date.toDateString() === now.toDateString();
    if (sameDay && hour <= now.getHours() + 1) return true;      // прошедшее время сегодня
    var seed = date.getDate() * 31 + (date.getMonth() + 1) * 7 + hour;
    return seed % 4 === 0 || seed % 9 === 0;
  }

  function buildDays() {
    if (!daysWrap) return;
    daysWrap.innerHTML = '';
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    for (var i = 0; i < 14; i++) {
      var d = new Date(start.getTime() + i * 86400000);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.dataset.iso = d.toISOString();
      b.innerHTML = '<span class="day__dow">' + (i === 0 ? 'Сег' : DOW[d.getDay()]) + '</span>' +
                    '<span class="day__num">' + d.getDate() + '</span>';
      b.setAttribute('aria-label', d.getDate() + ' ' + MONTHS[d.getMonth()]);
      (function (date, btn) {
        btn.addEventListener('click', function () {
          chosen.date = date;
          $$('.day', daysWrap).forEach(function (x) { x.classList.remove('is-active'); });
          btn.classList.add('is-active');
          buildSlots();
        });
      })(d, b);
      daysWrap.appendChild(b);
    }
    var last = new Date(start.getTime() + 13 * 86400000);
    if (monthLabel) monthLabel.textContent = MONTHS[last.getMonth()].toUpperCase() + ' ' + last.getFullYear();
  }

  function buildSlots() {
    if (!slotsWrap) return;
    slotsWrap.innerHTML = '';
    for (var h = 10; h <= 21; h++) {
      var label = (h < 10 ? '0' + h : h) + ':00';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.textContent = label;
      b.dataset.time = label;
      if (chosen.date && isBusy(chosen.date, h)) {
        b.disabled = true;
        b.title = 'Слот занят';
      }
      if (chosen.time === label && !b.disabled) b.classList.add('is-active');
      (function (t, btn) {
        btn.addEventListener('click', function () {
          chosen.time = t;
          $$('.slot', slotsWrap).forEach(function (x) { x.classList.remove('is-active'); });
          btn.classList.add('is-active');
          updateDatetimeValue();
          window.setTimeout(closeDatetime, 220);
        });
      })(label, b);
      slotsWrap.appendChild(b);
    }
  }

  function updateDatetimeValue() {
    if (!selectDatetime) return;
    var valueEl = selectDatetime.querySelector('.select__value');
    if (chosen.date && chosen.time) {
      var d = chosen.date;
      valueEl.textContent = DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' · ' + chosen.time;
      valueEl.classList.remove('is-placeholder');
      selectDatetime.dataset.value = valueEl.textContent;
      clearError('datetime');
    } else if (chosen.date) {
      valueEl.textContent = DOW[chosen.date.getDay()] + ', ' + chosen.date.getDate() + ' ' + MONTHS[chosen.date.getMonth()] + ' · выберите время';
      valueEl.classList.add('is-placeholder');
    }
  }

  function openDatetime() {
    closeAllPopups(selectDatetime);
    datetimePanel.hidden = false;
    selectDatetime.setAttribute('aria-expanded', 'true');
  }
  function closeDatetime() {
    if (!datetimePanel || datetimePanel.hidden) return;
    datetimePanel.hidden = true;
    selectDatetime.setAttribute('aria-expanded', 'false');
  }

  if (selectDatetime) {
    selectDatetime._close = closeDatetime;
    selectDatetime.addEventListener('click', function () {
      datetimePanel.hidden ? openDatetime() : closeDatetime();
    });
    selectDatetime.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDatetime(); }
      if (e.key === 'Escape') closeDatetime();
    });
  }
  buildDays();
  buildSlots();

  /* ---------------------------------------------------------
     8. Предвыбор услуги / мастера из секций
     --------------------------------------------------------- */
  $$('.service[data-service]').forEach(function (row) {
    row.addEventListener('click', function (e) {
      e.preventDefault();
      var val = row.dataset.service;
      if (selectService) selectService.selectValue(val);
      clearError('service');
      scrollToId('#booking');
      if (history.pushState) history.pushState(null, '', '#booking');
      window.setTimeout(function () {
        var f = $('#f-name');
        if (f) f.focus({ preventScroll: true });
      }, 700);
    });
  });

  $$('.master[data-master]').forEach(function (card) {
    card.addEventListener('click', function (e) {
      e.preventDefault();
      var val = card.dataset.master;
      if (selectMaster) selectMaster.selectValue(val);
      scrollToId('#booking');
      if (history.pushState) history.pushState(null, '', '#booking');
      window.setTimeout(function () {
        var f = $('#f-name');
        if (f) f.focus({ preventScroll: true });
      }, 700);
    });
  });

  /* ---------------------------------------------------------
     9. Маска телефона +7 999 000-00-00
     --------------------------------------------------------- */
  var phoneInput = $('#f-phone');
  var phoneDigits = '';

  function formatPhone(digits) {
    var rest = digits.slice(1, 11);
    var out = '+7';
    if (rest.length > 0) out += ' ' + rest.slice(0, 3);
    if (rest.length > 3) out += ' ' + rest.slice(3, 6);
    if (rest.length > 6) out += '-' + rest.slice(6, 8);
    if (rest.length > 8) out += '-' + rest.slice(8, 10);
    return out;
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      var before = phoneDigits;
      var digits = phoneInput.value.replace(/\D/g, '');
      var deleting = digits.length <= before.length;
      if (deleting && digits.length === before.length && phoneInput.value.replace(/\D/g, '').length === before.length) {
        digits = digits.slice(0, -1); // удалили разделитель — убираем и цифру
      }
      if (digits.length && digits[0] !== '7') {
        if (digits[0] === '8' || digits[0] === '9') digits = '7' + digits;
        else digits = '7' + digits;
      }
      digits = digits.slice(0, 11);
      phoneDigits = digits;
      phoneInput.value = formatPhone(digits);
    });
    phoneInput.addEventListener('focus', function () {
      if (!phoneInput.value) { phoneDigits = '7'; phoneInput.value = '+7 '; }
    });
    phoneInput.addEventListener('blur', function () {
      if (phoneInput.value.replace(/\D/g, '') === '7') { phoneInput.value = ''; phoneDigits = ''; }
    });
  }

  /* ---------------------------------------------------------
     10. Валидация и отправка формы
     --------------------------------------------------------- */
  var form = $('#bookingForm');
  var submitBtn = $('#submitBtn');
  var submitLabel = $('#submitLabel');
  var successBox = $('#formSuccess');

  function setError(name, message) {
    var field = form.querySelector('[data-error-for="' + name + '"]');
    if (!field) return;
    field.textContent = message;
    var wrap = field.closest('.field');
    if (wrap) wrap.classList.add('has-error');
  }
  function clearError(name) {
    var field = form.querySelector('[data-error-for="' + name + '"]');
    if (!field) return;
    field.textContent = '';
    var wrap = field.closest('.field');
    if (wrap) wrap.classList.remove('has-error');
  }
  function clearAllErrors() {
    $$('.field', form).forEach(function (f) { f.classList.remove('has-error'); });
    $$('.field__error', form).forEach(function (e) { e.textContent = ''; });
  }

  function validate() {
    clearAllErrors();
    var ok = true;
    var firstBad = null;

    var name = $('#f-name').value.trim();
    if (name.length < 2) { setError('name', 'Введите имя — минимум 2 символа'); ok = false; firstBad = firstBad || $('#f-name'); }

    var digits = (phoneInput.value || '').replace(/\D/g, '');
    if (digits.length !== 11 || digits[0] !== '7') { setError('phone', 'Телефон в формате +7 999 000-00-00'); ok = false; firstBad = firstBad || phoneInput; }

    if (!selectService.dataset.value) { setError('service', 'Выберите услугу'); ok = false; firstBad = firstBad || selectService; }

    if (!chosen.date || !chosen.time) { setError('datetime', 'Выберите дату и время'); ok = false; firstBad = firstBad || selectDatetime; }

    if (firstBad) firstBad.focus();
    return ok;
  }

  function setSending(sending) {
    submitBtn.disabled = sending;
    submitLabel.textContent = sending ? 'ОТПРАВЛЯЕМ…' : 'ЗАПИСАТЬСЯ';
  }

  function resetForm() {
    form.reset();
    phoneDigits = '';
    if (selectService) selectService.reset();
    if (selectMaster) selectMaster.reset();
    chosen = { date: null, time: '' };
    buildDays();
    buildSlots();
    if (selectDatetime) {
      var v = selectDatetime.querySelector('.select__value');
      v.textContent = 'Выберите удобное время';
      v.classList.add('is-placeholder');
      selectDatetime.dataset.value = '';
    }
    clearAllErrors();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;

    var payload = {
      name: $('#f-name').value.trim(),
      phone: phoneInput.value.trim(),
      service: selectService.dataset.value || '',
      master: selectMaster.dataset.value || '',
      datetime: chosen.date
        ? chosen.date.getFullYear() + '-' + String(chosen.date.getMonth() + 1).padStart(2, '0') + '-' +
          String(chosen.date.getDate()).padStart(2, '0') + ' ' + chosen.time
        : '',
      datetimeLabel: selectDatetime.querySelector('.select__value').textContent,
      source: 'vvan-site'
    };

    setSending(true);
    successBox.hidden = true;

    fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        // бэкенда нет (статический хостинг, например GitHub Pages) — демо-режим
        if (res.status === 404 || res.status === 405 || res.status === 501) {
          console.warn('[VVAN] /api/booking не найден — имитируем отправку (демо-режим)');
          return new Promise(function (r) { setTimeout(r, 600); });
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function () {
        resetForm();
        successBox.hidden = false;
        successBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          // сеть недоступна — тоже переходим в демо-режим
          console.warn('[VVAN] /api/booking недоступен, имитируем отправку:', err.message);
          return new Promise(function (r) { setTimeout(r, 600); }).then(function () {
            resetForm();
            successBox.hidden = false;
            successBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
        setError('name', 'Не удалось отправить заявку. Попробуйте ещё раз.');
        console.error('[VVAN] Ошибка отправки:', err);
      })
      .finally(function () { setSending(false); });
  });

  // очистка ошибок при вводе
  $$('.input', form).forEach(function (input) {
    input.addEventListener('input', function () {
      var name = input.id.replace('f-', '');
      clearError(name);
    });
  });

  /* ---------------------------------------------------------
     11. Политика (мини-модалка-уведомление вместо «мёртвой» ссылки)
     --------------------------------------------------------- */
  var privacyLink = $('#privacyLink');
  if (privacyLink) {
    privacyLink.addEventListener('click', function (e) {
      e.preventDefault();
      var note = $('.form__note');
      var existing = $('#privacyText');
      if (existing) { existing.remove(); return; }
      var p = document.createElement('span');
      p.id = 'privacyText';
      p.style.display = 'block';
      p.style.marginTop = '10px';
      p.style.color = 'rgba(255,255,255,.6)';
      p.textContent = 'Мы используем ваши данные только для записи и не передаём их третьим лицам.';
      note.appendChild(p);
    });
  }

  /* ---------------------------------------------------------
     Диагностика вёрстки: открыть страницу с ?diag —
     в <title> попадает ширина документа и «виновники» переполнения
     --------------------------------------------------------- */
  if (/[?&]diag\b/.test(location.search)) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        var vw = document.documentElement.clientWidth;
        var wide = [];
        var all = document.querySelectorAll('body *');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
            var cls = (typeof el.className === 'string' ? el.className : '').slice(0, 36);
            wide.push(el.tagName + (cls ? '.' + cls.replace(/\s+/g, '.') : '') +
              ' [L' + Math.round(r.left) + ' R' + Math.round(r.right) + ' W' + Math.round(r.width) + ']');
          }
        }
        document.title = 'SW=' + document.documentElement.scrollWidth + ' VW=' + vw +
          ' | ' + (wide.length ? wide.slice(0, 10).join(' || ') : 'нет переполнения');
      }, 400);
    });
  }
})();
