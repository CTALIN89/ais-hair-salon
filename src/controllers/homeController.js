'use strict';

const Service = require('../models/Service');
const ServiceCategory = require('../models/ServiceCategory');
const Master = require('../models/Master');

exports.index = async (req, res, next) => {
  try {
    const [categories, services, masters] = await Promise.all([
      ServiceCategory.list(),
      Service.list({ activeOnly: true }),
      Master.list(),
    ]);
    res.render('home', {
      title: 'Салон-парикмахерская',
      categories,
      featuredServices: services.slice(0, 6),
      featuredMasters: masters.slice(0, 4),
    });
  } catch (err) {
    next(err);
  }
};
