// Клиентский JavaScript АС «Салон-парикмахерская HAIR SALON».
  
(function () {
  'use strict';

  var $ = window.jQuery;
  if (!$) {
    // app.js подключается с defer после jquery — если его нет, просто
    // молчим: SSR-часть страниц продолжит работать без интерактива.
    return;
  }

  var SalonApp = (window.SalonApp = window.SalonApp || {});

  function formatDateTimeShort(mysqlDatetime) {
    if (!mysqlDatetime) return '';
    return String(mysqlDatetime).slice(0, 16);
  }

  function formatTime(mysqlDatetime) {
    if (!mysqlDatetime) return '';
    var s = String(mysqlDatetime);
    var spaceIdx = s.indexOf(' ');
    if (spaceIdx === -1) return s.slice(0, 5);
    return s.slice(spaceIdx + 1, spaceIdx + 6);
  }

  function formatPrice(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toFixed(0) + ' ₽';
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function api(method, url, data) {
    var opts = {
      method: method,
      url: url,
      dataType: 'json',
    };
    var hasBody = data !== undefined && data !== null && method !== 'GET' && method !== 'DELETE';
    if (hasBody) {
      opts.contentType = 'application/json';
      opts.data = JSON.stringify(data);
    }
    return $.ajax(opts).then(
      function (resp) { return resp; },
      function (xhr) {
        var msg = 'Ошибка сети';
        var code = null;
        var details = null;
        var status = xhr ? xhr.status : 0;
        if (xhr && xhr.responseJSON) {
          msg = xhr.responseJSON.message || xhr.responseJSON.error || msg;
          code = xhr.responseJSON.error || null;
          details = xhr.responseJSON.details || null;
        } else if (xhr && xhr.statusText) {
          msg = xhr.statusText;
        }
        var err = new Error(msg);
        err.status = status;
        err.code = code;
        err.details = details;
        return $.Deferred().reject(err).promise();
      }
    );
  }

  function notify(msg, type) {
    var cls = type === 'error' ? 'alert-error' : 'alert-success';
    var $alert = $('<div></div>')
      .addClass('alert')
      .addClass(cls)
      .text(msg);
    var $host = $('main.container');
    if (!$host.length) $host = $('body');
    $host.prepend($alert);
    setTimeout(function () {
      $alert.fadeOut(300, function () { $alert.remove(); });
    }, 5000);
  }

  SalonApp.api = api;
  SalonApp.notify = notify;
  SalonApp.formatDateTimeShort = formatDateTimeShort;
  SalonApp.formatTime = formatTime;
  SalonApp.formatPrice = formatPrice;

  // ------------------------------------------------------------------
  // Init-роутер
  // ------------------------------------------------------------------

  $(function () {
    if ($('#booking-wizard').length) initBookingWizard();
    if ($('.appointments-table .cancel-btn, .appointments-table .reschedule-btn').length) {
      initAppointmentActions();
    }
    if ($('.complete-form').length) initMasterCompleteForms();
    if ($('.confirm-btn, .start-btn').length) initMasterStatusButtons();

    // Админ-панель
    if ($('#form-create-category').length) initAdminCategoryForms();
    if ($('#form-create-service').length) initAdminServiceForms();
    if ($('#form-attach-master-service').length) initAdminMasterServiceForms();
    if ($('#form-create-schedule').length) initAdminScheduleForm();
    if ($('#report-form').length) initAdminReportsForm();
    if ($('.deactivate-user, .activate-user, .role-select').length) initAdminUserActions();
    if ($('#form-create-user').length) initAdminCreateUserForm();

    // Страница каталога (старая простая фильтрация категории) и
    // страница мастера — оставляем как было: минимальный DOM-helper,
    // специально для страниц /services и /masters/:id.
    initLegacyCatalogBits();
  });

  function initBookingWizard() {
    var $root = $('#booking-wizard');

    var state = {
      serviceId: null,
      masterId: null,
      date: null,
      slotId: null,
      service: null,
      master: null,
      slot: null,
      allServices: [],
      categories: [],
    };

    // Предвыбранные значения — подхватываются из URL через контроллер.
    var preselect = {
      serviceId: toNumOrNull($root.data('preselectService')),
      masterId: toNumOrNull($root.data('preselectMaster')),
      date: $root.data('preselectDate') || null,
    };

    function showStep(n) {
      $root.find('.booking-step').removeClass('active');
      $root.find('.booking-step[data-step="' + n + '"]').addClass('active');
      $root.find('.step-dot').removeClass('active');
      $root.find('.step-dot[data-step-dot="' + n + '"]').addClass('active');
    }

    // --- шаг 1: услуги ---------------------------------------------------

    /**
     * Рендерит карточки услуг, фильтруя по выбранной категории (если есть).
     */
    function renderServices() {
      var catVal = $root.find('#wizard-category').val();
      var catId = catVal ? Number(catVal) : null;
      var services = state.allServices.filter(function (s) {
        return s.is_active !== false && (catId ? s.category_id === catId : true);
      });
      var $host = $root.find('#wizard-services').empty();
      if (!services.length) {
        $host.append('<p class="muted">В выбранной категории нет услуг.</p>');
        return;
      }
      services.forEach(function (s) {
        var $item = $('<div></div>')
          .addClass('wizard-item')
          .attr('data-id', s.id)
          .attr('data-duration', s.duration_min)
          .html(
            '<strong>' + escapeHtml(s.name) + '</strong><br>' +
            '<small>' + escapeHtml(s.duration_min) + ' мин · ' +
            escapeHtml(formatPrice(s.base_price)) + '</small>'
          );
        if (state.serviceId === s.id) $item.addClass('selected');
        $host.append($item);
      });
    }

    /**
     * Подгружает категории и услуги; выставляет предвыбор, если есть.
     */
    function loadStep1() {
      return $.when(
        api('GET', '/api/services/categories'),
        api('GET', '/api/services')
      ).then(function (catsResp, srvResp) {
        // Когда `$.when` получает два jqXHR/deferred, callback получает
        // массивы; в нашем .then — результаты уже resolved-значения,
        // но для совместимости берём `[0]`, если пришёл tuple.
        var cats = (catsResp && catsResp.categories) || (catsResp && catsResp[0] && catsResp[0].categories) || [];
        var srvs = (srvResp && srvResp.services) || (srvResp && srvResp[0] && srvResp[0].services) || [];
        state.categories = cats;
        state.allServices = srvs;

        var $cat = $root.find('#wizard-category');
        cats.forEach(function (c) {
          $cat.append(
            $('<option></option>').val(c.id).text(c.name)
          );
        });

        renderServices();

        // Предвыбор услуги, если пришёл из URL.
        if (preselect.serviceId) {
          var preSrv = state.allServices.find(function (s) { return s.id === preselect.serviceId; });
          if (preSrv) {
            selectService(preSrv);
            // Автоматически переходим к шагу 2, когда услуга предвыбрана.
            goToStep(2);
          }
        }
      });
    }

    function selectService(service) {
      state.serviceId = service.id;
      state.service = service;
      // При смене услуги сбрасываем нижестоящие шаги.
      state.masterId = null;
      state.master = null;
      state.slotId = null;
      state.slot = null;
      $root.find('#wizard-services .wizard-item').removeClass('selected');
      $root.find('#wizard-services .wizard-item[data-id="' + service.id + '"]').addClass('selected');
      $root.find('.booking-step[data-step="1"] .wizard-next').prop('disabled', false);
    }

    // --- шаг 2: мастера --------------------------------------------------

    function loadMasters() {
      if (!state.serviceId) return $.Deferred().resolve().promise();
      var $host = $root.find('#wizard-masters').empty().append('<p class="muted">Загрузка мастеров…</p>');
      return api('GET', '/api/services/' + state.serviceId + '/masters').then(function (resp) {
        var masters = (resp && resp.masters) || [];
        $host.empty();
        if (!masters.length) {
          $host.append('<p class="muted">Для этой услуги пока нет мастеров.</p>');
          return;
        }
        masters.forEach(function (m) {
          var $item = $('<div></div>')
            .addClass('wizard-item')
            .attr('data-id', m.id)
            .html(
              '<strong>' + escapeHtml(m.full_name) + '</strong>' +
              (m.specialization ? '<br><small>' + escapeHtml(m.specialization) + '</small>' : '')
            );
          if (state.masterId === m.id) $item.addClass('selected');
          $host.append($item);
        });

        // Предвыбор мастера (если предустановка из URL совпадает со списком).
        if (preselect.masterId && !state.masterId) {
          var preM = masters.find(function (mm) { return mm.id === preselect.masterId; });
          if (preM) selectMaster(preM);
        }
      });
    }

    function selectMaster(master) {
      state.masterId = master.id;
      state.master = master;
      state.slotId = null;
      state.slot = null;
      $root.find('#wizard-masters .wizard-item').removeClass('selected');
      $root.find('#wizard-masters .wizard-item[data-id="' + master.id + '"]').addClass('selected');
      $root.find('.booking-step[data-step="2"] .wizard-next').prop('disabled', false);
    }

    // --- шаг 3: дата -----------------------------------------------------

    function bindDateInput() {
      var $d = $root.find('#wizard-date');
      if (preselect.date && !state.date) {
        $d.val(preselect.date);
        state.date = preselect.date;
        $root.find('.booking-step[data-step="3"] .wizard-next').prop('disabled', false);
      }
      $d.off('change.wizard').on('change.wizard', function () {
        state.date = $(this).val() || null;
        state.slotId = null;
        state.slot = null;
        $root.find('.booking-step[data-step="3"] .wizard-next').prop('disabled', !state.date);
      });
    }

    // --- шаг 4: слоты и подтверждение -----------------------------------

    function loadSlots() {
      var $host = $root.find('#wizard-slots').empty().append('<p class="muted">Загрузка свободных интервалов…</p>');
      $root.find('#wizard-summary').prop('hidden', true);
      $root.find('#wizard-confirm').prop('disabled', true);

      if (!state.masterId || !state.date || !state.serviceId) {
        $host.empty().append('<p class="muted">Заполните предыдущие шаги.</p>');
        return $.Deferred().resolve().promise();
      }

      var url = '/api/masters/' + state.masterId + '/slots?date=' +
        encodeURIComponent(state.date) + '&service_id=' + encodeURIComponent(state.serviceId);

      return api('GET', url).then(function (resp) {
        var slots = (resp && resp.slots) || [];
        $host.empty();
        if (!slots.length) {
          $host.append('<p class="muted">Свободных интервалов на эту дату нет — выберите другую.</p>');
          return;
        }
        slots.forEach(function (s) {
          var label = formatTime(s.slot_start);
          var $btn = $('<button type="button"></button>')
            .addClass('slot')
            .attr('data-id', s.id)
            .text(label);
          $btn.data('slot', s);
          $host.append($btn);
        });
      });
    }

    function selectSlot($btn) {
      state.slot = $btn.data('slot');
      state.slotId = Number($btn.attr('data-id'));
      $root.find('#wizard-slots .slot').removeClass('selected');
      $btn.addClass('selected');

      // Заполняем summary и разрешаем подтверждение.
      var $s = $root.find('#wizard-summary');
      $s.find('#summary-service').text(state.service ? state.service.name : '—');
      $s.find('#summary-master').text(state.master ? state.master.full_name : '—');
      $s.find('#summary-slot').text(formatDateTimeShort(state.slot.slot_start));
      $s.find('#summary-price').text(state.service ? formatPrice(state.service.base_price) : '—');
      $s.prop('hidden', false);
      $root.find('#wizard-confirm').prop('disabled', false);
    }

    function confirmBooking() {
      if (!state.serviceId || !state.masterId || !state.slotId) return;
      var $btn = $root.find('#wizard-confirm').prop('disabled', true);
      api('POST', '/api/appointments', {
        service_id: state.serviceId,
        master_id: state.masterId,
        time_slot_id: state.slotId,
      }).then(
        function (resp) {
          var appt = resp && resp.appointment;
          var $res = $root.find('#wizard-result')
            .prop('hidden', false)
            .empty();
          var when = appt ? formatDateTimeShort(appt.start_at) : '';
          $res.append(
            $('<div class="alert alert-success"></div>').html(
              'Запись создана' +
              (appt ? ' №' + escapeHtml(appt.id) + ' на ' + escapeHtml(when) : '') +
              '. <a href="/account">Перейти в кабинет →</a>'
            )
          );
          notify('Запись успешно создана', 'success');
          // Мягкий редирект, чтобы пользователь успел прочитать сообщение.
          setTimeout(function () { window.location.href = '/account'; }, 1200);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message || 'Не удалось создать запись', 'error');
        }
      );
    }

    // --- переключение шагов ---------------------------------------------

    /**
     * Переход на шаг `n` с ленивой подгрузкой данных, если надо.
     */
    function goToStep(n) {
      showStep(n);
      if (n === 2 && state.serviceId) loadMasters();
      if (n === 3) bindDateInput();
      if (n === 4) loadSlots();
    }

    // --- обработчики -----------------------------------------------------

    $root.on('change', '#wizard-category', renderServices);

    $root.on('click', '#wizard-services .wizard-item', function () {
      var id = Number($(this).attr('data-id'));
      var service = state.allServices.find(function (s) { return s.id === id; });
      if (service) selectService(service);
    });

    $root.on('click', '#wizard-masters .wizard-item', function () {
      var id = Number($(this).attr('data-id'));
      // Выбираем из DOM «мастера»: имя берём из карточки — этого
      // достаточно для отображения в summary.
      var master = { id: id, full_name: $(this).find('strong').text() };
      selectMaster(master);
    });

    $root.on('click', '#wizard-slots .slot', function () {
      selectSlot($(this));
    });

    $root.on('click', '.wizard-next', function () {
      var next = Number($(this).attr('data-next-step')) || null;
      if (next) goToStep(next);
    });
    $root.on('click', '.wizard-prev', function () {
      var prev = Number($(this).attr('data-prev-step')) || null;
      if (prev) goToStep(prev);
    });

    $root.on('click', '#wizard-confirm', confirmBooking);

    // Старт: загружаем каталог.
    loadStep1().fail(function (err) {
      notify(err.message || 'Не удалось загрузить каталог услуг', 'error');
    });
  }

  // ------------------------------------------------------------------
  // Клиентский кабинет: отмена и перенос
  // ------------------------------------------------------------------

  function initAppointmentActions() {
    // Отмена.
    $(document).on('click', '.appointments-table .cancel-btn', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Отменить запись №' + id + '?')) return;
      var $btn = $(this).prop('disabled', true);
      api('POST', '/api/appointments/' + id + '/cancel', {})
        .then(
          function () {
            notify('Запись отменена', 'success');
            setTimeout(function () { window.location.reload(); }, 600);
          },
          function (err) {
            $btn.prop('disabled', false);
            notify(err.message || 'Не удалось отменить запись', 'error');
          }
        );
    });

    // Перенос — открытие inline-wizard под строкой таблицы.
    $(document).on('click', '.appointments-table .reschedule-btn', function () {
      var $btn = $(this);
      var id = Number($btn.data('id'));
      if (!id) return;
      var $tr = $btn.closest('tr');

      // Сворачиваем, если уже открыт.
      var $existing = $tr.next('tr.reschedule-row');
      if ($existing.length) { $existing.remove(); return; }

      // Нужны master_id и service_id для подбора слотов. Берём их из
      // `/api/appointments/mine?status=active`. Дешёвый round-trip, зато
      // шаблон client.pug трогать не нужно.
      openReschedulePanel($tr, id);
    });
  }

  function openReschedulePanel($tr, appointmentId) {
    var colspan = $tr.children('td').length || 6;
    var $row = $(
      '<tr class="reschedule-row">' +
        '<td colspan="' + colspan + '">' +
          '<div class="reschedule-panel">' +
            '<p class="muted">Загрузка данных записи…</p>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
    $tr.after($row);

    var $panel = $row.find('.reschedule-panel');

    api('GET', '/api/appointments/mine?status=active').then(
      function (resp) {
        var appt = ((resp && resp.appointments) || []).find(function (a) {
          return Number(a.id) === appointmentId;
        });
        if (!appt) {
          $panel.empty().append('<p class="muted">Запись не найдена или уже недоступна для переноса.</p>');
          return;
        }
        renderReschedulePanel($panel, appt);
      },
      function (err) {
        $panel.empty().append(
          $('<p class="alert alert-error"></p>').text(err.message || 'Не удалось загрузить данные записи')
        );
      }
    );
  }

  function renderReschedulePanel($panel, appt) {
    $panel.empty();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var min = today.toISOString().slice(0, 10);
    var maxD = new Date(today.getTime() + 13 * 24 * 60 * 60 * 1000);
    var max = maxD.toISOString().slice(0, 10);

    $panel.append(
      '<h4>Перенос записи №' + escapeHtml(appt.id) + '</h4>' +
      '<p class="muted">Услуга: ' + escapeHtml(appt.service_name) +
        ' · Мастер: ' + escapeHtml(appt.master_name) + '</p>' +
      '<div class="form-row">' +
        '<label class="field"><span>Новая дата</span>' +
        '<input type="date" class="reschedule-date" min="' + min + '" max="' + max + '">' +
        '</label>' +
        '<button type="button" class="btn btn-secondary reschedule-cancel">Закрыть</button>' +
      '</div>' +
      '<div class="slots reschedule-slots"></div>' +
      '<div class="reschedule-actions">' +
        '<button type="button" class="btn btn-primary reschedule-submit" disabled>Перенести</button>' +
      '</div>'
    );

    var state = { slotId: null };

    $panel.find('.reschedule-cancel').on('click', function () {
      $panel.closest('tr.reschedule-row').remove();
    });

    $panel.find('.reschedule-date').on('change', function () {
      var date = $(this).val();
      state.slotId = null;
      $panel.find('.reschedule-submit').prop('disabled', true);
      var $slots = $panel.find('.reschedule-slots')
        .empty()
        .append('<p class="muted">Загрузка…</p>');
      if (!date) { $slots.empty(); return; }

      var url = '/api/masters/' + appt.master_id +
        '/slots?date=' + encodeURIComponent(date) +
        '&service_id=' + encodeURIComponent(appt.service_id);
      api('GET', url).then(
        function (resp) {
          var slots = (resp && resp.slots) || [];
          $slots.empty();
          if (!slots.length) {
            $slots.append('<p class="muted">На эту дату свободных интервалов нет.</p>');
            return;
          }
          slots.forEach(function (s) {
            $slots.append(
              $('<button type="button" class="slot"></button>')
                .attr('data-id', s.id)
                .text(formatTime(s.slot_start))
            );
          });
        },
        function (err) {
          $slots.empty().append(
            $('<p class="alert alert-error"></p>').text(err.message || 'Не удалось загрузить слоты')
          );
        }
      );
    });

    $panel.on('click', '.reschedule-slots .slot', function () {
      $panel.find('.reschedule-slots .slot').removeClass('selected');
      $(this).addClass('selected');
      state.slotId = Number($(this).attr('data-id'));
      $panel.find('.reschedule-submit').prop('disabled', false);
    });

    $panel.find('.reschedule-submit').on('click', function () {
      if (!state.slotId) return;
      var $btn = $(this).prop('disabled', true);
      api('POST', '/api/appointments/' + appt.id + '/reschedule', {
        time_slot_id: state.slotId,
      }).then(
        function () {
          notify('Запись перенесена', 'success');
          setTimeout(function () { window.location.reload(); }, 600);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message || 'Не удалось перенести запись', 'error');
        }
      );
    });
  }

  // ------------------------------------------------------------------
  // Мастер-кабинет 
  // ------------------------------------------------------------------

  function initMasterStatusButtons() {
    $(document).on('click', '.confirm-btn', function () {
      var id = Number($(this).data('id'));
      var status = $(this).data('status') || 'Confirmed';
      postStatus(this, id, { status: status });
    });
    $(document).on('click', '.start-btn', function () {
      var id = Number($(this).data('id'));
      var status = $(this).data('status') || 'InService';
      postStatus(this, id, { status: status });
    });
  }

  function initMasterCompleteForms() {
    $(document).on('submit', '.complete-form', function (e) {
      e.preventDefault();
      var $form = $(this);
      var id = Number($form.data('id'));
      var $input = $form.find('input[name="actual_price"]');
      var rawPrice = $input.val();
      var price = Number(rawPrice);
      if (!isFinite(price) || price < 0) {
        notify('Введите корректную фактическую стоимость (≥ 0)', 'error');
        $input.focus();
        return;
      }
      var $btn = $form.find('button[type="submit"]').prop('disabled', true);
      api('POST', '/api/appointments/' + id + '/status', {
        status: 'Completed',
        actual_price: price,
      }).then(
        function () {
          notify('Запись завершена', 'success');
          setTimeout(function () { window.location.reload(); }, 600);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message || 'Не удалось завершить запись', 'error');
        }
      );
    });
  }

  function postStatus(btn, id, body) {
    if (!id) return;
    var $btn = $(btn).prop('disabled', true);
    api('POST', '/api/appointments/' + id + '/status', body).then(
      function () {
        notify('Статус обновлён', 'success');
        setTimeout(function () { window.location.reload(); }, 600);
      },
      function (err) {
        $btn.prop('disabled', false);
        notify(err.message || 'Не удалось изменить статус', 'error');
      }
    );
  }

  // ------------------------------------------------------------------
  // Админ — категории
  // ------------------------------------------------------------------

  function initAdminCategoryForms() {
    $('#form-create-category').on('submit', function (e) {
      e.preventDefault();
      var data = readForm($(this));
      if (data.sort_order !== undefined && data.sort_order !== '') {
        data.sort_order = Number(data.sort_order);
      }
      api('POST', '/api/admin/service-categories', data).then(
        function () {
          notify('Категория создана', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });

    $(document).on('click', '.delete-category', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Удалить категорию №' + id + '?')) return;
      api('DELETE', '/api/admin/service-categories/' + id).then(
        function () {
          notify('Категория удалена', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
  }

  // ------------------------------------------------------------------
  // Админ — услуги
  // ------------------------------------------------------------------

  function initAdminServiceForms() {
    $('#form-create-service').on('submit', function (e) {
      e.preventDefault();
      var data = readForm($(this));
      data.category_id = Number(data.category_id);
      data.duration_min = Number(data.duration_min);
      data.base_price = Number(data.base_price);
      api('POST', '/api/admin/services', data).then(
        function () {
          notify('Услуга добавлена', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });

    // Переключение активности услуги (soft-delete/restore: пока сервер
    // поддерживает обновление is_active через PUT).
    $(document).on('change', '.active-toggle', function () {
      var id = Number($(this).data('id'));
      var is_active = $(this).is(':checked');
      api('PUT', '/api/admin/services/' + id, { is_active: is_active }).then(
        function () { notify('Статус услуги обновлён', 'success'); },
        function (err) { notify(err.message, 'error'); }
      );
    });

    // Инлайн-редактирование ячеек-editable (double-click → input).
    $(document).on('dblclick', '.editable', function () {
      var $td = $(this);
      if ($td.find('input').length) return;
      var field = $td.data('field');
      if (!field) return;
      var oldVal = $.trim($td.text());
      var $input = $('<input type="text">').val(oldVal);
      $td.empty().append($input);
      $input.trigger('focus');
      $input.on('blur keydown', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== 'Escape') return;
        if (e.type === 'keydown' && e.key === 'Escape') { $td.text(oldVal); return; }
        var newVal = $input.val();
        if (newVal === oldVal) { $td.text(oldVal); return; }
        var id = Number($td.closest('tr').data('id'));
        var payload = {};
        if (field === 'duration_min' || field === 'base_price') {
          payload[field] = Number(newVal);
        } else {
          payload[field] = newVal;
        }
        api('PUT', '/api/admin/services/' + id, payload).then(
          function () { $td.text(newVal); notify('Услуга обновлена', 'success'); },
          function (err) { $td.text(oldVal); notify(err.message, 'error'); }
        );
      });
    });

    $(document).on('click', '.delete-service', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Деактивировать услугу №' + id + '?')) return;
      api('DELETE', '/api/admin/services/' + id).then(
        function () {
          notify('Услуга деактивирована', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
  }

  // ------------------------------------------------------------------
  // Админ — привязки мастер ↔ услуга
  // ------------------------------------------------------------------

  function initAdminMasterServiceForms() {
    $('#form-attach-master-service').on('submit', function (e) {
      e.preventDefault();
      var data = readForm($(this));
      var masterId = Number(data.master_id);
      var serviceId = Number(data.service_id);
      if (!masterId || !serviceId) {
        notify('Выберите мастера и услугу', 'error');
        return;
      }
      api('POST', '/api/admin/masters/' + masterId + '/services', {
        service_id: serviceId,
      }).then(
        function () {
          notify('Привязка создана', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });

    $(document).on('click', '.detach-master-service', function () {
      var masterId = Number($(this).data('masterId'));
      var serviceId = Number($(this).data('serviceId'));
      if (!masterId || !serviceId) return;
      if (!confirm('Открепить мастера №' + masterId + ' от услуги №' + serviceId + '?')) return;
      api('DELETE', '/api/admin/masters/' + masterId + '/services/' + serviceId).then(
        function () {
          notify('Привязка удалена', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
  }

  // ------------------------------------------------------------------
  // Админ — расписания
  // ------------------------------------------------------------------

  function initAdminScheduleForm() {
    $('#form-create-schedule').on('submit', function (e) {
      e.preventDefault();
      var data = readForm($(this));
      var masterId = Number(data.master_id);
      if (!masterId) { notify('Выберите мастера', 'error'); return; }
      var payload = {
        date: data.date,
        start_time: data.start_time,
        end_time: data.end_time,
        slot_min: Number(data.slot_min),
      };
      api('POST', '/api/admin/masters/' + masterId + '/schedule', payload).then(
        function () {
          notify('Расписание создано', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
  }

  // ------------------------------------------------------------------
  // Админ — пользователи
  // ------------------------------------------------------------------

  function initAdminUserActions() {
    $(document).on('click', '.deactivate-user', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Деактивировать пользователя №' + id + '?')) return;
      var $btn = $(this).prop('disabled', true);
      api('POST', '/api/admin/users/' + id + '/deactivate', {}).then(
        function () {
          notify('Пользователь деактивирован', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message, 'error');
        }
      );
    });

    // Активация: обратная операция.
    $(document).on('click', '.activate-user', function () {
      var id = Number($(this).data('id'));
      if (!id) return;
      var $btn = $(this).prop('disabled', true);
      api('POST', '/api/admin/users/' + id + '/activate', {}).then(
        function () {
          notify('Пользователь активирован', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message, 'error');
        }
      );
    });

    // Смена роли. Если выбрана роль master и у пользователя ещё нет
    // профиля мастера, сервер попросит specialization — запрашиваем её
    // через prompt. Для client специализация не нужна.
    $(document).on('change', '.role-select', function () {
      var $sel = $(this);
      var id = Number($sel.data('id'));
      var role = String($sel.val());
      if (!id || !role) return;

      var payload = { role: role };
      if (role === 'master') {
        var spec = window.prompt(
          'Специализация мастера (оставьте пустым, если профиль уже существует):',
          ''
        );
        if (spec && spec.trim()) {
          payload.specialization = spec.trim();
        }
      }

      $sel.prop('disabled', true);
      api('POST', '/api/admin/users/' + id + '/role', payload).then(
        function () {
          notify('Роль изменена', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) {
          $sel.prop('disabled', false);
          notify(err.message, 'error');
          // Возвращаем выбор назад, чтобы UI отражал реальное состояние.
          setTimeout(function () { window.location.reload(); }, 600);
        }
      );
    });
  }

  function initAdminCreateUserForm() {
    $('#form-create-user').on('submit', function (e) {
      e.preventDefault();
      var $form = $(this);
      var data = readForm($form);

      // specialization нужен только для роли master, в иных случаях его
      // пропускаем, чтобы сервер не ругался на неожиданное поле.
      var payload = {
        role: data.role,
        login: data.login,
        password: data.password,
        full_name: data.full_name,
        email: data.email,
        phone: data.phone,
      };
      if (data.role === 'master' && data.specialization) {
        payload.specialization = data.specialization;
      }

      var $btn = $form.find('button[type="submit"]').prop('disabled', true);
      api('POST', '/api/admin/users', payload).then(
        function () {
          notify('Пользователь создан', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message, 'error');
        }
      );
    });
  }

  // ------------------------------------------------------------------
  // Админ — отчёты
  // ------------------------------------------------------------------

  function initAdminReportsForm() {
    $('#report-form').on('submit', function (e) {
      e.preventDefault();
      var data = readForm($(this));
      var payload = { type: data.type, date_from: data.date_from, date_to: data.date_to };
      if (data.client_id) payload.client_id = Number(data.client_id);
      var $res = $('#report-result').html('<p class="muted">Формирование отчёта…</p>');
      api('POST', '/api/admin/reports', payload).then(
        function (resp) { renderReport($res, resp.report); },
        function (err) {
          $res.empty().append($('<div class="alert alert-error"></div>').text(err.message || 'Ошибка'));
        }
      );
    });

    $(document).on('click', '.report-open', function () {
      var id = Number($(this).data('id'));
      if (!id) return;
      var $res = $('#report-result').html('<p class="muted">Загрузка…</p>');
      api('GET', '/api/admin/reports/' + id).then(
        function (resp) { renderReport($res, resp.report); },
        function (err) {
          $res.empty().append($('<div class="alert alert-error"></div>').text(err.message || 'Ошибка'));
        }
      );
    });
  }

  function renderReport($host, report) {
    if (!report) {
      $host.empty().append('<p class="muted">Пустой ответ.</p>');
      return;
    }
    var $root = $('<div></div>');
    $root.append(
      $('<h3></h3>').text('Отчёт №' + report.id + ' — ' + (report.type || ''))
    );
    $root.append(
      $('<p class="muted"></p>').text(
        'Период: ' + (report.date_from || '—') + ' — ' + (report.date_to || '—')
      )
    );
    if (report.total_amount !== null && report.total_amount !== undefined) {
      $root.append(
        $('<p></p>').html('Итого: <strong>' + escapeHtml(formatPrice(report.total_amount)) + '</strong>')
      );
    }
    if (!report.items || !report.items.length) {
      $root.append('<p class="muted">Данных за указанный период нет.</p>');
    } else {
      var $t = $('<table class="table"></table>');
      $t.append(
        '<thead><tr><th>#</th><th>Показатель</th><th>Значение</th><th>Доп.</th></tr></thead>'
      );
      var $tb = $('<tbody></tbody>');
      report.items.forEach(function (it, i) {
        var $tr = $('<tr></tr>');
        $tr.append($('<td></td>').text(i + 1));
        $tr.append($('<td></td>').text(it.label || ''));
        $tr.append($('<td></td>').text(it.value_num !== null && it.value_num !== undefined ? it.value_num : ''));
        $tr.append($('<td></td>').text(it.value_text || ''));
        $tb.append($tr);
      });
      $t.append($tb);
      $root.append($t);
    }
    if (report.id) {
      $root.append(
        $('<p></p>').html(
          '<a class="btn btn-link" href="/api/admin/reports/' + report.id +
          '/export?format=csv">Экспорт в CSV</a>'
        )
      );
    }
    $host.empty().append($root);
  }

  // ------------------------------------------------------------------
  // Легаси-биты: фильтр каталога и слоты на странице мастера
  // ------------------------------------------------------------------

  function initLegacyCatalogBits() {
    // Фильтр услуг по категории на странице /services (SSR-рендер).
    $('#category-filter').on('change', function () {
      var cat = $(this).val();
      $('#services-list .card').each(function () {
        var $c = $(this);
        if (!cat || String($c.data('categoryId')) === String(cat)) $c.show();
        else $c.hide();
      });
    });

    // Выбор даты на странице мастера → показ свободных слотов.
    var $picker = $('.schedule-picker');
    if ($picker.length) {
      var masterId = $picker.data('masterId');
      $picker.find('#schedule-date').on('change', function () {
        var date = $(this).val();
        var $slots = $picker.find('#available-slots');
        if (!date) { $slots.html('<p class="muted">Выберите дату.</p>'); return; }
        $slots.html('<p class="muted">Загрузка…</p>');
        api('GET', '/api/masters/' + masterId + '/slots?date=' + encodeURIComponent(date)).then(
          function (resp) {
            var slots = (resp && resp.slots) || [];
            if (!slots.length) {
              $slots.html('<p class="muted">На эту дату свободных интервалов нет.</p>');
              return;
            }
            var html = '';
            slots.forEach(function (s) {
              html += '<span class="slot">' + escapeHtml(formatTime(s.slot_start)) + '</span>';
            });
            $slots.html(html);
          },
          function (err) {
            $slots.html(
              '<p class="muted">Ошибка: ' + escapeHtml(err.message || 'не удалось загрузить') + '</p>'
            );
          }
        );
      });
    }
  }

  // ------------------------------------------------------------------
  // Мелкие утилиты
  // ------------------------------------------------------------------

  function readForm($form) {
    var out = {};
    $form.serializeArray().forEach(function (f) {
      if (!f.name) return;
      out[f.name] = f.value;
    });
    return out;
  }

  function toNumOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  // ==================================================================
  // Salon-enhancements: status-dropdown, confirmDeleteModal, image upload,
  // generic delete-entity handler.
  // ==================================================================

  // Маппинг entity → REST URL для delete-entity.
  var ENTITY_URLS = {
    'service':           '/api/admin/services',
    'service-category':  '/api/admin/service-categories',
    'master':            '/api/admin/masters',
    'client':            '/api/admin/clients',
    'user':              '/api/admin/users',
    'appointment':       '/api/admin/appointments',
    'schedule':          '/api/admin/schedule',
  };

  $(function () {
    initStatusDropdownHandlers();
    initConfirmDeleteModal();
    initImageUploadHandlers();
  });

  function initStatusDropdownHandlers() {
    $(document).on('change', 'select.status-dropdown', function () {
      var $sel = $(this);
      var id = Number($sel.data('appointment-id'));
      var status = String($sel.val() || '');
      if (!id || !status) return;
      $sel.prop('disabled', true);
      api('POST', '/api/appointments/' + id + '/status', { status: status }).then(
        function () {
          notify('Статус обновлён', 'success');
          setTimeout(function () { window.location.reload(); }, 500);
        },
        function (err) {
          $sel.prop('disabled', false);
          notify(err.message || 'Не удалось изменить статус', 'error');
        }
      );
    });
  }

  function initConfirmDeleteModal() {
    var pendingHref = null;

    $(document).on('click', '.delete-entity', function (e) {
      e.preventDefault();
      var entity = $(this).data('entity');
      var id = Number($(this).data('id'));
      var label = $(this).data('label') || ('#' + id);
      var base = ENTITY_URLS[entity];
      if (!base || !id) {
        notify('Неизвестная сущность для удаления: ' + entity, 'error');
        return;
      }
      pendingHref = base + '/' + id;
      var $modal = $('#confirm-delete-modal');
      $modal.find('#confirm-delete-message').text(
        'Удалить ' + entity + ' "' + label + '"?'
      );
      $modal.attr('hidden', false).attr('aria-hidden', 'false');
    });

    $(document).on('click', '#confirm-delete-modal [data-action="cancel"], #confirm-delete-modal .modal-backdrop', function () {
      var $modal = $('#confirm-delete-modal');
      $modal.attr('hidden', true).attr('aria-hidden', 'true');
      pendingHref = null;
    });

    $(document).on('click', '#confirm-delete-button', function () {
      if (!pendingHref) return;
      var url = pendingHref;
      var $btn = $(this).prop('disabled', true);
      api('DELETE', url).then(
        function () {
          notify('Удалено', 'success');
          var $modal = $('#confirm-delete-modal');
          $modal.attr('hidden', true).attr('aria-hidden', 'true');
          pendingHref = null;
          $btn.prop('disabled', false);
          setTimeout(function () { window.location.reload(); }, 500);
        },
        function (err) {
          $btn.prop('disabled', false);
          notify(err.message || 'Не удалось удалить', 'error');
        }
      );
    });
  }

  function initImageUploadHandlers() {
    $(document).on('submit', '.service-image-form', function (e) {
      e.preventDefault();
      uploadImage($(this), '/api/admin/services/', 'image');
    });
    $(document).on('submit', '.master-photo-form', function (e) {
      e.preventDefault();
      uploadImage($(this), '/api/admin/masters/', 'photo');
    });
    $(document).on('click', '.delete-service-image', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Удалить изображение услуги?')) return;
      api('DELETE', '/api/admin/services/' + id + '/image').then(
        function () {
          notify('Изображение удалено', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
    $(document).on('click', '.delete-master-photo', function () {
      var id = Number($(this).data('id'));
      if (!id || !confirm('Удалить фото мастера?')) return;
      api('DELETE', '/api/admin/masters/' + id + '/image').then(
        function () {
          notify('Фото удалено', 'success');
          setTimeout(function () { window.location.reload(); }, 400);
        },
        function (err) { notify(err.message, 'error'); }
      );
    });
  }

  function uploadImage($form, baseUrl, fieldName) {
    var id = Number($form.data('id'));
    if (!id) return;
    var fd = new FormData($form[0]);
    if (!fd.get(fieldName)) {
      notify('Выберите файл изображения', 'error');
      return;
    }
    var $btn = $form.find('button').prop('disabled', true);
    fetch(baseUrl + id + '/image', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
    }).then(function (resp) {
      return resp.json().then(function (json) { return { ok: resp.ok, status: resp.status, json: json }; });
    }).then(function (r) {
      $btn.prop('disabled', false);
      if (r.ok) {
        notify('Изображение загружено', 'success');
        setTimeout(function () { window.location.reload(); }, 500);
      } else {
        notify((r.json && r.json.message) || 'Не удалось загрузить', 'error');
      }
    }, function () {
      $btn.prop('disabled', false);
      notify('Сетевая ошибка при загрузке', 'error');
    });
  }
  
  function trackEvent(category, action, label) {
  if (window.ym && process.env?.YANDEX_METRIKA_ID) {
    window.ym(process.env.YANDEX_METRIKA_ID, 'reachGoal', action, {
      category, label,
    });
  }
}

// Пример: отслеживание создания записи
api('POST', '/api/appointments', data).then((resp) => {
  trackEvent('booking', 'appointment_created', `service_${data.service_id}`);
  notify('Запись создана', 'success');
});
})();