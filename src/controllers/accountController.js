'use strict';

// Контроллер личных кабинетов. 
 
const Appointment = require('../models/Appointment');
const Client = require('../models/Client');
const Master = require('../models/Master');
const { ForbiddenError } = require('../errors');

async function clientDashboard(req, res, next) {
  try {
    const user = req.session.user;
    const client = await Client.findByUserId(user.id);
    if (!client) return next(new ForbiddenError('Профиль клиента не найден'));

    const [active, history] = await Promise.all([
      Appointment.listForClient(user.id, { status: 'active' }),
      Appointment.listForClient(user.id, { status: 'history' }),
    ]);

    res.render('account/client', {
      title: 'Личный кабинет клиента',
      client,
      active,
      history,
    });
  } catch (err) {
    next(err);
  }
}

async function masterDashboard(req, res, next) {
  try {
    const user = req.session.user;
    const master = await Master.findById(user.id);
    if (!master) return next(new ForbiddenError('Профиль мастера не найден'));

    const q = String(req.query.q || '').trim();

    const [active, history] = await Promise.all([
      Appointment.listForMaster(user.id, { status: 'active' }),
      Appointment.listForMaster(user.id, { status: 'history' }),
    ]);

    function filterQ(rows) {
      if (!q) return rows;
      const needle = q.toLowerCase();
      return rows.filter((r) => {
        return (r.client_name || '').toLowerCase().includes(needle)
            || (r.service_name || '').toLowerCase().includes(needle)
            || String(r.start_at || '').toLowerCase().includes(needle);
      });
    }
    const activeF = filterQ(active);
    const historyF = filterQ(history);

    const activeByDate = new Map();
    for (const ap of activeF) {
      const date = String(ap.start_at).slice(0, 10);
      if (!activeByDate.has(date)) activeByDate.set(date, []);
      activeByDate.get(date).push(ap);
    }
    const activeGrouped = Array.from(activeByDate.entries()).map(
      ([date, items]) => ({ date, items })
    );

    res.render('account/master', {
      title: 'Личный кабинет мастера',
      master,
      activeGrouped,
      history: historyF,
      q,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { clientDashboard, masterDashboard };